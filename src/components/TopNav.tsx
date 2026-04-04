'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createCategory } from '@/actions/category';
import { createLink } from '@/actions/link';
import { usePreview } from '@/components/PreviewContext';
import { useView } from '@/components/ViewContext';
import { useUser } from '@/components/UserContext';
import UserProfileSidebar from './UserProfileSidebar';
import PinModal from './PinModal';
import { useSession } from 'next-auth/react';

export default function TopNav({ initialCategories }: { initialCategories: any[] }) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [categories, setCategories] = useState(initialCategories);
  const [url, setUrl] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  
  const { showPreview, togglePreview } = usePreview();
  const { columns, toggleColumns } = useView();
  const { setSidebarOpen, privateSafe } = useUser();
  
  const [isPrivate, setIsPrivate] = useState(false);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const currentSearch = params.get('search') || '';
      const currentPage = params.get('page') || '1';

      // Only push if the search value or page has actually changed
      if (searchValue !== currentSearch || currentPage !== '1') {
        if (searchValue) {
          params.set('search', searchValue);
        } else {
          params.delete('search');
        }
        params.set('page', '1'); // Reset to page 1 on search
        router.push(`/?${params.toString()}`);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchValue, router, searchParams]);

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsLoading(true);
    let categoryId = selectedCategory;

    if (showCreateCategory && newCategoryName) {
      const res = await createCategory(newCategoryName);
      if (res.success && res.category) {
        categoryId = res.category._id;
        setCategories([res.category, ...categories]);
        setSelectedCategory(categoryId);
        setNewCategoryName('');
        setShowCreateCategory(false);
      } else {
        alert(res.error || 'Failed to create category');
        setIsLoading(false);
        return;
      }
    }

    if (!categoryId) {
        alert('Please select a category');
        setIsLoading(false);
        return;
    }

    const res = await createLink(url, categoryId, [], isPrivate);
    if (res.success) {
      setUrl('');
      setIsPrivate(false);
      setIsModalOpen(false);
    } else {
      alert(res.error || 'Failed to save link');
    }
    setIsLoading(false);
  };

  const topCategories = categories.slice(0, 5);
  const restCategories = categories.slice(5);

  return (
    <header className="app-header">
      <div className="container">
        {/* Row 1: App name and add link */}
        <div className="header-row row-1" style={!session ? { justifyContent: 'center' } : {}}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {session && (
              <button 
                className="user-icon-btn" 
                onClick={() => setSidebarOpen(true)}
                title="User Profile"
                style={{ fontSize: '1.5rem', background: 'var(--bg-tertiary)', width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                👤
              </button>
            )}
            <a href="/" className="logo">SaveMyLink</a>
          </div>
          {session && (
            <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
              + Add Link
            </button>
          )}
        </div>

        {/* Row 2: Search input, hide button and toggle view */}
        {session && (
          <div className="header-row row-2">
            <div className="search-container">
              <span className="search-icon">🔍</span>
              <input 
                type="text" 
                placeholder="Search by title, tag, or URL..." 
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="search-input"
              />
            </div>

            <div className="header-actions">
              <button className="btn-icon circle" onClick={togglePreview} title={showPreview ? "Hide Previews" : "Show Previews"}>
                {showPreview ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path>
                    <path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                    <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.05 1.05l21.9 21.9"></path>
                    <path d="M17.45 17.45a9 9 0 0 1-12.9-12.9"></path>
                    <path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                  </svg>
                )}
              </button>
              <button className="btn-icon circle" onClick={toggleColumns} title="Toggle Grid View">
                {columns === 1 ? '⊞' : '⊟'}
              </button>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Save a New Link</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>&times;</button>
            </div>
            
            <form onSubmit={handleAddLink} className="modal-form">
              <div className="input-group">
                <input 
                  type="url" 
                  placeholder="Paste the URL here..." 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
              
              <div className="category-selector">
                <p style={{marginBottom: '10px', fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Choose Category</p>
                <div className="popular-categories" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {topCategories.map(c => (
                    <button 
                      type="button" 
                      key={c._id} 
                      className={`cat-pill ${selectedCategory === c._id && !showCreateCategory ? 'active' : ''}`} 
                      onClick={() => { setSelectedCategory(c._id); setShowCreateCategory(false); setShowMoreCategories(false); }}
                    >
                      {c.name}
                    </button>
                  ))}
                  
                  {restCategories.length > 0 && (
                    <button 
                      type="button" 
                      className={`cat-pill ${showMoreCategories ? 'active' : ''}`} 
                      onClick={() => { setShowMoreCategories(!showMoreCategories); setShowCreateCategory(false); }}
                    >
                      + More
                    </button>
                  )}
                  
                  <button 
                    type="button" 
                    className={`cat-pill ${showCreateCategory ? 'active' : ''}`} 
                    onClick={() => { setShowCreateCategory(true); setShowMoreCategories(false); setSelectedCategory(''); }}
                  >
                    + Create
                  </button>
                </div>
                
                {showMoreCategories && restCategories.length > 0 && (
                  <select 
                    className="category-select"
                    value={selectedCategory}
                    onChange={(e) => { setSelectedCategory(e.target.value); setShowCreateCategory(false); }}
                    style={{marginTop: '12px'}}
                  >
                    <option value="" disabled>Select from more categories</option>
                    {restCategories.map((c: any) => (
                      <option key={c._id} value={c._id}>{c.name}</option>
                    ))}
                  </select>
                )}
                
                {showCreateCategory && (
                  <div className="input-group" style={{marginTop: '12px'}}>
                    <input 
                      type="text" 
                      placeholder="New Category Name" 
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <label className="switch-container">
                  <div className="switch">
                    <input 
                      type="checkbox" 
                      checked={isPrivate} 
                      onChange={(e) => setIsPrivate(e.target.checked)}
                    />
                    <span className="slider"></span>
                  </div>
                  <span className="switch-label">Mark as Private Link 🔒</span>
                </label>
              </div>

              <button type="submit" className="btn-primary" disabled={isLoading} style={{ marginTop: '8px' }}>
                {isLoading ? <div className="loading-spinner"></div> : 'Save Link'}
              </button>
            </form>
          </div>
        </div>
      )}
      
      <UserProfileSidebar />
      <PinModal />
    </header>
  );
}
