import { log, prisma } from "@/core/sdk/server";
import { announceIfPublic } from "../lib/announce";

/**
 * Publish changelog entries whose `publishAt` has elapsed. Clears the
 * `publishAt` timestamp so the entry becomes publicly visible, and announces
 * each one (`changelog.entry.published`) the way a release published by hand
 * is announced - this used to be a bulk update that told nobody.
 */
export default async function publishScheduled(): Promise<void> {
    const now = new Date();
    try {
        const due = await prisma.changelogEntry.findMany({
            where: { publishAt: { lte: now } },
            select: { id: true },
            take: 500,
        });
        if (due.length === 0) return;

        const result = await prisma.changelogEntry.updateMany({
            where: { id: { in: due.map((row: { id: string }) => row.id) }, publishAt: { lte: now } },
            data: { publishAt: null },
        });
        let announced = 0;
        for (const row of due) {
            if (await announceIfPublic(row.id, now)) announced++;
        }
        if (result.count > 0) {
            log.info("cron: changelog entries published", { job: "changelog:publish-scheduled", published: result.count, announced });
        }
    } catch (err) {
        log.error("[changelog] publish-scheduled failed", { error: err instanceof Error ? err.message : String(err) });
    }
}
