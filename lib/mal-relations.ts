/**
 * AniList relations client for franchise grouping.
 *
 * The networked unit. Pure graph logic (lib/franchise.ts) receives a
 * `getRelations` function so it stays testable without a network. Relations are
 * effectively static, so results are cached in two layers: an in-process L1 map
 * (fast path within a hot instance) and a shared `MalRelation` DB table (L2,
 * durable + shared across all users and serverless instances). On Vercel the L1
 * map is per-instance/ephemeral, so the DB layer is what makes a franchise's
 * relations fetched from AniList once, ever, globally. Concurrent live fetches for
 * the same malId are coalesced into a single request.
 *
 * Relations stay keyed on MAL ids (AniList exposes the related node's MAL id as
 * `idMal`) so the rest of the franchise graph is unchanged; an edge whose node has
 * no `idMal` is dropped (can't key the MAL graph). AniList relation-type enums are
 * mapped back to the Jikan-style labels lib/franchise.ts already matches.
 *
 * Cardinal rule: this never throws to its caller. On timeout / network / DB error
 * it returns [] so the franchise resolver degrades to local string logic and the
 * user's write still succeeds.
 */
import { db } from '@/lib/db';
import { anilistFetch } from '@/lib/anilist-client';
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
const MIN_SPACING_MS = 350; // gentle spacing so a franchise walk doesn't burst AniList
const REQUEST_TIMEOUT_MS = 2500;

const RELATIONS_QUERY = `
  query ($malId: Int) {
    Media(idMal: $malId, type: ANIME) {
      relations {
        edges {
          relationType
          node { idMal type title { romaji english } }
        }
      }
    }
  }
`;

/** AniList relationType enum -> the Jikan-style labels lib/franchise.ts matches.
 * Only `character`/`other` are excluded by the graph; the spine relies on the
 * exact strings "prequel"/"sequel"/"parent story". */
const RELATION_TYPE_MAP: Record<string, string> = {
  PREQUEL: 'prequel',
  SEQUEL: 'sequel',
  PARENT: 'parent story',
  SIDE_STORY: 'side story',
  ALTERNATIVE: 'alternative version',
  SPIN_OFF: 'spin-off',
  SUMMARY: 'summary',
  CHARACTER: 'character',
  ADAPTATION: 'adaptation',
  SOURCE: 'source',
  COMPILATION: 'compilation',
  CONTAINS: 'contains',
  OTHER: 'other',
};

function mapRelationType(t: string): string {
  return RELATION_TYPE_MAP[t] ?? (t ? t.toLowerCase().replace(/_/g, ' ') : '');
}

type CacheEntry = { entries: RelationEntry[]; ts: number };
const relationsCache = new Map<number, CacheEntry>();
/** Coalesces concurrent live fetches for the same malId into one request. */
const inflight = new Map<number, Promise<RelationEntry[]>>();

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pure: turn an AniList relations `data` body into RelationEntry[] (anime only,
 * MAL-linked only). Edges whose node has no `idMal` are dropped — the franchise
 * graph is keyed on MAL ids and can't traverse an unmapped node.
 */
export function parseRelationsPayload(data: unknown): RelationEntry[] {
  const edges = (data as { Media?: { relations?: { edges?: unknown } } })?.Media?.relations?.edges;
  if (!Array.isArray(edges)) return [];
  const out: RelationEntry[] = [];
  for (const edge of edges as Array<{
    relationType?: unknown;
    node?: { idMal?: unknown; type?: unknown; title?: { romaji?: unknown; english?: unknown } } | null;
  }>) {
    const node = edge?.node;
    if (!node || node.type !== 'ANIME') continue;
    if (typeof node.idMal !== 'number' || node.idMal <= 0) continue;
    const relation = mapRelationType(typeof edge?.relationType === 'string' ? edge.relationType : '');
    const name =
      typeof node.title?.english === 'string'
        ? node.title.english
        : typeof node.title?.romaji === 'string'
          ? node.title.romaji
          : '';
    out.push({ relation, malId: node.idMal, name });
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
  const data = await anilistFetch(RELATIONS_QUERY, { malId }, REQUEST_TIMEOUT_MS);
  return parseRelationsPayload(data);
}

/**
 * Live fetch + cache write, coalesced per malId so concurrent walks don't issue
 * duplicate AniList calls. Writes both L1 (in-process) and L2 (DB). Never throws.
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
 * live AniList. Returns [] on any failure (never throws).
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
      // Guard against a malformed/corrupt JSON row: a non-array would make the
      // caller's `for...of` throw (outside our never-throws contract). Fall
      // through to a live fetch, which upserts a clean row over the bad one.
      if (Array.isArray(entries)) {
        relationsCache.set(malId, { entries, ts: now });
        return entries;
      }
    }
  } catch {
    // Fall through to a live fetch.
  }

  // Live (coalesced), then write back to both layers.
  return fetchAndCache(malId);
};
