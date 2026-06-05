/**
 * Jikan relations client for franchise grouping.
 *
 * The ONLY networked unit. Pure graph logic (lib/franchise.ts) receives a
 * `getRelations` function so it stays testable without a network. Relations are
 * effectively static, so results are cached process-globally with a long TTL.
 *
 * Cardinal rule: this never throws to its caller. On timeout / 429 / network
 * error it returns [] so the franchise resolver degrades to local string logic
 * and the user's write still succeeds.
 */

export type RelationEntry = {
  /** MAL relation label, e.g. "Prequel", "Sequel", "Side story", "Parent story". */
  relation: string;
  /** mal_id of the related anime. */
  malId: number;
  /** Display name of the related anime (comes free from the relations payload). */
  name: string;
};

/** Returns the anime relation edges for a given malId. Never throws. */
export type GetRelations = (malId: number) => Promise<RelationEntry[]>;

const CACHE_TTL = 1000 * 60 * 60 * 24; // 24h — relations are static
const MIN_SPACING_MS = 350; // stay under Jikan's ~3 req/s
const REQUEST_TIMEOUT_MS = 2500;
const MAX_RETRIES = 2; // retries after the first try -> 3 attempts total (0, 1, 2)

type CacheEntry = { entries: RelationEntry[]; ts: number };
const relationsCache = new Map<number, CacheEntry>();

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pure: turn a Jikan /relations JSON body into RelationEntry[] (anime only). */
export function parseRelationsPayload(json: unknown): RelationEntry[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: RelationEntry[] = [];
  for (const group of data as Array<{ relation?: unknown; entry?: unknown }>) {
    const relation = typeof group?.relation === 'string' ? group.relation : '';
    const entries = Array.isArray(group?.entry) ? group.entry : [];
    for (const e of entries as Array<{ mal_id?: unknown; type?: unknown; name?: unknown }>) {
      if (e?.type === 'anime' && typeof e?.mal_id === 'number' && e.mal_id > 0) {
        out.push({ relation, malId: e.mal_id, name: typeof e?.name === 'string' ? e.name : '' });
      }
    }
  }
  return out;
}

/** Serialize live calls and enforce a minimum spacing between them. */
async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = MIN_SPACING_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastCallAt = Date.now();
    }
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function fetchRelationsLive(malId: number): Promise<RelationEntry[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/relations`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Jikan relations ${malId} -> ${res.status}`);
    return parseRelationsPayload(await res.json());
  }
  throw new Error(`Jikan relations ${malId} -> rate limited after retries`);
}

/** Cached, throttled relations fetch. Returns [] on any failure (never throws). */
export const getRelations: GetRelations = async (malId: number) => {
  const cached = relationsCache.get(malId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.entries;
  try {
    const entries = await throttle(() => fetchRelationsLive(malId));
    relationsCache.set(malId, { entries, ts: Date.now() });
    return entries;
  } catch {
    // Degrade gracefully; cache only successes so a transient failure can recover.
    return [];
  }
};
