import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/isAdmin';
import { loadProductDocs } from '@/lib/productDocs';
import { DocArticle } from '@/components/admin/DocArticle';
import { DocShell } from '@/components/admin/DocShell';

/**
 * One reading of the product docs. The session is checked before any file is opened.
 * A signed-in person who is not an admin gets the same not-found as a slug that does not exist,
 * so the URL does not confirm that the page is there.
 */
export async function ProductDocsScreen({ slug }: { slug: string }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) notFound();

  const all = loadProductDocs();
  const current = all.find(d => d.slug === slug);
  if (!current) notFound();

  return (
    <DocShell
      current={current.slug}
      docs={all.map(d => ({
        slug: d.slug,
        title: d.title,
        blurb: d.blurb,
        href: d.href,
        headings: d.headings.filter(h => h.level === 2).map(h => ({ id: h.id, text: h.text })),
      }))}
    >
      <DocArticle markdown={current.markdown} headings={current.headings} />
    </DocShell>
  );
}
