const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function checkWatching() {
  try {
    const data = await prisma.anime.findMany({
      where: { status: 'incomplete' },
      orderBy: { watchOrder: 'asc' }
    });
    console.log(JSON.stringify(data.map(a => ({ id: a.id, name: a.name, order: a.watchOrder, time: a.createdAt })), null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkWatching();
