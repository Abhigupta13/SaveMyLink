import nodemailer from 'nodemailer';

// SMTP is optional: without credentials we log the message so local dev still works.
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
export const mailConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

export async function sendMail(
  { to, subject, html, text, replyTo }:
  { to: string; subject: string; html: string; text: string; replyTo?: string }
) {
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
  // From stays our own address — providers reject mail claiming to be from someone else's
  // domain. replyTo is what actually makes "hit reply" reach the person who wrote in.
  await transport.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, html, text, replyTo });
  return { delivered: true as const };
}

/** User-typed text goes into every one of these templates; none of it may arrive as markup. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Sent when someone is added to a project. Two audiences, one template: a person who already
 * has an account lands on the project, a new person lands on signup with their email prefilled
 * — the address has to match for `memberEmails` to let them in, so it is not theirs to retype.
 *
 * Without a projectName it is a plain invite from someone's contacts. Same envelope, same CTA,
 * different sentence — a second near-identical template would only drift from this one.
 */
export function inviteEmail(opts: { projectName?: string; inviterName: string; link: string; hasAccount: boolean; name?: string }) {
  const { projectName, inviterName, link, hasAccount, name } = opts;
  const cta = hasAccount ? (projectName ? 'Open the project' : 'Open the app') : 'Create your account';
  const heading = projectName ? "You've been added to a project" : "You've been invited";
  const lead = projectName
    ? (hasAccount
      ? `You now have access to everything in it — tasks, meeting notes and files.`
      : `Create an account with this email address and the project will be waiting for you, along with anything already assigned to you.`)
    : (hasAccount
      ? `They work in ALL YOU NEED — shared projects, tasks, meeting notes and files, all in one place.`
      : `ALL YOU NEED keeps links, notes, tasks, meetings and files in one place, and turns a recorded meeting into assigned tasks. Create an account with this email address to get started.`);
  const openingLine = projectName
    ? `${inviterName} added you to the project "${projectName}" on ALL YOU NEED.`
    : `${inviterName} invited you to ALL YOU NEED.`;

  const text = `Hi${name ? ` ${name}` : ''},

${openingLine}

${lead}

${cta}: ${link}

If you weren't expecting this, you can ignore this email.`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${openingLine}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#161922;border:1px solid #262b39;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#e08a6a;">ALL <span style="color:#8b93a7;">YOU NEED</span></div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:800;color:#f1f3f9;letter-spacing:-0.02em;">${heading}</h1>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#9aa3b8;">Hi${name ? ` ${name}` : ''}, <strong style="color:#c9d0e0;">${inviterName}</strong> ${projectName ? `added you to <strong style="color:#c9d0e0;">${projectName}</strong>` : 'invited you to ALL YOU NEED'}. ${lead}</p>
        </td></tr>

        <tr><td style="padding:24px 32px 0;">
          <a href="${link}" style="display:block;text-align:center;padding:14px 20px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:14px;font-weight:800;font-size:15px;">${cta}</a>
        </td></tr>

        <tr><td style="padding:18px 32px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7891;">Button not working? Paste this into your browser:<br><span style="color:#8b93a7;word-break:break-all;">${link}</span></p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #262b39;">
          <p style="margin:0;font-size:11px;color:#5a6274;">Sent by ALL YOU NEED · your personal vault</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return {
    subject: projectName ? `${inviterName} added you to "${projectName}"` : `${inviterName} invited you to ALL YOU NEED`,
    html, text,
  };
}

/**
 * One code template, two jobs: resetting a password and confirming a new address. Deliberately
 * kept plain — a transactional mail stuffed with feature copy is what gets a Gmail app password
 * filtered, and the person reading it is looking for six digits, nothing else.
 */
export function otpEmail(code: string, name?: string, purpose: 'reset' | 'verify' = 'reset') {
  const verify = purpose === 'verify';
  const title = verify ? 'Confirm your email' : 'Reset your password';
  const blurb = verify
    ? 'use this code to confirm your email address'
    : 'use this code to set a new password';
  const footnote = verify
    ? "Didn't sign up? You can safely ignore this email — the account stays unusable without this code. Never share it with anyone."
    : "Didn't ask for this? You can safely ignore this email — nothing changes until the code is used. Never share this code with anyone.";

  const text = `Hi${name ? ` ${name}` : ''},

Your ALL YOU NEED ${verify ? 'email confirmation' : 'password reset'} code is: ${code}

It expires in 10 minutes. If you didn't ${verify ? 'sign up' : 'request this'}, ignore this email${verify ? '.' : ' — your password stays unchanged.'}`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your code is ${code} — expires in 10 minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#161922;border:1px solid #262b39;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#e08a6a;">ALL <span style="color:#8b93a7;">YOU NEED</span></div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:800;color:#f1f3f9;letter-spacing:-0.02em;">${title}</h1>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#9aa3b8;">Hi${name ? ` ${name}` : ''}, ${blurb}. It expires in <strong style="color:#c9d0e0;">10 minutes</strong>.</p>
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
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7891;">${footnote}</p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #262b39;">
          <p style="margin:0;font-size:11px;color:#5a6274;">Sent by ALL YOU NEED · your personal vault</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject: `${code} is your ${verify ? 'confirmation' : 'password reset'} code`, html, text };
}

/**
 * "Help us improve" lands in the admin's inbox as well as the app, so a bug report is seen
 * the day it is written rather than the next time someone opens the inbox page. The reporter's
 * address is the Reply-To, so answering them is one keystroke.
 */
export function suggestionEmail(opts: {
  kind: string; message: string; from: string; page?: string; userAgent?: string; shotUrl?: string;
}) {
  const { kind, message, from, page, userAgent, shotUrl } = opts;
  const label = kind === 'bug' ? '🐞 Bug' : kind === 'idea' ? '💡 Idea' : '💬 Feedback';
  const rows = [
    ['From', from],
    ['Page', page || '—'],
    ['Browser', userAgent || '—'],
  ];

  const text = `${label} from ${from}

${message}

Page: ${page || '—'}
Browser: ${userAgent || '—'}${shotUrl ? `\nScreenshot: ${shotUrl}` : ''}

Reply to this email to answer them directly.`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#161922;border:1px solid #262b39;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#e08a6a;">ALL <span style="color:#8b93a7;">YOU NEED</span></div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;font-weight:800;color:#f1f3f9;letter-spacing:-0.02em;">${label}</h1>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#9aa3b8;">Someone just used “Help us improve”.</p>
        </td></tr>

        <tr><td style="padding:20px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border:1px solid #2b3142;border-radius:16px;">
            <tr><td style="padding:20px;">
              <p style="margin:0;font-size:15px;line-height:1.65;color:#e6e9f2;white-space:pre-wrap;">${esc(message)}</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows.map(([k, v]) => `<tr>
              <td style="padding:4px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6f7891;width:80px;vertical-align:top;">${k}</td>
              <td style="padding:4px 0;font-size:12px;line-height:1.5;color:#9aa3b8;word-break:break-word;">${esc(String(v))}</td>
            </tr>`).join('')}
          </table>
        </td></tr>

        ${shotUrl ? `<tr><td style="padding:18px 32px 0;">
          <a href="${shotUrl}" style="display:inline-block;padding:10px 18px;border-radius:12px;background:#7c83ff;color:#0f1117;font-size:13px;font-weight:800;text-decoration:none;">View screenshot</a>
          <div style="margin-top:8px;font-size:11px;color:#5a6274;">Opens in the app — you'll need to be signed in.</div>
        </td></tr>` : ''}

        <tr><td style="padding:22px 32px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7891;">Reply to this email to answer ${esc(from)} directly.</p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #262b39;">
          <p style="margin:0;font-size:11px;color:#5a6274;">Sent by ALL YOU NEED · Help us improve</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: `${label} from ${from}`, html, text };
}

/** Enough of their own words to recognise which report this is, without quoting an essay back. */
const QUOTE_LIMIT = 400;

/**
 * The other end of "Help us improve": an admin closed the report, so the person who took the
 * trouble to write in hears back. Deliberately not a status update — it says what was done, in
 * the admin's own words when they wrote any, and thanks them.
 *
 * This one is addressed to the REPORTER, which is why it takes no address of any kind. The admin
 * who closed it is recorded on the row for the inbox, and their personal address has no business
 * in a mail leaving to a stranger; `suggestionEmail` puts a From row in the body because that one
 * goes to us, and copying that habit into this template is the mistake worth designing out.
 */
export function resolvedEmail(opts: { message: string; note?: string; name?: string }) {
  const { message, note, name } = opts;
  const trimmed = String(message || '').trim();
  const quote = trimmed.length > QUOTE_LIMIT ? `${trimmed.slice(0, QUOTE_LIMIT).trimEnd()}…` : trimmed;
  const said = String(note || '').trim();

  const text = `Hi${name ? ` ${name}` : ''},

Thank you for the feedback you sent us through Help us improve. We have reviewed it, and it is now resolved.

You reported:

“${quote}”${said ? `\n\n${said}` : ''}

We appreciate you taking the time to report this. It is how we find out what needs fixing.

If we have misunderstood, reply to this email and we will reopen it.

— The ALL YOU NEED team`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">We have reviewed your feedback and it is now resolved.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#161922;border:1px solid #262b39;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#e08a6a;">ALL <span style="color:#8b93a7;">YOU NEED</span></div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:800;color:#f1f3f9;letter-spacing:-0.02em;">Your feedback has been resolved</h1>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#9aa3b8;">Hi${name ? ` ${esc(name)}` : ''}, thank you for the feedback you sent us through “Help us improve”. You reported:</p>
        </td></tr>

        <tr><td style="padding:18px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border:1px solid #2b3142;border-radius:16px;">
            <tr><td style="padding:20px;">
              <p style="margin:0;font-size:15px;line-height:1.65;color:#e6e9f2;white-space:pre-wrap;">${esc(quote)}</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 32px 0;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#c9d0e0;">We have reviewed this, and it is now resolved.</p>
          ${said ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#9aa3b8;white-space:pre-wrap;">${esc(said)}</p>` : ''}
        </td></tr>

        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#9aa3b8;">We appreciate you taking the time to report this. It is how we find out what needs fixing.</p>
          <p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#6f7891;">If we have misunderstood, reply to this email and we will reopen it.</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#9aa3b8;">— The ALL YOU NEED team</p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #262b39;">
          <p style="margin:0;font-size:11px;color:#5a6274;">Sent by ALL YOU NEED · Help us improve</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: 'Your feedback has been resolved', html, text };
}

/**
 * The one email a new signup actually reads: it arrives the moment they finish confirming, when
 * they have just committed. Only for people who arrived on their own — someone invited to a
 * project already got a personal "X added you to Y", which is a better welcome than this, and
 * three emails in ninety seconds reads as spam.
 */
export function welcomeEmail(opts: { name?: string; link: string }) {
  const { name, link } = opts;
  const starts = [
    ['Save anything, from anywhere', 'Share a link from any app on your phone — a recipe, a flat listing, a spec. Title, thumbnail and category are filled in for you.'],
    ['Ask Jarvis', 'Tap the spark button and talk. “What’s urgent today?”, “where’s that site I saved?” — it answers from your own stuff, and can add tasks or notes for you.'],
    ['Record a meeting or a thought', 'Hit record in MOM. You get a clean summary plus the action items pulled out, ready to assign — at work, or just so you stop forgetting what you promised.'],
  ];

  const text = `Hi${name ? ` ${name}` : ''},

Your email is confirmed — welcome to ALL YOU NEED.

It keeps links, notes, tasks, meetings, documents and people in one place, and it chases the things you said you would do — at work and in the rest of your life.

Everything you save is yours alone by default. A project is the only thing your team can see, and even then only the people you add.

Three things worth trying first:

${starts.map(([t, d]) => `• ${t} — ${d}`).join('\n\n')}

Open the app: ${link}

Something confusing or broken? Hit "Help us improve" inside the app — it comes straight to us.`;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your email is confirmed — here are three things to try first.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#161922;border:1px solid #262b39;border-radius:20px;overflow:hidden;">

        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.08em;color:#e08a6a;">ALL <span style="color:#8b93a7;">YOU NEED</span></div>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:800;color:#f1f3f9;letter-spacing:-0.02em;">You're in${name ? `, ${name}` : ''}</h1>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#9aa3b8;">Links, notes, tasks, meetings, documents and people — one place that answers back, and chases the things you said you would do. <strong style="color:#c9d0e0;">At work and in the rest of your life.</strong></p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#8b93a7;">Everything you save is yours alone by default. A project is the only thing your team can see — and only the people you add to it.</p>
        </td></tr>

        <tr><td style="padding:22px 32px 0;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6f7891;margin-bottom:12px;">Three things to try first</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${starts.map(([t, d]) => `<tr><td style="padding:0 0 14px;">
              <div style="font-size:14px;font-weight:800;color:#e6e9f2;margin-bottom:3px;">${t}</div>
              <div style="font-size:13px;line-height:1.55;color:#9aa3b8;">${d}</div>
            </td></tr>`).join('')}
          </table>
        </td></tr>

        <tr><td style="padding:8px 32px 0;">
          <a href="${link}" style="display:block;text-align:center;padding:14px 20px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:14px;font-weight:800;font-size:15px;">Open the app</a>
        </td></tr>

        <tr><td style="padding:18px 32px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6f7891;">Something confusing or broken? Hit “Help us improve” inside the app — it comes straight to us.</p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #262b39;">
          <p style="margin:0;font-size:11px;color:#5a6274;">Sent by ALL YOU NEED · your personal vault</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: 'Welcome to ALL YOU NEED', html, text };
}
