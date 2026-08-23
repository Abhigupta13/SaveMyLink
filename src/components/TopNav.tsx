'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import AddLinkForm from './AddLinkForm';
import PinModal from './PinModal';
import { useSession } from 'next-auth/react';
import { Search, Plus, Home, Link as LinkIcon, Library, CheckSquare, Mic, Users, Newspaper, Upload, StickyNote, X } from 'lucide-react';

const NAV = [
  { label: 'Links', path: '/links', Icon: LinkIcon },
  { label: 'Notes', path: '/notes', Icon: StickyNote },
  { label: 'Tasks', path: '/tasks', Icon: CheckSquare },
  { label: 'MOM', path: '/mom', Icon: Mic },
  { label: 'Digi Locker', path: '/d-locker', Icon: Library },
  { label: 'Contacts', path: '/contacts', Icon: Users },
  { label: 'Digest', path: '/digest', Icon: Newspaper },
  { label: 'Import', path: '/import', Icon: Upload },
];
// Phone bottom bar: the daily-use four + menu for everything else
const MOBILE_NAV = ['/links', '/notes', '/tasks'];

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
      {/* Desktop / tablet: left rail */}
      <aside className="side-rail">
        <a href="/" className="rail-wordmark">ALL<span>YOU NEED</span></a>
        <button className={`rail-item home ${isActive('/') ? 'active' : ''}`} onClick={() => router.push('/')} title="Home">
          <Home size={20} strokeWidth={2.2} /><span>Home</span>
        </button>
        <nav className="rail-scroll">
          {NAV.map(({ label, path, Icon }) => (
            <button key={path} className={`rail-item ${isActive(path) ? 'active' : ''}`} onClick={() => router.push(path)} title={label}>
              <Icon size={20} strokeWidth={2.2} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button className={`rail-avatar ${isActive('/profile') ? 'active' : ''}`} onClick={() => router.push('/profile')} title="Profile">{initial}</button>
        </div>
      </aside>

      {/* Phone: bottom tabs only — no top bar */}
      <nav className="bottom-nav">
        <button className={`bottom-item ${isActive('/') ? 'active' : ''}`} onClick={() => router.push('/')}><Home size={21} strokeWidth={2.2} /><span>Home</span></button>
        {NAV.filter(n => MOBILE_NAV.includes(n.path)).map(({ label, path, Icon }) => (
          <button key={path} className={`bottom-item ${isActive(path) ? 'active' : ''}`} onClick={() => router.push(path)}><Icon size={21} strokeWidth={2.2} /><span>{label}</span></button>
        ))}
        <button className={`bottom-item ${isActive('/profile') ? 'active' : ''}`} onClick={() => router.push('/profile')}>
          <span className="bottom-avatar">{initial}</span><span>You</span>
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
