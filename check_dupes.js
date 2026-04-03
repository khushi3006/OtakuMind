const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function checkDuplicates() {
  try {
    const data = await prisma.anime.findMany({
      where: {
        normalizedName: "jigokuraku"
      }
    });
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkDuplicates();
