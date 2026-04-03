const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function checkAllDuplicates() {
  try {
    const all = await prisma.anime.findMany();
    const seen = new Set();
    const dupes = [];
    
    for (const a of all) {
      const key = `${a.normalizedName}|${a.season}`;
      if (seen.has(key)) {
        dupes.push(a);
      }
      seen.add(key);
    }
    
    if (dupes.length > 0) {
      console.log('Duplicates found:', JSON.stringify(dupes.map(d => ({ id: d.id, name: d.name, season: d.season })), null, 2));
    } else {
      console.log('No duplicates found.');
    }

    const malSeen = new Map();
    const malDupes = [];
    for (const a of all) {
      if (a.malId) {
        if (malSeen.has(a.malId)) {
          malDupes.push(a);
        }
        malSeen.set(a.malId, true);
      }
    }
    if (malDupes.length > 0) {
      console.log('MAL ID Duplicates found:', JSON.stringify(malDupes.map(d => ({ id: d.id, name: d.name, malId: d.malId })), null, 2));
    } else {
      console.log('No MAL ID duplicates found.');
    }

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllDuplicates();
