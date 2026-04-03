const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function cleanup() {
  try {
    await prisma.anime.deleteMany({
      where: {
        malId: { in: [999991, 999992] }
      }
    });
    console.log('Cleanup successful');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
