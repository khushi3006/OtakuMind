import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as fs from 'fs';
import * as path from 'path';

function normalizeEntry(name: string): { normalizedName: string; season: number } {
  const lowercaseMatch = name.toLowerCase();
  
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
  
  let normalized = lowercaseMatch;
  normalized = normalized.replace(/\(.*?\)/g, '');
  normalized = normalized.replace(/\[.*?\]/g, '');
  
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
    /\b(ii|iii|iv|v|vi)\b\s*$/gi,
  ];

  for (const pattern of removePatterns) {
    normalized = normalized.replace(pattern, ' ');
  }

  normalized = normalized.replace(/[-:;,!?.~]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ');
  return { normalizedName: normalized.trim(), season };
}

export async function GET() {
  try {
    // Removed count check to allow updating/re-seeding with new fields like originalOrder

    const filePath = path.join(process.cwd(), 'raw_anime_data.txt');
    if (!fs.existsSync(filePath)) {
       return NextResponse.json({ error: "raw_anime_data.txt not found" }, { status: 404 });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let processingCompleted = true; 
    
    const completedAnime: any[] = [];
    const currentlyWatching: any[] = [];
    let seenRawNames = new Set();
    
    for (const line of lines) {
      if (line.includes('OP - 1155') || line.includes('This is the complete list')) {
        processingCompleted = false;
      }
      
      if (processingCompleted) {
        const match = line.match(/^(\d+)\.\s*(.+)/);
        if (match) {
          const order = parseInt(match[1], 10);
          const rawName = match[2].trim();
          if (!seenRawNames.has(rawName)) {
            const { normalizedName, season } = normalizeEntry(rawName);
            
            let type = "TV";
            const isMovie = rawName.match(/\b(movie|film)\b/i) || (!rawName.match(/season/i) && !rawName.match(/episode/i) && !rawName.match(/s\d+/i) && !rawName.match(/part/i) && rawName.length > 0);
            if (isMovie) type = "Movie";

            completedAnime.push({
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
        if (line.includes('This is the complete list') || line.includes('which I am currently watching') || line.includes('acronyms')) continue;
        
        const split = line.split('-');
        const acronym = split[0].trim();
        const episodes = split.length > 1 ? parseInt(split[1].replace(/[^\d]/g, ''), 10) : 0;
        
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
        
        if (!seenRawNames.has(properName)) {
           const { normalizedName } = normalizeEntry(properName);
           currentlyWatching.push({
             name: properName,
             normalizedName,
             season: 1, 
             episodesWatched: isNaN(episodes) ? 0 : episodes,
             status: 'incomplete'
           });
           seenRawNames.add(properName);
        }
      }
    }

    const res1 = await db.anime.createMany({ data: completedAnime, skipDuplicates: true });
    const res2 = await db.anime.createMany({ data: currentlyWatching, skipDuplicates: true });
    
    return NextResponse.json({ 
       success: true, 
       completedCount: res1.count, 
       watchingCount: res2.count 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
