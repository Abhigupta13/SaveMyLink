'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createCategory } from '@/actions/category';
import { createLink, getLinkMetadata } from '@/actions/link';
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
  
  // Sync categories when server provides new ones (after router.refresh())
  useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  const [url, setUrl] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  
  // Metadata Preview State
  const [previewMetadata, setPreviewMetadata] = useState<{ title: string, image: string } | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  
  const { showPreview, togglePreview } = usePreview();
  const { columns, toggleColumns } = useView();
  const { setSidebarOpen, privateSafe } = useUser();
  
  const [isPrivate, setIsPrivate] = useState(privateSafe);

  // Sync isPrivate with current mode when mode changes
  useEffect(() => {
    setIsPrivate(privateSafe);
  }, [privateSafe]);

  // Also sync when modal opens to ensure it matches current mode
  useEffect(() => {
    if (isModalOpen) {
      setIsPrivate(privateSafe);
    }
  }, [isModalOpen, privateSafe]);

  // Fetch metadata logic
  const handleFetchMetadata = async (targetUrl: string) => {
    if (!targetUrl || !targetUrl.startsWith('http')) {
      setPreviewMetadata(null);
      return;
    }

    setIsFetchingMetadata(true);
    try {
      const res = await getLinkMetadata(targetUrl);
      if (res.success && res.metadata) {
        setPreviewMetadata({
          title: res.metadata.title || '',
          image: res.metadata.image || ''
        });
      } else {
        setPreviewMetadata({ title: 'No preview found', image: '' });
      }
    } catch (err) {
      console.error('Failed to fetch metadata:', err);
      setPreviewMetadata({ title: 'Failed to fetch preview', image: '' });
    } finally {
      setIsFetchingMetadata(false);
    }
  };

  // Debounced metadata fetch
  useEffect(() => {
    if (!url) {
      setPreviewMetadata(null);
      return;
    }

    const timer = setTimeout(() => {
      if (url && url.startsWith('http')) {
        handleFetchMetadata(url);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [url]);

  // Reset metadata when modal closes
  useEffect(() => {
    if (!isModalOpen) {
      setPreviewMetadata(null);
      setUrl('');
      setNewCategoryName('');
      setShowCreateCategory(false);
      setShowMoreCategories(false);
    }
  }, [isModalOpen]);

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
      const res = await createCategory(newCategoryName, isPrivate);
      if (res.success && res.category) {
        categoryId = res.category._id;
        setCategories([res.category, ...categories]);
        setSelectedCategory(categoryId);
        setNewCategoryName('');
        setShowCreateCategory(false);
        router.refresh(); // Sync search bar categories
      } else {
        alert(res.error || 'Failed to create category');
        setIsLoading(false);
        return;
      }
    }

    const res = await createLink(url, categoryId || '', [], isPrivate, previewMetadata ? {
      title: previewMetadata.title,
      image: previewMetadata.image
    } : undefined);
    if (res.success) {
      setUrl('');
      // Keep isPrivate state if we are in private mode
      setIsModalOpen(false);
      
      const params = new URLSearchParams(window.location.search);
      if (privateSafe) {
        params.set('private', 'true');
      }
      params.delete('category'); // Reset filter
      
      router.push(`/?${params.toString()}`);
      router.refresh(); // Pull new links
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
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                )}
              </button>
              <button className="btn-icon circle" onClick={toggleColumns} title="Toggle Grid View">
                {columns === 1 ? '☰' : columns === 2 ? '⊟' : '⊞'}
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

              {/* Incremental Metadata Preview */}
              {(url && (isFetchingMetadata || previewMetadata)) && (
                <div className="modal-preview-container">
                  {isFetchingMetadata ? (
                    <div className="loading-spinner"></div>
                  ) : previewMetadata ? (
                    <div className="preview-content-box" style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {previewMetadata.image ? (
                        <img src={previewMetadata.image} alt="Preview" className="modal-preview-image" />
                      ) : (
                        <div className="no-preview-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                          No Image Preview Found
                        </div>
                      )}
                      <div className="preview-metadata-overlay" style={{ 
                        position: 'absolute', 
                        bottom: 0, 
                        left: 0, 
                        right: 0, 
                        backgroundColor: 'rgba(0,0,0,0.7)', 
                        padding: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px'
                      }}>
                        <p className="preview-title-text" style={{ 
                          fontSize: '0.8rem', 
                          fontWeight: 600, 
                          color: 'white',
                          margin: 0,
                          flex: 1
                        }}>
                          {previewMetadata.title}
                        </p>
                        <button 
                          type="button" 
                          className="refresh-preview-btn"
                          onClick={() => handleFetchMetadata(url)}
                          title="Reload metadata"
                        >
                          ↻ Reload
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              
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
