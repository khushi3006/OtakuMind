/**
 * One-time backfill: regroup existing anime into MAL franchises and re-slug them
 * to the canonical root slug, re-packing collision-free (season, part). Idempotent:
 * a warm second run (relations cache primed) is a no-op.
 *
 * Reuses the process-global relations cache in lib/mal-relations across all users,
 * so a franchise's relations are fetched at most once for the whole run, and the
 * same two-phase merge helpers as the POST/PUT routes (park to a negative season,
 * then assign finals) so the partial unique index is never tripped.
 *
 * Dry run (default — prints the plan, writes nothing):
 *   npx tsx scripts/migrate-franchise-slugs.ts
 * Apply for real:
 *   npx tsx scripts/migrate-franchise-slugs.ts --apply
 */
import { db } from '../lib/db';
import { getRelations } from '../lib/mal-relations';
import { buildComponent, canonicalSlugFor } from '../lib/franchise';
import { planSeasons } from '../lib/season-reassign';
import { parkRows, applyFinalSeasons } from '../lib/franchise-resolve';
import { withDeadlockRetry } from '../lib/deadlock-retry';

// A franchise group can be large (many sequential row updates over Neon), so give
// the transaction a generous timeout — the Prisma default of 5s is easily exceeded.
const MIGRATION_TX_OPTIONS = { maxWait: 30000, timeout: 30000 } as const;

const APPLY = process.argv.includes('--apply');
const BOUNDS = { maxNodes: 60, maxApiCalls: 60 };

type Row = {
  id: number;
  name: string;
  normalizedName: string;
  malId: number | null;
  type: string;
  season: number;
  part: number | null;
};

function slotLabel(season: number, part: number | null): string {
  return `S${season}${part != null ? `P${part}` : ''}`;
}

async function main() {
  const users = await db.user.findMany({ select: { id: true, username: true } });
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${users.length} user(s)\n`);

  let groupsChanged = 0;

  for (const user of users) {
    const animes: Row[] = await db.anime.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, normalizedName: true, malId: true, type: true, season: true, part: true },
    });

    // 1. Compute a canonical slug for every row that has a malId, grouping members.
    //    Reuse a previously built component if this malId is already a known member.
    const slugByAnimeId = new Map<number, string>();
    const components: Array<{ slug: string; members: Set<number> }> = [];
    for (const a of animes) {
      if (!a.malId) continue;
      let resolved = components.find((c) => c.members.has(a.malId as number));
      if (!resolved) {
        const component = await buildComponent(a.malId, a.name, getRelations, BOUNDS);
        resolved = { slug: canonicalSlugFor(component), members: new Set(component.nodes.map((n) => n.malId)) };
        components.push(resolved);
      }
      slugByAnimeId.set(a.id, resolved.slug);
    }

    // 2. Group rows by target slug (malId rows by computed slug; others keep theirs).
    const groups = new Map<string, Row[]>();
    for (const a of animes) {
      const slug = slugByAnimeId.get(a.id) ?? a.normalizedName;
      const arr = groups.get(slug);
      if (arr) arr.push(a);
      else groups.set(slug, [a]);
    }

    // 3. Per group, plan (season, part); apply only if a slug or TV slot would change.
    for (const [slug, rows] of groups) {
      const plan = planSeasons(rows.map((r) => ({ id: r.id, type: r.type, season: r.season, part: r.part })));
      const planById = new Map(plan.map((p) => [p.id, p]));
      const changed = rows.filter((r) => {
        const p = planById.get(r.id)!;
        return (
          r.normalizedName !== slug ||
          (r.type === 'TV' && (p.season !== r.season || (p.part ?? null) !== (r.part ?? null)))
        );
      });
      if (changed.length === 0) continue;
      groupsChanged++;

      console.log(`@${user.username}  slug="${slug}"  (${rows.length} entries, ${changed.length} change)`);
      for (const r of changed) {
        const p = planById.get(r.id)!;
        const to = r.type === 'TV' ? `${slug}/${slotLabel(p.season, p.part)}` : `${slug}/${slotLabel(r.season, r.part)}`;
        console.log(`   #${r.id} "${r.name}"  ${r.normalizedName}/${slotLabel(r.season, r.part)} -> ${to}`);
      }

      if (APPLY) {
        await withDeadlockRetry(() =>
          db.$transaction(async (tx) => {
            await parkRows(tx, slug, rows.map((r) => ({ id: r.id, type: r.type })));
            const tvIds = new Set(rows.filter((r) => r.type === 'TV').map((r) => r.id));
            await applyFinalSeasons(tx, plan, tvIds);
          }, MIGRATION_TX_OPTIONS)
        );
      }
    }
  }

  console.log(`\n${APPLY ? 'Applied changes to' : 'Would change'} ${groupsChanged} group(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
  });
