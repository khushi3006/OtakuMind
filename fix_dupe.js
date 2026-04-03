const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function fixDupe() {
  try {
    const data = await prisma.anime.findMany({ where: { malId: 36654 } });
    console.log('Found:', JSON.stringify(data, null, 2));
    
    if (data.length > 1) {
      // Delete the second one (usually the newer one with higher id)
      const toDelete = data[1].id;
      await prisma.anime.delete({ where: { id: toDelete } });
      console.log(`Deleted duplicate id: ${toDelete}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

fixDupe();
