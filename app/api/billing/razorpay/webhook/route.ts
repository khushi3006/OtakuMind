import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';

const LIFETIME_PRICE_PAISE = Number(process.env.LIFETIME_PRICE_PAISE ?? '29900');

export async function POST(request: Request) {
  try {
    const raw = await request.text(); // raw body required for signature verification
    const signature = request.headers.get('x-razorpay-signature') ?? '';
    const expected = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);
    if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const body = JSON.parse(raw) as {
      event?: string;
      payload?: {
        payment?: { entity?: { amount?: number; currency?: string; notes?: { userId?: string } } };
        refund?: { entity?: { payment_id?: string } };
      };
    };

    // --- Grant on a captured payment ---
    if (body.event === 'payment.captured') {
      const payment = body.payload?.payment?.entity;
      const userId = Number(payment?.notes?.userId);
      if (!Number.isInteger(userId)) {
        return NextResponse.json({ ok: true });
      }
      // Only grant for the exact lifetime price/currency. The order is created server-side at this
      // amount, so a mismatch means the event isn't one of ours — never grant on it.
      if (Number(payment?.amount) !== LIFETIME_PRICE_PAISE || payment?.currency !== 'INR') {
        return NextResponse.json({ ok: true });
      }
      await db.user
        .update({ where: { id: userId }, data: { hasLifetime: true, lifetimePurchasedAt: new Date() } })
        .catch(() => {}); // unknown user → no-op, don't trigger endless retries
      return NextResponse.json({ ok: true });
    }

    // --- Revoke on a processed refund ---
    if (body.event === 'refund.processed') {
      const paymentId = body.payload?.refund?.entity?.payment_id;
      if (!paymentId) return NextResponse.json({ ok: true });
      // The refund entity only carries the payment id; fetch the payment to recover notes.userId.
      const rzp = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!,
        key_secret: process.env.RAZORPAY_KEY_SECRET!,
      });
      const payment = await rzp.payments.fetch(paymentId).catch(() => null);
      const userId = Number((payment?.notes as { userId?: string } | undefined)?.userId);
      if (!Number.isInteger(userId)) return NextResponse.json({ ok: true });
      await db.user
        .update({ where: { id: userId }, data: { hasLifetime: false, lifetimePurchasedAt: null } })
        .catch(() => {}); // grandfathered users keep access via the grandfathered flag regardless
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true }); // ignore other events
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
