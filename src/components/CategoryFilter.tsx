'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export default function CategoryFilter({ categories, activeCategoryId }: { categories: any[], activeCategoryId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPrivate = searchParams.get('private') === 'true';

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

    router.push(`/?${params.toString()}`);
  };

  return (
    <div className="category-filter">
      <div className="category-list">
        <button 
          className={`category-filter-btn ${!activeCategoryId ? 'active' : ''}`}
          onClick={() => handleFilter(null)}
        >
          All Categories
        </button>

        <button 
          className={`category-filter-btn ${activeCategoryId === 'favorites' ? 'active' : ''}`}
          onClick={() => handleFilter('favorites')}
        >
          ★ Favorites
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
  );
}
