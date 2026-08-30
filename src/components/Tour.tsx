'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { X, ArrowRight, Check, Loader2 } from 'lucide-react';
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
// How long a step waits for its screen, and then for its target, before giving up and explaining
// itself from the middle of the screen. Two budgets, not one: the effect re-runs when the route
// lands, so a slow page and a slow target each get their own — and neither can hang the tour.
const WAIT_MS = 2500;

export default function Tour() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // False from the moment Next is pressed until this step's screen AND its target have actually
  // arrived. Until then the bubble says it is waiting instead of describing a screen that is not
  // there yet — the phone bug: router.push resolves over the network, the old page stays on
  // screen, and the tour was already talking about the next one.
  const [ready, setReady] = useState(false);
  // The index whose screen has actually landed. Lets a late arrival finish the job — the route
  // can outrun WAIT_MS, settle centred, and still pick its spotlight up when it turns up —
  // without throwing the bubble back into "One moment" under a user already reading the step.
  const shownRef = useRef(-1);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const start = useCallback((from = 0) => { shownRef.current = -1; setIndex(from); setActive(true); }, []);

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
    // The server answers first, always. Resuming straight off localStorage let a step left by
    // one account replay itself at the next one and then call markTourDone() on the wrong user
    // — a stale local step must never outrank what the server says about who is signed in.
    tourStatus().then(s => {
      if (saved !== null && saved >= 0 && saved < STEPS.length) start(saved);
      else if (s.autoStart) start(0);
    }).catch(() => {
      // Offline, or signed out mid-flight: an interrupted tour still deserves to finish.
      if (saved !== null && saved >= 0 && saved < STEPS.length) start(saved);
    });

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

  // Navigate to the step's page, wait for BOTH the page and its target to arrive, then lock on.
  // The poll reads window.location rather than the `pathname` hook: router.push only commits the
  // URL once the route's payload is in, and that commit is the honest signal that the DOM under
  // us has been swapped. Nothing is shown until then, so the spotlight can never land on the
  // previous screen. Give-up is a centred bubble, never a hang.
  useEffect(() => {
    if (!active) return;
    const s = STEPS[index];
    if (shownRef.current !== index) {
      setRect(null);   // drop the previous target's hole immediately so it can't linger mid-move
      setReady(false);
    }
    if (pathname !== s.route) router.push(s.route);   // effect re-runs when pathname lands

    let cancelled = false;
    const deadline = Date.now() + WAIT_MS;
    const settle = (el: HTMLElement | null) => {
      shownRef.current = index;
      if (el) el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      setRect(el ? el.getBoundingClientRect() : null);
      setReady(true);
    };
    const tick = () => {
      if (cancelled) return;
      if (window.location.pathname === s.route) {
        if (s.selector === null) { settle(null); return; }   // deliberately centred step
        const el = document.querySelector(s.selector) as HTMLElement | null;
        if (el) { settle(el); return; }
      }
      // Still travelling, or the target has not mounted yet. Keep looking, then explain the
      // step centred rather than leaving the bubble spinning (empty account, slow 4G, both).
      if (Date.now() < deadline) setTimeout(tick, 80); else settle(null);
    };
    tick();
    return () => { cancelled = true; };
  }, [active, index, pathname, router, reduce]);

  // Keep the hole glued to the element as it scrolls or the viewport resizes.
  useEffect(() => {
    if (!active || !ready) return;   // mid-move the selector may still match the OLD page's DOM
    let raf = 0;
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => measure()); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [active, ready, measure]);

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
        {/* Waiting reads as a step of its own, not as a broken one: the bubble keeps its frame,
            its counter and its buttons, and only the two lines that would be a lie change. */}
        <h2 id="tour-title" className="tour-bubble-title">{ready ? step.title : 'One moment'}</h2>
        <p id="tour-body" className="tour-bubble-body" aria-live="polite">
          {ready ? step.body : (
            <span className="tour-wait"><Loader2 size={14} aria-hidden="true" /> Opening the screen this step is about…</span>
          )}
        </p>
        <div className="tour-bubble-foot">
          {/* Skip leaves the tour. It used to call next(), which made it a second Next sitting
              beside the real one — two buttons, one job, and no way out except the X. */}
          {!isLast && <button className="tour-btn ghost" onClick={finish} style={{ marginRight: 'auto' }}>Skip tour</button>}
          {isLast
            ? <button className="tour-btn primary" onClick={finish} style={{ marginLeft: 'auto' }}><Check size={15} /> Done</button>
            : <button className="tour-btn primary" onClick={next}>Next <ArrowRight size={15} /></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
