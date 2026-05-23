import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeWatchingOrder, updateWatchOrderItems } from '@/lib/watch-order';
import { withDeadlockRetry } from '@/lib/deadlock-retry';
import { WATCH_ORDER_TRANSACTION_OPTIONS } from '@/lib/transaction-options';

/**
 * PUT /api/anime/reorder
 * Body: { items: [{ id: number, watchOrder: number }, ...] }
 * Updates watchOrder for all provided anime in a single transaction.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }

    // Batch update in a transaction for atomicity
    await withDeadlockRetry(() =>
      db.$transaction(async (tx) => {
        await updateWatchOrderItems(tx, items as { id: number; watchOrder: number }[]);
        await normalizeWatchingOrder(tx);
      }, WATCH_ORDER_TRANSACTION_OPTIONS)
    );

    return NextResponse.json({ success: true, updated: items.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
