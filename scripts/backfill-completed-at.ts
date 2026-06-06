/**
 * One-time backfill of Anime.completedAt for historically-imported completed
 * rows that never had it set.
 *
 * Why: completedAt was added later, so older completed rows are NULL. The
 * "Completed" sort therefore fell back to createdAt (bulk-import timestamp),
 * making "Recently/Oldest Completed" meaningless. originalOrder preserves the
 * user's historical watch/import sequence (1..N), so we use it as the proxy:
 * lower originalOrder = completed earlier. Synthetic timestamps are placed
 * strictly BEFORE each user's earliest real completedAt, so genuine app-era
 * completions always sort as more recent.
 *
 * Idempotent: only touches rows where status='completed' AND completedAt IS NULL.
 * Run per branch:
 *   DOTENV_CONFIG_PATH=.env.development npx tsx -r dotenv/config scripts/backfill-completed-at.ts
 *   DOTENV_CONFIG_PATH=.env.production  npx tsx -r dotenv/config scripts/backfill-completed-at.ts
 * Add --apply to write; without it, dry-run only.
 */
import { db } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const MINUTE = 60 * 1000;

type Target = { id: number; userId: number; originalOrder: number | null; createdAt: Date };

async function main() {
  const host = (process.env.DATABASE_URL || '').replace(/postgresql:\/\/[^@]*@([^/]+)\/.*/, '$1');
  console.log(`DB host: ${host || '(unset)'}\n`);
  const targets: Target[] = await db.$queryRawUnsafe(
    `SELECT id, "userId", "originalOrder", "createdAt"
     FROM "Anime" WHERE status='completed' AND "completedAt" IS NULL`
  );
  const realMins: { userId: number; m: Date }[] = await db.$queryRawUnsafe(
    `SELECT "userId", MIN("completedAt") AS m
     FROM "Anime" WHERE status='completed' AND "completedAt" IS NOT NULL
     GROUP BY "userId"`
  );
  const earliestCreated: { userId: number; m: Date }[] = await db.$queryRawUnsafe(
    `SELECT "userId", MIN("createdAt") AS m
     FROM "Anime" WHERE status='completed' GROUP BY "userId"`
  );
  const realMinByUser = new Map(realMins.map((r) => [r.userId, new Date(r.m)]));
  const earliestByUser = new Map(earliestCreated.map((r) => [r.userId, new Date(r.m)]));

  // group + rank per user
  const byUser = new Map<number, Target[]>();
  for (const t of targets) {
    if (!byUser.has(t.userId)) byUser.set(t.userId, []);
    byUser.get(t.userId)!.push(t);
  }

  const updates: { id: number; ts: Date }[] = [];
  for (const [userId, rows] of byUser) {
    // Rows WITH originalOrder are a historical import (watched before the app
    // tracked completedAt): give them synthetic timestamps strictly BEFORE the
    // user's earliest real completion, ordered by originalOrder (lower = earlier).
    // Rows WITHOUT originalOrder have no historical signal -> completedAt =
    // createdAt, so they slot into their natural place instead of the bottom.
    const historical = rows
      .filter((r) => r.originalOrder != null)
      .sort((a, b) => a.originalOrder! - b.originalOrder!);
    const natural = rows.filter((r) => r.originalOrder == null);

    const anchor = realMinByUser.get(userId) ?? earliestByUser.get(userId) ?? new Date(rows[0].createdAt);
    const H = historical.length;
    historical.forEach((r, rank) => {
      updates.push({ id: r.id, ts: new Date(anchor.getTime() - (H - rank) * MINUTE) });
    });
    natural.forEach((r) => {
      updates.push({ id: r.id, ts: new Date(r.createdAt) });
    });
    console.log(
      `user ${userId}: ${rows.length} rows -> ${H} historical (originalOrder ${historical[0]?.originalOrder ?? '-'}..${historical[H - 1]?.originalOrder ?? '-'}, before ${anchor.toISOString()}), ${natural.length} natural (completedAt=createdAt)`
    );
  }

  console.log(`\nTotal rows to update: ${updates.length} (${APPLY ? 'APPLYING' : 'DRY RUN — pass --apply to write'})`);
  if (!APPLY) return process.exit(0);

  await db.$transaction(
    updates.map((u) =>
      db.$executeRawUnsafe(`UPDATE "Anime" SET "completedAt"=$1 WHERE id=$2`, u.ts, u.id)
    )
  );
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
