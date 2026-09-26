import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import LinksClient from './LinksClient';

export const dynamic = 'force-dynamic';

export default async function LinksPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/auth/signin');

  return (
    <Suspense fallback={null}>
      <LinksClient />
    </Suspense>
  );
}
