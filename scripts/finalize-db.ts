import { db } from '../lib/db';

async function main() {
  console.log('Finalizing database schema - making userId NOT NULL...');

  // Set NOT NULL constraint on userId
  await db.$executeRawUnsafe(`
    ALTER TABLE "Anime" ALTER COLUMN "userId" SET NOT NULL;
  `);

  console.log('userId column is now NOT NULL!');
}

main()
  .catch((err) => {
    console.error('Finalization failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
