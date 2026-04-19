'use client';

import { useState, useEffect, useRef } from 'react';
import LinkCard from '@/components/LinkCard';
import { useView } from '@/components/ViewContext';
import { getLinks } from '@/actions/link';

export default function LinksDisplay({ 
  links: initialLinks, 
  categories, 
  totalCount,
  categoryId,
  search,
  privateSafe = false 
}: { 
  links: any[], 
  categories: any[], 
  totalCount: number,
  categoryId?: string,
  search?: string,
  privateSafe?: boolean 
}) {
  const { columns } = useView();
  const [links, setLinks] = useState(initialLinks);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialLinks.length < totalCount);
  
  // Synchronize state when server props change (e.g., after router.refresh())
  useEffect(() => {
    setLinks(initialLinks);
    setPage(1);
    setHasMore(initialLinks.length < totalCount);
  }, [initialLinks, totalCount]);
  
  const observerTarget = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      async (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          await loadMoreLinks();
        }
      },
      { threshold: 1.0 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, page]);

  const loadMoreLinks = async () => {
    setLoading(true);
    const nextPage = page + 1;
    const limit = columns === 1 ? 10 : columns === 2 ? 20 : 40;
    
    try {
      const data = await getLinks(categoryId, nextPage, limit, search, privateSafe);
      if (data.links.length > 0) {
        setLinks(prev => [...prev, ...data.links]);
        setPage(nextPage);
        setHasMore(links.length + data.links.length < totalCount);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Failed to load more links:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div 
        className={`links-grid display-cols-${columns}`} 
      >
        {links.map((link: any) => (
          <LinkCard key={link._id} link={link} categories={categories} privateSafe={privateSafe} />
        ))}
      </div>

      {hasMore && (
        <div ref={observerTarget} style={{ height: '20px', margin: '20px 0', display: 'flex', justifyContent: 'center' }}>
          {loading && <div className="loading-spinner"></div>}
        </div>
      )}
      
      {!hasMore && links.length > 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          No more links to show.
        </div>
      )}
    </>
  );
}
