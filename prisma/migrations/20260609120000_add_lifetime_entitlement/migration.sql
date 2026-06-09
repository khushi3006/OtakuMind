-- Paid plan: account-wide entitlement columns on User.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasLifetime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lifetimePurchasedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "grandfathered" BOOLEAN NOT NULL DEFAULT false;
