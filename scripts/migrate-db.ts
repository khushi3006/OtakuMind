import { db } from '../lib/db';

async function main() {
  console.log('Starting custom database migration via raw SQL...');

  // 1. Create User table
  console.log('Creating User table...');
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" SERIAL PRIMARY KEY,
      "email" TEXT UNIQUE NOT NULL,
      "password" TEXT NOT NULL,
      "name" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('User table created or already exists.');

  // 2. Alter Anime table to add userId as optional temporarily
  console.log('Altering Anime table to add optional userId...');
  await db.$executeRawUnsafe(`
    ALTER TABLE "Anime" ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES "User"("id") ON DELETE CASCADE;
  `);
  console.log('userId column added or already exists.');

  // 3. Drop the old global unique constraint on normalizedName and season
  console.log('Dropping old Anime_normalizedName_season_key unique constraint...');
  try {
    await db.$executeRawUnsafe(`
      ALTER TABLE "Anime" DROP CONSTRAINT IF EXISTS "Anime_normalizedName_season_key";
    `);
    console.log('Dropped old constraint.');
  } catch (err: any) {
    console.warn('Warning dropping Anime_normalizedName_season_key:', err.message);
  }

  // 4. Drop the global unique constraint on malId
  console.log('Dropping old Anime_malId_key unique constraint...');
  try {
    await db.$executeRawUnsafe(`
      ALTER TABLE "Anime" DROP CONSTRAINT IF EXISTS "Anime_malId_key";
    `);
    console.log('Dropped malId unique constraint.');
  } catch (err: any) {
    console.warn('Warning dropping Anime_malId_key:', err.message);
  }

  // 5. Add user-scoped unique constraint (after we make userId required, but we can do it now if we handle nulls correctly or do it after seeding)
  console.log('Adding user-scoped unique constraint for [userId, normalizedName, season]...');
  try {
    await db.$executeRawUnsafe(`
      ALTER TABLE "Anime" ADD CONSTRAINT "Anime_userId_normalizedName_season_key" UNIQUE ("userId", "normalizedName", "season");
    `);
    console.log('Added user-scoped unique constraint.');
  } catch (err: any) {
    if (err.message.includes('already exists')) {
      console.log('User-scoped unique constraint already exists.');
    } else {
      console.warn('Warning adding unique constraint:', err.message);
    }
  }

  console.log('Custom database migration completed successfully!');
}

main()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
