const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function cleanup() {
  try {
    // Delete duplicate Test Anime 1
    await prisma.anime.deleteMany({ where: { id: { in: [2590, 2591] } } });
    // Delete duplicate Jigokuraku
    await prisma.anime.delete({ where: { id: 2594 } });
    console.log('Cleanup successful');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
