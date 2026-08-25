'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Bug, Lightbulb, MessageSquare, Link as LinkIcon, StickyNote, CheckSquare, Mic, Library, FolderOpen, Users } from 'lucide-react';
import { getAdminStats, listUsersForSarvam, setSarvamAccess } from '@/actions/admin';
import { getSuggestions } from '@/actions/suggestion';
import { formatInZone } from '@/lib/time';
import { useFeedback } from '@/components/ui/Feedback';

/**
 * How the app is doing. Admin only — the server actions are the gate, this page just renders what
 * they hand back, exactly like /feedback-inbox.
 *
 * COUNTS ONLY. /terms tells users we do not read their content, and this is the page where that
 * would quietly stop being true. Nothing here shows a title, a note body or a transcript.
 */

const ICON = { bug: Bug, idea: Lightbulb, other: MessageSquare } as const;

/** 1,284 / 12.9K — a headline number should not need counting digits. */
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 10_000 ? `${(n / 1000).toFixed(1)}K`
  : n.toLocaleString('en-IN');

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

const USAGE: [keyof Stats['usage'], string, typeof LinkIcon][] = [
  ['links', 'Links', LinkIcon],
  ['notes', 'Notes', StickyNote],
  ['tasks', 'Tasks', CheckSquare],
  ['moms', 'Meetings', Mic],
  ['docs', 'Documents', Library],
  ['projects', 'Projects', FolderOpen],
  ['contacts', 'Contacts', Users],
];

type Stats = Extract<Awaited<ReturnType<typeof getAdminStats>>, { success: true }>;
interface FeedbackRow {
  _id: string; kind: string; message: string; createdAt: string;
  email?: string; page?: string; shot?: { url?: string };
}

type SarvamRow = { id: string; email: string; name: string; ownKey: boolean; access: boolean; envListed: boolean; grantedBy: string };

/**
 * "They paid me, give them the good engine."
 *
 * In-app payment does not exist yet, so this is the whole billing system: money changes hands
 * outside the app and an admin flips a switch. It runs on the FOUNDER'S key, which is why the
 * card says so out loud — every account switched on here spends his balance, not theirs.
 *
 * The one place /admin shows individual people. Address and name only, never their content.
 */
function SarvamAccessCard() {
  const { toast } = useFeedback();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SarvamRow[] | null>(null);
  const [busy, setBusy] = useState('');

  const load = async (term: string) => {
    const res = await listUsersForSarvam(term);
    if (res.success) setRows(res.users);
    else toast(res.error || 'Could not load the list', 'error');
  };

  // Same shape as the page's own effect: the await is what keeps setState out of the effect body
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listUsersForSarvam('');
      if (!cancelled) setRows(res.success ? res.users : []);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async (row: SarvamRow) => {
    setBusy(row.id);
    const res = await setSarvamAccess(row.id, !row.access);
    setBusy('');
    if (!res.success) { toast(res.error || 'Could not change that', 'error'); return; }
    // Trust the server's answer rather than re-fetching: the row is the only thing that changed
    setRows(rs => (rs || []).map(r => r.id === row.id ? { ...r, access: res.access } : r));
    toast(res.access ? `${row.email} now has the upgraded engine` : `${row.email} is back on the free engine`, 'success');
  };

  return (
    <section className="card viz-card" id="sarvam-access">
      <h2 className="viz-title">Upgraded Hindi access</h2>
      <p className="viz-sub">
        For people who have paid you outside the app — in-app payments come later. Switching
        someone on spends <strong>your</strong> Sarvam balance. Anyone who adds their own key in
        Profile is billed by Sarvam directly and needs nothing here.
      </p>

      <form onSubmit={e => { e.preventDefault(); load(q); }} style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by email or name"
          className="field" style={{ flex: 1 }} />
        <button type="submit" className="btn-primary" style={{ padding: '8px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem' }}>Search</button>
      </form>

      {rows === null ? <p className="viz-empty">Loading…</p>
        : rows.length === 0 ? <p className="viz-empty">Nobody matches that.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--border-color)' }}>
                <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                    {[r.name, r.ownKey && 'has their own key', r.envListed && 'on the env list',
                      r.access && r.grantedBy && `granted by ${r.grantedBy}`].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <label className="switch" title={r.ownKey ? 'They already pay Sarvam themselves' : r.access ? 'Revoke' : 'Grant'}>
                  <input type="checkbox" checked={r.access} disabled={busy === r.id} onChange={() => toggle(r)} />
                  <span className="slider round"></span>
                </label>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

export default function AdminPage() {
  const { status } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' && status !== 'unauthenticated') return;
    let cancelled = false;
    (async () => {
      // Signed out gets the same "Not found" as a signed-in non-admin, without a request
      if (status === 'unauthenticated') { if (!cancelled) setDenied(true); return; }
      const [s, f] = await Promise.all([getAdminStats(), getSuggestions()]);
      if (cancelled) return;
      if (!('success' in s) || !s.success) { setDenied(true); return; }
      setStats(s as Stats);
      if (f.success) setFeedback(f.suggestions || []);
    })();
    return () => { cancelled = true; };
  }, [status]);

  if (denied) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Not found.</p></div>;
  if (!stats) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></div>;

  const { people, usage, loop, feedback: fb } = stats;
  const busiestDay = Math.max(1, ...people.signups.map(d => d.n));
  const usageMax = Math.max(1, ...USAGE.map(([k]) => usage[k]));
  const totalItems = USAGE.reduce((n, [k]) => n + usage[k], 0);

  /* Meetings -> action items is an EXPANSION, not a funnel stage: one meeting yields several
     items, so 18 items from 16 meetings is 113% of the step above — a meaningless sentence and,
     before this, a bar that ran off the card. Meetings are context above the funnel; the funnel
     proper starts at the action items, where each stage really is a subset of the one before. */
  const stages = [
    { label: 'Action items found', n: loop.extracted },
    { label: 'Confirmed as tasks', n: loop.confirmed },
    { label: 'Actually completed', n: loop.completed },
    { label: 'Signed off by an owner', n: loop.signedOff },
  ];
  const perMeeting = loop.meetings ? (loop.extracted / loop.meetings).toFixed(1) : '0';

  return (
    <div className="container viz" style={{ padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '22px' }}>
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">Aggregate numbers only — never anyone&rsquo;s content.</p>
      </header>

      {/* Hero: exactly one per view */}
      <section className="card viz-hero">
        <span className="viz-hero-label">People on the app</span>
        <span className="viz-hero-value">{compact(people.total)}</span>
        <span className="viz-hero-sub">
          {people.verified} confirmed their email · {pct(people.verified, people.total)}%
        </span>
      </section>

      <section className="viz-kpis">
        {[
          { label: 'New this week', value: compact(people.newThisWeek) },
          { label: 'Saved something this week', value: compact(people.createdSomethingThisWeek) },
          { label: 'Things saved, all time', value: compact(totalItems) },
          { label: 'Feedback this week', value: compact(fb.thisWeek) },
        ].map(k => (
          <div key={k.label} className="card viz-kpi">
            <span className="viz-kpi-value">{k.value}</span>
            <span className="viz-kpi-label">{k.label}</span>
          </div>
        ))}
      </section>

      {/* ---------- Signups, last 14 days ---------- */}
      <section className="card viz-card">
        <h2 className="viz-title">Signups</h2>
        <p className="viz-sub">Last 14 days · {people.signups.reduce((n, d) => n + d.n, 0)} total</p>

        <div className="viz-cols" role="img" aria-label={`Signups per day for the last 14 days. ${people.signups.map(d => `${d.day}: ${d.n}`).join(', ')}`}>
          {people.signups.map((d, i) => (
            <div key={d.day} className="viz-col-slot" title={`${d.day} · ${d.n} signup${d.n === 1 ? '' : 's'}`}>
              {d.n > 0 && d.n === busiestDay && <span className="viz-col-value">{d.n}</span>}
              <span className="viz-col" style={{ height: `${Math.max(2, (d.n / busiestDay) * 100)}%` }} />
              {(i === 0 || i === people.signups.length - 1) && (
                <span className="viz-col-tick">{d.day.slice(8)}/{d.day.slice(5, 7)}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- The loop the whole product rests on ---------- */}
      <section className="card viz-card">
        <h2 className="viz-title">Meeting → task</h2>
        <p className="viz-sub">
          Whether a recorded meeting actually turns into work someone finishes. The drop between
          stages is the number that matters.
        </p>

        {loop.meetings > 0 && (
          <p className="viz-context">
            <strong>{compact(loop.meetings)}</strong> meetings recorded ·{' '}
            <strong>{perMeeting}</strong> action items found per meeting
          </p>
        )}

        {loop.meetings === 0 ? (
          <p className="viz-empty">No meetings recorded yet.</p>
        ) : (
          <div className="viz-funnel">
            {stages.map((s, i) => {
              const prev = i > 0 ? stages[i - 1].n : null;
              return (
                <div key={s.label} className="viz-funnel-row">
                  <div className="viz-funnel-head">
                    <span className="viz-funnel-label">{s.label}</span>
                    <span className="viz-funnel-value">{compact(s.n)}</span>
                  </div>
                  <span
                    // s1..s4 are the only ordinal tokens globals.css defines. This was s${i+2},
                    // which fitted three stages exactly — a fourth would have asked for .s5, a
                    // class with no rule, and rendered as an invisible bar.
                    className={`viz-funnel-bar s${i + 1}`}
                    // Clamped both ways: a stage can never render wider than the card, and a
                    // non-zero stage never renders as nothing.
                    style={{ width: `${s.n === 0 ? 0 : Math.min(100, Math.max(1.5, (s.n / Math.max(1, stages[0].n)) * 100))}%` }}
                    title={`${s.label}: ${s.n}`}
                  />
                  {prev !== null && (
                    <span className="viz-funnel-drop">
                      {prev === 0 ? '—'
                        : s.n === 0 ? 'None yet'
                        : `${pct(s.n, prev)}% of the step above`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- What people actually touch ---------- */}
      <section className="card viz-card">
        <h2 className="viz-title">What&rsquo;s being used</h2>
        <p className="viz-sub">Everything saved across every account.</p>

        <div className="viz-ranked">
          {[...USAGE].sort((a, b) => usage[b[0]] - usage[a[0]]).map(([key, label, Icon]) => (
            <div key={key} className="viz-ranked-row" title={`${label}: ${usage[key]}`}>
              <span className="viz-ranked-label"><Icon size={14} strokeWidth={2.2} /> {label}</span>
              <span className="viz-ranked-track">
                <span className="viz-ranked-bar" style={{ width: `${Math.max(1.5, (usage[key] / usageMax) * 100)}%` }} />
              </span>
              <span className="viz-ranked-value">{compact(usage[key])}</span>
            </div>
          ))}
        </div>
      </section>

      <SarvamAccessCard />

      {/* ---------- Feedback ---------- */}
      <section className="card viz-card">
        <h2 className="viz-title">Help us improve</h2>
        <p className="viz-sub">{fb.total} {fb.total === 1 ? 'submission' : 'submissions'} · {fb.thisWeek} this week</p>

        <div className="viz-chips">
          {([['bug', 'Bugs', fb.bug], ['idea', 'Ideas', fb.idea], ['other', 'Other', fb.other]] as const).map(([kind, label, n]) => {
            const Icon = ICON[kind];
            return (
              <span key={kind} className="viz-chip"><Icon size={14} /> {n} {label}</span>
            );
          })}
        </div>
      </section>

      {!!feedback.length && (
        <div style={{ display: 'grid', gap: '12px', marginTop: '14px' }}>
          {feedback.map(r => {
            const Icon = ICON[r.kind as keyof typeof ICON] || MessageSquare;
            return (
              <div key={r._id} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <Icon size={14} /> {r.kind}
                  <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{formatInZone(r.createdAt)}</span>
                </div>
                <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: '10px' }}>{r.message}</p>
                {r.shot?.url && (
                  <a href={r.shot.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.shot.url} alt="Screenshot" style={{ maxWidth: '100%', maxHeight: '240px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '10px' }} />
                  </a>
                )}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  {r.email || 'unknown'}{r.page ? ` · ${r.page}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="auth-foot" style={{ marginTop: '22px' }}>
        <Link href="/feedback-inbox">Feedback on its own page</Link> · <Link href="/">Back to the app</Link>
      </p>
    </div>
  );
}
