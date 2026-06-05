import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || 'OtakuMind <onboarding@resend.dev>';

const resend = apiKey ? new Resend(apiKey) : null;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends a transactional email via Resend.
 * Throws on failure — callers decide whether the failure is fatal
 * (OTP / reset link) or best-effort (welcome / alert).
 */
export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<void> {
  if (!resend) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  const { error } = await resend.emails.send({ from, to, subject, html, text });
  if (error) {
    throw new Error(`Resend error: ${error.message ?? 'unknown'}`);
  }
}
