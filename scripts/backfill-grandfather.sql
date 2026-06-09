-- One-time, run MANUALLY at launch against each Neon branch (dev, then production) with user consent.
-- Marks every pre-launch account as grandfathered (free lifetime access).
-- Replace the timestamp with the actual launch moment (UTC) before running.
UPDATE "User"
SET "grandfathered" = true
WHERE "createdAt" < '2026-07-01T00:00:00Z'   -- <<< LAUNCH_DATE: set before running
  AND "grandfathered" = false;
