'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { usePreview } from '@/components/PreviewContext';
import { useView } from '@/components/ViewContext';
import { Star, Eye, EyeOff, LayoutGrid, List } from 'lucide-react';

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
    
    // Always preserve private state if present in URL
    if (isPrivate) {
      params.set('private', 'true');
    }

    router.push(`/links?${params.toString()}`);
  };

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
            className={`category-filter-btn ${activeCategoryId === 'favorites' ? 'active' : ''}`}
            onClick={() => handleFilter('favorites')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', padding: 0 }}
            title="Favorites"
          >
            <Star size={18} fill={activeCategoryId === 'favorites' ? "currentColor" : "none"} />
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
        <button 
          className="btn-icon circle" 
          onClick={togglePreview} 
          title={showPreview ? "Hide Previews" : "Show Previews"}
          style={{ 
            width: '40px', height: '40px', borderRadius: '12px', 
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)'
          }}
        >
          {showPreview ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <button 
          className="btn-icon circle" 
          onClick={toggleColumns} 
          title="Toggle Columns"
          style={{ 
            width: '40px', height: '40px', borderRadius: '12px', 
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)'
          }}
        >
          {columns === 1 ? <List size={18} /> : <LayoutGrid size={18} />}
        </button>
      </div>
    </div>
  );
}
