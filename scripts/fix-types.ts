import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const animes = await prisma.anime.findMany();
  let updatedCount = 0;

  for (const anime of animes) {
    if (anime.type === 'Movie') continue; // Already set

    const name = anime.name;
    const isMovie = name.match(/\b(movie|film)\b/i) || (!name.match(/season/i) && !name.match(/episode/i) && !name.match(/s\d+/i) && !name.match(/part/i) && name.length > 0);
    
    if (isMovie) {
      await prisma.anime.update({
        where: { id: anime.id },
        data: { type: 'Movie' }
      });
      updatedCount++;
    }
  }

  console.log(`Updated ${updatedCount} animes to Movie type.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
