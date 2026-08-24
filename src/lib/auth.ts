import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import connectToDatabase from "@/lib/mongodb";
import { User } from "@/lib/models/User";
import bcrypt from "bcryptjs";

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions = {
  providers: [
    ...(googleEnabled ? [GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true, // same email = same account as password signup
    })] : []),
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
