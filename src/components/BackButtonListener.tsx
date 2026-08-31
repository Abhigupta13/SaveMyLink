'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Android hardware/gesture back. Nothing runs on the web — the dynamic imports
 * are guarded by isNativePlatform() exactly like SendIntentListener.
 *
 * One decision, in order:
 *   1. A modal is open  → close the topmost one and stay put.
 *      Every modal in this app closes on an overlay click, so clicking the
 *      overlay IS the close button; the last one in the DOM is the topmost.
 *
 *      OVERLAYS is one list on purpose. It used to name `.modal-overlay` alone, which missed the
 *      two overlays that are not modals: the shared confirm dialog (.confirm-overlay, ui/Feedback)
 *      and the account sheet (.sheet-overlay, AccountSwitcher). With "Delete this document?" on
 *      screen, back fell through to step 3 and navigated away — while the dialog, mounted up in the
 *      root layout, stayed on top of the new page with its promise never resolved. Nothing could
 *      settle it after that: the caller awaiting the answer was gone with the old page.
 *      A new overlay class is now one edit here, not a fourth silent hole.
 *   2. Jarvis panel open → Esc, which is what JarvisWidget already listens for
 *      (it also releases the mic and stops the voice — a raw setOpen would not).
 *   3. Not on Home       → back, or Home if there is no history to go back to
 *      (a share-intent cold start has none, and back() there would strand you).
 *   4. On Home           → let the app close, like every other Android app.
 */
/** Every dismissable layer, topmost last in the DOM. Each closes on an overlay click. */
const OVERLAYS = '.modal-overlay, .confirm-overlay, .sheet-overlay';

export default function BackButtonListener() {
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    let handle: { remove: () => Promise<void> } | undefined;

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');

      handle = await App.addListener('backButton', ({ canGoBack }) => {
        const overlays = document.querySelectorAll<HTMLElement>(OVERLAYS);
        if (overlays.length) {
          overlays[overlays.length - 1].click();
          return;
        }
        if (document.querySelector('.jarvis-panel')) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return;
        }
        // Read the path at press time, not at mount — this listener outlives every navigation.
        if (window.location.pathname !== '/') {
          if (canGoBack) router.back();
          else router.push('/');
          return;
        }
        /* One last chance to say something, at most a few times a year — see ExitFeedback and
           lib/feedbackPrompt. It answers true only when it has taken responsibility for the
           gesture, and then exits on the person's behalf; every other time we leave immediately.
           The back press is always honoured, never swallowed. */
        const ask = (window as unknown as { __exitFeedback?: (exit: () => void) => boolean }).__exitFeedback;
        if (ask?.(() => App.exitApp())) return;
        App.exitApp();
      });
      if (disposed) handle.remove();
    })().catch(() => {});

    return () => {
      disposed = true;
      handle?.remove();
    };
  }, [router]);

  return null;
}
