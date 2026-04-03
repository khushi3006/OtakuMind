export function normalizeAnimeName(name: string): string {
  // Common terms to remove to group different seasons together
  let normalized = name.toLowerCase();

  // Remove common bracketed/parentheses info completely (like " (Season X Y episodes)")
  normalized = normalized.replace(/\(.*\)/g, '');
  normalized = normalized.replace(/\[.*\]/g, '');

  // Remove terms following a colon or dash often indicating subtitles, unless it's very short.
  // Actually, some names like "Spry x Family" or "Konosuba: God's blessing" might be tricky.
  // It's safer to remove specific season keywords.

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
  ];

  for (const pattern of removePatterns) {
    normalized = normalized.replace(pattern, ' ');
  }

  // Remove trailing numbers (often representing seasons, but we must be careful with anime ending in numbers like "Mob Psycho 100")
  // Let's remove roman numerals at the end of strings or specific "II", "III" if preceded by space.
  normalized = normalized.replace(/\b(ii|iii|iv|v|vi)\b\s*$/gi, ' ');

  // Remove trailing punctuation and extra spaces
  normalized = normalized.replace(/[-:;,!?.~]/g, ' ');
  
  return normalized.trim().replace(/\s+/g, ' ');

}

export function extractSeasonNumber(name: string): number {
  const sMatch = name.match(/s(\d+)/i);
  if (sMatch) return parseInt(sMatch[1], 10);
  
  const seasonMatch = name.match(/season\s*(\d+)/i);
  if (seasonMatch) return parseInt(seasonMatch[1], 10);

  // Roman numerals mapping
  const rmMatch = name.match(/\b(ii|iii|iv|v|vi)\b\s*$/i);
  if (rmMatch) {
    const map: Record<string, number> = { 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6 };
    return map[rmMatch[1].toLowerCase()] || 1;
  }
  
  return 1;
}

export function inferAnimeType(name: string): string {
  const lowercase = name.toLowerCase();
  
  // Explicitly check for "movie" or "film"
  if (lowercase.match(/\b(movie|film)\b/i)) return "Movie";
  
  // If it's the movie list or doesn't have season/episode/sX markers, it's likely a movie
  if (!lowercase.match(/season/i) && !lowercase.match(/episode/i) && !lowercase.match(/s\d+/i) && !lowercase.match(/part/i)) {
    return "Movie";
  }
  
  return "TV";
}
