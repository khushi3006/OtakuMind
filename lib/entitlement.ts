// Single source of truth for a user's access entitlement.
// Order of precedence: grandfathered (free, pre-launch) → purchased (paid lifetime)
// → trial (14 days from signup) → expired. Pure: no DB, no side effects.
// Used by GET /api/auth/me (mobile) and the web layout gate.

export const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EntitlementReason = 'grandfathered' | 'purchased' | 'trial' | 'expired';

export interface Entitlement {
  active: boolean;
  reason: EntitlementReason;
  /** ISO timestamp when the trial ends; null when the user is not on a trial. */
  trialEndsAt: string | null;
}

/** The minimal `User` fields needed to compute entitlement. */
export interface EntitlementInput {
  createdAt: Date;
  hasLifetime: boolean;
  grandfathered: boolean;
}

export function computeEntitlement(user: EntitlementInput, now: Date = new Date()): Entitlement {
  if (user.grandfathered) {
    return { active: true, reason: 'grandfathered', trialEndsAt: null };
  }
  if (user.hasLifetime) {
    return { active: true, reason: 'purchased', trialEndsAt: null };
  }
  const trialEnd = new Date(user.createdAt.getTime() + TRIAL_DAYS * DAY_MS);
  if (now.getTime() < trialEnd.getTime()) {
    return { active: true, reason: 'trial', trialEndsAt: trialEnd.toISOString() };
  }
  return { active: false, reason: 'expired', trialEndsAt: trialEnd.toISOString() };
}
