/**
 * Send someone to connect their Google Drive, and bring them back where they were.
 *
 * Files live in the user's own Drive now, so "no Drive connected" is not an error condition — it is
 * a step that has not happened yet, and the first time most people meet it will be the moment they
 * try to save something. A red toast saying "Connect your Google Drive" and nothing else is a dead
 * end: it names the fix and refuses to perform it.
 *
 * `to` rides along so the callback can land them back on the locker, or the note, or wherever they
 * were, instead of on the profile page wondering what happened to their upload. The route validates
 * it with `safeReturnTo` — a same-site path only — because it ends up in a redirect.
 *
 * A full document load on purpose: this leaves the app for Google's consent screen, and a client-side
 * navigation cannot.
 *
 * Inside the Android app a document load is not enough. Navigating the WebView to Google means
 * Google sees an embedded user agent and refuses with `disallowed_useragent` — and because Drive is
 * the only file storage there is, that one refusal takes every upload in the app down with it. So
 * the app opens consent in a Chrome Custom Tab instead; see lib/nativeBridge.ts.
 */
export function goConnectDrive(returnTo?: string): void {
  if (typeof window === 'undefined') return;
  const to = returnTo || `${window.location.pathname}${window.location.search}`;

  void (async () => {
    const { startNativeDriveConnect } = await import('@/lib/nativeBridge');
    // Falls back to the in-page redirect on the web, and also if the Custom Tab could not be
    // opened — that shows Google's own refusal, which is at least a visible failure.
    if (await startNativeDriveConnect(to)) return;
    window.location.assign(`/api/drive/connect?to=${encodeURIComponent(to)}`);
  })();
}

/** What the callback appends when it sends someone back, so a page can say how it went. */
export type DriveOutcome = 'connected' | 'denied' | 'noPermission' | 'noRefresh';

export const DRIVE_OUTCOME_MESSAGE: Record<DriveOutcome, { text: string; kind: 'success' | 'error' | 'info' }> = {
  connected: { text: 'Google Drive connected — your files are saved to your own Drive.', kind: 'success' },
  denied: { text: 'Google Drive was not connected, so files cannot be saved yet.', kind: 'info' },
  // The consent screen lets people untick a scope. Without drive.file we hold a token that can do
  // nothing, so say that rather than letting the next upload fail for no visible reason.
  noPermission: { text: 'Drive access was not granted — try again and leave the file permission ticked.', kind: 'error' },
  noRefresh: { text: 'Google did not return a lasting permission. Try connecting once more.', kind: 'error' },
};
