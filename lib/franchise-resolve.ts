/**
 * Franchise resolution, shared by the anime POST/PUT routes and the backfill
 * migration. (The DB merge helpers are added during route integration, once the
 * season model is finalized — kept out of this file deliberately for now.)
 *
 * `resolveFranchise` decides the canonical slug for an anime being written:
 *   1. MAL path (malId present, relations reachable): build the related-web
 *      component and use its canonical-root slug.
 *   2. Local fallback (no malId / relations unavailable): exact slug match, else
 *      a conservative token-subset fuzzy match against the user's existing slugs,
 *      else the plain normalized title.
 */
import { normalizeAnimeName } from './normalize';
import { buildComponent, canonicalSlugFor } from './franchise';
import { getRelations as defaultGetRelations, type GetRelations } from './mal-relations';

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
