/** Android share-sheet → Links add flow (session survives sign-in). */

export const PENDING_SHARE_KEY = 'pendingShareIntent';
export const SHARE_FLOW_KEY = 'shareIntentFlow';

export type PendingShare = { url: string; title?: string };

export function stashPendingShare(p: PendingShare) {
  try {
    sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(p));
  } catch { /* private mode */ }
}

export function takePendingShare(): PendingShare | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SHARE_KEY);
    sessionStorage.removeItem(PENDING_SHARE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingShare;
  } catch {
    return null;
  }
}

export function markShareFlow() {
  try {
    sessionStorage.setItem(SHARE_FLOW_KEY, '1');
  } catch { /* ignore */ }
}

export function consumeShareFlow(): boolean {
  try {
    const v = sessionStorage.getItem(SHARE_FLOW_KEY);
    sessionStorage.removeItem(SHARE_FLOW_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export function linksAddParams(url: string | null, title: string): string {
  const params = new URLSearchParams();
  params.set('add', '1');
  if (url) params.set('url', url);
  if (title && title !== url) params.set('title', title.slice(0, 300));
  return params.toString();
}
