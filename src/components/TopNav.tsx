'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import AddLinkForm from './AddLinkForm';
import PinModal from './PinModal';
import VerifyBanner from './VerifyBanner';
import { useSession } from 'next-auth/react';
import { Search, Plus, Home, X } from 'lucide-react';
import { NAV, MOBILE_NAV } from '@/lib/nav';

export default function TopNav({ initialCategories }: { initialCategories: any[] }) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const initial = ((session?.user?.name || session?.user?.email || 'U') as string)[0].toUpperCase();
  const [categories, setCategories] = useState(initialCategories);
  useEffect(() => { setCategories(initialCategories); }, [initialCategories]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');

  // Links page search: debounce into ?search=
  useEffect(() => {
    if (pathname !== '/links') return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const currentSearch = params.get('search') || '';
      if (searchValue !== currentSearch) {
        if (searchValue) params.set('search', searchValue); else params.delete('search');
        params.set('page', '1');
        router.push(`${pathname}?${params.toString()}`);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchValue, router, searchParams, pathname]);

  const handleSaved = ({ isPrivate }: { isPrivate: boolean }) => {
    setIsModalOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (isPrivate) params.set('private', 'true');
    params.delete('category');
    router.push(`/links?${params.toString()}`);
    router.refresh();
  };

  const isActive = (path: string) => path === '/' ? pathname === '/' : pathname.startsWith(path);
  const goSearch = () => {
    if (pathname === '/links') setShowSearchBar(v => !v);
    else router.push('/search');
  };

  // Auth pages get no app chrome — just the brand
  if (!session || pathname.startsWith('/auth')) {
    return (
      <>
        <header className="topbar">
          <a href="/" className="logo">ALL <span className="logo-light" style={{ marginLeft: '4px' }}>YOU NEED</span></a>
        </header>
        <PinModal />
      </>
    );
  }

  return (
    <>
      <VerifyBanner />

      {/* Desktop / tablet: left rail */}
      <aside className="side-rail">
        <a href="/" className="rail-wordmark">ALL<span>YOU NEED</span></a>
        <button className={`rail-item home ${isActive('/') ? 'active' : ''}`} onClick={() => router.push('/')} title="Home">
          <Home size={20} strokeWidth={2.2} /><span>Home</span>
        </button>
        <nav className="rail-scroll">
          {NAV.map(({ title, href, Icon }) => (
            <button key={href} className={`rail-item ${isActive(href) ? 'active' : ''}`} onClick={() => router.push(href)} title={title}>
              <Icon size={20} strokeWidth={2.2} /><span>{title}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button className={`rail-avatar ${isActive('/profile') ? 'active' : ''}`} onClick={() => router.push('/profile')} title="Profile">{initial}</button>
        </div>
      </aside>

      {/* Phone: brand header on every tab except Home (Home has it in the greeting) */}
      {pathname !== '/' && <a href="/" className="phone-wordmark">ALL <span>YOU NEED</span></a>}

      {/* Phone: bottom tabs only — no top bar */}
      <nav className="bottom-nav">
        <button className={`bottom-item ${isActive('/') ? 'active' : ''}`} onClick={() => router.push('/')}><Home size={21} strokeWidth={2.2} /><span>Home</span></button>
        {NAV.filter(n => MOBILE_NAV.includes(n.href)).map(({ title, href, Icon }) => (
          <button key={href} className={`bottom-item ${isActive(href) ? 'active' : ''}`} onClick={() => router.push(href)}><Icon size={21} strokeWidth={2.2} /><span>{title}</span></button>
        ))}
        <button className={`bottom-item ${isActive('/profile') ? 'active' : ''}`} onClick={() => router.push('/profile')}>
          <span className="bottom-avatar">{initial}</span>
        </button>
      </nav>

      {/* Links search strip (toggled from the rail / top bar while on /links) */}
      {showSearchBar && pathname === '/links' && (
        <div className="search-strip">
          <div className="search-container" style={{ height: '44px', borderRadius: '14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', flex: 1 }}>
            <span className="search-icon" style={{ opacity: 0.5 }}><Search size={18} /></span>
            <input type="text" placeholder="Search your links…" value={searchValue} onChange={(e) => setSearchValue(e.target.value)} className="search-input" style={{ paddingLeft: '44px', fontWeight: 600 }} autoFocus />
          </div>
          <button className="subtle-link" onClick={() => router.push(`/search${searchValue ? `?q=${encodeURIComponent(searchValue)}` : ''}`)} style={{ whiteSpace: 'nowrap' }}>Search everything →</button>
          <button className="icon-btn" onClick={() => { setShowSearchBar(false); setSearchValue(''); }}><X size={16} /></button>
        </div>
      )}

      <button className={`search-fab ${showSearchBar ? 'active' : ''}`} onClick={goSearch} title="Search" aria-label="Search">
        <Search size={20} strokeWidth={2.4} />
      </button>

      {pathname === '/links' && (
        <div className="fab-container">
          <button className="fab-btn" onClick={() => setIsModalOpen(true)} title="Add Link"><Plus size={32} strokeWidth={3} /></button>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">New Entry</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}><X size={24} /></button>
            </div>
            <AddLinkForm categories={categories} onSaved={handleSaved} />
          </div>
        </div>
      )}

      <PinModal />
    </>
  );
}
