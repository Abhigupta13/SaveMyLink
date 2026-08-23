'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { searchAll } from '@/actions/search';
import { Search } from 'lucide-react';

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await searchAll(q);
      if (res.success) setResults(res);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [q]);

  const section = (label: string, items: any[], render: (item: any) => React.ReactNode) =>
    items?.length > 0 && (
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>{items.map(render)}</div>
      </div>
    );

  const card = (key: string, onClick: () => void, primary: string, secondary?: string) => (
    <button key={key} onClick={onClick} style={{
      textAlign: 'left', padding: '14px 18px', borderRadius: '16px', background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)', cursor: 'pointer', color: 'var(--text-primary)'
    }}>
      <span style={{ display: 'block', fontWeight: 700, fontSize: '0.95rem' }}>{primary}</span>
      {secondary && <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{secondary}</span>}
    </button>
  );

  return (
    <div className="container" style={{ maxWidth: '640px', padding: '24px 16px 120px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', marginBottom: '20px' }}>Search everything</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 4px 4px 18px', background: 'var(--bg-secondary)', borderRadius: '20px', border: '1px solid var(--border-color)', marginBottom: '32px' }}>
        <Search size={20} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <input
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Links, tasks, projects, meeting transcripts…"
          autoFocus
          style={{ flex: 1, padding: '14px 0', border: 'none', background: 'transparent', color: 'var(--text-primary)', outline: 'none', fontSize: '1rem', fontWeight: 600 }}
        />
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="loading-spinner"></div></div>}

      {results && !loading && (
        <>
          {section('Links & notes', results.links, (l: any) =>
            card(l._id, () => l.url ? window.open(l.url, '_blank') : router.push('/links'), l.title || l.url, l.url || 'Note'))}
          {section('Notes', results.notes, (n: any) =>
            card(n._id, () => router.push('/notes'), n.title || (n.body || '').slice(0, 60), (n.body || '').slice(0, 120)))}
          {section('Tasks', results.tasks, (t: any) =>
            card(t._id, () => router.push('/tasks'), t.title, t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString()}` : undefined))}
          {section('Projects', results.projects, (p: any) =>
            card(p._id, () => router.push('/tasks'), p.name, p.notes?.slice(0, 120)))}
          {section('Meetings (MOM)', results.moms, (m: any) =>
            card(m._id, () => router.push('/tasks'), m.title, `${m.projectName || ''} · ${m.summary?.slice(0, 100) || 'transcript match'}`))}
          {!results.links?.length && !results.tasks?.length && !results.projects?.length && !results.moms?.length && (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px', fontWeight: 600 }}>Nothing found for “{q}”.</p>
          )}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return <Suspense fallback={null}><SearchPageInner /></Suspense>;
}
