'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic, ListChecks, Sparkles, Share2, Users, Lock, Globe, Home as HomeIcon, List, Search } from 'lucide-react';
import Mark from './brand/Mark';
import Wordmark from './brand/Wordmark';
import { NAV, MOBILE_NAV } from '@/lib/nav';
import '@/styles/landing.css';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Runs `tick` on an interval only while `el` is on screen; hover pauses. */
function useCycle(ref: React.RefObject<HTMLElement | null>, next: () => void, dwell: number, deps: unknown[]) {
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    if (!visible || paused || reduced()) return;
    const t = setTimeout(next, dwell);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paused, dwell, ...deps]);
  return { paused, setPaused };
}

const Wave = ({ n }: { n: number }) => <div className="wave">{Array.from({ length: n }, (_, i) => <i key={i} />)}</div>;

const TABS = [
  { label: 'Meetings', Icon: Mic },
  { label: 'Tasks', Icon: ListChecks },
  { label: 'Jarvis', Icon: Sparkles },
  { label: 'Save anything', Icon: Share2 },
  { label: 'Project groups', Icon: Users },
];

function Tour() {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [key, setKey] = useState(0); // remount the active tab so its drain restarts on click
  const show = (n: number) => { setI((n + TABS.length) % TABS.length); setKey(k => k + 1); };
  const { paused, setPaused } = useCycle(ref, () => show(i + 1), 5500, [i, key]);
  return (
    <div ref={ref} className={`tour ${paused ? 'paused' : ''}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onKeyDown={e => { if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); }}>
      <div className="tour-tabs" role="tablist" aria-label="What the app does">
        {TABS.map(({ label, Icon }, k) => (
          <button key={k === i ? `${k}-${key}` : k} className={`tab ${k === i ? 'on' : ''}`} role="tab" aria-selected={k === i} onClick={() => show(k)}>
            <Icon aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div className="stage">
        <div className={`panel ${i === 0 ? 'on' : ''}`} role="tabpanel">
          <div className="blurb">
            <h3>Record the meeting. The to-do list writes itself.</h3>
            <p>Hit record — Hindi, English, or both mid-sentence. You get a summary of what was decided, and every action item pulled out with a name and a date on it. You confirm, and it&apos;s assigned.</p>
            <span className="k">Meeting → task in one tap</span>
          </div>
          <div className="screen">
            <div className="bar"><b>Sprint planning</b><span>Tue · 41 min</span></div>
            <div className="rec a"><i className="dotr" /><Wave n={20} /><span className="pill">Recording</span></div>
            <div className="transcript a">&ldquo;…Abhishek will send the revised quote by Wednesday, aur Swaraj client ko demo schedule karega…&rdquo;</div>
            <div className="arrow a">↓ action items found</div>
            <div className="row a"><span className="av">A</span><div className="t">Send revised quote to client<div className="m">Abhishek</div></div><span className="pill due">Wed 5:00 pm</span></div>
            <div className="row a"><span className="av" style={{ background: '#8b93a7' }}>S</span><div className="t">Schedule the client demo<div className="m">Swaraj</div></div><span className="pill due">Thu 11:00 am</span></div>
          </div>
        </div>

        <div className={`panel ${i === 1 ? 'on' : ''}`} role="tabpanel">
          <div className="blurb">
            <h3>Reminders that actually reach you.</h3>
            <p>Not a badge you&apos;ll ignore. A notification on your phone — a day before, an hour before, at the deadline, then every morning until you tick it. The app is the one that chases.</p>
            <span className="k">Nothing gets forgotten</span>
          </div>
          <div className="screen">
            <div className="bar"><b>Tomorrow</b><span>3 open</span></div>
            <div className="notif"><div className="ic">1d</div><div><b>Due tomorrow: Send revised quote to client</b><span>Wed, 5:00 pm</span></div></div>
            <div className="notif"><div className="ic">1h</div><div><b>Due in 1 hour: Send revised quote to client</b><span>Wed, 5:00 pm</span></div></div>
            <div className="notif"><div className="ic">!</div><div><b>Overdue: Send revised quote to client</b><span>Was due Wed, 5:00 pm — every morning until it&apos;s done</span></div></div>
          </div>
        </div>

        <div className={`panel ${i === 2 ? 'on' : ''}`} role="tabpanel">
          <div className="blurb">
            <h3>Ask, don&apos;t search.</h3>
            <p>&ldquo;What&apos;s urgent today?&rdquo; &ldquo;Where&apos;s that flat listing?&rdquo; &ldquo;Get me Abhishek&apos;s number.&rdquo; Jarvis answers from your own stuff, out loud, and can add a task or a note while you talk.</p>
            <span className="k">English and Hindi, by voice</span>
          </div>
          <div className="screen">
            <div className="bar"><b>Jarvis</b><span>Listening…</span></div>
            <div className="bub me a">What&apos;s urgent today?</div>
            <div className="think a"><i /><i /><i /></div>
            <div className="bub ai a">Two things. <b>Send revised quote to client</b> is due at 5 pm — Abhishek has it. And <b>Finalise the launch checklist</b> is overdue since Monday, still unassigned.</div>
            <div className="row a"><span className="cb" /><div className="t">Send revised quote to client<div className="m">Product launch · Abhishek</div></div><span className="pill due">Today</span></div>
          </div>
        </div>

        <div className={`panel ${i === 3 ? 'on' : ''}`} role="tabpanel">
          <div className="blurb">
            <h3>Share a link. It&apos;s filed.</h3>
            <p>From your browser, WhatsApp, anywhere — share to the app and it lands in your vault with the title, thumbnail and category already filled in. Recipes, flat listings, specs. Work and not-work, same pocket.</p>
            <span className="k">One tap from any app</span>
          </div>
          <div className="screen">
            <div className="bar"><b>Share</b><span>ALL YOU NEED</span></div>
            <div className="card a"><div className="th th-doc"><svg viewBox="0 0 54 40" fill="none" aria-hidden="true"><rect x="12" y="4" width="30" height="32" rx="3" fill="#faf9f5" /><rect x="17" y="10" width="14" height="3" rx="1.5" fill="#1f1e1d" /><rect x="17" y="17" width="20" height="2" rx="1" fill="#93908a" /><rect x="17" y="22" width="18" height="2" rx="1" fill="#93908a" /><rect x="17" y="27" width="20" height="2" rx="1" fill="#93908a" /></svg></div><div><div className="t">How to write a product spec your team will actually read</div><div className="m">saved to <b>Work reading</b></div></div></div>
            <div className="card a"><div className="th th-flat"><svg viewBox="0 0 54 40" fill="none" aria-hidden="true"><path d="M9 20L27 7l18 13" stroke="#faf9f5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><rect x="14" y="19" width="26" height="16" rx="1.5" fill="#faf9f5" /><rect x="18" y="23" width="6" height="6" rx="1" fill="#1f6f5a" /><rect x="29" y="25" width="6" height="10" rx="1" fill="#1f6f5a" /></svg></div><div><div className="t">2BHK near the office, ₹38k — available next month</div><div className="m">saved to <b>Flat hunt</b></div></div></div>
            <div className="card a"><div className="th th-food"><svg viewBox="0 0 54 40" fill="none" aria-hidden="true"><ellipse cx="27" cy="28" rx="18" ry="6" fill="#faf9f5" /><ellipse cx="27" cy="26" rx="11" ry="4" fill="#b45309" /><path d="M20 18c0-3 2-3 2-6M27 17c0-3 2-3 2-6M34 18c0-3 2-3 2-6" stroke="#faf9f5" strokeWidth="2" strokeLinecap="round" opacity=".85" /></svg></div><div><div className="t">Chettinad chicken, the proper way</div><div className="m">saved to <b>Recipes</b></div></div></div>
          </div>
        </div>

        <div className={`panel ${i === 4 ? 'on' : ''}`} role="tabpanel">
          <div className="blurb">
            <h3>A group, like WhatsApp — but it remembers.</h3>
            <p>Add people the way you&apos;d add them to a group. Their meetings, tasks, notes and files live together, shared with exactly them. Owners keep it tidy; everyone sees what changed since Friday.</p>
            <span className="k">Shared with the people you add</span>
          </div>
          <div className="screen">
            <div className="bar"><b>Product launch</b><span>4 people · 3 open</span></div>
            <div className="row a"><span className="cb tick" /><div className="t" style={{ textDecoration: 'line-through', color: '#93908a' }}>Approve the landing page copy<div className="m">Swaraj · signed off</div></div><span className="pill ok">Done</span></div>
            <div className="row a"><span className="cb" /><div className="t">Send revised quote to client<div className="m">Abhishek</div></div><span className="pill due">Wed</span></div>
            <div className="row a"><span className="cb" /><div className="t">Schedule the client demo<div className="m">Swaraj</div></div><span className="pill due">Thu</span></div>
            <div className="row a"><span className="av" style={{ background: '#6b4fbb', color: '#fff' }}>+</span><div className="t">A new teammate joined the group<div className="m">added by Abhishek · yesterday</div></div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const NOS = ['minutes to write', 'follow-up messages', '“did you get to that?”', 'ads, ever'];
const YES = ['to tracking everything', 'to real collaboration', 'to Hindi, English, or both', 'to it staying yours'];

/* A spotlight walks the eight lines; hover holds it on a line (reduced-motion lights them all via CSS). */
function NoYes() {
  const ref = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(0);
  const { setPaused } = useCycle(ref, () => setLit(l => (l + 1) % 8), 2200, [lit]);
  const line = (k: number, word: string, text: string) => (
    <div key={k} className={`ln ${lit === k ? 'lit' : ''}`} onMouseEnter={() => { setLit(k); setPaused(true); }}><b>{word}</b> {text}</div>
  );
  return (
    <div ref={ref} className="noyes" onMouseLeave={() => setPaused(false)}>
      <div className="nos">{NOS.map((t, k) => line(k, 'NO', t))}</div>
      <div className="yes">{YES.map((t, k) => line(k + 4, 'YES', t))}</div>
    </div>
  );
}

const STAGES = [
  { n: 'i', h: 'Record', p: 'Hit the mic. Hindi, Hinglish or English — it doesn\'t mind which.', label: 'Recording · 00:41', dwell: 4200 },
  { n: 'ii', h: 'It reads the room', p: 'A summary of what was decided, and every action item pulled out with a name on it.', label: 'Reading the room…', dwell: 3600 },
  { n: 'iii', h: 'You confirm', p: 'Who owns each one, and by when. One tap. Nothing is created that you didn\'t agree to.', label: 'Confirm · 3 tasks', dwell: 3400 },
  { n: 'iv', h: 'It chases', p: 'A day before. An hour before. Every morning until it\'s done — so you don\'t have to.', label: 'Chasing · 2 open', dwell: 3600 },
];

function Loop() {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [key, setKey] = useState(0);
  const go = (n: number) => { setI(n % 4); setKey(k => k + 1); };
  useCycle(ref, () => go(i + 1), STAGES[i].dwell, [i, key]);
  return (
    <div ref={ref} className="loop">
      <div className="stages">
        {STAGES.map((s, k) => (
          <button key={k} type="button" className={`stg ${k === i ? 'on' : ''} ${k < i ? 'done' : ''}`} onClick={() => go(k)}>
            <div className="n"><span>{s.n}</span></div>
            <div><h3>{s.h}</h3><p>{s.p}</p></div>
          </button>
        ))}
      </div>
      <div className="loop-screen">
        <div className="bar"><b>Sprint planning</b><span>{STAGES[i].label}</span></div>
        <div className={`ls ${i === 0 ? 'on' : ''}`}>
          <div className="rec"><i className="dotr" /><Wave n={22} /><span className="pill">REC</span></div>
          <div className="transcript">&ldquo;…Abhishek revised quote Wednesday tak bhej dega, aur Swaraj will schedule the client demo…&rdquo;</div>
        </div>
        <div className={`ls ${i === 1 ? 'on' : ''}`}>
          <div className="sum"><b>Summary</b>Quote and demo both due this week. Launch checklist blocked on final pricing — Abhishek to confirm with finance.</div>
          <div className="row"><span className="av">A</span><div className="t">Send revised quote to client<div className="m">Abhishek · Wed 5:00 pm</div></div><span className="pill due">found</span></div>
          <div className="row"><span className="av" style={{ background: '#8b93a7' }}>S</span><div className="t">Schedule the client demo<div className="m">Swaraj · Thu 11:00 am</div></div><span className="pill due">found</span></div>
          <div className="row"><span className="av" style={{ background: '#6b4fbb', color: '#fff' }}>A</span><div className="t">Confirm pricing with finance<div className="m">Abhishek · Fri</div></div><span className="pill due">found</span></div>
        </div>
        <div className={`ls ${i === 2 ? 'on' : ''}`}>
          <div className="row"><span className="pick" /><div className="t">Send revised quote to client<div className="m">Abhishek · Wed 5:00 pm</div></div></div>
          <div className="row"><span className="pick" /><div className="t">Schedule the client demo<div className="m">Swaraj · Thu 11:00 am</div></div></div>
          <div className="row"><span className="pick" /><div className="t">Confirm pricing with finance<div className="m">Abhishek · Fri</div></div></div>
          <div className="row cta">Create 3 tasks</div>
        </div>
        <div className={`ls ${i === 3 ? 'on' : ''}`}>
          <div className="notif"><div className="ic">1d</div><div><b>Due tomorrow: Send revised quote to client</b><span>Wed, 5:00 pm · Abhishek</span></div></div>
          <div className="notif"><div className="ic">1h</div><div><b>Due in 1 hour: Schedule the client demo</b><span>Thu, 11:00 am · Swaraj</span></div></div>
          <div className="notif"><div className="ic">✓</div><div><b>Done: Confirm pricing with finance</b><span>Abhishek ticked it · signed off by Swaraj</span></div></div>
        </div>
        <div className="loop-progress"><i key={key} style={{ '--dwell': `${STAGES[i].dwell}ms` } as React.CSSProperties} /></div>
      </div>
    </div>
  );
}

/* The Home grid the signed-in app actually draws (HomeTiles: every NAV destination, plus Search
   which is a FAB everywhere else). Read from NAV so a new destination shows up here too. */
const PH_TILES = [...NAV, { href: '/search', Icon: Search, title: 'Search' }];
const PH_TABS = NAV.filter(n => MOBILE_NAV.includes(n.href));

/* Six things the phone is for, each pinned to the real surface it lives on — five Home tiles
   and Jarvis, which in the app is a floating button, not a tile. Walk order follows the grid. */
const FEATURES = [
  { at: '/links', title: 'Save from anywhere', text: 'Share from any app. Filed for you.' },
  { at: '/notes', title: 'Notes and files together', text: 'Notes, PDFs, docs — one search.' },
  { at: '/tasks', title: 'Reminders that reach you', text: 'A real notification, until you tick it.' },
  { at: '/projects', title: 'Project groups', text: 'Add people like a WhatsApp group.' },
  { at: '/d-locker', title: 'Private Safe', text: 'Sensitive things behind a PIN.' },
  { at: 'jarvis', title: 'Ask Jarvis', text: 'Answers out loud, from your own stuff.' },
];
const JARVIS = FEATURES.length - 1;

/* One phone running the app's own Home screen; a spotlight walks six of its tiles and the Jarvis
   button, lighting the matching bottom tab as it goes. Hover/tap holds it. Reduced motion never
   ticks, so the first tile stays lit with its caption. A toolbar, not a tablist: the grid also
   holds the destinations no feature line points at. */
function Pocket() {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const { setPaused } = useCycle(ref, () => setI(n => (n + 1) % FEATURES.length), 2000, [i]);
  const pick = (n: number) => { setI((n + FEATURES.length) % FEATURES.length); setPaused(true); };
  const at = FEATURES[i].at;
  const spot = (k: number) => ({
    'aria-pressed': k === i, 'aria-label': `${FEATURES[k].title}. ${FEATURES[k].text}`,
    tabIndex: k === i ? 0 : -1, type: 'button' as const,
    onClick: () => pick(k), onMouseEnter: () => pick(k), onFocus: () => pick(k),
  });
  return (
    <div ref={ref} className="pocket" onMouseLeave={() => setPaused(false)}>
      <div className="phone">
        <div className="ph-screen">
          <div className="ph-status" aria-hidden="true"><span>9:41</span><i className="ph-notch" /><span className="ph-bars"><i /><i /><i /></span></div>

          <header className="ph-greet">
            <span className="ph-mark" aria-hidden="true"><Mark size={11} />ALL <i>YOU NEED</i></span>
            <b>Hi, Swaraj</b>
            <span>What&apos;s on your mind?</span>
          </header>
          <div className="ph-vault" aria-hidden="true"><span>Your vault</span><List size={9} strokeWidth={2.4} /></div>

          <div className="ph-tiles" role="toolbar" aria-label="What lives in the app"
            onKeyDown={e => { if (e.key === 'ArrowRight') pick(i + 1); if (e.key === 'ArrowLeft') pick(i - 1); }}>
            {PH_TILES.map(({ href, Icon, title }) => {
              const k = FEATURES.findIndex(f => f.at === href);
              const face = <><span className="ph-ic"><Icon size={17} strokeWidth={2.2} aria-hidden="true" /></span><span className="ph-tt">{title}</span></>;
              return k < 0
                ? <div key={href} className="ph-tile">{face}</div>
                : <button key={href} className={`ph-tile ${k === i ? 'on' : ''}`} {...spot(k)}>{face}</button>;
            })}
            <button className={`ph-jarvis ${at === 'jarvis' ? 'on' : ''}`} {...spot(JARVIS)}>
              <Sparkles size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>

          <nav className="ph-tabs" aria-hidden="true">
            <span className={`ph-tab ${MOBILE_NAV.includes(at) ? '' : 'on'}`}><HomeIcon size={14} strokeWidth={2.2} /><i>Home</i></span>
            {PH_TABS.map(({ href, Icon, title }) => (
              <span key={href} className={`ph-tab ${at === href ? 'on' : ''}`}><Icon size={14} strokeWidth={2.2} /><i>{title}</i></span>
            ))}
            <span className="ph-tab"><i className="ph-av">S</i></span>
          </nav>
        </div>
      </div>
      <p className="pocket-cap"><b>{FEATURES[i].title}.</b> {FEATURES[i].text}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <nav className="nav">
        <div className="nav-pill">
          <Link href="/" className="lp-logo" aria-label="ALL YOU NEED"><Mark tone="inverse" size={40} />ALL <span>YOU NEED</span></Link>
          <div className="nav-actions">
            <Link className="btn btn-ghost" href="/auth/signin">Log in</Link>
            <Link className="btn btn-accent" href="/auth/signup">Get started</Link>
          </div>
        </div>
      </nav>

      <section className="hero">
        <Mark tone="inverse" size={168} animate className="hero-mark" />
        <h1><span className="w">Record</span> <span className="w">everything.</span><br /><em><span className="w">Chase</span> <span className="w">nobody.</span></em></h1>
        <p className="hero-sub">
          All your <span className="chip">meetings</span> <span className="chip">tasks</span> <span className="chip">notes</span>{' '}<span className="nb">and <span className="chip">links</span></span> in one place that follows through for you.
        </p>
        <div className="platforms">
          <Link className="platform primary" href="/download">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.67a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" /></svg>
            Get the Android app
          </Link>
          <Link className="platform" href="/auth/signup"><Globe aria-hidden="true" />Use it on the web</Link>
          <span className="platform">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.5c-.03-2.66 2.18-3.94 2.28-4-1.24-1.82-3.18-2.07-3.86-2.1-1.64-.17-3.21.97-4.04.97-.84 0-2.12-.95-3.49-.92-1.8.03-3.45 1.04-4.37 2.65-1.87 3.24-.48 8.03 1.34 10.66.89 1.29 1.94 2.73 3.33 2.68 1.34-.05 1.84-.87 3.46-.87 1.61 0 2.07.87 3.48.84 1.44-.03 2.35-1.3 3.23-2.6 1.02-1.49 1.44-2.94 1.46-3.02-.03-.01-2.8-1.07-2.82-4.29zM13.7 4.65c.74-.9 1.24-2.14 1.1-3.38-1.07.04-2.36.71-3.12 1.6-.69.79-1.29 2.06-1.13 3.27 1.19.09 2.41-.6 3.15-1.49z" /></svg>
            iPhone <small>· via the web app</small>
          </span>
        </div>
        <div className="wrap"><Tour /></div>
      </section>

      <section className="section" id="why">
        <div className="wrap">
          <div className="chapter"><span className="num">Chapter one</span><h2>Why this exists</h2></div>
          <div className="manifesto">
            <p><span className="cap">E</span>very team has one person whose real job is remembering. They write the minutes. They chase the follow-ups. They ask, again, whether the thing got done.</p>
            <p>That person is usually the most senior one in the room — spending their day as a reminder service.</p>
            <p>We built the reminder service. Record the meeting. The tasks write themselves, land with the right people, carry a date, and keep asking until they are finished.</p>
            <p>Nobody has to be the one who remembers.</p>
          </div>
          <NoYes />
        </div>
      </section>

      <section className="band" id="how">
        <div className="wrap">
          <div className="chapter"><span className="num">Chapter two</span><h2>Talk for an hour.<br /><em>Get a to-do list with names on it.</em></h2></div>
          <p className="lede">Hindi, English, or both mid-sentence. Record it and the work is already assigned by the time you stand up.</p>
          <Loop />
          <Link className="btn btn-light" href="/auth/signup">Try it with a real meeting →</Link>
        </div>
      </section>

      <section className="section pocket-section">
        <div className="wrap">
          <p className="eyebrow">And the rest of your life</p>
          <h2>Work and not-work,<br />in the same pocket.</h2>
          <p className="lede">You won&apos;t open a work tool on a Sunday. You&apos;ll open the place your recipes already are — and that&apos;s the app that has Monday&apos;s meeting notes in it.</p>
          <Pocket />
        </div>
      </section>

      <section className="vault" id="private">
        <div className="wrap">
          <p className="eyebrow">Your data stays yours</p>
          <div className="vault-card">
            <div className="vault-lock"><Lock size={22} aria-hidden="true" /></div>
            <h2>Yours alone.</h2>
            <p className="lede">Everything you save is private by default. We don&apos;t read your content, we don&apos;t sell it, and we&apos;ll tell you the limits of that promise rather than let you assume a stronger one.</p>
            <div className="vault-rules">
              <div className="vault-rule"><b>Private by default</b><span>Nothing you save is visible to anyone else unless you put it in a project group.</span></div>
              <div className="vault-rule"><b>You choose who</b><span>A group is seen by the people you add to it, and nobody else.</span></div>
              <div className="vault-rule"><b>A Private Safe</b><span>Anything sensitive goes behind a PIN, hidden from the normal view until you unlock it.</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="close">
        <div className="wrap">
          <h2>Welcome to<br /><em>the end of <span className="nb">follow-ups.</span></em></h2>
          <Link className="btn btn-accent" href="/auth/signup">Sign up — it&apos;s free →</Link>
        </div>
      </section>

      <footer className="foot">
        <Wordmark className="foot-logo" size={18} />
        <Link href="/download">Get the Android app</Link>
        <Link href="/terms">Terms &amp; your data</Link>
        <span>Works on iPhone via the web</span>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
