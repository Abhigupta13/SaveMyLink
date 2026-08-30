'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Bug, Lightbulb, MessageSquare, Link as LinkIcon, StickyNote, CheckSquare, Mic, Library, FolderOpen, Users, ArrowRight, Plus, Minus, Ban, RotateCcw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAdminStats, listUsersForManage, setSarvamAccess, setUserSuspended, deleteUserAsAdmin } from '@/actions/admin';
import { getSuggestions } from '@/actions/suggestion';
import { formatInZone } from '@/lib/time';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
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

type ManageRow = {
  id: string; email: string; name: string;
  ownKey: boolean; access: boolean; envListed: boolean; grantedBy: string;
  suspended: boolean; suspendedAt: string; suspendedBy: string;
  admin: boolean;
};

/* What each action asks before it does anything, and what its yes-button says.
 *
 * Every one names the account and states the consequence rather than asking "are you sure?" — the
 * mis-tap this guards against is one where the admin does not yet realise which row they hit, and
 * a generic prompt reads as an obstacle to click past rather than a fact to check.
 *
 * The yes-button never says "Yes" alone either: read on its own it has to say what it is about to
 * do, because that button is the last thing anybody actually reads. */
type Ask = 'upgrade' | 'downgrade' | 'suspend' | 'restore' | 'delete';
const ASK: Record<Ask, (email: string) => string> = {
  upgrade: e => `Switch ${e} to the upgraded Hindi engine? Their transcription starts spending your Sarvam balance.`,
  downgrade: e => `Move ${e} back to the free engine? They keep their account and everything in it.`,
  suspend: e => `Suspend ${e}? They will be signed out and cannot sign back in until you restore them. Nothing is deleted.`,
  restore: e => `Let ${e} back in? They will be able to sign in again straight away.`,
  delete: e => `Delete ${e} and everything in it? Their links, notes, tasks, meetings and uploads go, and this cannot be undone.`,
};
const CTA: Record<Ask, string> = {
  upgrade: 'Yes, upgrade', downgrade: 'Yes, downgrade',
  suspend: 'Yes, suspend', restore: 'Yes, restore', delete: 'Yes, delete',
};

/**
 * Manage users — the one card that names people, and the only place an admin acts on one.
 *
 * Three things happen here and they are deliberately one card, because they are one question:
 * "this person — what do I do about them?" Two cards meant searching the same account twice and
 * reading two answers about it.
 *
 * The three are not peers, and the card should not pretend they are:
 *
 *  · Upgrade  — reversible, costs the founder money, nobody is locked out. A plain toggle.
 *  · Suspend  — reversible, but a real person stops being able to sign in. Asks first.
 *  · Delete   — no undo at all. Asks in a sentence that names them and says what goes.
 *
 * Restore is the same button as Suspend with the switch thrown, so an account you locked out by
 * mistake is one tap from working again and the way back is where you left it.
 *
 * An admin is listed but has no buttons. `setUserSuspended` and `deleteUserAsAdmin` both re-check
 * against ADMIN_EMAILS server-side — this is the label on that rule, not the rule.
 *
 * Ten to a page, counted and paged in the database. The old list stopped dead at fifty and said
 * nothing about it, which reads as "that is everyone" when it is not.
 */
function ManageUsersCard() {
  const { toast } = useFeedback();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ManageRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [busy, setBusy] = useState('');
  // The one row showing a confirmation, and which action it is asking about.
  const [confirm, setConfirm] = useState<{ id: string; what: Ask } | null>(null);

  // The search term the CURRENT rows belong to. Typing in the box must not change what paging
  // does — the page buttons page through the results you are looking at, not through an unsubmitted
  // half-typed query.
  const [term, setTerm] = useState('');

  /* Bumped to refetch the page we are already on — after a delete, where the row count and every
     later page have shifted. A trigger rather than a direct call so there is exactly one place
     that fetches, and one cancellation rule covering it. */
  const [tick, setTick] = useState(0);

  // Same shape as the page's own effect: the await is what keeps setState out of the effect body,
  // and `cancelled` means clicking Next three times fast cannot let the first answer land last.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listUsersForManage(term, page);
      if (cancelled) return;
      if (!res.success) { setRows([]); toast(res.error || 'Could not load the list', 'error'); return; }
      setRows(res.users);
      setMeta({ total: res.total, pages: res.pages });
      // The server clamps the page to what exists; follow it rather than holding a number past the
      // end. Guarded because setting it to the value it already holds is what makes this effect
      // re-run itself.
      if (res.page !== page) setPage(res.page);
      /* An open confirmation is NOT cleared here. It is the admin's half-finished intent, and this
         effect can fire for reasons that have nothing to do with them — anything that re-renders
         this card while the question is on screen would otherwise close it under their thumb.
         It is keyed by row id, so if the row genuinely left the page it simply stops rendering. */
    })();
    return () => { cancelled = true; };
  }, [term, page, tick, toast]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setTerm(q.trim());
    setPage(1);   // a new search starts at the beginning, not on page four of the old one
  };

  const toggleUpgrade = async (row: ManageRow) => {
    setBusy(row.id);
    const res = await setSarvamAccess(row.id, !row.access);
    setBusy('');
    setConfirm(null);
    if (!res.success) { toast(res.error || 'Could not change that', 'error'); return; }
    // Trust the server's answer rather than re-fetching: the row is the only thing that changed
    setRows(rs => (rs || []).map(r => r.id === row.id ? { ...r, access: res.access, grantedBy: res.by } : r));
    toast(res.access ? `${row.email} now has the upgraded engine` : `${row.email} is back on the free engine`, 'success');
  };

  const setSuspended = async (row: ManageRow, on: boolean) => {
    setBusy(row.id);
    const res = await setUserSuspended(row.id, on);
    setBusy('');
    setConfirm(null);
    if (!res.success) { toast(res.error || 'Could not change that', 'error'); return; }
    setRows(rs => (rs || []).map(r => r.id === row.id
      ? { ...r, suspended: on, suspendedBy: on ? res.by : '', suspendedAt: on ? new Date().toISOString() : '' }
      : r));
    toast(on ? `${row.email} is locked out` : `${row.email} can sign in again`, 'success');
  };

  const remove = async (row: ManageRow) => {
    setBusy(row.id);
    const res = await deleteUserAsAdmin(row.id);
    setBusy('');
    if (!res.success) { setConfirm(null); toast(res.error || 'Could not delete that account', 'error'); return; }
    toast(`${row.email} has been deleted`, 'success');
    // Refetched, not spliced: a row left this page, so every later page shifts up by one and the
    // total moved. Patching in place would leave the count and the last page both wrong.
    setTick(t => t + 1);
  };

  const shown = rows?.length || 0;
  const first = meta.total === 0 ? 0 : (page - 1) * 10 + 1;

  return (
    <section className="a-card" id="manage-users">
      <h2>Manage users</h2>
      <p className="a-sub">
        <strong>Upgrade</strong> switches someone onto the founder&rsquo;s Sarvam balance — for people
        who paid outside the app. <strong>Suspend</strong> locks an account out and keeps everything:
        they see a screen explaining it and can ask you to reopen, and Restore puts it back.{' '}
        <strong>Delete</strong> runs the same erase as deleting your own account — their content and
        uploads go, groups they created hand over, and the row is purged after 90 days, with no undo.
        Admins cannot be suspended or deleted here.
      </p>

      <form className="a-search" onSubmit={search}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by email or name"
          className="field" aria-label="Search accounts by email or name" />
        <button type="submit">Search</button>
      </form>

      {rows === null ? <Loading variant="inline" label="Loading accounts" />
        : rows.length === 0 ? <p className="a-empty">{term ? 'Nobody matches that.' : 'No accounts yet.'}</p>
        : (
          <>
            <div className="a-people">
              {rows.map((r, i) => (
                <div key={r.id} className={`a-person${r.suspended ? ' out' : ''}`} style={step(i)}>
                  <div className="a-person-who">
                    <span className="a-cell-name">{r.name || r.email.split('@')[0]}</span>
                    <span className="a-cell-mail">{r.email}</span>
                    <span className="a-cell-marks">
                      {r.admin && <span className="a-mark">Admin</span>}
                      {r.access && <span className="a-mark state">Upgraded{r.grantedBy ? ` by ${r.grantedBy.split('@')[0]}` : ''}</span>}
                      {r.ownKey && <span className="a-mark">Own key</span>}
                      {r.envListed && <span className="a-mark">Env list</span>}
                      {r.suspended && (
                        <span className="a-mark danger">
                          Suspended{r.suspendedBy ? ` by ${r.suspendedBy.split('@')[0]}` : ''}
                          {r.suspendedAt ? ` · ${formatInZone(r.suspendedAt)}` : ''}
                        </span>
                      )}
                    </span>
                  </div>

                  {r.admin ? (
                    <span className="a-person-note">Protected</span>
                  ) : confirm?.id === r.id ? (
                    /* Every action asks first, including the two reversible ones. These are three
                       small buttons a thumb's width apart on a phone, and each of them lands on a
                       real person — a mis-tap that costs money or signs somebody out should not be
                       possible in one touch. The question always names the account, because "are
                       you sure?" is not a question anybody can actually answer. */
                    <div className="a-person-confirm">
                      <span className={confirm.what === 'delete' ? 'grave' : undefined}>{ASK[confirm.what](r.email)}</span>
                      <div className="a-person-acts">
                        <button type="button" className={`a-btn${confirm.what === 'delete' ? ' danger' : ''}`}
                          disabled={busy === r.id}
                          onClick={() => {
                            if (confirm.what === 'delete') return remove(r);
                            if (confirm.what === 'suspend') return setSuspended(r, true);
                            if (confirm.what === 'restore') return setSuspended(r, false);
                            return toggleUpgrade(r);
                          }}>
                          {busy === r.id ? 'Working…' : CTA[confirm.what]}
                        </button>
                        <button type="button" className="a-btn" disabled={busy === r.id} onClick={() => setConfirm(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="a-person-acts">
                      {/* Not offered on a locked-out account. Upgrading spends the founder's Sarvam
                          balance on an engine the person cannot reach — the button would take real
                          money for nothing. Restore first; the choice comes back with them. Their
                          existing grant is untouched either way, and the row still shows it. */}
                      {!r.suspended && (
                        <button type="button" className="a-btn" disabled={busy === r.id}
                          onClick={() => setConfirm({ id: r.id, what: r.access ? 'downgrade' : 'upgrade' })}
                          title={r.ownKey ? 'They already pay Sarvam themselves' : r.access ? 'Back to the free engine' : 'Spend your Sarvam balance on them'}>
                          {r.access ? <><Minus size={13} /> Downgrade</> : <><Plus size={13} /> Upgrade</>}
                        </button>
                      )}
                      <button type="button" className="a-btn" disabled={busy === r.id}
                        onClick={() => setConfirm({ id: r.id, what: r.suspended ? 'restore' : 'suspend' })}>
                        {r.suspended ? <><RotateCcw size={13} /> Restore</> : <><Ban size={13} /> Suspend</>}
                      </button>
                      <button type="button" className="a-btn danger" disabled={busy === r.id}
                        onClick={() => setConfirm({ id: r.id, what: 'delete' })}>
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Always rendered, even on a single page: "1–7 of 7" is the sentence that says the
                list is not truncated, which is the thing the old fifty-row cap never said. */}
            <div className="a-pager">
              <button type="button" className="a-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="a-pager-at">
                {first}–{first + shown - 1} of {meta.total}
              </span>
              <button type="button" className="a-btn" disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          </>
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
  if (!stats) return <div className="page narrow"><Loading label="Loading the numbers" /></div>;

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

      <div style={{ marginTop: '12px' }}><ManageUsersCard /></div>

      {/* ---------- Feedback. Designed like the rest of the page down to the card, and then
           deliberately left alone inside it: the report itself is plain text at reading size. --- */}
      <section className="a-card" style={{ marginTop: '12px' }}>
        {/* The heading keeps its own row and the way in sits at the end of it. This section is the
            only one on the page you can act on rather than only read, and the footer link that used
            to be the way there was 400px below the reports it applies to. */}
        <div className="a-card-head">
          <div>
            <h2>Help us improve</h2>
            <p className="a-sub">{fb.total} {fb.total === 1 ? 'submission' : 'submissions'} · {fb.inRange} {RANGE_WORD[range]}</p>
          </div>
          <Link href="/feedback-inbox" className="a-head-btn">
            Manage <ArrowRight size={14} />
          </Link>
        </div>

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
        <Link href="/">Back to the app</Link>
      </p>
    </div>
  );
}
