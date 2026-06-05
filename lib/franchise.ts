/**
 * Pure franchise-graph logic. NO network and NO database access — the relation
 * fetcher is injected so this is fully unit-testable (see scripts/test-franchise.ts).
 *
 * "Widest" grouping (per design decision): we follow every relation type EXCEPT
 * `Character` and `Other`. The canonical root is chosen deterministically so the
 * franchise slug is identical regardless of which season was added first.
 */
import { normalizeAnimeName } from './normalize';
import type { GetRelations } from './mal-relations';

/** Relation types that do NOT connect a franchise. Everything else is followed. */
const EXCLUDED_RELATIONS = new Set(['character', 'other']);

/** Relation types meaning "current entry comes AFTER the target" (origin edges). */
const BACKWARD_RELATIONS = new Set(['prequel', 'parent story']);

/**
 * Relations that form the main narrative timeline. We expand these FIRST so the
 * earliest entry of a long franchise is reached before the node/call budget runs
 * out — otherwise seeding from a late season (e.g. Re:Zero S4) could exhaust the
 * budget on side stories/OVAs and never reach Season 1, picking a side entry as
 * the canonical root. Side relations (alternative version, side story, spin-off,
 * summary, …) are still followed for "widest" grouping, just at lower priority.
 */
const SPINE_RELATIONS = new Set(['prequel', 'sequel', 'parent story', 'full story']);

export type FranchiseNode = { malId: number; name: string };

export type FranchiseComponent = {
  /** Every anime node in the connected franchise web. */
  nodes: FranchiseNode[];
  /** Directed origin edges: `from` has `to` as its prequel/parent. */
  backEdges: Array<{ from: number; to: number }>;
  /** True if a bound (maxNodes / maxApiCalls) cut the walk short. */
  truncated: boolean;
};

export type BuildBounds = { maxNodes: number; maxApiCalls: number };

export async function buildComponent(
  seedMalId: number,
  seedName: string,
  getRelations: GetRelations,
  bounds: BuildBounds
): Promise<FranchiseComponent> {
  const nodes = new Map<number, string>([[seedMalId, seedName]]);
  const backEdges: Array<{ from: number; to: number }> = [];
  const visited = new Set<number>();
  // Two-tier frontier: spine nodes (on the main timeline, reached from the seed
  // via spine edges) are expanded before side nodes, so the chain root is found
  // within budget regardless of how many side stories hang off later seasons.
  const spine = new Set<number>([seedMalId]);
  const spineFrontier: number[] = [seedMalId];
  const sideFrontier: number[] = [];
  let apiCalls = 0;
  let truncated = false;

  while (spineFrontier.length > 0 || sideFrontier.length > 0) {
    const current = (spineFrontier.length > 0 ? spineFrontier : sideFrontier).shift()!;
    if (visited.has(current)) continue;
    if (apiCalls >= bounds.maxApiCalls) {
      truncated = true;
      break;
    }
    visited.add(current);

    const relations = await getRelations(current);
    apiCalls++;

    const currentIsSpine = spine.has(current);

    for (const rel of relations) {
      const type = rel.relation.toLowerCase();
      if (EXCLUDED_RELATIONS.has(type)) continue;

      // A neighbour is on the spine when reached via a spine edge from a spine node.
      const childIsSpine = currentIsSpine && SPINE_RELATIONS.has(type);

      if (!nodes.has(rel.malId)) {
        if (nodes.size >= bounds.maxNodes) {
          truncated = true;
          continue;
        }
        nodes.set(rel.malId, rel.name);
      }
      if (childIsSpine) spine.add(rel.malId);
      if (BACKWARD_RELATIONS.has(type)) {
        backEdges.push({ from: current, to: rel.malId });
      }
      if (!visited.has(rel.malId)) {
        (childIsSpine ? spineFrontier : sideFrontier).push(rel.malId);
      }
    }
  }

  return {
    nodes: Array.from(nodes, ([malId, name]) => ({ malId, name })),
    backEdges,
    truncated,
  };
}

/**
 * Pick the deterministic canonical root of a franchise component.
 * Precondition: `component.nodes` is non-empty (buildComponent always returns
 * at least the seed node).
 */
export function pickCanonicalRoot(component: FranchiseComponent): FranchiseNode {
  const { nodes, backEdges } = component;
  // A node with an outgoing origin edge (it HAS a prequel/parent) is not an origin.
  const hasOrigin = new Set(backEdges.map((e) => e.from));
  const origins = nodes.filter((n) => !hasOrigin.has(n.malId));
  const pool = origins.length > 0 ? origins : nodes;
  // Smallest malId = oldest on MAL ≈ the original work. Deterministic tiebreak.
  return pool.reduce((best, n) => (n.malId < best.malId ? n : best));
}

export function canonicalSlugFor(component: FranchiseComponent): string {
  return normalizeAnimeName(pickCanonicalRoot(component).name);
}
