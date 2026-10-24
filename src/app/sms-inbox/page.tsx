'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { MessageSquareText, RefreshCw, Smartphone, StickyNote, CheckSquare, Wallet } from 'lucide-react';
import {
  getSmsPermission,
  listSmsInbox,
  listenForNewSms,
  requestSmsPermission,
  smsInboxAvailable,
  type SmsInboxRow,
} from '@/lib/native/smsInbox';
import { getContacts } from '@/actions/contact';
import { getSavedSmsIdSet, type SmsSavedKind } from '@/lib/smsSavedLocal';
import SmsSaveReviewSheet, { findContactByPhone } from '@/components/SmsSaveReviewSheet';
import { formatDay } from '@/lib/time';
import { useFeedback } from '@/components/ui/Feedback';

type ContactRow = { _id?: string; name: string; phone?: string; email?: string };

export default function SmsInboxPage() {
  const { status } = useSession();
  const { toast } = useFeedback();

  const [native, setNative] = useState<boolean | null>(null);
  const [perm, setPerm] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [messages, setMessages] = useState<SmsInboxRow[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [hideSaved, setHideSaved] = useState(true);

  const [reviewQueue, setReviewQueue] = useState<SmsInboxRow[]>([]);
  const [reviewKind, setReviewKind] = useState<SmsSavedKind | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);

  useEffect(() => {
    smsInboxAvailable().then(setNative).catch(() => setNative(false));
  }, []);

  const refreshSaved = useCallback(async () => {
    setSavedIds(await getSavedSmsIdSet());
  }, []);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listSmsInbox(120);
      setMessages(rows);
      await refreshSaved();
    } catch {
      toast('Could not read SMS on this device', 'error');
    } finally {
      setLoading(false);
    }
  }, [refreshSaved, toast]);

  useEffect(() => {
    if (status !== 'authenticated' || native !== true) return;
    (async () => {
      let p = await getSmsPermission();
      if (p !== 'granted') p = await requestSmsPermission();
      setPerm(p === 'granted' ? 'granted' : 'denied');
      if (p === 'granted') await loadInbox();
      getContacts().then(r => {
        if (r.success && r.contacts) setContacts(r.contacts as ContactRow[]);
      }).catch(() => {});
    })();
  }, [status, native, loadInbox]);

  useEffect(() => {
    if (perm !== 'granted') return;
    let stop: (() => void) | undefined;
    listenForNewSms(() => { loadInbox().catch(() => {}); })
      .then(dispose => { stop = dispose; })
      .catch(() => {});
    return () => { stop?.(); };
  }, [perm, loadInbox]);

  const labelFor = useCallback(
    (address: string) => {
      const c = findContactByPhone(contacts, address);
      return c?.name || address || 'Unknown';
    },
    [contacts],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return messages.filter(m => {
      if (hideSaved && savedIds.has(m.id)) return false;
      if (!needle) return true;
      const label = labelFor(m.address || '').toLowerCase();
      return label.includes(needle)
        || (m.address || '').includes(needle)
        || (m.body || '').toLowerCase().includes(needle);
    });
  }, [messages, q, hideSaved, savedIds, labelFor]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startSave = (kind: SmsSavedKind) => {
    const queue = messages.filter(m => selected.has(m.id));
    if (!queue.length) return;
    setReviewKind(kind);
    setReviewQueue(queue);
    setReviewIndex(0);
  };

  const activeReview = reviewKind && reviewQueue.length ? reviewQueue[reviewIndex] : null;

  if (native === null || status === 'loading') {
    return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></div>;
  }

  if (native === false) {
    return (
      <div className="page narrow">
        <h1 className="page-title">Save from SMS</h1>
        <p style={{ lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Classic SMS can only be read inside the Android app. The website cannot access your messages.
        </p>
        <Link href="/download" className="btn primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Smartphone size={18} /> Get the Android app
        </Link>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="page narrow">
        <h1 className="page-title">Save from SMS</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Sign in to save messages into your vault.</p>
        <Link href="/auth/signin" className="btn primary">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <h1 className="page-title">Save from SMS</h1>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.65, color: 'var(--text-secondary)', marginBottom: 14 }}>
        Pick classic SMS on this phone. Chat (RCS) in Google Messages does not appear here. Nothing is uploaded until you save.
      </p>

      {perm === 'denied' && (
        <div
          style={{
            padding: '14px 16px', borderRadius: '14px', marginBottom: 16,
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: '0.88rem', lineHeight: 1.6 }}>
            SMS access is off. Allow it in Android settings to see your inbox here, or share one message from Google Messages into ALL you need.
          </p>
          <Link href="/capture" className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <MessageSquareText size={16} /> Share a message instead
          </Link>
        </div>
      )}

      {perm === 'granted' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="Search sender or text"
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{ flex: '1 1 180px' }}
            />
            <button type="button" className="btn secondary" onClick={() => loadInbox()} disabled={loading} aria-label="Refresh">
              <RefreshCw size={18} style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined} />
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 14, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={hideSaved} onChange={e => setHideSaved(e.target.checked)} />
            Hide messages already saved
          </label>

          {selected.size > 0 && (
            <div
              style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: '12px',
                borderRadius: '14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
              }}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: 700, alignSelf: 'center' }}>{selected.size} selected</span>
              <button type="button" className="btn secondary" onClick={() => startSave('note')}>
                <StickyNote size={16} /> Note
              </button>
              <button type="button" className="btn secondary" onClick={() => startSave('task')}>
                <CheckSquare size={16} /> Task
              </button>
              <button type="button" className="btn secondary" onClick={() => startSave('expense')}>
                <Wallet size={16} /> Expense
              </button>
              <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {visible.length === 0 && !loading ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {messages.length === 0 ? 'No classic SMS in the inbox yet.' : 'No messages match your filters.'}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visible.map(m => {
                const label = labelFor(m.address || '');
                const checked = selected.has(m.id);
                return (
                  <li key={m.id}>
                    <label
                      style={{
                        display: 'flex', gap: 12, padding: '12px 14px', borderRadius: '14px', cursor: 'pointer',
                        background: checked ? 'var(--bg-tertiary)' : 'transparent',
                        border: `1px solid ${checked ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} style={{ marginTop: 4 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <strong style={{ fontSize: '0.92rem' }}>{label}</strong>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {formatDay(new Date(m.date).toISOString())}
                          </span>
                        </span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {(m.body || '').slice(0, 160)}{(m.body || '').length > 160 ? '…' : ''}
                        </span>
                        {savedIds.has(m.id) && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)', marginTop: 4, display: 'block' }}>Saved</span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {activeReview && reviewKind && (
        <SmsSaveReviewSheet
          message={activeReview}
          saveAs={reviewKind}
          senderLabel={labelFor(activeReview.address || '')}
          contact={findContactByPhone(contacts, activeReview.address || '')}
          queueIndex={reviewIndex}
          queueTotal={reviewQueue.length}
          onCancel={() => {
            setReviewQueue([]);
            setReviewKind(null);
            setReviewIndex(0);
          }}
          onDone={async () => {
            if (reviewIndex + 1 < reviewQueue.length) {
              setReviewIndex(i => i + 1);
            } else {
              setReviewQueue([]);
              setReviewKind(null);
              setReviewIndex(0);
              setSelected(new Set());
              await refreshSaved();
              await loadInbox();
            }
          }}
        />
      )}
    </div>
  );
}
