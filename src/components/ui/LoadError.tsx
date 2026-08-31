'use client';

/**
 * What a screen shows when the load FAILED, as opposed to when there is nothing to show.
 *
 * These two states looked identical everywhere before this component existed. Seven pages ran
 * `if (res.success) setRows(...)` with no else, so a failed action left the list at its initial []
 * and the page rendered its empty state — "No notes yet", "Your Digi Locker is empty", "Nothing
 * here yet". A user whose network dropped, or whose session expired, was told their data was gone.
 * That is the worst possible lie for an app whose whole promise is that it keeps your things.
 *
 * So: an empty state means empty, and this means broken. It offers the one action that can help,
 * because a transient failure is the common case and a reload is what the user would do anyway.
 *
 * `role="alert"` rather than Loading's `role="status"` — this one interrupts, it does not narrate.
 */
export default function LoadError({
  what = 'this', onRetry, className = '',
}: { what?: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={`load-error ${className}`.trim()} role="alert">
      <p className="load-error-title">Could not load {what}.</p>
      <p className="load-error-hint">Check your connection — nothing has been lost.</p>
      {onRetry && (
        <button type="button" className="btn-primary load-error-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
