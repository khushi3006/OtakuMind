# Email Service for Auth (Signup OTP + Reset-Password Link) — Design

**Date:** 2026-06-06
**Repos:** `OtakuMind` (Next.js 16 web backend — commits authored by *khushi*) and `otakumind-mobile` (Expo SDK 56 client — commits authored by the device owner).

## Goal

Add a real transactional email service (Resend) to the OtakuMind auth flows:

1. **Signup → OTP verification.** A new account is created *only after* a 6-digit code emailed to the user is confirmed.
2. **Forgot password → reset link.** A tokenized URL is emailed; opening it lets the user set a new password (works for both web and mobile — the link opens the web page).
3. **Welcome email** after a verified signup.
4. **Password-changed alert** on any password change or reset.

Also: update the deployed base URL everywhere to `https://otakumind.thekhushikumari.com` and push the new env vars to Vercel.

## Architecture

All email/OTP/token logic lives in the **web backend**. The mobile app is a thin client over the shared httpOnly-cookie session — it gains new screens that call the new endpoints. Resend is the transport.

### New backend infrastructure

- `lib/email.ts` — Resend client wrapper. Reads `RESEND_API_KEY` and `EMAIL_FROM`. Single `sendEmail({ to, subject, html, text })` helper. Throws a typed error on failure; callers decide whether failure is fatal (OTP send = fatal; welcome/alert = best-effort, logged).
- `lib/email-templates.ts` — pure functions returning `{ subject, html, text }` for each message type. Branded HTML matching the OtakuMind theme (see Email Design). Logo referenced as a hosted PNG at `${APP_URL}/logo-email.png`.
- `lib/otp.ts` — `generateOtp()` (6-digit numeric), `hashOtp`/`hashToken` (sha256 at rest), `generateResetToken()` (32 random bytes hex), constant-time compare helpers, expiry constants.
- `public/logo-email.png` — rasterized brand logo (email clients strip inline SVG). Generated from `components/Logo.tsx` art.

### New Prisma models

Created the project's established two-mechanism way: add to `prisma/schema.prisma`, write a formal migration under `prisma/migrations/`, mirror with a `tsx` raw-SQL script under `scripts/` (idempotent, `IF NOT EXISTS`), run `npx prisma generate`, and apply to **both** the dev and production Neon branches.

```prisma
model PendingSignup {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  name         String?
  username     String?
  passwordHash String
  otpHash      String
  attempts     Int      @default(0)
  expiresAt    DateTime
  lastSentAt   DateTime @default(now())
  createdAt    DateTime @default(now())
}

model PasswordResetToken {
  id        Int       @id @default(autoincrement())
  userId    Int
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

`User` gains `passwordResetTokens PasswordResetToken[]`. No User row exists until OTP is confirmed, so no `emailVerified` column is needed.

## Endpoints (web backend)

All under `/api/auth/*` (already exempt from session gating in `proxy.ts`).

| Endpoint | Behaviour |
|---|---|
| `POST /api/auth/signup/start` | Body `{ email, password, name, username? }`. Validate (reuse signup rules: email regex, password ≥ 6, username shape). 409 if email already a real `User`; 409 if explicit username taken. Upsert `PendingSignup` keyed on email (hash password + OTP, `expiresAt = now+10m`, reset `attempts`). Enforce 60s resend cooldown via `lastSentAt`. Email the OTP (fatal on send failure). Returns `{ ok: true }` — no session, no user data. |
| `POST /api/auth/signup/verify` | Body `{ email, code }`. Load `PendingSignup`; reject if missing/expired/`attempts ≥ 5`. On wrong code: increment `attempts`, 400. On match: resolve final username (explicit or auto-generate via `lib/username.ts`), create `User`, delete the `PendingSignup`, set session cookie, send welcome email (best-effort). Returns `{ user }` (same shape the old signup returned). |
| `POST /api/auth/forgot-password` | Body `{ email }`. If a matching `User` exists, create a `PasswordResetToken` (`expiresAt = now+30m`) and email a link `${APP_URL}/reset-password?token=<raw>`. **Always** returns generic success (no email enumeration). |
| `POST /api/auth/reset-password` | Body `{ token, password }`. Hash token, look up unused & unexpired row; 400 otherwise. Update the user's password, mark token `usedAt`, invalidate the user's other reset tokens, send password-changed alert (best-effort). Returns `{ ok: true }`. |

`POST /api/auth/change-password` (existing): add a best-effort password-changed alert after a successful change. The old `POST /api/auth/signup` route is **removed**; clients switch to start+verify. Google/Apple OAuth signup is untouched (those users are inherently verified).

### Security parameters

- **OTP:** 6-digit numeric, sha256-hashed at rest, 10-minute expiry, max 5 attempts, 60-second resend cooldown.
- **Reset token:** 32 random bytes (hex), sha256-hashed at rest, 30-minute expiry, single-use, siblings invalidated on use.
- Generic responses on forgot-password to avoid account enumeration. Signup-start keeps the existing "email already registered" 409 (parity with current UX).

## Client flows

### Web (`khushi` author)

- **`/signup`** → two-step. Step 1 collects name/username/email/password and calls `signup/start`. Step 2 renders an inline OTP input with a resend countdown and calls `signup/verify`; success routes to `/` (session now set). Reuses existing `.auth-*` styles.
- **`/forgot-password`** → replace the simulated `setTimeout` with a real `forgot-password` call. Success state copy unchanged ("reset link sent").
- **`/reset-password`** → **new page**. Reads `?token=`, shows new-password + confirm fields, calls `reset-password`, then links to `/login`. Handles missing/invalid token with a clear error + link back to `/forgot-password`.
- Add `/reset-password` to public (non-protected) routes in `proxy.ts` if needed (it's not in `PROTECTED_PAGES`, and it must be reachable while logged out — confirm the redirect logic doesn't bounce it).

### Mobile (device-owner author)

- **`src/api/auth.ts`** — replace `useSignup` with `useStartSignup` + `useVerifySignup`; add `useForgotPassword`. (`useVerifySignup` calls `signIn(res.user)` on success, same as before.)
- **`signup.tsx`** → on submit calls `startSignup`, then `router.push` to the new verify screen carrying the email (+ a way to trigger resend).
- **`src/app/(auth)/verify-otp.tsx`** → **new screen**. 6-digit code entry (segmented boxes), resend button with countdown, calls `verifySignup`; success routes to `/`. Built with existing `AuthScaffold`, `Input`/`Button`, `haptics`, theme — matching the established refined-motion aesthetic.
- **`forgot-password.tsx`** → replace the simulated timer with a real `forgotPassword` call. Keep the existing "check your inbox" success state. The emailed link opens the web `/reset-password` page in the browser — a cross-platform URL system, no deep link needed.

## Email design (branded)

Shared table-based HTML (email-client-safe), matching the app theme:

- Page bg `#faf9f6` (warm cream); centered card `#ffffff` with `1px` border `#eae8e1`, rounded.
- Header: `logo-email.png` (~40px) + "OtakuMind" wordmark in `#1a1a1a`.
- Body text `#5c5c5c`; headings `#1a1a1a`.
- Primary CTA button: solid sage `#a3b18a`, white text, rounded (used for reset link; OTP email shows the code in a large letter-spaced mono block instead).
- Footer: muted `#9e9c96`, small print + "you received this because…" line.
- Always include a plaintext alternative.

Four templates: **signup OTP**, **welcome**, **password-reset link**, **password-changed alert**.

## Environment & deployment

New env vars (added to `.env`, `.env.example`, and pushed to the Vercel `otakumind` project for Production + Preview):

- `RESEND_API_KEY` = the provided Resend key.
- `EMAIL_FROM` = `OtakuMind <otakumind@thekhushikumari.com>`.
- `APP_URL` = `https://otakumind.thekhushikumari.com` (reset links + email logo base).

URL change:

- Mobile `otakumind-mobile/.env`: `EXPO_PUBLIC_API_BASE_URL=https://otakumind.thekhushikumari.com`.
- Web has no hardcoded deployment URL (relative paths); its base comes from `APP_URL`.
- Vercel: confirm the custom domain `otakumind.thekhushikumari.com` is attached to the project (DNS owned by the user).
- Historical docs under `docs/superpowers/{plans,specs}` that mention the old `vercel.app` URL are left unchanged as historical records.

## Error handling

- OTP/token send failure on `signup/start` and `forgot-password`-with-real-user: `signup/start` surfaces a 502-style error (the user must get the code); `forgot-password` still returns generic success but logs the failure server-side.
- Welcome and password-changed emails are best-effort: failures are logged, never block the auth response.
- Expired/exhausted OTP returns a clear, distinct message so the client can prompt a resend.
- Mobile/web both map backend `error`/`code` to friendly copy via existing `getErrorMessage`/`errorMessage`.

## Testing / verification

No automated test framework in either repo. Manual verification:

- `signup/start` → receive code → `verify` creates the user, sets the session, welcome email arrives.
- Wrong code increments attempts; 6th attempt blocked; resend respects 60s cooldown.
- `forgot-password` emails a working link; `/reset-password` updates the password; alert email arrives; token is single-use and expires.
- Web `npm run build` + `npm run lint` clean. Mobile `eslint` + type-check clean.
- Confirm emails render correctly (logo, button, colors) in a real client.

## Out of scope (YAGNI)

- Login-from-new-device alerts, email-change verification, magic-link login, deep-linked mobile reset, per-IP rate limiting beyond the OTP cooldown.
