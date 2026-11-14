// @vitest-environment node
/**
 * A changelog release reaches Discord as an embed with a link a reader can
 * follow, and then, when the operator asked for one, a ping of its own.
 *
 * The ping is a second plain message because Discord pings nobody named inside
 * an embed, and it names in `allowed_mentions` exactly the one mention chosen:
 * Discord pings `@here` only when that list allows "everyone", and a role only
 * when the role is listed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const settings = new Map<string, unknown>();
const designed = new Map<string, Record<string, unknown>>();
const posts: { url: string; body: Record<string, unknown> }[] = [];
const WEBHOOK = "https://discord.com/api/webhooks/1/announce";

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        setting: {
            findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
                where.key.in.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) })),
            findUnique: async ({ where }: { where: { key: string } }) =>
                settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
        },
        discordEventMessage: {
            findUnique: async ({ where }: { where: { event: string } }) => designed.get(where.event) ?? null,
        },
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    recordWebhookDelivery: async () => {},
    resolveAppUrl: () => "https://site.example",
}));

const listener = async () => (await import("@/modules/discord-integration/listeners/changelog-entry-published")).default;
const blogListener = async () => (await import("@/modules/discord-integration/listeners/blog-article-created")).default;
const { mentionMessage } = await import("@/modules/discord-integration/lib/mention");

const entry = (over: Record<string, unknown> = {}) => ({
    id: "e1", number: 7, slug: "new-map", version: "2.0", title: "New map",
    content: "<p>A <strong>whole</strong> new world &amp; more.</p>", details: null,
    isActive: true, publishAt: null, createdAt: new Date("2026-11-14T10:00:00Z"),
    ...over,
});

beforeEach(() => {
    settings.clear();
    designed.clear();
    posts.length = 0;
    settings.set("discord_webhook_changelog_entry_published", WEBHOOK);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
        posts.push({ url, body: JSON.parse(init.body) });
        return new Response(null, { status: 204 });
    }));
});
afterEach(() => vi.unstubAllGlobals());

describe("a release that is not out yet", () => {
    it("is not announced while switched off", async () => {
        await (await listener())(entry({ isActive: false }));
        expect(posts).toEqual([]);
    });

    it("is not announced while it waits for its hour", async () => {
        await (await listener())(entry({ publishAt: new Date(Date.now() + 3_600_000) }));
        expect(posts).toEqual([]);
    });

    it("is announced once its hour has passed", async () => {
        await (await listener())(entry({ publishAt: new Date(Date.now() - 1000) }));
        expect(posts).toHaveLength(1);
    });
});

describe("a release that is out", () => {
    it("is posted once, as one embed, with no ping when none was chosen", async () => {
        await (await listener())(entry());
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toBe(WEBHOOK);
        const embeds = posts[0].body.embeds as Record<string, unknown>[];
        expect(embeds).toHaveLength(1);
        expect(embeds[0].title).toBe("2.0 - New map");
        expect(embeds[0].description).toContain("A whole new world & more.");
        expect(posts[0].body.content).toBeUndefined();
    });

    it("links to the timeline with an absolute https address when it has no page", async () => {
        await (await listener())(entry());
        const embed = (posts[0].body.embeds as Record<string, string>[])[0];
        expect(embed.url).toBe("https://site.example/changelog");
        expect(new URL(embed.url).protocol).toBe("https:");
        expect(embed.description).toContain("https://site.example/changelog");
    });

    it("links to its own page when it has one", async () => {
        await (await listener())(entry({ details: "<p>More</p>" }));
        const embed = (posts[0].body.embeds as Record<string, string>[])[0];
        expect(embed.url).toBe("https://site.example/changelog/7/new-map");
    });

    it("sends nothing when no webhook is set", async () => {
        settings.clear();
        await (await listener())(entry());
        expect(posts).toEqual([]);
    });

    it("sends nothing when the operator switched its designed message off", async () => {
        designed.set("changelog.entry.published", { isActive: false });
        await (await listener())(entry());
        expect(posts).toEqual([]);
    });

    it("uses the message the operator designed, with the values filled in", async () => {
        designed.set("changelog.entry.published", {
            isActive: true, title: "Update {version}", description: "{title}: {url}", fields: [], webhookUrl: null,
        });
        await (await listener())(entry());
        const embed = (posts[0].body.embeds as Record<string, string>[])[0];
        expect(embed.title).toBe("Update 2.0");
        expect(embed.description).toBe("New map: https://site.example/changelog");
    });
});

describe("the ping after it", () => {
    it("@here is a separate message allowed to ping everyone and nothing else", async () => {
        settings.set("discord_mention_changelog_entry_published", "here");
        await (await listener())(entry());
        expect(posts).toHaveLength(2);
        expect(posts[1].url).toBe(WEBHOOK);
        expect(posts[1].body.content).toBe("@here");
        expect(posts[1].body.embeds).toBeUndefined();
        expect(posts[1].body.allowed_mentions).toEqual({ parse: ["everyone"] });
    });

    it("a role is pinged by its id alone", async () => {
        settings.set("discord_mention_changelog_entry_published", "1568187050224779304");
        await (await listener())(entry());
        expect(posts[1].body.content).toBe("<@&1568187050224779304>");
        expect(posts[1].body.allowed_mentions).toEqual({ parse: [], roles: ["1568187050224779304"] });
    });

    it("is not sent when the announcement was refused", async () => {
        settings.set("discord_mention_changelog_entry_published", "here");
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
            posts.push({ url, body: JSON.parse(init.body) });
            return new Response("bad", { status: 400 });
        }));
        await (await listener())(entry());
        expect(posts).toHaveLength(1);
    });

    it("works for a blog article too", async () => {
        settings.set("discord_webhook_blog_article_created", WEBHOOK);
        settings.set("discord_mention_blog_article_created", "everyone");
        await (await blogListener())({ id: "a", number: 3, title: "Hello", slug: "hello", status: "PUBLISHED" });
        expect(posts).toHaveLength(2);
        expect((posts[0].body.embeds as Record<string, string>[])[0].url).toBe("https://site.example/blog/3/hello");
        expect(posts[1].body).toMatchObject({ content: "@everyone", allowed_mentions: { parse: ["everyone"] } });
    });

    it.each([
        ["", null],
        ["none", null],
        [null, null],
        ["@here", { content: "@here", allowed_mentions: { parse: ["everyone"] } }],
        ["everyone", { content: "@everyone", allowed_mentions: { parse: ["everyone"] } }],
        ["<@&123456789012345678>", { content: "<@&123456789012345678>", allowed_mentions: { parse: [], roles: ["123456789012345678"] } }],
        ["12", null],
        ["@someone", null],
    ])("%j is read as %j", (choice, expected) => {
        expect(mentionMessage(choice)).toEqual(expected);
    });
});
