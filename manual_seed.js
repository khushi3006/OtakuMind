const { PrismaClient } = require('./prisma/generated/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

const categories = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'anime_categories.json'), 'utf-8'));

function detectType(order, rawName) {
  // Use the pre-categorized type if available, fallback to basic detection
  if (categories[order]) return categories[order];
  
  const name = rawName.toLowerCase();
  if (name.includes('movie') || name.includes('film')) return "Movie";
  if (name.includes('ova')) return "OVA";
  if (name.includes('special')) return "Special";
  return "TV";
}

function normalizeEntry(name) {
  const lowercaseMatch = name.toLowerCase();
  let season = 1;
  const sMatch = lowercaseMatch.match(/s(\d+)/);
  const seasonMatchStr = lowercaseMatch.match(/season\s*(\d+)/);
  if (sMatch) season = parseInt(sMatch[1], 10);
  else if (seasonMatchStr) season = parseInt(seasonMatchStr[1], 10);
  
  let normalized = lowercaseMatch.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
  return { normalizedName: normalized, season };
}

async function main() {
  console.log('Clearing database for fresh seed...');
  await prisma.anime.deleteMany();
  
  const filePath = path.join(process.cwd(), 'raw_anime_data.txt');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  const animeData = [];
  let seenRawNames = new Set();
  let processingCompleted = true;

  for (const line of lines) {
    if (line.includes('OP - 1155')) processingCompleted = false;
    
    if (processingCompleted) {
      const match = line.match(/^(\d+)\.\s*(.+)/);
      if (match) {
        const order = parseInt(match[1], 10);
        const rawName = match[2].trim();
        if (!seenRawNames.has(rawName)) {
          const { normalizedName, season } = normalizeEntry(rawName);
          const type = detectType(order, rawName);

          animeData.push({
            name: rawName,
            normalizedName,
            season,
            episodesWatched: 0,
            status: 'completed',
            type,
            originalOrder: order
          });
          seenRawNames.add(rawName);
        }
      }
    } else {
       if (line.includes('This is the complete list')) continue;
       const split = line.split('-');
       const name = split[0].trim();
       if (name && !seenRawNames.has(name)) {
         const { normalizedName } = normalizeEntry(name);
         // For currently watching, we use a basic detection or default to TV
         const type = detectType(0, name); 
         animeData.push({
           name,
           normalizedName,
           season: 1,
           status: 'incomplete',
           type,
           episodesWatched: split[1] ? parseInt(split[1].replace(/[^\d]/g, ''), 10) || 0 : 0
         });
         seenRawNames.add(name);
       }
    }
  }

  console.log(`Seeding ${animeData.length} records...`);
  const chunk = 50;
  for (let i = 0; i < animeData.length; i += chunk) {
    await prisma.anime.createMany({ data: animeData.slice(i, i + chunk) });
    console.log(`Uploaded items ${i} to ${Math.min(i + chunk, animeData.length)}`);
  }
  
  console.log('Seeding finished successfully.');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
