import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';

// RevenueCat sends purchase/renewal events here. Auth is a shared secret set as the
// "Authorization" header in the RevenueCat webhook config. A lifetime non-consumable
// arrives as INITIAL_PURCHASE or NON_RENEWING_PURCHASE.
const PURCHASE_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);

export async function POST(request: Request) {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret || request.headers.get('authorization') !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as { event?: { type?: string; app_user_id?: string } };
    const event = body.event;
    if (!event || !PURCHASE_TYPES.has(event.type ?? '')) {
      return NextResponse.json({ ok: true }); // ignore non-purchase events
    }

    const userId = Number(event.app_user_id);
    if (!Number.isInteger(userId)) {
      return NextResponse.json({ ok: true }); // anonymous / unmapped id — nothing to do
    }

    await db.user
      .update({ where: { id: userId }, data: { hasLifetime: true, lifetimePurchasedAt: new Date() } })
      .catch(() => {}); // unknown user → no-op, don't make RevenueCat retry forever

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
