import { log, prisma, recordWebhookDelivery } from "@/core/sdk/server";

interface DiscordEmbed {
    title?: string;
    url?: string;
    description?: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: { text: string };
    timestamp?: string;
    thumbnail?: { url: string };
}

/**
 * Who a message may ping. Discord pings nobody a message names unless this
 * lets it, so `@here` in `content` with no `allowed_mentions` is plain text.
 */
export interface AllowedMentions {
    parse: ("everyone" | "roles" | "users")[];
    roles?: string[];
    users?: string[];
}

export interface WebhookPayload {
    content?: string;
    embeds?: DiscordEmbed[];
    username?: string;
    avatar_url?: string;
    allowed_mentions?: AllowedMentions;
}

export interface WebhookResult {
    ok: boolean;
    status: number;
    detail: string | null;
    /** The address it went to, so a follow-up lands in the same channel. */
    url: string | null;
}

/**
 * Generic Discord webhook sender.
 *
 * Modules call this with their own event type key.
 * The webhook URL is resolved from settings:
 *   1. `discord_webhook_{eventType}` (dots replaced with underscores)
 *   2. `discord_webhook_general` fallback
 *   3. DISCORD_WEBHOOK_URL env var fallback
 *
 * Example usage from a module:
 *   sendDiscordWebhook("order_completed", { embeds: [...] })
 *   sendDiscordWebhook("ticket_created", { embeds: [...] })
 */
export async function sendDiscordWebhook(
    eventType: string,
    payload: WebhookPayload
): Promise<WebhookResult> {
    const url = await resolveWebhookUrl(eventType);
    if (!url) return { ok: false, status: 0, detail: null, url: null };

    const sent = await postToWebhook(url, payload);
    if (!sent.ok) {
        // `fetch` does not throw on a 400, so this used to be silent: an embed
        // the service refused looked exactly like one it took, and an operator
        // found out by noticing the messages had stopped.
        log.error("[Discord Webhook] Refused", { eventType, status: sent.status, detail: sent.detail });
    }
    return { ...sent, url };
}

/**
 * Where an event's messages go: its own webhook, else the general one, else
 * `DISCORD_WEBHOOK_URL`. Null when none is set or the one set is not one of
 * the service's own addresses (a tampered value must not exfiltrate payloads).
 */
export async function resolveWebhookUrl(eventType: string): Promise<string | null> {
    const specificKey = `discord_webhook_${eventType.replace(/\./g, "_")}`;
    const generalKey = "discord_webhook_general";

    const settings = await prisma.setting.findMany({
        where: { key: { in: [specificKey, generalKey] } },
    });

    const specific = settings.find((s: { key: string; value: unknown }) => s.key === specificKey);
    let url: string | null = null;

    if (specific && typeof specific.value === "string" && specific.value.startsWith("http")) {
        url = specific.value;
    } else {
        const general = settings.find((s: { key: string; value: unknown }) => s.key === generalKey);
        if (general && typeof general.value === "string" && general.value.startsWith("http")) {
            url = general.value;
        } else {
            url = process.env.DISCORD_WEBHOOK_URL || null;
        }
    }

    if (!url) return null;

    // Validate webhook domain - only post to official Discord hosts so a
    // tampered setting value can't be used to exfiltrate payloads (SSRF).
    // Exact-or-subdomain match - endsWith("discord.com") alone would also
    // accept "evildiscord.com" / "discord.com.attacker.test" (SSRF bypass).
    if (!isDiscordWebhook(url)) {
        log.warn("[Discord] Invalid webhook domain", { eventType });
        return null;
    }
    return url;
}

/**
 * One POST, with the answer read.
 *
 * The service refuses a message it cannot take with a status and a body
 * naming the part it did not like, and that body is the only useful thing
 * anybody gets when a message does not arrive.
 *
 * Every path out records the attempt, so whatever keeps the webhook log has a
 * row for a message that never arrived as well as one that did. The address
 * is cut to its origin on the way: a Discord webhook URL is the key to that
 * channel.
 */
export async function postToWebhook(
    url: string,
    payload: WebhookPayload,
): Promise<{ ok: boolean; status: number; detail: string | null }> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, username: payload.username || "Blysis" }),
        });
        if (res.ok) {
            await recordWebhookDelivery({ event: "discord.message", url, status: res.status, ok: true, detail: null });
            return { ok: true, status: res.status, detail: null };
        }
        const detail = await res.text().catch(() => "");
        await recordWebhookDelivery({ event: "discord.message", url, status: res.status, ok: false, detail: detail || null });
        return { ok: false, status: res.status, detail: detail.slice(0, 300) || null };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[Discord Webhook] Failed to send", { error: message });
        // Status zero: the request never got an answer at all.
        await recordWebhookDelivery({ event: "discord.message", url, status: 0, ok: false, detail: message });
        return { ok: false, status: 0, detail: null };
    }
}

/** Whether a URL is one of the service's own webhook addresses. */
export function isDiscordWebhook(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
        return ["discord.com", "discordapp.com"].some((d) => host === d || host.endsWith("." + d));
    } catch {
        return false;
    }
}
