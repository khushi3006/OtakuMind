/**
 * Jikan relations client for franchise grouping.
 *
 * The networked unit. Pure graph logic (lib/franchise.ts) receives a
 * `getRelations` function so it stays testable without a network. Relations are
 * effectively static, so results are cached in two layers: an in-process L1 map
 * (fast path within a hot instance) and a shared `MalRelation` DB table (L2,
 * durable + shared across all users and serverless instances). On Vercel the L1
 * map is per-instance/ephemeral, so the DB layer is what makes a franchise's
 * relations fetched from Jikan once, ever, globally. Concurrent live fetches for
 * the same malId are coalesced into a single request.
 *
 * Cardinal rule: this never throws to its caller. On timeout / 429 / network /
 * DB error it returns [] so the franchise resolver degrades to local string logic
 * and the user's write still succeeds.
 */
import { db } from '@/lib/db';
import type { Prisma } from '../prisma/generated/client';

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

const CACHE_TTL = 1000 * 60 * 60 * 24; // 24h — L1 (in-process) freshness window
const DB_TTL = 1000 * 60 * 60 * 24 * 30; // 30d — L2 (DB) freshness; relations are static
const MIN_SPACING_MS = 350; // stay under Jikan's ~3 req/s
const REQUEST_TIMEOUT_MS = 2500;
const MAX_RETRIES = 2; // retries after the first try -> 3 attempts total (0, 1, 2)

type CacheEntry = { entries: RelationEntry[]; ts: number };
const relationsCache = new Map<number, CacheEntry>();
/** Coalesces concurrent live fetches for the same malId into one request. */
const inflight = new Map<number, Promise<RelationEntry[]>>();

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

/**
 * Live fetch + cache write, coalesced per malId so concurrent walks don't issue
 * duplicate Jikan calls. Writes both L1 (in-process) and L2 (DB). Never throws.
 */
function fetchAndCache(malId: number): Promise<RelationEntry[]> {
  const existing = inflight.get(malId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const entries = await throttle(() => fetchRelationsLive(malId));
      relationsCache.set(malId, { entries, ts: Date.now() });
      // Persist to the shared DB layer so every other instance/user benefits.
      try {
        await db.malRelation.upsert({
          where: { malId },
          create: { malId, relations: entries as unknown as Prisma.InputJsonValue },
          update: { relations: entries as unknown as Prisma.InputJsonValue, syncedAt: new Date() },
        });
      } catch {
        // A DB write hiccup just means we'll refetch next time — non-fatal.
      }
      return entries;
    } catch {
      // Degrade gracefully; cache only successes so a transient failure can recover.
      return [];
    } finally {
      inflight.delete(malId);
    }
  })();
  inflight.set(malId, p);
  return p;
}

/**
 * Layered, coalesced relations fetch: L1 (in-process) -> L2 (MalRelation DB) ->
 * live Jikan. Returns [] on any failure (never throws).
 */
export const getRelations: GetRelations = async (malId: number) => {
  const now = Date.now();

  // L1: in-process map (fast path within a hot instance).
  const cached = relationsCache.get(malId);
  if (cached && now - cached.ts < CACHE_TTL) return cached.entries;

  // L2: shared DB table (durable, cross-instance). A DB error falls through to live.
  try {
    const row = await db.malRelation.findUnique({ where: { malId } });
    if (row && now - row.syncedAt.getTime() < DB_TTL) {
      const entries = row.relations as unknown as RelationEntry[];
      relationsCache.set(malId, { entries, ts: now });
      return entries;
    }
  } catch {
    // Fall through to a live fetch.
  }

  // Live (coalesced), then write back to both layers.
  return fetchAndCache(malId);
};
