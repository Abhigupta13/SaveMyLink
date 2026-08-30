/**
 * The contract between a suspended sign-in and the page that explains it.
 *
 * Its own module, and a one-line one, because both ends need it and the ends are on opposite sides
 * of the server boundary: `auth.ts` throws it from `authorize`, and the sign-in page — a client
 * component — matches on it. Importing `@/lib/auth` to read a string would pull mongoose and bcrypt
 * into the browser bundle.
 *
 * NextAuth hands the thrown message back as `res.error` and nothing else distinguishes it from a
 * wrong password, so this is matched exactly. Reword the sentence a suspended person reads on
 * /suspended freely; leave this token alone.
 */
export const SUSPENDED_ERROR = 'ACCOUNT_SUSPENDED';
