/**
 * Pure decision logic for the RevenueCat webhook (no DB / network — unit-testable, mirrors
 * `lib/entitlement.ts`). Maps a RevenueCat event to the set of our User ids whose `hasLifetime`
 * flag should be granted or revoked. The route layer applies the result.
 */

/** The slice of a RevenueCat webhook event we read. RevenueCat sends many more fields. */
export interface RevenueCatEvent {
  type?: string;
  product_id?: string;
  // Milliseconds since epoch; used as the ordering key so out-of-order/duplicate deliveries no-op.
  event_timestamp_ms?: number;
  // Purchase / revoke events attribute to these:
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  // TRANSFER events carry these instead (and no app_user_id / product_id):
  transferred_from?: string[];
  transferred_to?: string[];
}

/** Which of our User ids to flip. Empty arrays = nothing to do. */
export interface EntitlementMutation {
  grantIds: number[];
  revokeIds: number[];
}

// A lifetime non-consumable arrives as INITIAL_PURCHASE or NON_RENEWING_PURCHASE.
const PURCHASE_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);
// A refund/expiration on the non-consumable revokes the purchased flag. (RevenueCat surfaces an
// App Store refund as CANCELLATION; EXPIRATION/REFUND are handled defensively.)
const REVOKE_TYPES = new Set(['CANCELLATION', 'EXPIRATION', 'REFUND']);

const EMPTY: EntitlementMutation = { grantIds: [], revokeIds: [] };

/** Our User ids are integers; collect every candidate string that parses to one (dedup, drop NaN). */
function toIntIds(ids: Array<string | undefined>): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    const n = Number(id);
    if (Number.isInteger(n)) out.add(n);
  }
  return [...out];
}

/**
 * Decide what a RevenueCat event means for our `hasLifetime` flag.
 *
 * TRANSFER is the case the old handler dropped: a non-consumable can only live on one App User ID
 * at a time, and RevenueCat's default behaviour moves it to whichever App User ID last restores it,
 * firing a TRANSFER with `transferred_from`/`transferred_to` (and NO product_id/app_user_id).
 * Dropping it left the *losing* account with a stale `hasLifetime: true` (free access it no longer
 * owns) and never granted the *gaining* account server-side. We mirror the move: revoke `from`,
 * grant `to`.
 */
export function entitlementMutationForEvent(
  event: RevenueCatEvent | undefined,
  lifetimeProductId: string,
): EntitlementMutation {
  if (!event) return EMPTY;
  const type = event.type ?? '';

  if (type === 'TRANSFER') {
    const grantIds = toIntIds(event.transferred_to ?? []);
    const granting = new Set(grantIds);
    // If an id is on both sides (shouldn't happen), grant wins — never revoke an id we're granting.
    const revokeIds = toIntIds(event.transferred_from ?? []).filter((id) => !granting.has(id));
    return { grantIds, revokeIds };
  }

  const isPurchase = PURCHASE_TYPES.has(type);
  const isRevoke = REVOKE_TYPES.has(type);
  if (!isPurchase && !isRevoke) return EMPTY;

  // Only our lifetime product grants/revokes. Some event types omit product_id — only enforce when
  // present.
  if (event.product_id && event.product_id !== lifetimeProductId) return EMPTY;

  // RevenueCat may attribute the event to the app_user_id, the original_app_user_id, or any alias
  // (e.g. when an anonymous purchase is later aliased to the logged-in user id).
  const ids = toIntIds([event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]);
  if (ids.length === 0) return EMPTY;

  return isPurchase ? { grantIds: ids, revokeIds: [] } : { grantIds: [], revokeIds: ids };
}
