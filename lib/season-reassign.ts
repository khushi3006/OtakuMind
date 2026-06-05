/**
 * Pure season planner for franchise merges, part-aware.
 *
 * When several rows are pulled under one franchise slug, their TV (season, part)
 * pairs must stay unique. The partial unique index covers `type = 'TV'` on
 * (userId, normalizedName, season, part) with NULLS NOT DISTINCT — so two rows
 * collide only when they share the SAME season AND the same part (a null part
 * equals another null part). Split-cour parts of one season (e.g. season 2 part 1
 * and season 2 part 2) coexist.
 *
 * This computes a collision-free (season, part) for every TV row, honouring the
 * same policy as lib/season-resolve.ts: a row whose season was set EXPLICITLY by
 * the user keeps its (season, part) where it is free; everything else is
 * auto-packed by bumping the SEASON (the part is intrinsic to the entry and is
 * preserved), ordered by (current season, id) — so merging two "Season 1" rows
 * bumps the later one rather than failing.
 *
 * Non-TV rows (Movie/OVA/Special) are outside numbering and keep their season/part.
 */

export type FranchiseRow = {
  id: number;
  type: string;
  season: number;
  /** null/undefined = normal single season; 1,2,… = a split-cour part. */
  part?: number | null;
  /** True if the user explicitly chose this season (vs. auto-derived). */
  explicit?: boolean;
};

export type SeasonAssignment = { id: number; season: number; part: number | null };

/** Slot key matching the index's NULLS NOT DISTINCT semantics (null === null). */
function slotKey(season: number, part: number | null): string {
  return `${season}|${part ?? 'null'}`;
}

export function planSeasons(rows: FranchiseRow[]): SeasonAssignment[] {
  const assignments: SeasonAssignment[] = [];
  const taken = new Set<string>();

  // Claim the preferred season for this part, bumping the season until the
  // (season, part) slot is free. The part is preserved.
  const claim = (preferred: number, part: number | null): number => {
    let s = preferred < 1 ? 1 : preferred;
    while (taken.has(slotKey(s, part))) s++;
    taken.add(slotKey(s, part));
    return s;
  };

  const tv = rows.filter((r) => r.type === 'TV');

  // Explicit rows (by id order) claim first so their chosen slot wins where free.
  for (const r of tv.filter((r) => r.explicit).sort((a, b) => a.id - b.id)) {
    const part = r.part ?? null;
    assignments.push({ id: r.id, season: claim(r.season, part), part });
  }
  // Auto rows fill remaining slots, ordered by current season then id.
  for (const r of tv
    .filter((r) => !r.explicit)
    .sort((a, b) => a.season - b.season || a.id - b.id)) {
    const part = r.part ?? null;
    assignments.push({ id: r.id, season: claim(r.season, part), part });
  }
  // Non-TV rows keep their current season/part.
  for (const r of rows.filter((r) => r.type !== 'TV')) {
    assignments.push({ id: r.id, season: r.season, part: r.part ?? null });
  }

  return assignments;
}
