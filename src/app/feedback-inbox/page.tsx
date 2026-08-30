'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Bug, Lightbulb, MessageSquare, Check, Mail, MailWarning, MailCheck, MailX, Undo2 } from 'lucide-react';
import { getSuggestions, resolveSuggestion, reopenSuggestion } from '@/actions/suggestion';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
import { formatInZone } from '@/lib/time';
import Link from 'next/link';

/**
 * Everything sent through "Help us improve". Admin only — the server action is the gate, this
 * page just renders whatever it hands back. Not linked from anywhere; you type the URL.
 *
 * Closing a report does not delete it: it moves to the Resolved tab carrying who closed it, when,
 * whatever they chose to say, and whether the thank-you actually reached the reporter.
 */

const ICON = { bug: Bug, idea: Lightbulb, other: MessageSquare } as const;

const when = (iso: string) => formatInZone(iso);

// What happened to the reporter's copy. 'none' is a report with no address on it at all, and it
// must never read as if somebody was written to — which is also why an address with no recorded
// outcome (the outcome write is best-effort, the resolution is not) says so rather than borrowing
// either answer.
const MAIL_NOTE = {
  sent: { Icon: MailCheck, text: 'Reporter emailed', color: 'var(--success-color)' },
  failed: { Icon: MailWarning, text: 'Email did not go out', color: 'var(--danger-color)' },
  none: { Icon: MailX, text: 'No email address — nobody was emailed', color: 'var(--text-tertiary)' },
  // The send is started after the response, so a just-closed row lands here for a beat. Without an
  // entry of its own the lookup returned undefined and the card threw on `mail.color`.
  pending: { Icon: Mail, text: 'Sending the thank-you…', color: 'var(--text-tertiary)' },
  already: { Icon: MailCheck, text: 'Emailed when this was closed before', color: 'var(--success-color)' },
  unknown: { Icon: MailWarning, text: 'Email outcome not recorded', color: 'var(--text-tertiary)' },
} as const;

type View = 'open' | 'resolved';

export default function FeedbackInboxPage() {
  const { status } = useSession();
  const { toast } = useFeedback();
  const [view, setView] = useState<View>('open');
  const [rows, setRows] = useState<any[] | null>(null);
  const [counts, setCounts] = useState({ open: 0, resolved: 0 });
  const [denied, setDenied] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);   // the one card showing its composer
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (v: View) => {
    const res = await getSuggestions(v);
    if (res.success) { setRows(res.suggestions || []); setCounts(res.counts || { open: 0, resolved: 0 }); }
    else setDenied(true);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') { setDenied(true); return; }   // else it says "Loading…" forever
    if (status !== 'authenticated') return;
    load(view);
  }, [status, view, load]);

  const closeComposer = () => { setNoteFor(null); setNote(''); };

  const resolve = async (id: string) => {
    setBusy(id);
    const res = await resolveSuggestion(id, note);
    setBusy(null);
    if (!res.success) { toast(res.error || 'Could not close that', 'error'); return; }
    closeComposer();
    /* Every outcome gets its own branch, and the default is the neutral one. This used to fall
       through to "there is no email address on this one" for anything it did not recognise — and
       since the send moved after the response, the answer for a normal close became 'pending',
       which it did not recognise. Every reporter with an address was reported as having none. */
    toast(
      res.already ? 'That one was already closed — nobody was emailed twice'
        : res.mailed === 'pending' ? 'Closed — the thank-you is on its way'
        : res.mailed === 'sent' ? 'Closed, and they have been emailed'
        : res.mailed === 'failed' ? 'Closed — but the email did not go out'
        : res.mailed === 'already' ? 'Closed — they were already emailed the first time'
        : res.mailed === 'none' ? 'Closed — there is no email address on this one, so nobody was emailed'
        : 'Closed',
      res.mailed === 'failed' ? 'error' : 'success');
    // Refetched rather than patched in place: the row leaves this view and both counts move, and
    // an "already closed" answer means what we were holding was stale anyway.
    load(view);
  };

  const reopen = async (id: string) => {
    setBusy(id);
    const res = await reopenSuggestion(id);
    setBusy(null);
    if (!res.success) { toast(res.error || 'Could not reopen that', 'error'); return; }
    toast(res.already ? 'That one was already open' : 'Back in Open — closing it again will not email them twice', 'success');
    load(view);
  };

  if (denied) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Not found.</p></div>;
  if (!rows) return <div className="page narrow"><Loading label="Loading reports" /></div>;

  return (
    <div className="page narrow">
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>Help us improve</h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
        {counts.open + counts.resolved} {counts.open + counts.resolved === 1 ? 'submission' : 'submissions'} · <Link href="/admin" style={{ color: 'var(--accent-text)', fontWeight: 700 }}>see the numbers</Link>
      </p>

      <div className="seg-group" style={{ marginBottom: '16px' }}>
        {([['open', 'Open', counts.open], ['resolved', 'Resolved', counts.resolved]] as const).map(([id, label, n]) => (
          <button key={id} type="button" className={`seg-btn ${view === id ? 'active' : ''}`}
            onClick={() => { if (view !== id) { closeComposer(); setView(id); } }}>
            {label}<span className="pill-count">{n}</span>
          </button>
        ))}
      </div>

      {!rows.length && (
        <p style={{ color: 'var(--text-secondary)' }}>
          {view === 'open' ? 'Nothing waiting.' : 'Nothing closed yet.'}
        </p>
      )}

      <div style={{ display: 'grid', gap: '12px' }}>
        {rows.map(r => {
          const Icon = ICON[r.kind as keyof typeof ICON] || MessageSquare;
          const mail = MAIL_NOTE[(r.resolveMail || (r.email ? 'unknown' : 'none')) as keyof typeof MAIL_NOTE];
          const composing = noteFor === r._id;
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
                {/* Only on an open row: a reopened report looks identical to a never-closed one
                    otherwise, and "why is this back" is the first thing the next admin asks. */}
                {!r.resolvedAt && r.reopenedAt && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px', opacity: 0.9 }}>
                    <Undo2 size={12} /> Reopened by {r.reopenedBy || 'an admin'} · {when(r.reopenedAt)}
                  </div>
                )}
              </div>

              {r.resolvedAt ? (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success-color)' }}>
                    <Check size={14} /> Closed by {r.resolvedBy || 'an admin'} · {when(r.resolvedAt)}
                  </div>
                  {r.resolveNote && (
                    <p style={{ margin: '8px 0 0', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'pre-wrap' }}>{r.resolveNote}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', fontSize: '0.72rem', color: mail.color }}>
                    <mail.Icon size={13} /> {mail.text}
                  </div>
                  <button type="button" onClick={() => reopen(r._id)} disabled={busy === r._id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '12px', height: '36px', padding: '0 14px', borderRadius: '11px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-primary)', font: 'inherit', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                    <Undo2 size={14} /> {busy === r._id ? 'Reopening…' : 'Reopen'}
                  </button>
                </div>
              ) : composing ? (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                  <label className="field-label" htmlFor={`note-${r._id}`}>Anything to tell them? (optional)</label>
                  {/* The admin should know their words are not buried in the boilerplate — they
                      arrive under their own heading, which is worth writing a real sentence for. */}
                  <p style={{ margin: '2px 2px 6px', fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                    Shown in the email under “A note from the team”.
                  </p>
                  <textarea id={`note-${r._id}`} className="field" rows={3} autoFocus value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Fixed in the next build · This is now under Settings"
                    style={{ resize: 'vertical', minHeight: '76px' }} />
                  <p style={{ margin: '6px 2px 10px', fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                    {!r.email
                      ? 'This report has no email address, so nobody will be emailed.'
                      : r.thankedAt
                        ? 'They were emailed when this was closed before — closing it again will not email them twice.'
                        : 'Left blank, they still get a plain thank-you.'}
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="btn-primary" disabled={busy === r._id}
                      onClick={() => resolve(r._id)}
                      style={{ height: '42px', borderRadius: '12px', fontWeight: 800, flex: 1 }}>
                      {busy === r._id ? 'Closing…' : 'Mark resolved'}
                    </button>
                    <button type="button" onClick={closeComposer} disabled={busy === r._id}
                      style={{ height: '42px', padding: '0 16px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-secondary)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '12px' }}>
                  <button type="button" onClick={() => { setNoteFor(r._id); setNote(''); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', borderRadius: '11px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-primary)', font: 'inherit', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                    <Check size={14} /> Mark resolved
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
