/** Who can read the "Help us improve" inbox. Comma-separated ADMIN_EMAILS overrides the default. */
export const isAdmin = (email?: string | null) =>
  !!email && (process.env.ADMIN_EMAILS || 'swarajdangare2016@gmail.com')
    .toLowerCase().split(',').map(e => e.trim()).includes(email.toLowerCase());
