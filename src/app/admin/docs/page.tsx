import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/isAdmin';
import { ProductDocsScreen } from './screen';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) return { title: 'Not found', robots: { index: false, follow: false } };
  return { title: 'Overview · Docs', robots: { index: false, follow: false } };
}

export default function ProductDocsIndex() {
  return <ProductDocsScreen slug="readme" />;
}
