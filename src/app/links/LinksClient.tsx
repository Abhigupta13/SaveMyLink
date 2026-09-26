'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getLinksPageData } from '@/actions/link';
import { hintFor } from '@/lib/nav';
import CategoryFilter from '@/components/CategoryFilter';
import LinksDisplay from '@/components/LinksDisplay';
import { SafeBanner, SafeEmpty } from '@/components/PrivateSafe';
import { useUser } from '@/components/UserContext';
import { useView } from '@/components/ViewContext';
import { AppCacheNs, invalidateLinksCache } from '@/lib/appDataCache';
import { runStaleQuery } from '@/lib/runStaleQuery';
import Loading from '@/components/ui/Loading';

export default function LinksClient() {
  const searchParams = useSearchParams();
  const { privateSafe } = useUser();
  const { columns } = useView();

  const [categoryId, setCategoryId] = useState<string | undefined>(() => {
    const c = searchParams.get('category');
    return c && c !== 'all' ? c : undefined;
  });
  const [search, setSearch] = useState(() => searchParams.get('search') || undefined);
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);

  const [links, setLinks] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const limit = columns === 1 ? 10 : columns === 2 ? 20 : 40;

  useEffect(() => {
    const c = searchParams.get('category');
    setCategoryId(c && c !== 'all' ? c : undefined);
    setSearch(searchParams.get('search') || undefined);
    setPage(Number(searchParams.get('page')) || 1);
  }, [searchParams]);

  const cacheKey = `${categoryId || 'all'}:${search || ''}:${page}:${privateSafe ? '1' : '0'}:${columns}`;

  const load = useCallback(async (force?: boolean) => {
    await runStaleQuery({
      namespace: AppCacheNs.links,
      cacheKey,
      force,
      ui: { setLoading, setRefreshing, setFailed },
      fetch: async () => {
        const res = await getLinksPageData(categoryId, page, limit, search, privateSafe);
        if (!res.success) throw new Error(res.error || 'Failed');
        return {
          links: res.links,
          totalCount: res.totalCount,
          categories: res.categories,
        };
      },
      apply: (data) => {
        setLinks(data.links);
        setTotalCount(data.totalCount);
        setCategories(data.categories);
      },
    });
  }, [cacheKey, categoryId, page, limit, search, privateSafe]);

  useEffect(() => {
    load();
  }, [load]);

  const onCategoryChange = useCallback((id: string | null) => {
    const next = id || undefined;
    setCategoryId(next);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set('category', next);
    else params.delete('category');
    params.delete('page');
    const qs = params.toString();
    window.history.replaceState(null, '', `/links${qs ? `?${qs}` : ''}`);
  }, [searchParams]);

  return (
    <main className="container links-page-container">
      {refreshing && !loading && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 8 }} aria-live="polite">
          Syncing links…
        </p>
      )}
      <CategoryFilter
        categories={categories}
        activeCategoryId={categoryId}
        onCategoryChange={onCategoryChange}
      />

      <SafeBanner noun="links" open={privateSafe} />

      {loading && links.length === 0 ? (
        <Loading label="Loading your links" />
      ) : failed && links.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '24px' }}>
          <p style={{ fontWeight: 800 }}>Could not load links</p>
          <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => { invalidateLinksCache(); load(true); }}>
            Retry
          </button>
        </div>
      ) : links.length > 0 ? (
        <LinksDisplay
          key={`${categoryId || 'all'}-${search || ''}-${privateSafe}-${columns}`}
          links={links}
          categories={categories}
          totalCount={totalCount}
          categoryId={categoryId}
          search={search}
          privateSafe={privateSafe}
        />
      ) : privateSafe && !search ? (
        <SafeEmpty noun="links" />
      ) : (
        <div className="empty-state" style={{ marginTop: '24px' }}>
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>{search ? 'No matches' : categoryId ? 'Nothing in this category yet' : 'Nothing saved yet'}</p>
          {!search && !categoryId && <p className="empty-hint">{hintFor('/links')}</p>}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {search ? 'Try a different search.' : 'Tap the + button (bottom right) to save a link or note.'}
          </p>
        </div>
      )}
    </main>
  );
}
