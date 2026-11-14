-- A release is announced once, when a reader can first see it.
--
-- `changelog.entry.published` fired on create whatever the entry was, and
-- never when a scheduled one went out. It now fires at the moment the entry
-- becomes public, and this column remembers that it did, so switching a
-- release off and on again does not announce it a second time.
--
-- Every release that is already public has, as far as anybody downstream is
-- concerned, been announced: it is stamped with the day it went out, so an
-- edit to an old release announces nothing. A switched-off or scheduled one
-- stays unstamped and is announced when it goes out.
--
-- Safe on a fresh install and safe to re-run.

ALTER TABLE "ChangelogEntry" ADD COLUMN IF NOT EXISTS "announcedAt" TIMESTAMP(3);

UPDATE "ChangelogEntry"
   SET "announcedAt" = COALESCE("publishAt", "createdAt")
 WHERE "announcedAt" IS NULL
   AND "isActive" = TRUE
   AND ("publishAt" IS NULL OR "publishAt" <= CURRENT_TIMESTAMP);
