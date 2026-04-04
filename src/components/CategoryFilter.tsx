'use client';

import { useRouter } from 'next/navigation';

export default function CategoryFilter({ categories, activeCategoryId }: { categories: any[], activeCategoryId?: string }) {
  const router = useRouter();

  const handleFilter = (id: string | null) => {
    if (id) {
      router.push(`/?category=${id}`);
    } else {
      router.push(`/`);
    }
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
        
        {categories.map((c) => (
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
