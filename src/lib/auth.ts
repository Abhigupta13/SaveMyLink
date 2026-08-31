import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import connectToDatabase from "@/lib/mongodb";
import { User } from "@/lib/models/User";
import bcrypt from "bcryptjs";
import { usableBase } from "@/lib/url";
import { SUSPENDED_ERROR } from "@/lib/suspension";

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * NextAuth reads NEXTAUTH_URL itself, so nothing here can correct a bad one — but it can refuse to
 * fail silently. A value holding two URLs (`https://prod/ | http://localhost:3000`) parses into an
 * origin plus a nonsense path, NextAuth adopts that path as its OAuth basePath, and Google answers
 * the malformed redirect_uri with `Error 400: invalid_request` and no hint at all.
 *
 * One URL per variable, per environment: localhost in `.env.local`, the real domain in Vercel's
 * dashboard. Both must be registered in the Google console as authorised redirect URIs — that is
 * what makes one OAuth client serve development and production at the same time.
 */
if (!usableBase(process.env.NEXTAUTH_URL)) {
  console.error(
    '[auth] NEXTAUTH_URL is not a single usable URL:', JSON.stringify(process.env.NEXTAUTH_URL),
    '\n       Google sign-in will fail with Error 400: invalid_request until this is one URL.',
  );
}

export const authOptions = {
  providers: [
    ...(googleEnabled ? [GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true, // same email = same account as password signup
      /**
       * Without this Google silently reuses its own signed-in session and re-authenticates the
       * SAME account, so "Add another account" answers "you already have that one" every time —
       * the feature is unusable for the exact case it exists for. v4 cannot pass `prompt`
       * per-call, so this applies to every Google sign-in: one extra tap for everyone, and a
       * genuine fix on a shared device. Worth a line in the release notes.
       */
      authorization: { params: { prompt: 'select_account' } },
    })] : []),
    /**
     * The Android app's Google sign-in, completed.
     *
     * Google refuses OAuth from an embedded WebView, so the app runs the real flow in a Chrome
     * Custom Tab and comes back over a deep link holding a one-time code. This provider is what
     * turns that code into a session — deliberately a provider rather than a route that mints a
     * JWT itself, because minting is forbidden (see the box in lib/accountLocker.ts). NextAuth
     * issues the cookie here on exactly the same terms as a password sign-in.
     *
     * Not shown in any UI: authProviders() only advertises Google, and this is only ever called
     * by NativeAuthListener with a code the person cannot see or type.
     */
    CredentialsProvider({
      id: "native-handoff",
      name: "ALL you need app",
      credentials: {
        code: { label: "Code", type: "text" },
        verifier: { label: "Verifier", type: "text" },
      },
      async authorize(credentials) {
        const { redeemNativeCode } = await import("@/lib/nativeRedeem");
        return await redeemNativeCode(credentials?.code ?? '', credentials?.verifier ?? '');
      },
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing email or password");
        }

        await connectToDatabase();
        const user = await User.findOne({ email: credentials.email.toLowerCase() });

        if (!user || !user.password) {
          throw new Error("No user found with this email");
        }

        // A deleted account keeps a retained row (name/email/role) for 90 days but must never
        // sign back in — the password was nulled anyway, so bcrypt would fail, but say it plainly.
        if (user.deletedAt) {
          throw new Error("This account has been deleted");
        }

        // Suspended is not deleted: the password still works and the content is all still there,
        // which is exactly why the refusal has to be its own sentence. The sign-in page turns this
        // one into a link to /suspended rather than showing it as a typo-style error.
        if (user.suspendedAt) {
          throw new Error(SUSPENDED_ERROR);
        }

        const isPasswordCorrect = await bcrypt.compare(credentials.password, user.password);

        if (!isPasswordCorrect) {
          throw new Error("Incorrect password");
        }

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    // Google users have no local record on first login — create one, then reuse it
    async signIn({ user, account }: any) {
      if (account?.provider !== 'google') return true;
      const email = user.email?.toLowerCase();
      if (!email) return false;
      try {
        await connectToDatabase();
        const existing = await User.findOne({ email });
        // A deleted account cannot be revived by signing in with Google either.
        if (existing?.deletedAt) return false;
        // Returning a URL from this callback redirects instead of erroring, which is the whole
        // point for a suspension: the person is not doing anything wrong and there is something
        // for them to read and act on. `false` here would have dumped them on a generic
        // AccessDenied with no way to ask for the account back.
        if (existing?.suspendedAt) return '/suspended';
        // Google has already proven the address. That is the whole job of our own OTP, so a
        // Google sign-in settles it — including for a password account that predates verification
        // and is now signing in this way (allowDangerousEmailAccountLinking makes them one row).
        if (!existing) await User.create({ email, name: user.name, image: user.image, emailVerified: new Date() });
        else if (!existing.emailVerified) { existing.emailVerified = new Date(); await existing.save(); }
      } catch (err) {
        console.error('[google signIn] could not upsert user:', err);
        return false; // fail loudly rather than creating a session with no account
      }
      return true;
    },
    async session({ session, token }: any) {
      if (token) {
        session.user.id = token.id;
        // The route gate and authorize already refuse a deleted account, but a JWT minted before
        // the deletion is still stateless and valid — this is where a lingering token is caught,
        // so every getServerSession-guarded action sees no user and refuses.
        // ponytail: one indexed _id lookup per session read. Fold into the JWT if it ever profiles.
        try {
          await connectToDatabase();
          const u = await User.findById(token.id).select('deletedAt suspendedAt')
            .lean<{ deletedAt?: Date | null; suspendedAt?: Date | null } | null>();
          if (u?.deletedAt) { session.user = undefined; return session; }
          // Suspension has to bite the same way and in the same place. An admin suspends somebody
          // who is signed in right now on a phone; their JWT is stateless and stays valid for days,
          // so without this they keep using the app until it expires. Dropping the user here means
          // every getServerSession-guarded action refuses from the next request onward.
          if (u?.suspendedAt) { session.user = undefined; session.suspended = true; return session; }
        } catch (err) {
          console.error('[session] could not check account status:', err);
        }
      }
      return session;
    },
    async jwt({ token, user, account }: any) {
      if (user) token.id = user.id;
      // Google's user.id is Google's, not ours — swap in our Mongo _id
      if (account?.provider === 'google' && token.email) {
        try {
          await connectToDatabase();
          const dbUser = await User.findOne({ email: String(token.email).toLowerCase() }).select('_id');
          if (dbUser) token.id = dbUser._id.toString();
        } catch (err) {
          console.error('[google jwt] could not resolve user id:', err);
        }
      }
      return token;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV !== 'production',
  logger: {
    error(code: string, meta: any) {
      console.error('[next-auth error]', code, meta?.message || meta?.error?.message || meta);
      if (meta?.stack) console.error(meta.stack.split('\n').slice(0, 4).join('\n'));
    },
    warn(code: string) { console.warn('[next-auth warn]', code); },
  },
};
