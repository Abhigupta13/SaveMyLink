'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

export default function AuthProvider({
  session,
  children,
}: {
  // Read on the server in the root layout. Without it every client page opens with a
  // /api/auth/session round trip before it can ask for any data of its own.
  session: Session | null;
  children: React.ReactNode;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
