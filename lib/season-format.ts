/**
 * Shared season label/parse rules used by the web UI and the standalone tests.
 * Keep in sync with the mobile app's src/lib/format.ts (seasonLabel) and
 * src/components/anime/edit-anime-sheet.tsx (parseSeasonField).
 */

/** "Movie"/"OVA"/"Special" by type, "Final Season" for 99, else "Season N",
 *  with "· Part P" appended for a split-cour part. */
export function formatSeasonText(season: number, part: number | null, type: string): string {
  if (type === 'Movie') return 'Movie';
  if (type === 'OVA') return 'OVA';
  if (type === 'Special') return 'Special';
  const base = season === 99 ? 'Final Season' : `Season ${season}`;
  return part != null ? `${base} · Part ${part}` : base;
}

/** Parse the free-text Season field into { season, part, type }. Extracts the
 *  part first and strips it so its digit can't bleed into the season match. */
export function parseSeasonField(value: string): { season: number; part: number | null; type: string } {
  const raw = value.trim();
  const partMatch = raw.match(/(?:part|cour)\s*(\d+)/i);
  const part = partMatch ? parseInt(partMatch[1], 10) : null;
  const normalized = raw
    .replace(/(?:part|cour)\s*\d+/i, '')
    .replace(/·/g, ' ')
    .trim()
    .toLowerCase();

  if (normalized === 'movie') return { season: 1, part: null, type: 'Movie' };
  if (normalized === 'ova') return { season: 1, part: null, type: 'OVA' };
  if (normalized === 'special') return { season: 1, part: null, type: 'Special' };
  if (normalized === 'final season' || normalized === 'the final season') {
    return { season: 99, part, type: 'TV' };
  }
  const match = normalized.match(/(?:season|s)?\s*(\d+)/i);
  if (match) return { season: parseInt(match[1], 10), part, type: 'TV' };
  return { season: 1, part, type: 'TV' };
}
