import nodemailer from 'nodemailer';

// SMTP is optional: without credentials we log the message so local dev still works.
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
export const mailConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

export async function sendMail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  if (!mailConfigured) {
    console.warn(`[mail] SMTP not configured — would have sent to ${to}:\n${text}`);
    return { delivered: false as const };
  }
  const port = Number(SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transport.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, html, text });
  return { delivered: true as const };
}

export function otpEmail(code: string, name?: string) {
  const text = `Hi${name ? ` ${name}` : ''},

Your ALL YOU NEED password reset code is: ${code}

It expires in 10 minutes. If you didn't request this, ignore this email — your password stays unchanged.`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your password reset code is ${code} — expires in 10 minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#161922;border:1px solid #262b39;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#7c83ff;">ALL <span style="color:#8b93a7;">YOU NEED</span></div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:800;color:#f1f3f9;letter-spacing:-0.02em;">Reset your password</h1>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#9aa3b8;">Hi${name ? ` ${name}` : ''}, use this code to set a new password. It expires in <strong style="color:#c9d0e0;">10 minutes</strong>.</p>
        </td></tr>

        <tr><td style="padding:24px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border:1px solid #2b3142;border-radius:16px;">
            <tr><td align="center" style="padding:22px 16px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#6f7891;text-transform:uppercase;margin-bottom:10px;">Your code</div>
              <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#ffffff;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;padding-left:10px;">${code}</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:22px 32px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7891;">Didn't ask for this? You can safely ignore this email — nothing changes until the code is used. Never share this code with anyone.</p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #262b39;">
          <p style="margin:0;font-size:11px;color:#5a6274;">Sent by ALL YOU NEED · your personal vault</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject: `${code} is your password reset code`, html, text };
}
