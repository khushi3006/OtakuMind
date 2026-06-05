/**
 * Standalone verification for season label/parse helpers.
 * Run with:  npx tsx scripts/test-season-format.ts
 */
import { extractPartNumber } from '../lib/normalize';
import { formatSeasonText, parseSeasonField } from '../lib/season-format';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`); }
}

// extractPartNumber
eq('2nd-cour -> 2', extractPartNumber('Haikyu!! To the Top 2nd-cour'), 2);
eq('Part 2 -> 2', extractPartNumber('Attack on Titan Final Season Part 2'), 2);
eq('Cour 2 -> 2', extractPartNumber('Some Show Cour 2'), 2);
eq('no part -> null', extractPartNumber('Haikyu!! To the Top'), null);

// formatSeasonText
eq('TV season no part', formatSeasonText(4, null, 'TV'), 'Season 4');
eq('TV season with part', formatSeasonText(4, 2, 'TV'), 'Season 4 · Part 2');
eq('Final Season with part', formatSeasonText(99, 2, 'TV'), 'Final Season · Part 2');
eq('Movie ignores part', formatSeasonText(1, 2, 'Movie'), 'Movie');

// parseSeasonField round-trips with formatSeasonText output
eq('parse "Season 4 · Part 2"', parseSeasonField('Season 4 · Part 2'), { season: 4, part: 2, type: 'TV' });
eq('parse "Season 4"', parseSeasonField('Season 4'), { season: 4, part: null, type: 'TV' });
eq('parse "Season 4 Part 2"', parseSeasonField('Season 4 Part 2'), { season: 4, part: 2, type: 'TV' });
eq('parse "Final Season Part 2"', parseSeasonField('Final Season Part 2'), { season: 99, part: 2, type: 'TV' });
eq('parse "Movie"', parseSeasonField('Movie'), { season: 1, part: null, type: 'Movie' });
eq('parse "OVA"', parseSeasonField('OVA'), { season: 1, part: null, type: 'OVA' });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
