import { resolveAppUrl } from "@/core/sdk/server";
import { announce, excerpt, siteUrl } from "../lib/announce";

interface ChangelogEntryPayload {
    id: string;
    number?: number | null;
    slug?: string | null;
    version: string;
    title: string;
    content?: string | null;
    details?: string | null;
    isActive?: boolean | null;
    publishAt?: string | Date | null;
    createdAt?: string | Date | null;
}

/**
 * Hook listener: fires on `changelog.entry.published`.
 *
 * The changelog fires that once per entry, at the moment a reader can first
 * see it. The check is repeated here anyway: an older changelog fired it on
 * every create, a switched-off draft and a release scheduled for next week
 * included, and announcing either would send people to a page that is not
 * there yet.
 */
export default async function onChangelogEntryPublished(payload: ChangelogEntryPayload): Promise<void> {
    if (!isPublic(payload)) return;

    const url = siteUrl(resolveAppUrl(), entryPath(payload));
    const released = payload.createdAt ? new Date(payload.createdAt) : new Date();
    const date = Number.isNaN(released.getTime()) ? "" : released.toISOString().slice(0, 10);
    const summary = excerpt(payload.content);

    await announce({
        event: "changelog.entry.published",
        webhookKey: "changelog_entry_published",
        values: { title: payload.title, version: payload.version, date, excerpt: summary, url },
        embed: {
            title: `${payload.version} - ${payload.title}`.slice(0, 256),
            url,
            description: `${summary ? `${summary}\n\n` : ""}${url}`,
            color: 0x3b82f6,
            fields: [
                { name: "Version", value: payload.version.slice(0, 1024), inline: true },
                ...(date ? [{ name: "Date", value: date, inline: true }] : []),
            ],
            timestamp: Number.isNaN(released.getTime()) ? new Date().toISOString() : released.toISOString(),
        },
    });
}

/** Switched on, and not waiting for an hour still to come. */
export function isPublic(entry: Pick<ChangelogEntryPayload, "isActive" | "publishAt">, now = new Date()): boolean {
    if (entry.isActive === false) return false;
    if (entry.publishAt) {
        const at = new Date(entry.publishAt);
        if (!Number.isNaN(at.getTime()) && at.getTime() > now.getTime()) return false;
    }
    return true;
}

/**
 * The entry's own page when it has one (an entry with details), otherwise the
 * timeline. Built the way the changelog builds it, so the link lands.
 */
export function entryPath(entry: Pick<ChangelogEntryPayload, "number" | "slug" | "details">): string {
    const hasPage = typeof entry.details === "string" && entry.details.trim() !== "";
    if (hasPage && entry.number) return `/changelog/${entry.number}/${entry.slug || "release"}`;
    return "/changelog";
}
