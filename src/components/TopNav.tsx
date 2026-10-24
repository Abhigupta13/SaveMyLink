'use client';

import { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import Link from 'next/link';
import { getCategories } from '@/actions/category';
import { useDialog, dialogProps } from '@/components/ui/useDialog';
import NotificationsBell from '@/components/NotificationsBell';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import AddLinkForm from './AddLinkForm';
import PinModal from './PinModal';
import VerifyBanner from './VerifyBanner';
import { useSession } from 'next-auth/react';
import { Search, Plus, Home, X } from 'lucide-react';
import { NAV, MOBILE_NAV, ownsItsFrame } from '@/lib/nav';
import Wordmark from './brand/Wordmark';
import { useUser } from '@/components/UserContext';
import { useFeedback } from '@/components/ui/Feedback';
import { invalidateLinksCache } from '@/lib/appDataCache';
import { markShareFlow, consumeShareFlow } from '@/lib/shareIntent';
import { useNavIntent } from '@/components/NavIntentContext';

export default function TopNav() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { privateSafe } = useUser();
  const { toast } = useFeedback();
  const { effectivePath, markNav } = useNavIntent();
  const [, startTransition] = useTransition();

  const push = (href: string) => {
    markNav(href);
    startTransition(() => router.push(href));
  };

  const initial = ((session?.user?.name || session?.user?.email || 'U') as string)[0].toUpperCase();
  const [categories, setCategories] = useState<any[]>([]);
  const categoriesMode = useRef<'public' | 'private' | null>(null);

  const refreshCategories = useCallback(async () => {
    const mode = privateSafe ? 'private' : 'public';
    try {
      const cats = await getCategories(privateSafe);
      setCategories(cats);
      categoriesMode.current = mode;
    } catch {
      console.warn('Failed to fetch categories.');
    }
  }, [privateSafe]);

  useEffect(() => {
    const mode = privateSafe ? 'private' : 'public';
    if (categoriesMode.current !== null && categoriesMode.current !== mode) {
      setCategories([]);
      categoriesMode.current = null;
    }
  }, [privateSafe]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  useDialog(isModalOpen, () => setIsModalOpen(false));

  useEffect(() => {
    if (pathname === '/links') refreshCategories();
  }, [pathname, refreshCategories]);

  useEffect(() => {
    if (isModalOpen) refreshCategories();
  }, [isModalOpen, refreshCategories]);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [sharePrefill, setSharePrefill] = useState<{ url?: string; title?: string }>({});

  // Android share sheet → /links?add=1&url=… — open add form on Links tab
  useEffect(() => {
    if (pathname !== '/links') return;
    if (searchParams.get('add') !== '1') return;
    const url = searchParams.get('url') || undefined;
    const title = searchParams.get('title') || undefined;
    if (!url && !title) return;
    setSharePrefill({ url, title });
    setIsModalOpen(true);
    markShareFlow();
    const params = new URLSearchParams(searchParams.toString());
    params.delete('add');
    params.delete('url');
    params.delete('title');
    const qs = params.toString();
    router.replace(`/links${qs ? `?${qs}` : ''}`);
  }, [pathname, searchParams, router]);

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

  const handleSaved = async ({ isPrivate }: { isPrivate: boolean }) => {
    setIsModalOpen(false);
    setSharePrefill({});
    invalidateLinksCache();
    const params = new URLSearchParams(window.location.search);
    params.delete('private');
    params.delete('category');
    const qs = params.toString();
    router.push(pathname === '/links' ? `/links${qs ? `?${qs}` : ''}` : '/links');
    router.refresh();
    if (isPrivate && !privateSafe) {
      toast('Saved to your Private Safe. Unlock it from Profile when you want to view it.', 'info');
    }
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform() && consumeShareFlow()) {
      const { SendIntent } = await import('@mindlib-capacitor/send-intent');
      SendIntent.finish();
    }
  };

  const isActive = (path: string) =>
    path === '/' ? effectivePath === '/' : effectivePath.startsWith(path);
  const goSearch = () => {
    if (pathname === '/links') setShowSearchBar(v => !v);
    else push('/search');
  };

  // The landing, the auth pages and the suspended screen carry their own brand; other public pages
  // get the bare strip.
  if (!session || ownsItsFrame(pathname)) {
    if (pathname === '/' || ownsItsFrame(pathname)) return null;
    return (
      <>
        <header className="topbar">
          <Wordmark className="logo" />
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
        <Wordmark className="rail-wordmark" size={20} />
        <Link href="/" prefetch className={`rail-item home ${isActive('/') ? 'active' : ''}`} onClick={() => markNav('/')} title="Home">
          <Home size={20} strokeWidth={2.2} /><span>Home</span>
        </Link>
        <nav className="rail-scroll">
          {NAV.map(({ title, href, Icon }) => (
            <Link key={href} href={href} prefetch className={`rail-item ${isActive(href) ? 'active' : ''}`} onClick={() => markNav(href)} title={title}>
              <Icon size={20} strokeWidth={2.2} /><span>{title}</span>
            </Link>
          ))}
        </nav>
        <div className="rail-bottom">
          {/* A rail item, not a bare icon button: it now reads as part of the nav it sits in
              rather than something dropped into the corner. */}
          <NotificationsBell variant="rail" />
          <Link href="/profile" prefetch className={`rail-avatar ${isActive('/profile') ? 'active' : ''}`} onClick={() => markNav('/profile')} title="Profile">{initial}</Link>
        </div>
      </aside>

      {/* Phone: brand header on every tab except Home (Home has it in the greeting, and the bell
          with it). The bell rides along here rather than becoming an eighth bottom tab or a third
          FAB — the tab row is already seven wide and the FAB column already overlaps content. */}
      {pathname !== '/' && (
        <div className="phone-head">
          <Wordmark className="phone-wordmark" size={20} />
          <NotificationsBell className="phone-bell" />
        </div>
      )}

      {/* Phone: bottom tabs only — no top bar */}
      <nav className="bottom-nav">
        <Link href="/" prefetch className={`bottom-item ${isActive('/') ? 'active' : ''}`} onClick={() => markNav('/')}><Home size={21} strokeWidth={2.2} /><span>Home</span></Link>
        {NAV.filter(n => MOBILE_NAV.includes(n.href)).map(({ title, href, Icon }) => (
          <Link key={href} href={href} prefetch className={`bottom-item ${isActive(href) ? 'active' : ''}`} onClick={() => markNav(href)}><Icon size={21} strokeWidth={2.2} /><span>{title}</span></Link>
        ))}
        {/* Its five siblings pair an icon with a text label; this one is just an initial, so it
            announced as a single letter — on the only route to settings, the Private Safe and
            sign out. */}
        <Link href="/profile" prefetch className={`bottom-item ${isActive('/profile') ? 'active' : ''}`} onClick={() => markNav('/profile')} aria-label="Your profile and settings">
          <span className="bottom-avatar" aria-hidden="true">{initial}</span>
        </Link>
      </nav>

      {/* Links search strip (toggled from the rail / top bar while on /links) */}
      {showSearchBar && pathname === '/links' && (
        <div className="search-strip">
          <div className="search-container" style={{ height: '44px', borderRadius: '14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', flex: 1 }}>
            <span className="search-icon" style={{ opacity: 0.5 }}><Search size={18} /></span>
            <input type="text" placeholder="Search your links…" value={searchValue} onChange={(e) => setSearchValue(e.target.value)} className="search-input" style={{ paddingLeft: '44px', fontWeight: 600 }} autoFocus />
          </div>
          <button className="subtle-link" onClick={() => router.push(`/search${searchValue ? `?q=${encodeURIComponent(searchValue)}` : ''}`)} style={{ whiteSpace: 'nowrap' }}>Search everything →</button>
          <button className="icon-btn" onClick={() => { setShowSearchBar(false); setSearchValue(''); }} aria-label="Close search" title="Close search"><X size={16} /></button>
        </div>
      )}

      {/* Not on the settings page. This searches links — the bar it opens says "Search your
          links…" — and on /profile it was a shortcut to somewhere else that cost 66px of every
          row, wrapping "Where your files are kept" onto two lines just to stay clear of it. */}
      {pathname !== '/profile' && (
        <button className={`search-fab ${showSearchBar ? 'active' : ''}`} onClick={goSearch} title="Search" aria-label="Search">
          <Search size={20} strokeWidth={2.4} />
        </button>
      )}

      {pathname === '/links' && (
        <div className="fab-container">
          <button className="fab-btn" onClick={() => setIsModalOpen(true)} title="Add Link"><Plus size={32} strokeWidth={3} /></button>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => { setIsModalOpen(false); setSharePrefill({}); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} {...dialogProps} aria-label="Add a link">
            <div className="modal-header">
              <h2 className="modal-title">New Entry</h2>
              <button className="modal-close" onClick={() => { setIsModalOpen(false); setSharePrefill({}); }} aria-label="Close"><X size={24} /></button>
            </div>
            <AddLinkForm
              categories={categories}
              onSaved={handleSaved}
              initialUrl={sharePrefill.url}
              initialTitle={sharePrefill.title}
            />
          </div>
        </div>
      )}

      <PinModal />
    </>
  );
}
