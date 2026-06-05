const APP_URL = (process.env.APP_URL || 'https://otakumind.thekhushikumari.com').replace(/\/+$/, '');
const LOGO_URL = `${APP_URL}/logo-email.png`;

interface Template {
  subject: string;
  html: string;
  text: string;
}

/** Email-client-safe shell: cream bg, white card, logo header, muted footer. */
function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#faf9f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #eae8e1;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 32px 0 32px;" align="center">
          <img src="${LOGO_URL}" width="44" height="44" alt="OtakuMind" style="display:block;border:0;" />
          <div style="margin-top:10px;font-size:18px;font-weight:700;color:#1a1a1a;letter-spacing:-0.02em;">OtakuMind</div>
        </td></tr>
        <tr><td style="padding:24px 32px 32px 32px;color:#5c5c5c;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
      </table>
      <div style="max-width:480px;margin-top:16px;color:#9e9c96;font-size:12px;line-height:1.5;text-align:center;padding:0 16px;">
        You received this email because someone used this address on OtakuMind.<br/>
        If this wasn't you, you can safely ignore it.
      </div>
    </td></tr>
  </table></body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
    <td style="border-radius:10px;background:#a3b18a;">
      <a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;">${label}</a>
    </td></tr></table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#1a1a1a;letter-spacing:-0.02em;">${text}</h1>`;
}

export function signupOtpEmail(code: string): Template {
  return {
    subject: `${code} is your OtakuMind verification code`,
    html: shell(`${heading('Verify your email')}
      <p style="margin:0 0 8px 0;">Use this code to finish creating your OtakuMind account. It expires in 10 minutes.</p>
      <div style="margin:24px 0;text-align:center;font-size:34px;font-weight:700;letter-spacing:10px;color:#1a1a1a;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${code}</div>
      <p style="margin:0;color:#9e9c96;font-size:13px;">If you didn't try to sign up, you can ignore this email.</p>`),
    text: `Your OtakuMind verification code is ${code}. It expires in 10 minutes.`,
  };
}

export function welcomeEmail(name: string | null): Template {
  const who = name ? `, ${name}` : '';
  return {
    subject: 'Welcome to OtakuMind',
    html: shell(`${heading(`Welcome${who}!`)}
      <p style="margin:0 0 8px 0;">Your account is verified and ready. Start tracking what you're watching, build your list, and follow other fans.</p>
      ${button(`${APP_URL}/`, 'Open OtakuMind')}`),
    text: `Welcome to OtakuMind${who}! Your account is verified. Open ${APP_URL}/ to get started.`,
  };
}

export function resetPasswordEmail(link: string): Template {
  return {
    subject: 'Reset your OtakuMind password',
    html: shell(`${heading('Reset your password')}
      <p style="margin:0 0 8px 0;">We received a request to reset your OtakuMind password. This link expires in 30 minutes and can be used once.</p>
      ${button(link, 'Reset Password')}
      <p style="margin:0;color:#9e9c96;font-size:13px;">If the button doesn't work, paste this URL into your browser:<br/><span style="color:#8f9b78;word-break:break-all;">${link}</span></p>`),
    text: `Reset your OtakuMind password (expires in 30 minutes, single use): ${link}`,
  };
}

export function passwordChangedEmail(): Template {
  return {
    subject: 'Your OtakuMind password was changed',
    html: shell(`${heading('Your password was changed')}
      <p style="margin:0 0 8px 0;">This is a confirmation that your OtakuMind password was just changed.</p>
      <p style="margin:0;color:#9e9c96;font-size:13px;">If you didn't do this, reset your password immediately and contact support.</p>`),
    text: `Your OtakuMind password was just changed. If this wasn't you, reset it immediately.`,
  };
}
