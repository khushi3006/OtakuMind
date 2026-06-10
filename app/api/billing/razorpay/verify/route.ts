import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

const LIFETIME_PRICE_PAISE = Number(process.env.LIFETIME_PRICE_PAISE ?? '29900');

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = (await request.json()) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(razorpay_signature);
    if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // The signature only proves the (order, payment) pair is genuine — NOT that it belongs to the
    // caller. Without this check a single real payment's (order_id, payment_id, signature) triple
    // could be replayed by any logged-in user to unlock their own account for free. Fetch the order
    // and confirm it was created for THIS session's user (the order route stamps notes.userId), and
    // that it's the lifetime amount/currency. Defence-in-depth; the webhook is still the backstop.
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
    const order = await rzp.orders.fetch(razorpay_order_id);
    const orderUserId = String(order.notes?.userId ?? '');
    if (orderUserId !== String(session.userId)) {
      return NextResponse.json({ error: 'This order does not belong to your account.' }, { status: 403 });
    }
    if (Number(order.amount) !== LIFETIME_PRICE_PAISE || order.currency !== 'INR') {
      return NextResponse.json({ error: 'Unexpected order amount.' }, { status: 400 });
    }

    await db.user.update({
      where: { id: session.userId },
      data: { hasLifetime: true, lifetimePurchasedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
