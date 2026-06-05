import { db } from '@/lib/db';

// Idempotent mirror of prisma/migrations/20260606000000_add_email_auth.
// Runs through the app's Neon/DNS-patched connection (more reliable locally
// than the Prisma CLI). Apply against both the dev and production branches.
async function main() {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PendingSignup" (
      "id" SERIAL NOT NULL,
      "email" TEXT NOT NULL,
      "name" TEXT,
      "username" TEXT,
      "passwordHash" TEXT NOT NULL,
      "otpHash" TEXT NOT NULL,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PendingSignup_pkey" PRIMARY KEY ("id")
    );`);
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PendingSignup_email_key" ON "PendingSignup"("email");`);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
      "id" SERIAL NOT NULL,
      "userId" INTEGER NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "usedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
    );`);
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");`);
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "PasswordResetToken"
        ADD CONSTRAINT "PasswordResetToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  console.log('email-auth tables ready');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
