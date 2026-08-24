/** Who can read the "Help us improve" inbox. Comma-separated ADMIN_EMAILS overrides the default. */
export const adminEmails = () =>
  (process.env.ADMIN_EMAILS || 'swarajdangare2016@gmail.com')
    .toLowerCase().split(',').map(e => e.trim()).filter(Boolean);

export const isAdmin = (email?: string | null) =>
  !!email && adminEmails().includes(email.toLowerCase());
