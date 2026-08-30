'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';
import { NAV } from '@/lib/nav';

/* The vault, and only the vault: the places things are KEPT.
 *
 * Search and Import were the two tiles here that are not places — one is a verb you can already do
 * from the FAB on every screen, the other is something you do once when you arrive and then never
 * again. Both sat in the grid at the same weight as Links and Tasks, which is the weight of a
 * destination you open every day.
 *
 * Neither is orphaned: Search stays on its FAB, and Import stays in the desktop rail, which draws
 * every NAV entry.
 */
const TILES = NAV.filter(n => n.href !== '/import');

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
