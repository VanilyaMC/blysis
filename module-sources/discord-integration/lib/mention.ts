import type { AllowedMentions } from "./discord";

/**
 * Who an announcement pings, as an operator chose it.
 *
 * Stored per event in the setting `discord_mention_<event>`: empty or "none"
 * for nobody, "here", "everyone", or a role id. The ping goes out as a message
 * of its own after the embed, because Discord does not ping anybody named
 * inside an embed, and a ping in the same message as a long embed is easy to
 * scroll past.
 *
 * `allowed_mentions` names exactly the one mention chosen and nothing else.
 * Without it Discord pings nobody; with `parse: ["everyone"]` it would also
 * honour any `@everyone` a member managed to get into a title - which is why
 * the ping never travels with member-written text.
 */
export interface MentionMessage {
    content: string;
    allowed_mentions: AllowedMentions;
}

/** Discord ids are snowflakes: 17 to 20 digits. */
const ROLE_ID = /^\d{17,20}$/;

/** The setting an event's ping is kept in. */
export function mentionSettingKey(eventType: string): string {
    return `discord_mention_${eventType.replace(/\./g, "_")}`;
}

/** The follow-up message for a stored choice, or null when nobody is pinged. */
export function mentionMessage(choice: unknown): MentionMessage | null {
    if (typeof choice !== "string") return null;
    const value = choice.trim().replace(/^@/, "").replace(/^<@&(\d+)>$/, "$1").toLowerCase();
    if (value === "" || value === "none") return null;
    // `@here` and `@everyone` are both allowed by "everyone"; Discord has no
    // separate "here".
    if (value === "here") return { content: "@here", allowed_mentions: { parse: ["everyone"] } };
    if (value === "everyone") return { content: "@everyone", allowed_mentions: { parse: ["everyone"] } };
    if (ROLE_ID.test(value)) {
        // `parse: ["roles"]` beside a `roles` list is refused by Discord, and
        // would ping every role named anyway; the list alone pings this one.
        return { content: `<@&${value}>`, allowed_mentions: { parse: [], roles: [value] } };
    }
    return null;
}
