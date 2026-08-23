'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Bug, Lightbulb, MessageSquare } from 'lucide-react';
import { getSuggestions } from '@/actions/suggestion';

/**
 * Everything sent through "Help us improve". Admin only — the server action is the gate, this
 * page just renders whatever it hands back. Not linked from anywhere; you type the URL.
 */

const ICON = { bug: Bug, idea: Lightbulb, other: MessageSquare } as const;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

export default function FeedbackInboxPage() {
  const { status } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') { setDenied(true); return; }   // else it says "Loading…" forever
    if (status !== 'authenticated') return;
    getSuggestions().then(res => {
      if (res.success) setRows(res.suggestions || []);
      else setDenied(true);
    });
  }, [status]);

  if (denied) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Not found.</p></div>;
  if (!rows) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></div>;

  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>Help us improve</h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
        {rows.length} {rows.length === 1 ? 'submission' : 'submissions'}
      </p>

      {!rows.length && <p style={{ color: 'var(--text-secondary)' }}>Nothing yet.</p>}

      <div style={{ display: 'grid', gap: '12px' }}>
        {rows.map(r => {
          const Icon = ICON[r.kind as keyof typeof ICON] || MessageSquare;
          return (
            <div key={r._id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <Icon size={14} /> {r.kind}
                <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{when(r.createdAt)}</span>
              </div>

              <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: '10px' }}>{r.message}</p>

              {r.shot?.url && (
                <a href={r.shot.url} target="_blank" rel="noreferrer">
                  <img src={r.shot.url} alt="Screenshot" style={{ maxWidth: '100%', maxHeight: '240px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '10px' }} />
                </a>
              )}

              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, wordBreak: 'break-word' }}>
                {r.email}{r.page ? ` · ${r.page}` : ''}
                {r.userAgent && <div style={{ marginTop: '2px', opacity: 0.7 }}>{r.userAgent}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
