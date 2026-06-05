/**
 * Season-number resolution for the per-user `@@unique` rule.
 *
 * `season` is both a human-facing label ("Season 3") and a uniqueness key. To
 * stop those two roles from fighting (see `app/api/anime/route.ts` history), the
 * DB constraint is a *partial* unique index that only covers `type = 'TV'` rows
 * (`scripts/migrate-partial-season.ts`). This helper centralises the matching
 * application logic so POST and PUT agree:
 *
 * - Non-TV rows (Movie/OVA/Special) are never numbered — they pass through
 *   untouched and never collide, so a movie can sit at season 3 *and* a TV
 *   entry can be Season 3 under the same slug.
 * - A TV row whose desired season is free passes through.
 * - A TV row whose season was AUTO-derived (import / name change) and collides
 *   gets bumped past the highest existing TV sibling — keeps bulk imports working.
 * - A TV row whose season was set EXPLICITLY by the user is never silently
 *   renumbered; a genuine clash is surfaced so the caller can return an error.
 */

export type SeasonResolution =
  | { kind: 'ok'; season: number }
  | { kind: 'collision'; season: number };

export type ResolveSeasonArgs = {
  /** Effective type of the row after the write: 'TV' | 'Movie' | 'OVA' | 'Special'. */
  type: string;
  /** Desired season (explicit from the user, or auto-derived from the title). */
  season: number;
  /** True when the user explicitly chose this season (vs. auto-derived). */
  explicit: boolean;
  /**
   * Seasons of the OTHER same-slug, same-user TV rows (exclude the row being
   * written). Non-TV siblings must NOT be included.
   */
  tvSiblingSeasons: number[];
};

export function resolveSeason(args: ResolveSeasonArgs): SeasonResolution {
  const { type, season, explicit, tvSiblingSeasons } = args;

  // Non-TV rows are outside season numbering and the partial unique index.
  if (type !== 'TV') {
    return { kind: 'ok', season };
  }

  if (!tvSiblingSeasons.includes(season)) {
    return { kind: 'ok', season };
  }

  // Collision with an existing TV sibling.
  if (explicit) {
    // Honour the user's choice — never silently renumber. Caller errors out.
    return { kind: 'collision', season };
  }

  // Auto-derived: bump past the highest TV sibling so imports never fail.
  const maxSeason = tvSiblingSeasons.reduce((max, curr) => Math.max(max, curr), 0);
  return { kind: 'ok', season: maxSeason + 1 };
}
