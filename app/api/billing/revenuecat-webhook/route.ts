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

    const body = (await request.json()) as {
      event?: {
        type?: string;
        app_user_id?: string;
        original_app_user_id?: string;
        aliases?: string[];
      };
    };
    const event = body.event;
    if (!event || !PURCHASE_TYPES.has(event.type ?? '')) {
      return NextResponse.json({ ok: true }); // ignore non-purchase events
    }

    // RevenueCat may attribute the purchase to the app_user_id, the original_app_user_id, or any
    // alias (e.g. when an anonymous purchase is later aliased to the logged-in user id). Our User
    // ids are integers, so collect every candidate that parses to an integer and grant to it.
    const candidateIds = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
      .map((id) => Number(id))
      .filter((n) => Number.isInteger(n));

    if (candidateIds.length === 0) {
      return NextResponse.json({ ok: true }); // anonymous / unmapped id — nothing to do
    }

    // updateMany doesn't throw if an id doesn't exist — it just updates whichever candidate is real.
    await db.user.updateMany({
      where: { id: { in: candidateIds } },
      data: { hasLifetime: true, lifetimePurchasedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
