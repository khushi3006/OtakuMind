const { PrismaClient } = require('../prisma/generated/client');
const prisma = new PrismaClient();

async function main() {
  const animes = await prisma.anime.findMany();
  console.log(`Found ${animes.length} anime entries in the database.`);
  let updatedCount = 0;
  
  for (const anime of animes) {
    if (anime.type === 'Movie') {
      // Movies have no episodes
      await prisma.anime.update({
        where: { id: anime.id },
        data: { totalEpisodes: 0 }
      });
      console.log(`Updated Movie "${anime.name}" totalEpisodes to 0.`);
      updatedCount++;
      continue;
    }
    
    // Parse total episodes from the name if possible
    let totalEpisodes = 0;
    const name = anime.name;
    
    // Check patterns like "(Season X 26 episodes)", "12 episodes + 1 ova"
    const epMatch = name.match(/(\d+)\s*episodes?/i);
    // Check patterns like "Episode 01 - 25" or "01 - 25"
    const rangeMatch = name.match(/episodes?\s*\d+\s*-\s*(\d+)/i);
    const rangeMatch2 = name.match(/episode\s*\d+\s*-\s*(\d+)/i);
    const rangeMatch3 = name.match(/episode\s*01\s*-\s*(\d+)/i);
    const simpleRange = name.match(/01\s*-\s*(\d+)/i);

    if (epMatch) {
      totalEpisodes = parseInt(epMatch[1], 10);
    } else if (rangeMatch) {
      totalEpisodes = parseInt(rangeMatch[1], 10);
    } else if (rangeMatch2) {
      totalEpisodes = parseInt(rangeMatch2[1], 10);
    } else if (rangeMatch3) {
      totalEpisodes = parseInt(rangeMatch3[1], 10);
    } else if (simpleRange) {
      totalEpisodes = parseInt(simpleRange[1], 10);
    }

    if (totalEpisodes > 0) {
      await prisma.anime.update({
        where: { id: anime.id },
        data: { totalEpisodes }
      });
      console.log(`Updated TV/OVA "${name}" to totalEpisodes: ${totalEpisodes}`);
      updatedCount++;
    } else {
      // Default to 12 if it could not be parsed and it is TV type
      await prisma.anime.update({
        where: { id: anime.id },
        data: { totalEpisodes: 12 }
      });
      console.log(`Could not parse total episodes for "${name}". Defaulted to 12.`);
      updatedCount++;
    }
  }
  
  console.log(`Finished updating totalEpisodes for ${updatedCount} anime entries.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
