/**
 * Jikan relations client for franchise grouping.
 *
 * This module is the ONLY place that talks to the network. The pure graph logic
 * in lib/franchise.ts receives a `getRelations` function so it can be tested
 * without any network access. (The networked implementation is added in Task 3.)
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
