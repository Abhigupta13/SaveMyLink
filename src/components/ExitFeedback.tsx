'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SuggestDialog } from '@/components/SuggestBox';
import {
  shouldAskOnExit, afterAsked, afterDismissed, afterSent, afterSession, type FeedbackState,
} from '@/lib/feedbackPrompt';

const STORE = 'exitFeedback';

/**
 * Asks for feedback on the way out — and mostly does not ask at all. The rules live in
 * lib/feedbackPrompt, where every branch is provable without waiting a week for a cooldown.
 *
 * WHY THIS IS ANDROID-ONLY, and it is not an oversight. A browser cannot show a custom dialog when
 * a tab closes: `beforeunload` permits only the browser's own generic "Leave site?" string, and
 * every engine deliberately blocks custom UI there — precisely because exit-blocking modals were
 * abused. There is no API that would let this work on the web at tab-close, so pretending
 * otherwise would mean shipping something that silently never fires. On the web the nearest real
 * exit the app actually controls is signing out, which AccountSwitcher owns; this component
 * handles the app.
 *
 * The gesture is honoured either way. Someone who pressed back to leave gets to leave: "Later"
 * exits immediately, and sending exits once the report is away. What is never allowed is pressing
 * back and being trapped.
 */
export default function ExitFeedback() {
  const [open, setOpen] = useState(false);
  const exitRef = useRef<(() => void) | null>(null);

  const read = (): FeedbackState => {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
  };
  const write = (s: FeedbackState) => {
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode: never ask */ }
  };

  // One session per app load, counted before anything can ask.
  useEffect(() => { write(afterSession(read())); }, []);

  /* BackButtonListener owns the exit decision and calls this first. Returning true means "I have
     taken the gesture" — it must then not exit, because this dialog is now on screen and will exit
     on the person's behalf. Returning false means carry on and exit as before. */
  const intercept = useCallback((exit: () => void) => {
    if (open) return false;
    if (!shouldAskOnExit(read())) return false;
    write(afterAsked(read()));
    exitRef.current = exit;
    setOpen(true);
    return true;
  }, [open]);

  useEffect(() => {
    const w = window as unknown as { __exitFeedback?: (exit: () => void) => boolean };
    w.__exitFeedback = intercept;
    return () => { delete w.__exitFeedback; };
  }, [intercept]);

  if (!open) return null;

  const leave = () => {
    setOpen(false);
    const exit = exitRef.current;
    exitRef.current = null;
    exit?.();
  };

  return (
    <SuggestDialog
      title="Before you go"
      intro="Anything broken, or missing? A sentence is plenty."
      laterLabel="Later"
      onLater={() => { write(afterDismissed(read())); leave(); }}
      /* Reached only after a successful send — SuggestDialog keeps itself up on failure so the
         words are not lost. afterSent is stamped here rather than inside the dialog because
         sending from the /profile row is not an exit and must not start an exit cooldown. Without
         this the 60-day silence after someone actually helps would never begin. */
      onClose={() => { write(afterSent(read())); leave(); }}
    />
  );
}
