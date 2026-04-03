const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.anime.count();
  console.log('Total anime count:', count);
  const completed = await prisma.anime.findMany({
    where: { status: 'completed' },
    take: 5
  });
  console.log('Sample completed anime:', completed);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
