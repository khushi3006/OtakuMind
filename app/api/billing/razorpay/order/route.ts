import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { getSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api-error';

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const amount = Number(process.env.LIFETIME_PRICE_PAISE ?? '29900');
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });

    const order = await rzp.orders.create({
      amount,
      currency: 'INR',
      notes: { userId: String(session.userId) },
    });

    return NextResponse.json({
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
