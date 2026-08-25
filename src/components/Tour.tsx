'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { X, ArrowRight, Check } from 'lucide-react';
import { tourStatus, markTourDone } from '@/actions/intro';

/**
 * A guided spotlight tour of the real app. It navigates page to page, cuts a bright hole around a
 * real element on each stop and explains it. Lead with the MOM wedge — record → tasks → chased.
 * Not modal cards: the highlighted thing is the actual button the user will press later.
 *
 * Targets are stable containers, never list items, so an empty account still has them. When a
 * target genuinely isn't on the page, the bubble simply centres and the explanation continues.
 */
type Step = { route: string; selector: string | null; title: string; body: string };

const STEPS: Step[] = [
  { route: '/', selector: '.home-greeting', title: 'For work and for life',
    body: 'This is everything you save — for work and for life. Let me show you around.' },
  { route: '/mom', selector: '[data-tour="record-meeting"]', title: 'Record a meeting',
    body: 'You talk; it writes the summary and the tasks, with names and dates that chase themselves. This is the one thing no other app does.' },
  { route: '/tasks', selector: '[data-tour="task-add"]', title: 'Tasks that chase themselves',
    body: 'Every task can carry a due time — your phone reminds you until it’s done.' },
  { route: '/links', selector: '.fab-btn', title: 'Save anything',
    body: 'Save a link or a note from anywhere; one search finds all of it.' },
  { route: '/projects', selector: '[data-tour="project-add"]', title: 'Groups that share',
    body: 'Make a group like a WhatsApp group — meetings, tasks and notes shared with exactly those people.' },
  { route: '/projects', selector: '.jarvis-fab', title: 'Ask Jarvis',
    body: 'Ask Jarvis anything about your own stuff, by voice or text.' },
  { route: '/projects', selector: null, title: 'That’s the loop',
    body: 'Record → it becomes tasks → they chase themselves. Done whenever you like.' },
];

const PAD = 8;      // breathing room around the highlighted element
const GAP = 14;     // gap between the hole and the bubble
const MARGIN = 16;  // keep the bubble this far from the screen edge
const STORE = 'tourStep';

export default function Tour() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const start = useCallback((from = 0) => { setIndex(from); setActive(true); }, []);

  const finish = useCallback(() => {
    setActive(false);
    setRect(null);
    try { localStorage.removeItem(STORE); } catch {}
    markTourDone().catch(() => {});
  }, []);

  const next = useCallback(() => {
    setIndex(i => {
      if (i >= STEPS.length - 1) { finish(); return i; }
      return i + 1;
    });
  }, [finish]);

  // Auto-start on a fresh account's first login; resume mid-tour after a reload; a launcher button
  // fires 'tour:start' to replay it. tourStatus withholds auto-start for anyone signed out.
  useEffect(() => {
    let saved: number | null = null;
    try { const v = localStorage.getItem(STORE); if (v !== null) saved = Number(v); } catch {}
    if (saved !== null && saved >= 0 && saved < STEPS.length) { start(saved); }
    else tourStatus().then(s => { if (s.autoStart) start(0); }).catch(() => {});

    const onStart = () => start(0);
    window.addEventListener('tour:start', onStart);
    return () => window.removeEventListener('tour:start', onStart);
  }, [start]);

  useEffect(() => {
    if (active) { try { localStorage.setItem(STORE, String(index)); } catch {} }
  }, [active, index]);

  // Measure the current target (or clear it for a centred bubble).
  const measure = useCallback(() => {
    const sel = STEPS[index].selector;
    if (!sel) { setRect(null); return true; }
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    setRect(el.getBoundingClientRect());
    return true;
  }, [index]);

  // Navigate to the step's page, wait for its target to exist, then lock onto it.
  useEffect(() => {
    if (!active) return;
    const s = STEPS[index];
    setRect(null);   // drop the previous target's hole immediately so it can't linger mid-move
    if (pathname !== s.route) { router.push(s.route); return; }   // re-runs when pathname lands
    if (s.selector === null) return;

    let cancelled = false, tries = 0;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(s.selector!) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 40) {
        setTimeout(tick, 100);   // client page still fetching — keep looking for ~4s
      } else {
        setRect(null);           // genuinely absent (empty account) — carry on centred
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [active, index, pathname, router, reduce]);

  // Keep the hole glued to the element as it scrolls or the viewport resizes.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => measure()); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [active, measure]);

  // Place the bubble: below the target if it fits, else above, else clamped on-screen.
  useLayoutEffect(() => {
    if (!active) return;
    const b = bubbleRef.current;
    if (!b) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = b.offsetWidth, bh = b.offsetHeight;
    if (!rect) { setPos({ top: Math.max(MARGIN, (vh - bh) / 2), left: (vw - bw) / 2 }); return; }
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - bh;
    let top = below + bh + MARGIN <= vh ? below : above >= MARGIN ? above : below;
    top = Math.max(MARGIN, Math.min(top, vh - bh - MARGIN));
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - bw - MARGIN));
    setPos({ top, left });
  }, [active, rect, index]);

  // Focus the bubble on each step so keyboard + screen-reader land inside it.
  useEffect(() => { if (active) bubbleRef.current?.focus(); }, [active, index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); next(); return; }
    if (e.key === 'Tab') {
      const nodes = bubbleRef.current?.querySelectorAll<HTMLElement>('button');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === bubbleRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
  };

  if (!active) return null;

  const hole = rect && {
    top: rect.top - PAD, left: rect.left - PAD,
    width: rect.width + PAD * 2, height: rect.height + PAD * 2,
  };

  return createPortal(
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {hole
        ? <>
            <div className="tour-catch" />
            <div className="tour-hole" data-reduce={reduce ? '' : undefined}
              style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
          </>
        : <div className="tour-scrim-full" />}

      <div ref={bubbleRef} className="tour-bubble" tabIndex={-1} onKeyDown={onKeyDown}
        style={pos ? { top: pos.top, left: pos.left, visibility: 'visible' } : { top: -9999, left: -9999, visibility: 'hidden' }}>
        <div className="tour-bubble-top">
          <span className="tour-count">{index + 1} / {STEPS.length}</span>
          <button className="icon-btn" onClick={finish} aria-label="End tour"><X size={16} /></button>
        </div>
        <h2 id="tour-title" className="tour-bubble-title">{step.title}</h2>
        <p id="tour-body" className="tour-bubble-body">{step.body}</p>
        <div className="tour-bubble-foot">
          {!isLast && <button className="tour-btn ghost" onClick={next}>Skip</button>}
          {!isLast && <button className="tour-btn ghost" onClick={finish} style={{ marginLeft: 'auto' }}>Done</button>}
          {isLast
            ? <button className="tour-btn primary" onClick={finish} style={{ marginLeft: 'auto' }}><Check size={15} /> Done</button>
            : <button className="tour-btn primary" onClick={next}>Next <ArrowRight size={15} /></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
