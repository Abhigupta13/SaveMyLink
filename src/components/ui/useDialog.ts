'use client';
import { useEffect, useRef } from 'react';

/**
 * Escape closes the dialog.
 *
 * Nine modals in this app were plain `<div className="modal-overlay">` with no keyboard exit at
 * all: the only way out was clicking the overlay or finding the close button. Feedback's confirm
 * dialog, AccountSwitcher and Tour all handle Escape; the ad-hoc modals never did, because each
 * was written on its own.
 *
 * Two things this deliberately does NOT do:
 *
 *  · No focus trap. A real one has to find the tabbable set, handle Tab and Shift+Tab at both
 *    ends, and cope with content that changes while open. Half a trap is worse than none, because
 *    focus escapes to something the user cannot see. `dialogProps` marks the box up so a screen
 *    reader at least announces it correctly.
 *  · No body scroll lock. `overflow: hidden` on body is the usual companion to this, but it
 *    misbehaves in ways that need a real device to see — scroll position jumps on restore, and
 *    address-bar resize on Android. Untestable from here, so untouched. `.modal-content` now has
 *    its own max-height and internal scrolling, which was the actual problem.
 *
 * Pass `active` so the listener exists only while the dialog is on screen — several of these render
 * null when closed, but some stay mounted.
 */
export function useDialog(active: boolean, onClose: () => void) {
  /* onClose is held in a ref so callers can pass an inline arrow — which most of these modals do,
     since their close is a one-liner. Depending on its identity instead would tear down and
     re-add the listener on every single render of the parent, and would quietly push a useCallback
     requirement onto seven call sites where forgetting it is invisible. */
  const closeRef = useRef(onClose);
  // Synced in an effect, not during render: writing a ref while rendering is what
  // react-hooks/refs forbids, and it tears under concurrent rendering.
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();   // one Escape closes one layer, not every open layer at once
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Spread onto the dialog box itself (the .modal-content), never onto the overlay. */
export const dialogProps = { role: 'dialog', 'aria-modal': true } as const;
