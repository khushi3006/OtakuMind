import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entitlementMutationForEvent } from './revenuecat.ts';

const PRODUCT = 'com.otakumind.lifetime';

test('INITIAL_PURCHASE grants the app_user_id', () => {
  const m = entitlementMutationForEvent({ type: 'INITIAL_PURCHASE', product_id: PRODUCT, app_user_id: '7' }, PRODUCT);
  assert.deepEqual(m, { grantIds: [7], revokeIds: [] });
});

test('NON_RENEWING_PURCHASE grants the app_user_id', () => {
  const m = entitlementMutationForEvent({ type: 'NON_RENEWING_PURCHASE', product_id: PRODUCT, app_user_id: '7' }, PRODUCT);
  assert.deepEqual(m, { grantIds: [7], revokeIds: [] });
});

test('a purchase collects app_user_id, original_app_user_id, and integer aliases (deduped)', () => {
  const m = entitlementMutationForEvent(
    { type: 'INITIAL_PURCHASE', app_user_id: '7', original_app_user_id: '7', aliases: ['8', '$RCAnonymousID:abc'] },
    PRODUCT,
  );
  assert.deepEqual(m.grantIds.sort(), [7, 8]);
  assert.deepEqual(m.revokeIds, []);
});

test('CANCELLATION revokes', () => {
  const m = entitlementMutationForEvent({ type: 'CANCELLATION', product_id: PRODUCT, app_user_id: '7' }, PRODUCT);
  assert.deepEqual(m, { grantIds: [], revokeIds: [7] });
});

test('EXPIRATION and REFUND revoke', () => {
  for (const type of ['EXPIRATION', 'REFUND']) {
    const m = entitlementMutationForEvent({ type, app_user_id: '9' }, PRODUCT);
    assert.deepEqual(m, { grantIds: [], revokeIds: [9] });
  }
});

test('a purchase of a different product is ignored', () => {
  const m = entitlementMutationForEvent({ type: 'INITIAL_PURCHASE', product_id: 'com.other.thing', app_user_id: '7' }, PRODUCT);
  assert.deepEqual(m, { grantIds: [], revokeIds: [] });
});

test('a purchase with no integer ids (anonymous only) is a no-op', () => {
  const m = entitlementMutationForEvent({ type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc' }, PRODUCT);
  assert.deepEqual(m, { grantIds: [], revokeIds: [] });
});

test('unknown event types are ignored', () => {
  assert.deepEqual(entitlementMutationForEvent({ type: 'TEST', app_user_id: '7' }, PRODUCT), { grantIds: [], revokeIds: [] });
  assert.deepEqual(entitlementMutationForEvent({ type: 'BILLING_ISSUE', app_user_id: '7' }, PRODUCT), { grantIds: [], revokeIds: [] });
});

test('an undefined event is a no-op', () => {
  assert.deepEqual(entitlementMutationForEvent(undefined, PRODUCT), { grantIds: [], revokeIds: [] });
});

// --- TRANSFER: the case the old handler dropped (the bug) ---

test('TRANSFER grants the gaining ids and revokes the losing ids', () => {
  const m = entitlementMutationForEvent(
    { type: 'TRANSFER', transferred_from: ['7'], transferred_to: ['8'] },
    PRODUCT,
  );
  assert.deepEqual(m, { grantIds: [8], revokeIds: [7] });
});

test('TRANSFER filters out anonymous (non-integer) ids on both sides', () => {
  const m = entitlementMutationForEvent(
    { type: 'TRANSFER', transferred_from: ['$RCAnonymousID:old', '7'], transferred_to: ['$RCAnonymousID:new', '8'] },
    PRODUCT,
  );
  assert.deepEqual(m, { grantIds: [8], revokeIds: [7] });
});

test('TRANSFER applies even though it carries no product_id', () => {
  // TRANSFER events have no product_id; the product filter must not drop them.
  const m = entitlementMutationForEvent({ type: 'TRANSFER', transferred_to: ['8'] }, PRODUCT);
  assert.deepEqual(m, { grantIds: [8], revokeIds: [] });
});

test('TRANSFER with an id on both sides grants it (never revokes an id being granted)', () => {
  const m = entitlementMutationForEvent(
    { type: 'TRANSFER', transferred_from: ['8'], transferred_to: ['8'] },
    PRODUCT,
  );
  assert.deepEqual(m, { grantIds: [8], revokeIds: [] });
});
