import { log, prisma } from "@/core/sdk/server";
import { stripHtmlTags } from "@/core/sdk";
import { postToWebhook, isDiscordWebhook, sendDiscordWebhook, type WebhookPayload } from "./discord";
import { fillPlaceholders } from "./placeholders";
import { mentionMessage, mentionSettingKey } from "./mention";
import { embedRefusal } from "./embed-limits";

type Embed = NonNullable<WebhookPayload["embeds"]>[number];

export interface Announcement {
    /** The hook, as the manifest declares it (`changelog.entry.published`). */
    event: string;
    /** The settings key it routes under (`changelog_entry_published`). */
    webhookKey: string;
    /** What the operator's placeholders are filled with. */
    values: Record<string, string>;
    /** The embed this module ships, used when nobody has designed one. */
    embed: Embed;
}

/**
 * Post an announcement, then the ping the operator chose for it.
 *
 * The message an operator designed for the event wins over the one this
 * module ships, and a designed message switched off sends nothing. The ping,
 * when there is one, goes as a second plain message to the same channel, and
 * only after the embed was taken: a ping for a message that never arrived is
 * a ping to nothing.
 */
export async function announce({ event, webhookKey, values, embed }: Announcement): Promise<boolean> {
    let payloadEmbed: Embed = embed;
    let ownUrl: string | null = null;

    const designed = await prisma.discordEventMessage.findUnique({ where: { event } }).catch(() => null);
    if (designed) {
        if (!designed.isActive) return false;
        const fields = Array.isArray(designed.fields) ? (designed.fields as { name?: string; value?: string; inline?: boolean }[]) : [];
        const candidate: Embed = {
            title: designed.title ? fillPlaceholders(designed.title, values) : embed.title,
            url: embed.url,
            description: designed.description ? fillPlaceholders(designed.description, values) : embed.description,
            color: designed.color ?? embed.color,
            footer: designed.footer ? { text: fillPlaceholders(designed.footer, values) } : embed.footer,
            fields: fields.length > 0
                ? fields.map((field) => ({
                    name: fillPlaceholders(String(field.name ?? ""), values),
                    value: fillPlaceholders(String(field.value ?? ""), values),
                    inline: field.inline === true,
                }))
                : embed.fields,
            timestamp: embed.timestamp,
        };
        // A designed message that a long value pushed over the limit would be
        // refused outright; the shipped one is better than silence.
        if (!embedRefusal(candidate)) payloadEmbed = candidate;
        const own = designed.webhookUrl?.trim();
        if (own && isDiscordWebhook(own)) ownUrl = own;
    }

    let url: string | null;
    let ok: boolean;
    if (ownUrl) {
        const sent = await postToWebhook(ownUrl, { embeds: [payloadEmbed] });
        if (!sent.ok) log.error("[Discord Webhook] Refused", { eventType: webhookKey, status: sent.status, detail: sent.detail });
        url = ownUrl;
        ok = sent.ok;
    } else {
        const sent = await sendDiscordWebhook(webhookKey, { embeds: [payloadEmbed] });
        url = sent.url;
        ok = sent.ok;
    }
    if (!ok || !url) return false;

    const choice = await prisma.setting.findUnique({ where: { key: mentionSettingKey(webhookKey) } }).catch(() => null);
    const mention = mentionMessage(choice?.value);
    if (mention) {
        const pinged = await postToWebhook(url, mention);
        if (!pinged.ok) log.error("[Discord Webhook] Mention refused", { eventType: webhookKey, status: pinged.status, detail: pinged.detail });
    }
    log.info("[Discord] announced", { event, mention: mention ? mention.content : "none" });
    return true;
}

/** Plain text from what an editor wrote, cut to a line or two for an embed. */
export function excerpt(text: string | null | undefined, max = 300): string {
    if (!text) return "";
    const plain = stripHtmlTags(text.replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n"))
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (plain.length <= max) return plain;
    return plain.slice(0, max - 1).trimEnd() + "…";
}

/** An absolute address on this site for a path. */
export function siteUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

