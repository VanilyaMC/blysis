// @vitest-environment node
/**
 * `changelog.entry.published` fires once per release, at the moment a reader
 * can first see it: on create when it is out, on the edit that switches it on,
 * or when the cron reaches its hour - never for a switched-off or scheduled
 * entry, and never twice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };
let nextNumber = 1;
const fired: { hook: string; id: string }[] = [];

const changelogEntry = fakeTable(() => ({
    number: nextNumber++, isActive: true, publishAt: null, announcedAt: null, details: null, coverImage: null,
    type: "update", color: "#3b82f6", createdAt: new Date(),
}));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = {
    changelogEntry, contentTranslation,
    activityFeedItem: { create: async () => ({}) },
};
db.$transaction = fakeTransaction(db, [changelogEntry.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => true,
        readJsonBody: async () => body.value,
        recordRevision: async () => {},
        log: { info: () => {}, warn: () => {}, error: () => {} },
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/core/sdk", () => ({
    doActionAsync: async (hook: string, entry: { id: string }) => { fired.push({ hook, id: entry.id }); },
}));

const published = () => fired.filter((f) => f.hook === "changelog.entry.published");

async function create(payload: Record<string, unknown> = {}) {
    body.value = { version: "1.0", title: "Yeni harita", content: "x", ...payload };
    const { POST } = await import("../../../module-sources/changelog/api/route");
    const res = await POST(new Request("https://example.com/api/v1/changelog", { method: "POST" }) as never);
    return (await res.json()).entry as { id: string };
}

async function edit(id: string, payload: Record<string, unknown>) {
    body.value = payload;
    const { PATCH } = await import("../../../module-sources/changelog/api/[id]/route");
    await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, { params: Promise.resolve({ id }) });
}

async function cron() {
    const { default: run } = await import("../../../module-sources/changelog/cron/publish-scheduled");
    await run();
}

beforeEach(() => {
    changelogEntry.table.rows = [];
    contentTranslation.table.rows = [];
    fired.length = 0;
});

describe("a release", () => {
    it("that is out when created is announced once", async () => {
        const entry = await create();
        expect(published()).toEqual([{ hook: "changelog.entry.published", id: entry.id }]);
        await edit(entry.id, { title: "Renamed" });
        await cron();
        expect(published()).toHaveLength(1);
    });

    it("scheduled for later is not announced until the cron reaches its hour", async () => {
        const entry = await create({ publishAt: new Date(Date.now() + 3_600_000).toISOString() });
        expect(published()).toEqual([]);
        await cron();
        expect(published()).toEqual([]);

        // Its hour arrives.
        (changelogEntry.table.rows[0] as { publishAt: Date }).publishAt = new Date(Date.now() - 1000);
        await cron();
        expect(published()).toEqual([{ hook: "changelog.entry.published", id: entry.id }]);
        await cron();
        expect(published()).toHaveLength(1);
    });

    it("switched off is announced when switched on, and not again after off and on", async () => {
        const entry = await create();
        fired.length = 0;
        (changelogEntry.table.rows[0] as Record<string, unknown>).isActive = false;
        (changelogEntry.table.rows[0] as Record<string, unknown>).announcedAt = null;

        await edit(entry.id, { title: "Still hidden" });
        expect(published()).toEqual([]);

        await edit(entry.id, { isActive: true });
        expect(published()).toHaveLength(1);

        await edit(entry.id, { isActive: false });
        await edit(entry.id, { isActive: true });
        expect(published()).toHaveLength(1);
    });
});
