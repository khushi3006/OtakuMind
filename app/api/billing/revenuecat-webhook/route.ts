import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';
import { entitlementMutationForEvent, type RevenueCatEvent } from '@/lib/revenuecat';

// RevenueCat sends purchase/refund/transfer events here. Auth is a shared secret set as the
// "Authorization" header in the RevenueCat webhook config. The event→mutation decision lives in
// `lib/revenuecat.ts` (pure, unit-tested); this route just authenticates and applies the result.
const LIFETIME_PRODUCT_ID = process.env.REVENUECAT_LIFETIME_PRODUCT_ID ?? 'com.otakumind.lifetime';

/** Constant-time comparison of the shared-secret Authorization header (matches the Razorpay webhook). */
function authorized(request: Request): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as { event?: RevenueCatEvent };
    const event = body.event;
    const { grantIds, revokeIds } = entitlementMutationForEvent(event, LIFETIME_PRODUCT_ID);

    // Ordering/idempotency guard: RevenueCat doesn't guarantee delivery order and retries failed
    // deliveries (e.g. after an outage). Apply an event to a row only when it's newer than the last
    // entitlement event we recorded for it — so a delayed INITIAL_PURCHASE can't re-grant an account
    // a later TRANSFER already moved away, and a redelivered event is a no-op. Events without a
    // timestamp (shouldn't happen) fall back to applying unconditionally.
    const eventAt =
      typeof event?.event_timestamp_ms === 'number' ? new Date(event.event_timestamp_ms) : null;
    const newer = eventAt ? { OR: [{ lifetimeEventAt: null }, { lifetimeEventAt: { lt: eventAt } }] } : {};

    // updateMany doesn't throw if an id doesn't exist — it just updates whichever candidates are
    // real. A TRANSFER produces both: grant the gaining account(s), revoke the losing one(s).
    // Revoking only clears the purchased flag; grandfathered users keep access via their own flag.
    if (grantIds.length > 0) {
      await db.user.updateMany({
        where: { id: { in: grantIds }, ...newer },
        data: { hasLifetime: true, lifetimePurchasedAt: new Date(), lifetimeEventAt: eventAt ?? undefined },
      });
    }
    if (revokeIds.length > 0) {
      await db.user.updateMany({
        where: { id: { in: revokeIds }, ...newer },
        data: { hasLifetime: false, lifetimePurchasedAt: null, lifetimeEventAt: eventAt ?? undefined },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
