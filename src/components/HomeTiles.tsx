'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, LayoutGrid, List } from 'lucide-react';
import { NAV } from '@/lib/nav';

// every rail destination, plus Search which only exists as a FAB elsewhere
const TILES = [
  ...NAV,
  { href: '/search', Icon: Search, title: 'Search', desc: 'Across links, tasks, notes, meetings' },
];

export default function HomeTiles() {
  const [view, setView] = useState<'grid' | 'list'>('grid');

  useEffect(() => { try { const v = localStorage.getItem('homeView'); if (v === 'list' || v === 'grid') setView(v); } catch {} }, []);
  const toggleView = () => {
    const next = view === 'grid' ? 'list' : 'grid';
    setView(next);
    try { localStorage.setItem('homeView', next); } catch {}
  };

  return (
    <>
      <div className="tiles-bar">
        <span className="tiles-label">Your vault</span>
        <button className="icon-btn" onClick={toggleView}
          title={view === 'grid' ? 'Switch to detailed list' : 'Switch to compact grid'}
          aria-label={view === 'grid' ? 'Switch to detailed list' : 'Switch to compact grid'}>
          {view === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
        </button>
      </div>

      <div className={`tiles ${view}`}>
        {TILES.map(({ href, Icon, title, desc }) => (
          <Link key={href} href={href} className="tile">
            <span className="tile-icon"><Icon size={view === 'grid' ? 22 : 24} strokeWidth={2.2} /></span>
            <span className="tile-text">
              <span className="tile-title">{title}</span>
              {view === 'list' && <span className="tile-desc">{desc}</span>}
            </span>
          </Link>
        ))}

      </div>
    </>
  );
}
