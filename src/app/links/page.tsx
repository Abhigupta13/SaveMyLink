import { getLinks } from '@/actions/link';
import { getCategories } from '@/actions/category';
import CategoryFilter from '@/components/CategoryFilter';
import LinksDisplay from '@/components/LinksDisplay';
import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/auth/login');
  }

  const cookieStore = await cookies();
  const resolvedParams = await searchParams;
  const privateSafe = (cookieStore.get('privateSafe')?.value === 'true') || (resolvedParams.private === 'true');
  const categoryId = typeof resolvedParams.category === 'string' ? resolvedParams.category : undefined;
  const columns = Number(resolvedParams.columns) || Number(cookieStore.get('columns')?.value) || 2;
  const currentPage = Number(resolvedParams.page) || 1;
  const search = typeof resolvedParams.search === 'string' ? resolvedParams.search : undefined;
  
  const limit = columns === 1 ? 10 : columns === 2 ? 20 : 40;
  
  let links = [];
  let categories = [];
  let totalCount = 0;
  try {
    const data = await getLinks(categoryId, currentPage, limit, search, privateSafe);
    links = data.links;
    totalCount = data.totalCount;
    categories = await getCategories(privateSafe);
  } catch (err) {
    console.warn("Failed to fetch links or categories.", err);
  }

  return (
    <main className="container links-page-container">
      <CategoryFilter categories={categories} activeCategoryId={categoryId} />
      
      {links.length > 0 ? (
        <LinksDisplay 
          key={`${categoryId || 'all'}-${search || ''}-${privateSafe}`} 
          links={links} 
          categories={categories} 
          totalCount={totalCount}
          categoryId={categoryId}
          search={search}
          privateSafe={privateSafe}
        />
      ) : (
        <div className="empty-links-state">
          <h2>
            {categoryId ? 'No links found in this category.' : 'No links found. Add one above!'}
          </h2>
        </div>
      )}
    </main>
  );
}
