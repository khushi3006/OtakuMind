import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';

async function main() {
  console.log('Starting data migration to assign orphaned anime records to a default user...');

  const defaultEmail = 'ahmadfaraz00710@gmail.com';
  const defaultPass = 'password123';

  // 1. Create or find default user
  let defaultUser = await db.user.findUnique({
    where: { email: defaultEmail },
  });

  if (!defaultUser) {
    console.log(`Default user not found. Creating ${defaultEmail}...`);
    const hashedPassword = hashPassword(defaultPass);
    defaultUser = await db.user.create({
      data: {
        email: defaultEmail,
        password: hashedPassword,
        name: 'Default User',
      },
    });
    console.log(`Default user created with ID: ${defaultUser.id}`);
  } else {
    console.log(`Default user already exists with ID: ${defaultUser.id}`);
  }

  // 2. Count orphaned anime records
  const orphanCount = await db.anime.count({
    where: { userId: null },
  });

  console.log(`Found ${orphanCount} anime records without an owner.`);

  if (orphanCount > 0) {
    // 3. Update all orphaned records to have defaultUser.id as userId
    const updateResult = await db.anime.updateMany({
      where: { userId: null },
      data: {
        userId: defaultUser.id,
      },
    });
    console.log(`Successfully migrated ${updateResult.count} anime records to user ID ${defaultUser.id}!`);
  } else {
    console.log('No anime records needed migration.');
  }

  console.log('Data migration completed successfully!');
}

main()
  .catch((err) => {
    console.error('Data migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
