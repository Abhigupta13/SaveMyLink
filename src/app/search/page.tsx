'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { searchAll } from '@/actions/search';
import { Search, ArrowLeft } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';
import { formatDay } from '@/lib/time';

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped by the retry button. Re-running the same query needs something in the dep list to
  // change, and editing `q` to force that would alter what the user typed.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    /* A failed search used to render NOTHING — no spinner (cleared below), no results, no error,
       no empty state. Just a blank page under the search box, indistinguishable from "still
       typing". `failed` gives it something to say. */
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await searchAll(q);
        if (res.success) setResults(res);
        else setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q, retry]);

  const section = (label: string, items: any[], render: (item: any) => React.ReactNode) =>
    items?.length > 0 && (
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>{items.map(render)}</div>
      </div>
    );

  const card = (key: string, onClick: () => void, primary: string, secondary?: string, shared?: string | null) => (
    <button key={key} onClick={onClick} style={{
      textAlign: 'left', padding: '14px 18px', borderRadius: '16px', background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)', cursor: 'pointer', color: 'var(--text-primary)'
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.95rem' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{primary}</span>
        {shared && <span className="chip">{shared}</span>}
      </span>
      {secondary && <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{secondary}</span>}
    </button>
  );

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button className="icon-btn" onClick={() => router.back()} aria-label="Go back" title="Go back"><ArrowLeft size={18} /></button>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: 0 }}>Search everything</h1>
      </div>
      {/* .search-bar rather than inline styles: the focus ring belongs on this container, and an
          inline style cannot express :focus-within. The input inside is only the text layer. */}
      <div className="search-bar">
        <Search size={20} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} aria-hidden="true" />
        <input
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Links, tasks, projects, meeting transcripts…"
          aria-label="Search everything"
          autoFocus
        />
      </div>

      {loading && <Loading variant="inline" label="Searching" />}
      {failed && !loading && <LoadError what="those results" onRetry={() => setRetry(n => n + 1)} />}

      {results && !loading && (
        <>
          {section('Links & notes', results.links, (l: any) =>
            card(l._id, () => l.url ? window.open(l.url, '_blank') : router.push('/links'), l.title || l.url, l.url || 'Note'))}
          {section('Notes', results.notes, (n: any) =>
            card(n._id, () => router.push('/notes'), n.title || (n.body || '').slice(0, 60), (n.body || '').slice(0, 120), n.projectName))}
          {section('Tasks', results.tasks, (t: any) =>
            card(t._id, () => router.push('/tasks'), t.title, t.dueAt ? `Due ${formatDay(t.dueAt)}` : undefined, t.projectName))}
          {section('Projects', results.projects, (p: any) =>
            card(p._id, () => router.push('/tasks'), p.name, p.notes?.slice(0, 120)))}
          {section('Meetings (MOM)', results.moms, (m: any) =>
            card(m._id, () => router.push('/mom'), m.title, m.summary?.slice(0, 100) || 'transcript match', m.projectName))}
          {!results.links?.length && !results.notes?.length && !results.tasks?.length && !results.projects?.length && !results.moms?.length && (
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
