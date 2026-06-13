-- Ordering/idempotency guard for the RevenueCat webhook: the event_timestamp of the last applied
-- entitlement event. The webhook applies an event to a row only when it is newer than this, so an
-- out-of-order or redelivered event (e.g. a delayed INITIAL_PURCHASE arriving after a TRANSFER, or
-- a retry) can't clobber newer state. Nullable + additive; no backfill needed.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lifetimeEventAt" TIMESTAMP(3);
