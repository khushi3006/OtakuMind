import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeWatchingOrder, updateWatchOrderItems } from '@/lib/watch-order';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';
import { requireEntitlement } from '@/lib/require-entitlement';

/**
 * PUT /api/anime/reorder
 * Body: { items: [{ id: number, watchOrder: number }, ...] }
 * Updates watchOrder for all provided anime in a single transaction.
 */
export async function PUT(request: Request) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const session = gate.session;
    const userId = session.userId;

    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }

    // Verify ownership of all items in the request
    const ids = items.map((item: { id: number }) => item.id);
    const dbCount = await db.anime.count({
      where: {
        id: { in: ids },
        userId,
      },
    });

    if (dbCount !== ids.length) {
      return NextResponse.json({ error: 'Unauthorized or invalid item IDs' }, { status: 403 });
    }

    // Batch update in a transaction for atomicity
    await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        await updateWatchOrderItems(tx, items as { id: number; watchOrder: number }[]);
        await normalizeWatchingOrder(tx, userId);
      }, WATCH_ORDER_TRANSACTION_OPTIONS)
    );

    return NextResponse.json({ success: true, updated: items.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
