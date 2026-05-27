import { db } from '../lib/db';
import { slugifyUsername, findAvailableUsername } from '../lib/username';

/**
 * Idempotent migration for the social/follow layer:
 *  - User.username (unique, NOT NULL), User.bio, User.isPublic
 *  - Backfill usernames for existing users from their email local-part
 *  - Follow join table (follower -> following)
 *
 * Constraint/index names mirror what Prisma would generate so the formal
 * schema (prisma/schema.prisma) and the live DB stay in agreement.
 */
async function main() {
  console.log('Adding social schema (username / bio / isPublic / Follow)...');

  // 1. Add the new User columns (username nullable for now so we can backfill).
  await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;`);
  await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;`);
  console.log('User columns ensured.');

  // 2. Backfill usernames for any user that does not have one yet.
  const users = await db.$queryRaw<Array<{ id: number; email: string; username: string | null }>>`
    SELECT "id", "email", "username" FROM "User" ORDER BY "id" ASC
  `;

  const used = new Set<string>(
    users.map((u) => (u.username || '').toLowerCase()).filter(Boolean),
  );

  let backfilled = 0;
  for (const user of users) {
    if (user.username) continue;
    const base = slugifyUsername(user.email.split('@')[0] || `user${user.id}`);
    const username = await findAvailableUsername(base, async (c) => used.has(c.toLowerCase()));
    used.add(username.toLowerCase());
    await db.$executeRawUnsafe(`UPDATE "User" SET "username" = $1 WHERE "id" = $2`, username, user.id);
    backfilled++;
    console.log(`  user #${user.id} (${user.email}) -> @${username}`);
  }
  console.log(`Backfilled ${backfilled} username(s).`);

  // 3. Enforce NOT NULL + uniqueness + index on username.
  await db.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;`);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_username_key') THEN
        ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE ("username");
      END IF;
    END $$;
  `);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User" ("username");`);
  console.log('username constraints + index ensured.');

  // 4. Create the Follow table.
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Follow" (
      "id" SERIAL PRIMARY KEY,
      "followerId" INTEGER NOT NULL,
      "followingId" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Follow_followerId_followingId_key') THEN
        ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_followingId_key" UNIQUE ("followerId", "followingId");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Follow_followerId_fkey') THEN
        ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey"
          FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Follow_followingId_fkey') THEN
        ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey"
          FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Follow_followerId_idx" ON "Follow" ("followerId");`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Follow_followingId_idx" ON "Follow" ("followingId");`);
  console.log('Follow table ensured.');

  console.log('Social schema migration completed successfully!');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
