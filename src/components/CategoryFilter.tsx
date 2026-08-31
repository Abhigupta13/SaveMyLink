'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { usePreview } from '@/components/PreviewContext';
import { useView } from '@/components/ViewContext';
import { Star, Eye, EyeOff, LayoutGrid, List, Image as ImageIcon } from 'lucide-react';

export default function CategoryFilter({ categories, activeCategoryId }: { categories: any[], activeCategoryId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPrivate = searchParams.get('private') === 'true';
  
  const { showPreview, togglePreview } = usePreview();
  const { columns, toggleColumns } = useView();

  const handleFilter = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('category', id);
    } else {
      params.delete('category');
    }

    // Switching filter restarts the list. Without this, moving from a filter you were three pages
    // deep in to a narrower one kept ?page=3 and opened on an empty grid, because the new filter
    // has nowhere near that many rows.
    params.delete('page');

    // Always preserve private state if present in URL
    if (isPrivate) {
      params.set('private', 'true');
    }

    router.push(`/links?${params.toString()}`);
  };

  /** Tapping the filter you are already on clears it, rather than being a no-op. */
  const toggleFilter = (id: string) => handleFilter(activeCategoryId === id ? null : id);

  return (
    <div className="category-filter">
      <div className="category-scroll-area">
        <div className="category-list">
          <button 
            className={`category-filter-btn ${!activeCategoryId ? 'active' : ''}`}
            onClick={() => handleFilter(null)}
          >
            All
          </button>

          <button
            className={`category-filter-btn icon ${activeCategoryId === 'favorites' ? 'active' : ''}`}
            onClick={() => toggleFilter('favorites')}
            title="Favourites"
            aria-pressed={activeCategoryId === 'favorites'}
            aria-label="Show only favourites"
          >
            <Star size={18} fill={activeCategoryId === 'favorites' ? "currentColor" : "none"} />
          </button>

          {/* Only the links that actually have a thumbnail. Now that a card with no preview
              collapses its image band, a filtered wall of cards that all DO have one is the view
              that reads as a gallery — which is the reason to want this. Square icon chip rather
              than a "With preview" label because this row is already the tightest thing on a
              phone; the accessible name carries the meaning. */}
          <button
            className={`category-filter-btn icon ${activeCategoryId === 'haspreview' ? 'active' : ''}`}
            onClick={() => toggleFilter('haspreview')}
            title="Only links with a preview"
            aria-pressed={activeCategoryId === 'haspreview'}
            aria-label="Show only links with a preview image"
          >
            <ImageIcon size={18} />
          </button>

          {categories
            .map((c) => (
              <button
                key={c._id}
                className={`category-filter-btn ${activeCategoryId === c._id ? 'active' : ''}`}
                onClick={() => handleFilter(c._id)}
              >
                {c.name}
              </button>
            ))}
        </div>
      </div>

      <div className="category-actions">
        {/* Sizing lives in .category-action-btn rather than inline: these were hard-coded to 40px,
            which no media query can reach, so the phone tap-target rule could not apply to them. */}
        <button
          className="category-action-btn"
          onClick={togglePreview}
          title={showPreview ? "Hide previews" : "Show previews"}
          aria-pressed={showPreview}
          aria-label={showPreview ? "Hide preview images" : "Show preview images"}
        >
          {showPreview ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <button
          className="category-action-btn"
          onClick={toggleColumns}
          title="Toggle columns"
          aria-label={columns === 1 ? "Switch to grid view" : "Switch to list view"}
        >
          {columns === 1 ? <List size={18} /> : <LayoutGrid size={18} />}
        </button>
      </div>
    </div>
  );
}
