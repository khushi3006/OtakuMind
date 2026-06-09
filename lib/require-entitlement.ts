import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { computeEntitlement } from '@/lib/entitlement';
import type { SessionPayload } from '@/lib/jwt';

type Result =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

/**
 * Gate for authenticated app-data routes. Returns the session only if the user is
 * authenticated AND entitled (grandfathered, purchased, or within the 14-day trial).
 * 401 when unauthenticated; 403 (code ENTITLEMENT_REQUIRED) when the trial has expired
 * and they haven't paid. Reads entitlement fresh from the DB so a just-completed purchase
 * unlocks immediately. Do NOT use on auth/billing routes or on account deletion.
 */
export async function requireEntitlement(request: Request): Promise<Result> {
  const session = await getSession(request);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { createdAt: true, hasLifetime: true, grandfathered: true },
  });
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const entitlement = computeEntitlement(user);
  if (!entitlement.active) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Your free trial has ended. Unlock OtakuMind to continue.', code: 'ENTITLEMENT_REQUIRED' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}
