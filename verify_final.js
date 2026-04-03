const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.anime.findMany({
    where: { originalOrder: { in: [1, 220, 236] } },
    orderBy: { originalOrder: 'asc' }
  });
  console.log(items);
}

main().finally(() => prisma.$disconnect());
