/**
 * Franchise resolution + DB merge helpers, shared by the anime POST/PUT routes
 * and the backfill migration.
 *
 * `resolveFranchise` decides the canonical slug for an anime being written:
 *   1. MAL path (malId present, relations reachable): build the related-web
 *      component and use its canonical-root slug.
 *   2. Local fallback (no malId / relations unavailable): exact slug match, else
 *      a conservative token-subset fuzzy match against the user's existing slugs,
 *      else the plain normalized title.
 *
 * The DB helpers run a two-phase merge so a franchise convergence never trips the
 * partial unique index: park every TV row to a unique negative season first, then
 * assign collision-free final (season, part) pairs.
 */
import type { Prisma } from '../prisma/generated/client';
import { normalizeAnimeName } from './normalize';
import { buildComponent, canonicalSlugFor } from './franchise';
import { getRelations as defaultGetRelations, type GetRelations } from './mal-relations';
import type { SeasonAssignment } from './season-reassign';

const BUILD_BOUNDS = { maxNodes: 30, maxApiCalls: 30 };

export type ResolveArgs = {
  userId: number;
  name: string;
  malId?: number | null;
  /** Distinct normalizedNames the user already owns (for the no-malId fallback). */
  existingSlugs: string[];
  /** Injectable for tests; defaults to the live Jikan client. */
  getRelations?: GetRelations;
};

export type ResolveResult = {
  slug: string;
  /** MAL ids of every entry in the franchise web (empty in the local fallback). */
  memberMalIds: number[];
  truncated: boolean;
};

export async function resolveFranchise(args: ResolveArgs): Promise<ResolveResult> {
  const { name, malId, existingSlugs } = args;
  const getRelations = args.getRelations ?? defaultGetRelations;
  const baseSlug = normalizeAnimeName(name);

  if (malId) {
    const component = await buildComponent(malId, name, getRelations, BUILD_BOUNDS);
    if (component.nodes.length > 1) {
      return {
        slug: canonicalSlugFor(component),
        memberMalIds: component.nodes.map((n) => n.malId),
        truncated: component.truncated,
      };
    }
    // Standalone or relations unavailable: fall back to local logic but we still
    // know our own malId is the only confirmed member.
    return { slug: localSlug(baseSlug, existingSlugs), memberMalIds: [malId], truncated: component.truncated };
  }

  return { slug: localSlug(baseSlug, existingSlugs), memberMalIds: [], truncated: false };
}

/** Exact match, else conservative fuzzy match, else the base slug. */
export function localSlug(baseSlug: string, existingSlugs: string[]): string {
  if (existingSlugs.includes(baseSlug)) return baseSlug;
  return looseFranchiseMatch(baseSlug, existingSlugs) ?? baseSlug;
}

/**
 * Conservative franchise match for the no-malId fallback. Returns an EXISTING
 * slug to adopt, or null. Requires a shared first word, both names >=2 tokens, and
 * one name's token set is a subset of the other's — so "Sword Art Online" never
 * merges into "Sword of the Stranger". Among matches, picks the one with the
 * FEWEST tokens (the most root-like / general franchise slug).
 *
 * Bound: a 2-token existing slug that shares its first word with the candidate
 * and whose tokens are a subset will match. This is intended (real 2-word titles
 * are legitimate franchises); the >=2-token floor only blocks single-word slugs.
 */
export function looseFranchiseMatch(candidate: string, existingSlugs: string[]): string | null {
  const cTokens = candidate.split(' ').filter(Boolean);
  if (cTokens.length < 2) return null;
  const cSet = new Set(cTokens);
  let best: string | null = null;
  let bestTokens = Infinity;
  for (const slug of existingSlugs) {
    const sTokens = slug.split(' ').filter(Boolean);
    if (sTokens.length < 2) continue;
    if (cTokens[0] !== sTokens[0]) continue;
    const sSet = new Set(sTokens);
    const subset = sTokens.every((t) => cSet.has(t)) || cTokens.every((t) => sSet.has(t));
    if (subset && sTokens.length < bestTokens) {
      best = slug;
      bestTokens = sTokens.length;
    }
  }
  return best;
}

// --- DB merge helpers (two-phase, run inside a transaction) ---

type TxClient = Prisma.TransactionClient;

export type FranchiseDbRow = {
  id: number;
  type: string;
  season: number;
  part: number | null;
  normalizedName: string;
};

/**
 * Existing rows that belong under `slug`: same normalizedName OR malId in the
 * franchise's member set. Used to gather everything that must converge on merge.
 */
export async function findFranchiseRows(
  tx: TxClient,
  userId: number,
  slug: string,
  memberMalIds: number[]
): Promise<FranchiseDbRow[]> {
  return tx.anime.findMany({
    where: {
      userId,
      OR: [
        { normalizedName: slug },
        ...(memberMalIds.length ? [{ malId: { in: memberMalIds } }] : []),
      ],
    },
    select: { id: true, type: true, season: true, part: true, normalizedName: true },
  });
}

/**
 * Phase A: move every row under `slug`; park each TV row at a unique negative
 * season (-id) so no positive (season, part) slot is occupied during the merge.
 * Non-TV rows are outside the unique index, so they only take the slug.
 */
export async function parkRows(
  tx: TxClient,
  slug: string,
  rows: Array<{ id: number; type: string }>
): Promise<void> {
  for (const r of rows) {
    await tx.anime.update({
      where: { id: r.id },
      data: r.type === 'TV' ? { normalizedName: slug, season: -r.id } : { normalizedName: slug },
    });
  }
}

/**
 * Phase B: assign final (season, part) to the TV rows (others are untouched).
 * Every row starts at a parked non-positive season, and the finals are mutually
 * unique, so applying them in any order never trips the unique index.
 */
export async function applyFinalSeasons(
  tx: TxClient,
  assignments: SeasonAssignment[],
  tvIds: Set<number>
): Promise<void> {
  for (const a of assignments) {
    if (tvIds.has(a.id)) {
      await tx.anime.update({ where: { id: a.id }, data: { season: a.season, part: a.part } });
    }
  }
}
