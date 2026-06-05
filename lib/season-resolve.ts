/**
 * Season+part resolution for the per-user TV uniqueness rule.
 *
 * `season` is a display label *and* part of the uniqueness key; `part` extends it
 * for split-cour seasons (one season aired in multiple parts). The DB enforces a
 * PARTIAL unique index on (userId, normalizedName, season, part) WHERE type='TV',
 * with NULLS NOT DISTINCT so two NULL parts at the same season collide (a normal
 * single season stays unique) while numbered parts (1, 2, …) coexist.
 *
 * - Non-TV rows pass through untouched (never numbered, never collide).
 * - A TV (season, part) that is free passes through.
 * - An AUTO-derived TV (season, part) that collides is bumped past the highest TV
 *   sibling season (keeps imports working); the part is preserved.
 * - An EXPLICIT user-set TV (season, part) is never silently renumbered; a genuine
 *   clash is surfaced so the caller can return a 409.
 */

export type SeasonResolution =
  | { kind: 'ok'; season: number; part: number | null }
  | { kind: 'collision'; season: number; part: number | null };

/** A same-slug, same-user TV sibling (excluding the row being written). */
export type TvSibling = { season: number; part: number | null };

export type ResolveSeasonArgs = {
  /** Effective type after the write: 'TV' | 'Movie' | 'OVA' | 'Special'. */
  type: string;
  /** Desired season (explicit from the user, or auto-derived from the title). */
  season: number;
  /** Desired part: null = normal single season; 1, 2, … = part of a split season. */
  part: number | null;
  /** True when the user explicitly chose this season (vs. auto-derived). */
  explicit: boolean;
  /** The OTHER same-slug, same-user TV rows. Non-TV siblings must NOT be included. */
  tvSiblings: TvSibling[];
};

/** NULL-safe part equality, matching the index's NULLS NOT DISTINCT semantics. */
function samePart(a: number | null, b: number | null): boolean {
  return (a ?? null) === (b ?? null);
}

export function resolveSeason(args: ResolveSeasonArgs): SeasonResolution {
  const { type, season, part, explicit, tvSiblings } = args;

  // Non-TV rows are outside season numbering and the partial unique index.
  if (type !== 'TV') {
    return { kind: 'ok', season, part };
  }

  const clash = tvSiblings.some((s) => s.season === season && samePart(s.part, part));
  if (!clash) {
    return { kind: 'ok', season, part };
  }

  if (explicit) {
    // Honour the user's choice — never silently renumber. Caller errors out.
    return { kind: 'collision', season, part };
  }

  // Auto-derived: bump past the highest TV sibling season so imports never fail.
  const maxSeason = tvSiblings.reduce((max, s) => Math.max(max, s.season), 0);
  return { kind: 'ok', season: maxSeason + 1, part };
}
