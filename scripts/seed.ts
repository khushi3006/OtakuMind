import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Duplicate of lib/normalize logic for pure CLI seeding context without strict alias dependency issues
function normalizeEntry(name: string): { normalizedName: string; season: number } {
  const lowercaseMatch = name.toLowerCase();
  
  // Extract season number
  let season = 1;
  const sMatch = lowercaseMatch.match(/s(\d+)/);
  const seasonMatchStr = lowercaseMatch.match(/season\s*(\d+)/);
  const rmMatch = lowercaseMatch.match(/\b(ii|iii|iv|v|vi)\b\s*(?:(?:episode)|(?:part)|$)/);
  
  if (sMatch) season = parseInt(sMatch[1], 10);
  else if (seasonMatchStr) season = parseInt(seasonMatchStr[1], 10);
  else if (rmMatch) {
    const map: Record<string, number> = { 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6 };
    season = map[rmMatch[1]] || 1;
  }
  
  // Remove patterns
  let normalized = lowercaseMatch;
  normalized = normalized.replace(/\(.*?\)/g, ''); // parenthetical blocks
  normalized = normalized.replace(/\[.*?\]/g, ''); // bracketed blocks
  
  const removePatterns = [
    /\bseason\s*\d+\b/gi,
    /\bs\d+\b/gi,
    /\bpart\s*\d+\b/gi,
    /\bthe movie\b/gi,
    /\bmovie\s*\d*\b/gi,
    /\bova\b/gi,
    /\bona\b/gi,
    /\bspecial(?:s)?\b/gi,
    /(?:the)?\s*final season\b/gi,
    /\bthe final\b/gi,
    /(?:2nd|3rd|4th|5th|6th|7th)\s*season\b/gi,
    /\b(ii|iii|iv|v|vi)\b\s*$/gi, // Trailing roman numerals
  ];

  for (const pattern of removePatterns) {
    normalized = normalized.replace(pattern, ' ');
  }

  normalized = normalized.replace(/[-:;,!?.~]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return { normalizedName: normalized.trim(), season };
}

const prisma = new PrismaClient();

async function main() {
  const filePath = path.join(process.cwd(), 'raw_anime_data.txt');
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let processingCompleted = true; // Switch to false when hitting Currently Watching list
  
  const completedAnime: any[] = [];
  const currentlyWatching: any[] = [];
  
  for (const line of lines) {
    if (line.includes('OP - 1155') || line.includes('This is the complete list')) {
      processingCompleted = false;
    }
    
    if (processingCompleted) {
      // It's like "1. Your Name"
      const match = line.match(/^\d+\.\s*(.+)/);
      if (match) {
        const rawName = match[1].trim();
        const { normalizedName, season } = normalizeEntry(rawName);
        completedAnime.push({
          name: rawName,
          normalizedName,
          season,
          episodesWatched: 0, // Unknown max, but completed. Let's assume 12 if none provided, but we can't be sure. We'll set status to 'completed'.
          status: 'completed'
        });
      }
    } else {
      if (line.includes('This is the complete list') || line.includes('and this is which I am currently watching')) continue;
      
      // format: acronym - episodes or acronym
      const split = line.split('-');
      const acronym = split[0].trim();
      const episodes = split.length > 1 ? parseInt(split[1].replace(/[^\d]/g, ''), 10) : 0;
      
      // Map known acronyms to proper names for aesthetics
      let properName = acronym;
      const map: Record<string, string> = {
        'OP': 'One Piece',
        'Fire': 'Fire Force',
        'Hell': "Hell's Paradise",
        'Rent': 'Rent-A-Girlfriend',
        'Rascal': 'Rascal Does Not Dream',
        'Sentenced': 'Sentenced to Be a Hero',
        'Shield': 'Rising of the Shield Hero',
        'Campfire Cooking': 'Campfire Cooking in Another World',
        'OPM': 'One Punch Man'
      };
      
      if (map[properName]) properName = map[properName];
      
      const { normalizedName } = normalizeEntry(properName);
      
      currentlyWatching.push({
        name: properName,
        normalizedName,
        season: 1, // Assume S1 by default
        episodesWatched: isNaN(episodes) ? 0 : episodes,
        status: 'incomplete'
      });
    }
  }
  
  console.log(`Parsed ${completedAnime.length} completed, ${currentlyWatching.length} watching/plan to watch.`);
  
  // Insert to Neon DB
  try {
    const resultCompleted = await prisma.anime.createMany({
      data: completedAnime,
      skipDuplicates: true
    });
    console.log(`Inserted ${resultCompleted.count} completed anime.`);
    
    const resultWatching = await prisma.anime.createMany({
      data: currentlyWatching,
      skipDuplicates: true
    });
    console.log(`Inserted ${resultWatching.count} incomplete anime.`);
    
  } catch (error) {
    console.error("Error seeding DB:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
