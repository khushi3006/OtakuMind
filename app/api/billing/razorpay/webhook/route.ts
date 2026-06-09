import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { errorMessage } from '@/lib/api-error';

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
      payload?: { payment?: { entity?: { notes?: { userId?: string } } } };
    };
    if (body.event !== 'payment.captured') {
      return NextResponse.json({ ok: true }); // ignore other events
    }

    const userId = Number(body.payload?.payment?.entity?.notes?.userId);
    if (!Number.isInteger(userId)) {
      return NextResponse.json({ ok: true });
    }

    await db.user
      .update({ where: { id: userId }, data: { hasLifetime: true, lifetimePurchasedAt: new Date() } })
      .catch(() => {}); // unknown user → no-op, don't trigger endless retries

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
