/**
 * Low-level AniList GraphQL client + the shared "AniList media → Jikan-shaped"
 * mapper.
 *
 * OtakuMind migrated off the Jikan (MyAnimeList) API to AniList, but every client
 * (web + the shipped iOS app) and the whole DB are keyed on MAL ids and consume a
 * Jikan-shaped JSON contract. AniList exposes the same MAL id as `idMal`, so the
 * backend keeps returning the identical shape and only the upstream changed. This
 * module is the single place that talks to AniList and the single place that
 * translates an AniList `Media` into the legacy Jikan response object.
 *
 * Kept dependency-free (no DB / no airing-cache imports) so it sits at the bottom
 * of the import graph and can be reused by the search route, the popular-airing
 * route, the relations client, and the airing cache without cycles.
 */

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const DEFAULT_TIMEOUT_MS = 4000;

/**
 * POSTs a GraphQL query to AniList and returns the `data` payload. Throws on a
 * non-2xx response, a timeout, or GraphQL-level errors — callers wrap this in
 * their existing try/catch + stale-cache fallbacks.
 */
export async function anilistFetch<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AniList API returned status ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`AniList GraphQL error: ${json.errors[0]?.message ?? 'unknown'}`);
  }
  return json?.data as T;
}

/**
 * GraphQL selection set for a Media node, shared by the search and seasonal
 * queries so the mapper below has a consistent shape to work from.
 */
export const MEDIA_FIELDS = `
  idMal
  title { romaji english native }
  format
  episodes
  status
  averageScore
  description(asHtml: false)
  startDate { year month day }
  coverImage { extraLarge large medium }
`;

/** AniList `format` enum -> the Jikan `type` strings the clients already map. */
const FORMAT_TO_TYPE: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
};

/** The legacy Jikan-shaped anime object every client still consumes. */
export interface JikanShapedAnime {
  mal_id: number;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  type: string;
  episodes: number;
  airing: boolean;
  broadcast: Record<string, unknown>;
  score: number | null;
  synopsis: string | null;
  year: number | null;
  aired: { from: string | null } | null;
  images: {
    jpg: { image_url: string | null; large_image_url: string | null };
    webp: { image_url: string | null; large_image_url: string | null };
  };
}

interface AniListMediaRaw {
  idMal: number | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  format?: string | null;
  episodes?: number | null;
  status?: string | null;
  averageScore?: number | null;
  description?: string | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  coverImage?: { extraLarge?: string | null; large?: string | null; medium?: string | null } | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Builds a Jikan-style ISO `aired.from` string from AniList's startDate parts. */
function startDateToIso(d: AniListMediaRaw['startDate']): string | null {
  if (!d?.year) return null;
  const month = d.month ?? 1;
  const day = d.day ?? 1;
  return `${d.year}-${pad(month)}-${pad(day)}T00:00:00+00:00`;
}

/** Strips HTML tags/entities AniList leaves in `description` for plain-text UIs. */
function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  const text = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .trim();
  return text || null;
}

/**
 * Maps an AniList Media node to the legacy Jikan-shaped object. Returns `null`
 * when the title has no linked MAL id (`idMal`) — the whole app is keyed on MAL
 * ids, so such rows are skipped (a small set of brand-new/obscure titles).
 */
export function mapMediaToJikan(m: AniListMediaRaw | null | undefined): JikanShapedAnime | null {
  if (!m?.idMal) return null;
  const cover = m.coverImage ?? {};
  const large = cover.extraLarge ?? cover.large ?? cover.medium ?? null;
  const small = cover.large ?? cover.medium ?? cover.extraLarge ?? null;
  return {
    mal_id: m.idMal,
    title: m.title?.romaji ?? m.title?.english ?? m.title?.native ?? '',
    title_english: m.title?.english ?? null,
    title_japanese: m.title?.native ?? null,
    type: (m.format && FORMAT_TO_TYPE[m.format]) || 'TV',
    episodes: m.episodes ?? 0,
    airing: m.status === 'RELEASING',
    broadcast: {},
    // AniList averageScore is 0-100; Jikan/MAL score is 0-10 (one decimal).
    score: typeof m.averageScore === 'number' ? Math.round(m.averageScore) / 10 : null,
    synopsis: stripHtml(m.description),
    year: m.startDate?.year ?? null,
    aired: { from: startDateToIso(m.startDate) },
    images: {
      jpg: { image_url: small, large_image_url: large },
      webp: { image_url: small, large_image_url: large },
    },
  };
}
