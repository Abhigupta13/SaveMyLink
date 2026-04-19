'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { createCategory } from '@/actions/category';
import { createLink, getLinkMetadata } from '@/actions/link';
import { useUser } from '@/components/UserContext';
import UserProfileSidebar from './UserProfileSidebar';
import PinModal from './PinModal';
import { useSession } from 'next-auth/react';
import { Search, Menu, Plus, Home, Link as LinkIcon, Library, CheckSquare, Globe, X } from 'lucide-react';

export default function TopNav({ initialCategories }: { initialCategories: any[] }) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  
  const [categories, setCategories] = useState(initialCategories);
  const [showSearchBar, setShowSearchBar] = useState(false);
  
  useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  const [url, setUrl] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  
  const [previewMetadata, setPreviewMetadata] = useState<{ title: string, image: string } | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  
  const { setSidebarOpen, privateSafe } = useUser();
  const [isPrivate, setIsPrivate] = useState(privateSafe);

  useEffect(() => {
    setIsPrivate(privateSafe);
  }, [privateSafe]);

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

  useEffect(() => {
    if (!isModalOpen) {
      setPreviewMetadata(null);
      setUrl('');
      setNewCategoryName('');
      setShowCreateCategory(false);
    }
  }, [isModalOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const currentSearch = params.get('search') || '';
      const currentPage = params.get('page') || '1';

      if (searchValue !== currentSearch || currentPage !== '1') {
        if (searchValue) {
          params.set('search', searchValue);
        } else {
          params.delete('search');
        }
        params.set('page', '1');
        router.push(`${pathname}?${params.toString()}`);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchValue, router, searchParams, pathname]);

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
        router.refresh();
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
      setIsModalOpen(false);
      
      const params = new URLSearchParams(window.location.search);
      if (isPrivate) {
        params.set('private', 'true');
      }
      params.delete('category');
      
      router.push(`/links?${params.toString()}`);
      router.refresh();
    } else {
      alert(res.error || 'Failed to save link');
    }
    setIsLoading(false);
  };

  const navItems = [
    { label: 'Home', path: '/', icon: <Home size={18} strokeWidth={2.5} /> },
    { label: 'Links', path: '/links', icon: <LinkIcon size={18} strokeWidth={2.5} /> },
    { label: 'D-locker', path: '/d-locker', icon: <Library size={18} strokeWidth={2.5} /> },
    { label: 'Tasks', path: '/tasks', icon: <CheckSquare size={18} strokeWidth={2.5} /> },
    { label: 'Social', path: '/social', icon: <Globe size={18} strokeWidth={2.5} /> },
  ];

  return (
    <header className="app-header-container">
      <div className="container" style={{ padding: '0 16px' }}>
        {/* Row 1: Logo & Tools */}
        <div className="header-top-line" style={{ padding: '16px 0 12px' }}>
          <a href="/" className="logo">ALL <span className="logo-light" style={{ marginLeft: '4px' }}>YOU NEED</span></a>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {session && (
              <button 
                onClick={() => setShowSearchBar(!showSearchBar)} 
                className={`menu-trigger-btn ${showSearchBar ? 'active' : ''}`}
                style={{ 
                  background: showSearchBar ? 'var(--accent-soft)' : 'transparent',
                  color: showSearchBar ? 'var(--accent-color)' : 'var(--text-primary)'
                }}
              >
                <Search size={22} strokeWidth={2.5} />
              </button>
            )}

            {session && (
              <button 
                onClick={() => setSidebarOpen(true)} 
                className="menu-trigger-btn"
                style={{ color: 'var(--text-primary)' }}
              >
                <Menu size={24} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Navigation Tabs */}
        {session && (
          <nav className="tab-nav-container">
            {navItems.map((item) => (
              <button 
                key={item.label}
                className={`nav-tab-item ${pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path)) ? 'active' : ''}`}
                onClick={() => router.push(item.path)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}

        {/* Row 3: Conditional Search bar */}
        {session && showSearchBar && (
          <div className="contextual-header-row" style={{ paddingBottom: '12px', animation: 'fadeInDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
            <div className="search-wrapper">
              <div className="search-container" style={{ height: '48px', borderRadius: '16px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                <span className="search-icon" style={{ opacity: 0.5 }}><Search size={18} /></span>
                <input 
                  type="text" 
                  placeholder="Search your vault..." 
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="search-input"
                  style={{ paddingLeft: '44px', fontWeight: 600 }}
                  autoFocus
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {session && pathname === '/links' && (
        <div className="fab-container">
          <button className="fab-btn" onClick={() => setIsModalOpen(true)} title="Add Link">
            <Plus size={32} strokeWidth={3} />
          </button>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">New Entry</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={24} /></button>
            </div>
            
            <form onSubmit={handleAddLink} className="modal-form">
              <div className="input-group">
                <input 
                  type="url" placeholder="Paste URL (https://...)" 
                  value={url} onChange={(e) => setUrl(e.target.value)}
                  style={{ borderRadius: '16px', padding: '14px 18px', background: 'var(--bg-tertiary)' }} required
                />
              </div>

              {(url && (isFetchingMetadata || previewMetadata)) && (
                <div className="modal-preview-container">
                  {isFetchingMetadata ? (
                    <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
                      <div className="loading-spinner"></div>
                    </div>
                  ) : previewMetadata ? (
                    <div className="preview-content-box" style={{ 
                      position: 'relative', width: '100%', height: '180px', background: 'var(--bg-tertiary)', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)'
                    }}>
                      {previewMetadata.image ? (
                        <img src={previewMetadata.image} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontWeight: 600 }}>NO PREVIEW</div>
                      )}
                      <div style={{ 
                        position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, transparent 100%)', padding: '20px 16px'
                      }}>
                        <p style={{ fontSize: '0.85rem', color: 'white', margin: 0, fontWeight: 700, lineClamp: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{previewMetadata.title}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              
              <div className="category-selector">
                <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Store in</p>
                <div className="popular-categories" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {categories.slice(0, 5).map(c => (
                    <button 
                      type="button" key={c._id} 
                      className={`cat-pill ${selectedCategory === c._id && !showCreateCategory ? 'active' : ''}`} 
                      onClick={() => { setSelectedCategory(c._id); setShowCreateCategory(false); }}
                      style={{ padding: '10px 16px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 700 }}
                    >
                      {c.name}
                    </button>
                  ))}
                  <button 
                    type="button" className={`cat-pill ${showCreateCategory ? 'active' : ''}`} 
                    onClick={() => { setShowCreateCategory(true); setSelectedCategory(''); }}
                    style={{ padding: '10px 16px', borderRadius: '12px', fontSize: '0.8rem', borderStyle: 'dashed' }}
                  >
                    + New
                  </button>
                </div>
                
                {showCreateCategory && (
                  <div className="input-group" style={{marginTop: '12px'}}>
                    <input 
                      type="text" placeholder="Category Name" value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      style={{ borderRadius: '14px' }} required
                    />
                  </div>
                )}
              </div>

              <div className="input-group" style={{ marginBottom: '24px' }}>
                <label className="switch-container">
                  <div className="switch"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)}/><span className="slider round"></span></div>
                  <span className="switch-label" style={{ fontWeight: 600 }}>Internal Safe 🔒</span>
                </label>
              </div>

              <button type="submit" className="btn-primary" disabled={isLoading} style={{ width: '100%', height: '56px', borderRadius: '18px', fontWeight: 800 }}>
                {isLoading ? 'Saving...' : 'Secure to Vault'}
              </button>
            </form>
          </div>
        </div>
      )}
      
      <UserProfileSidebar />
      <PinModal />
      <style jsx>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </header>
  );
}
