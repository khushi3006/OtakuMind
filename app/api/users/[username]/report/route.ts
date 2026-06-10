import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireEntitlement } from '@/lib/require-entitlement';
import { errorMessage } from '@/lib/api-error';

// Keep in sync with the mobile report sheet's reason list.
const REASONS = new Set(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']);
const DETAILS_MAX = 1000;

// Report a user for objectionable content / abuse. Stored for review; multiple reports are allowed.
export async function POST(request: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    const gate = await requireEntitlement(request);
    if (!gate.ok) return gate.response;
    const meId = gate.session.userId;

    const { username } = await params;
    const handle = username.trim().toLowerCase();
    const target = await db.user.findUnique({ where: { username: handle }, select: { id: true } });
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (target.id === meId) {
      return NextResponse.json({ error: 'You cannot report yourself' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: string; details?: string };
    const reason = (body.reason ?? '').trim().toLowerCase();
    if (!REASONS.has(reason)) {
      return NextResponse.json({ error: 'Invalid report reason' }, { status: 400 });
    }
    const details = (body.details ?? '').trim().slice(0, DETAILS_MAX) || null;

    await db.report.create({
      data: { reporterId: meId, reportedUserId: target.id, reason, details },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
