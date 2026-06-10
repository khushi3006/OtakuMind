/**
 * Migration: add the moderation tables `Block` and `Report` (App Store UGC requirement —
 * in-app block + report). Idempotent. Run against EACH database (dev then prod):
 *   DATABASE_URL=<dev>  npx tsx scripts/migrate-add-block-report.ts
 *   DATABASE_URL=<prod> npx tsx scripts/migrate-add-block-report.ts
 *
 * IMPORTANT: the block-filtering added to the search / followers / profile routes queries the
 * `Block` table, so this MUST be applied BEFORE (or together with) deploying the code — otherwise
 * those existing routes 500 on a missing table.
 *
 * After running, mirror Prisma's history (per DB):
 *   npx prisma migrate resolve --applied 20260610120000_add_block_report
 *   npx prisma generate
 */
import { db } from '../lib/db';

async function main() {
  console.log('Creating "Block" and "Report" moderation tables (idempotent)...\n');

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Block" (
      "id"        SERIAL PRIMARY KEY,
      "blockerId" INTEGER NOT NULL,
      "blockedId" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey"
        FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey"
        FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");`,
  );
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Block_blockerId_idx" ON "Block"("blockerId");`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Block_blockedId_idx" ON "Block"("blockedId");`);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Report" (
      "id"             SERIAL PRIMARY KEY,
      "reporterId"     INTEGER NOT NULL,
      "reportedUserId" INTEGER NOT NULL,
      "reason"         TEXT NOT NULL,
      "details"        TEXT,
      "status"         TEXT NOT NULL DEFAULT 'open',
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey"
        FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedUserId_fkey"
        FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Report_reportedUserId_idx" ON "Report"("reportedUserId");`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Report_status_idx" ON "Report"("status");`);

  console.log('Done — "Block" and "Report" are present.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
