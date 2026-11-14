import { log, prisma } from "@/core/sdk/server";

/**
 * Telling the rest of the site that a release is out, once.
 *
 * `changelog.entry.published` used to fire when an entry was created, whatever
 * it was: switched off, or written now to go out next Tuesday. A listener that
 * took the name at its word announced a release nobody could see yet, and a
 * scheduled one was never announced at all, because the hour it went out was a
 * bulk update in a cron job that told nobody.
 *
 * So the hook fires at the moment a reader can first see the entry - on
 * create, on the edit that switches it on or clears its hour, or when that
 * hour comes - and only then. `announcedAt` is the memory of having done it:
 * claimed in the same statement that checks the entry is public, so two
 * requests (or the cron and an edit) racing for the same entry cannot both
 * win, and switching a release off and on again does not announce it twice.
 *
 * A failure here is logged, never thrown: the entry is saved either way, and a
 * missing announcement is a smaller harm than an editor told their release
 * was not saved when it was.
 */
export async function announceIfPublic(id: string, now: Date = new Date()): Promise<boolean> {
    try {
        const claimed = await prisma.changelogEntry.updateMany({
            where: {
                id,
                announcedAt: null,
                isActive: true,
                OR: [{ publishAt: null }, { publishAt: { lte: now } }],
            },
            data: { announcedAt: now },
        });
        if (claimed.count !== 1) return false;

        const entry = await prisma.changelogEntry.findUnique({ where: { id } });
        if (!entry) return false;

        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("changelog.entry.published", entry);
        return true;
    } catch (err) {
        log.error("[changelog] announcing a release failed", { id, error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}
