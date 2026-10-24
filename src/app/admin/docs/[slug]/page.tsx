import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/isAdmin';
import { docBySlug } from '@/lib/productDocs';
import { ProductDocsScreen } from '../screen';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const hidden: Metadata = { title: 'Not found', robots: { index: false, follow: false } };
  if (!isAdmin(session?.user?.email)) return hidden;
  const { slug } = await params;
  const doc = docBySlug(slug);
  if (!doc || doc.slug === 'readme') return hidden;
  return { title: `${doc.title} · Docs`, robots: { index: false, follow: false } };
}

export default async function ProductDocsSlug({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) notFound();
  if (slug === 'readme') redirect('/admin/docs');
  return <ProductDocsScreen slug={slug} />;
}
