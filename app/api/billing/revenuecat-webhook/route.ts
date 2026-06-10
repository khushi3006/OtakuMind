import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';

// RevenueCat sends purchase/renewal events here. Auth is a shared secret set as the
// "Authorization" header in the RevenueCat webhook config. A lifetime non-consumable
// arrives as INITIAL_PURCHASE or NON_RENEWING_PURCHASE.
const PURCHASE_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);
// A refund on a non-consumable surfaces as CANCELLATION (reason CUSTOMER_SUPPORT); EXPIRATION/REFUND
// are handled defensively. On any of these we revoke the purchased flag.
const REVOKE_TYPES = new Set(['CANCELLATION', 'EXPIRATION', 'REFUND']);
// Only our lifetime product grants access. Override via env if the product id ever changes.
const LIFETIME_PRODUCT_ID = process.env.REVENUECAT_LIFETIME_PRODUCT_ID ?? 'com.otakumind.lifetime';

export async function POST(request: Request) {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret || request.headers.get('authorization') !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      event?: {
        type?: string;
        product_id?: string;
        app_user_id?: string;
        original_app_user_id?: string;
        aliases?: string[];
      };
    };
    const event = body.event;
    const type = event?.type ?? '';
    const isPurchase = PURCHASE_TYPES.has(type);
    const isRevoke = REVOKE_TYPES.has(type);
    if (!event || (!isPurchase && !isRevoke)) {
      return NextResponse.json({ ok: true }); // ignore unrelated events
    }

    // Only act on our lifetime product. RevenueCat may route other products through the same
    // webhook; granting/revoking on those would be wrong. (Some event types omit product_id — only
    // enforce when present.)
    if (event.product_id && event.product_id !== LIFETIME_PRODUCT_ID) {
      return NextResponse.json({ ok: true });
    }

    // RevenueCat may attribute the event to the app_user_id, the original_app_user_id, or any
    // alias (e.g. when an anonymous purchase is later aliased to the logged-in user id). Our User
    // ids are integers, so collect every candidate that parses to an integer and act on it.
    const candidateIds = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
      .map((id) => Number(id))
      .filter((n) => Number.isInteger(n));

    if (candidateIds.length === 0) {
      return NextResponse.json({ ok: true }); // anonymous / unmapped id — nothing to do
    }

    // updateMany doesn't throw if an id doesn't exist — it just updates whichever candidate is real.
    // Revoking only clears the purchased flag; grandfathered users keep access via their own flag.
    await db.user.updateMany({
      where: { id: { in: candidateIds } },
      data: isPurchase
        ? { hasLifetime: true, lifetimePurchasedAt: new Date() }
        : { hasLifetime: false, lifetimePurchasedAt: null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
