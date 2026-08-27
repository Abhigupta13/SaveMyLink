'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Bug, Lightbulb, MessageSquare, Link as LinkIcon, StickyNote, CheckSquare, Mic, Library, FolderOpen, Users } from 'lucide-react';
import { getAdminStats, listUsersForSarvam, setSarvamAccess } from '@/actions/admin';
import { getSuggestions } from '@/actions/suggestion';
import { formatInZone } from '@/lib/time';
import { useFeedback } from '@/components/ui/Feedback';
import '@/styles/admin.css';

/**
 * How the app is doing. Admin only — the server actions are the gate, this page just renders what
 * they hand back, exactly like /feedback-inbox.
 *
 * COUNTS ONLY. /terms tells users we do not read their content, and this is the page where that
 * would quietly stop being true. Nothing here shows a title, a note body or a transcript. The one
 * exception is the allowlist below, which names people because you cannot grant a person access
 * without seeing which person.
 *
 * Styling lives in src/styles/admin.css, scoped under .adm. Motion is CSS only: no dependency
 * ships to the Android webview for a bar that grows.
 */

const ICON = { bug: Bug, idea: Lightbulb, other: MessageSquare } as const;

// The window the numbers are scoped to. Server clamps and validates; this is just the picker.
const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];
const RANGE_WORD: Record<RangeKey, string> = {
  today: 'today', '7d': 'in the last 7 days', '30d': 'in the last 30 days',
  '90d': 'in the last 90 days', all: 'all time',
};

/** 1,284 / 12.9K — a headline number should not need counting digits. */
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 10_000 ? `${(n / 1000).toFixed(1)}K`
  : n.toLocaleString('en-IN');

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Stagger index for the CSS reveals — one variable, read by every animation in admin.css. */
const step = (i: number) => ({ '--i': i } as CSSProperties);

type UsageKey = 'links' | 'notes' | 'tasks' | 'moms' | 'docs' | 'projects' | 'contacts';
const USAGE: [UsageKey, string, typeof LinkIcon][] = [
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
 * A grid, not a list with switches: the question this card answers is "who is on?", and a wall of
 * cells answers it at a glance where a column of rows makes you read every one. The whole cell is
 * the control — orange is on, grey is off — so the target is 96px tall instead of a 20px switch,
 * which matters because this is used on a phone. The state is written on the cell as well as
 * coloured, because a control whose only state is its hue has no state for a lot of people.
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

  const on = (rows || []).filter(r => r.access).length;

  return (
    <section className="a-card" id="sarvam-access">
      <h2>Upgraded Hindi access</h2>
      <p className="a-sub">
        For people who have paid you outside the app — in-app payments come later. Switching
        someone on spends <strong>your</strong> Sarvam balance. Anyone who adds their own key in
        Profile is billed by Sarvam directly and needs nothing here.
      </p>
      {rows !== null && rows.length > 0 && (
        <p className="a-sub"><strong>{on}</strong> of {rows.length} shown {on === 1 ? 'is' : 'are'} on the upgraded engine.</p>
      )}

      <form className="a-search" onSubmit={e => { e.preventDefault(); load(q); }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by email or name"
          className="field" aria-label="Search people by email or name" />
        <button type="submit">Search</button>
      </form>

      {rows === null ? <p className="a-empty">Loading…</p>
        : rows.length === 0 ? <p className="a-empty">Nobody matches that.</p>
        : (
          <div className="a-grid" role="group" aria-label="Who has upgraded Hindi access">
            {rows.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className="a-cell"
                // Capped: the list runs to 50, and 50 × 30ms is a second and a half of cells
                // fading in on a wall you are trying to read at a glance.
                style={step(Math.min(i, 11))}
                aria-pressed={r.access}
                disabled={busy === r.id}
                onClick={() => toggle(r)}
                title={r.ownKey ? 'They already pay Sarvam themselves' : r.access ? 'Tap to revoke' : 'Tap to grant'}
              >
                <span className="a-cell-name">{r.name || r.email.split('@')[0]}</span>
                <span className="a-cell-mail">{r.email}</span>
                <span className="a-cell-marks">
                  <span className="a-mark state">{r.access ? 'Upgraded' : 'Free engine'}</span>
                  {r.ownKey && <span className="a-mark">Own key</span>}
                  {r.envListed && <span className="a-mark">Env list</span>}
                  {r.access && r.grantedBy && <span className="a-mark">By {r.grantedBy.split('@')[0]}</span>}
                </span>
              </button>
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
  const [range, setRange] = useState<RangeKey>('7d');

  useEffect(() => {
    if (status !== 'authenticated' && status !== 'unauthenticated') return;
    let cancelled = false;
    (async () => {
      // Signed out gets the same "Not found" as a signed-in non-admin, without a request
      if (status === 'unauthenticated') { if (!cancelled) setDenied(true); return; }
      const [s, f] = await Promise.all([getAdminStats(range), getSuggestions()]);
      if (cancelled) return;
      if (!('success' in s) || !s.success) { setDenied(true); return; }
      setStats(s as Stats);
      if (f.success) setFeedback(f.suggestions || []);
    })();
    return () => { cancelled = true; };
  }, [status, range]);

  if (denied) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Not found.</p></div>;
  if (!stats) return <div className="page narrow"><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></div>;

  const { people, usage, loop, feedback: fb } = stats;
  const busiestDay = Math.max(1, ...people.signups.map(d => d.n));
  const usageMax = Math.max(1, ...USAGE.map(([k]) => usage[k]));
  const totalItems = USAGE.reduce((n, [k]) => n + usage[k], 0);
  const verifiedShare = people.total ? people.verified / people.total : 0;

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
    <div className="container adm" style={{ padding: '24px 16px 120px' }}>
      <header className="a-head">
        <p className="a-eyebrow">Founders only · counts, never content</p>
        <h1>How the app is doing</h1>
        <p className="a-lede">
          Counts only. The allowlist is the one place a person is named.
        </p>
      </header>

      {/* Window picker — drives the time-based numbers; all-time totals keep an in-range companion */}
      <div className="a-range" role="group" aria-label="Time range">
        {RANGES.map(r => (
          <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Keyed on the range so a new window replays the reveal — the numbers changing under a
          static page is the one thing that makes a dashboard feel dead. */}
      <div key={range}>
        {/* Hero: exactly one per view. The dial is the verified share of the same number. */}
        <section className="a-hero a-rise" style={step(0)}>
          <div className="a-hero-text">
            <span className="a-hero-label">People on the app</span>
            <span className="a-hero-value">{compact(people.total)}</span>
            <span className="a-hero-sub">{people.verified} confirmed their email</span>
          </div>
          <figure className="a-dial">
            <svg viewBox="0 0 96 96" aria-hidden="true" style={{ '--c': 251.3, '--p': verifiedShare } as CSSProperties}>
              <circle className="track" cx="48" cy="48" r="40" />
              <circle className="val" cx="48" cy="48" r="40" />
            </svg>
            <figcaption>{pct(people.verified, people.total)}% verified</figcaption>
          </figure>
        </section>

        <section className="a-kpis">
          {[
            { label: `New ${RANGE_WORD[range]}`, value: people.newInRange },
            { label: `Saved something ${RANGE_WORD[range]}`, value: people.createdSomethingInRange },
            { label: 'Things saved, all time', value: totalItems },
            { label: `Feedback ${RANGE_WORD[range]}`, value: fb.inRange },
          ].map((k, i) => (
            <div key={k.label} className="a-kpi a-rise" style={step(i + 1)}>
              <span className={`a-kpi-value${k.value === 0 ? ' zero' : ''}`}>{compact(k.value)}</span>
              <span className="a-kpi-label">{k.label}</span>
            </div>
          ))}
        </section>

        {/* ---------- Signups over the chosen window ---------- */}
        <section className="a-card a-rise" style={step(5)}>
          <h2>Signups</h2>
          <p className="a-sub">{RANGES.find(r => r.key === range)?.label} · {people.signups.reduce((n, d) => n + d.n, 0)} total{stats.range.unit === 'month' ? ' · by month' : ''}</p>

          <div className="a-cols" role="img" aria-label={`Signups per ${stats.range.unit} for ${RANGE_WORD[range]}. ${people.signups.map(d => `${d.day}: ${d.n}`).join(', ')}`}>
            {people.signups.map((d, i) => (
              <div key={d.day} className="a-col-slot" title={`${d.day} · ${d.n} signup${d.n === 1 ? '' : 's'}`}>
                {d.n > 0 && d.n === busiestDay && <span className="a-col-value">{d.n}</span>}
                <span className="a-col" style={{ height: `${Math.max(2, (d.n / busiestDay) * 100)}%`, ...step(i) }} />
                {(i === 0 || i === people.signups.length - 1) && (
                  <span className="a-col-tick">{stats.range.unit === 'month' ? `${d.day.slice(5, 7)}/${d.day.slice(2, 4)}` : `${d.day.slice(8)}/${d.day.slice(5, 7)}`}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- The loop the whole product rests on ---------- */}
        <section className="a-card a-rise" style={step(6)}>
          <h2>Meeting → task</h2>
          <p className="a-sub">
            Whether a recorded meeting actually turns into work someone finishes. The drop between
            stages is the number that matters.
          </p>
          {loop.meetings > 0 && (
            <p className="a-sub">
              <strong>{compact(loop.meetings)}</strong> meetings recorded ·{' '}
              <strong>{perMeeting}</strong> action items found per meeting
            </p>
          )}

          {loop.meetings === 0 ? (
            <p className="a-empty">No meetings recorded yet.</p>
          ) : (
            <div className="a-descent">
              {stages.map((s, i) => {
                const prev = i > 0 ? stages[i - 1].n : null;
                return (
                  <div key={s.label} className="a-stage">
                    {/* s1..s4 are the only ordinal tokens admin.css defines: a fifth stage would
                        ask for .s5, a class with no rule, and render as an invisible bar. */}
                    <span className={`a-node s${i + 1}`} style={step(i)} />
                    <div>
                      <span className="a-stage-head">
                        <span className="a-stage-label">{s.label}</span>
                        <span className="a-stage-value">{compact(s.n)}</span>
                      </span>
                      <span className="a-stage-track">
                        <span
                          className={`a-stage-bar s${i + 1}`}
                          // Clamped both ways: a stage can never render wider than the track, and
                          // a non-zero stage never renders as nothing.
                          style={{ width: `${s.n === 0 ? 0 : Math.min(100, Math.max(1.5, (s.n / Math.max(1, stages[0].n)) * 100))}%`, ...step(i) }}
                          title={`${s.label}: ${s.n}`}
                        />
                      </span>
                      {prev !== null && (
                        <span className="a-drop">
                          {prev === 0 ? '—'
                            : s.n === 0 ? 'None yet'
                            : `${pct(s.n, prev)}% of the step above`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- What people actually touch ---------- */}
        <section className="a-card a-rise" style={step(7)}>
          <h2>What&rsquo;s being used</h2>
          <p className="a-sub">All time, with what was added {RANGE_WORD[range]} underneath.</p>

          <div className="a-ranked">
            {[...USAGE].sort((a, b) => usage[b[0]] - usage[a[0]]).map(([key, label, Icon], i) => (
              <div key={key} className="a-ranked-row" title={`${label}: ${usage[key]} all time, ${usage.inRange[key]} ${RANGE_WORD[range]}`}>
                <span className="a-ranked-label"><Icon size={14} strokeWidth={2.2} /><span>{label}</span></span>
                <span className="a-ranked-track">
                  <span className="a-ranked-bar" style={{ width: `${Math.max(1.5, (usage[key] / usageMax) * 100)}%`, ...step(i) }} />
                </span>
                <span className="a-ranked-value">
                  {compact(usage[key])}
                  {usage.inRange[key] > 0 && <span className="a-ranked-delta">+{compact(usage.inRange[key])}</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div style={{ marginTop: '12px' }}><SarvamAccessCard /></div>

      {/* ---------- Feedback. Designed like the rest of the page down to the card, and then
           deliberately left alone inside it: the report itself is plain text at reading size. --- */}
      <section className="a-card" style={{ marginTop: '12px' }}>
        <h2>Help us improve</h2>
        <p className="a-sub">{fb.total} {fb.total === 1 ? 'submission' : 'submissions'} · {fb.inRange} {RANGE_WORD[range]}</p>

        <div className="a-chips">
          {([['bug', 'Bugs', fb.bug], ['idea', 'Ideas', fb.idea], ['other', 'Other', fb.other]] as const).map(([kind, label, n]) => {
            const Icon = ICON[kind];
            return <span key={kind} className={`a-chip ${kind}`}><Icon size={14} /> {n} {label}</span>;
          })}
        </div>

        {feedback.length === 0
          ? <p className="a-empty">Nothing has come in yet.</p>
          : (
            <div className="a-notes">
              {feedback.map(r => {
                const kind = (r.kind in ICON ? r.kind : 'other') as keyof typeof ICON;
                const Icon = ICON[kind];
                return (
                  <article key={r._id} className="a-note">
                    <div className="a-note-top">
                      <span className={`a-note-kind ${kind}`}><Icon size={13} /> {r.kind}</span>
                      <span className="a-note-when">{formatInZone(r.createdAt)}</span>
                    </div>
                    <p className="a-note-body">{r.message}</p>
                    {r.shot?.url && (
                      <a className="a-note-shot" href={r.shot.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.shot.url} alt="Screenshot attached to this report" />
                      </a>
                    )}
                    <div className="a-note-from">{r.email || 'unknown'}{r.page ? ` · ${r.page}` : ''}</div>
                  </article>
                );
              })}
            </div>
          )}
      </section>

      <p className="a-foot">
        <Link href="/feedback-inbox">Feedback on its own page</Link> · <Link href="/">Back to the app</Link>
      </p>
    </div>
  );
}
