/**
 * Who can reach /admin — the feedback inbox and the numbers. The two founders are the default so
 * this works on a fresh deploy with nothing configured; a misspelled ADMIN_EMAILS in Vercel would
 * otherwise lock both of them out silently.
 *
 * ADMIN_EMAILS still overrides completely, which is the escape hatch for changing the list without
 * a deploy — and, deliberately, for narrowing it too.
 */
export const adminEmails = () =>
  (process.env.ADMIN_EMAILS || 'swarajdangare2016@gmail.com,abhishek.akg13@gmail.com')
    .toLowerCase().split(',').map(e => e.trim()).filter(Boolean);

export const isAdmin = (email?: string | null) =>
  !!email && adminEmails().includes(email.toLowerCase());
