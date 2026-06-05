/**
 * Pure season planner for franchise merges.
 *
 * When several rows are pulled under one franchise slug, their TV season numbers
 * must stay unique (the partial unique index covers `type = 'TV'`; see
 * scripts/migrate-partial-season.ts). This computes a collision-free season for
 * every TV row, honouring the same policy as lib/season-resolve.ts: a row whose
 * season was set EXPLICITLY by the user keeps that number where it is free;
 * everything else is auto-packed into the lowest free slots, ordered by
 * (current season, id), so merging two "Season 1" rows bumps the later one
 * rather than failing.
 *
 * Non-TV rows (Movie/OVA/Special) are outside numbering and keep their season.
 */

export type FranchiseRow = {
  id: number;
  type: string;
  season: number;
  /** True if the user explicitly chose this season (vs. auto-derived). */
  explicit?: boolean;
};

export type SeasonAssignment = { id: number; season: number };

export function planSeasons(rows: FranchiseRow[]): SeasonAssignment[] {
  const assignments: SeasonAssignment[] = [];
  const taken = new Set<number>();

  const claim = (preferred: number): number => {
    let s = preferred < 1 ? 1 : preferred;
    while (taken.has(s)) s++;
    taken.add(s);
    return s;
  };

  const tv = rows.filter((r) => r.type === 'TV');

  // Explicit rows (by id order) claim first so their chosen number wins where free.
  for (const r of tv.filter((r) => r.explicit).sort((a, b) => a.id - b.id)) {
    assignments.push({ id: r.id, season: claim(r.season) });
  }
  // Auto rows fill remaining slots, ordered by current season then id.
  for (const r of tv
    .filter((r) => !r.explicit)
    .sort((a, b) => a.season - b.season || a.id - b.id)) {
    assignments.push({ id: r.id, season: claim(r.season) });
  }
  // Non-TV rows keep their current season.
  for (const r of rows.filter((r) => r.type !== 'TV')) {
    assignments.push({ id: r.id, season: r.season });
  }

  return assignments;
}
