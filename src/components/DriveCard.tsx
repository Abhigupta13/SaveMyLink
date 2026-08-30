'use client';

import { useEffect, useState } from 'react';
import { driveStatus, disconnectDrive } from '@/actions/drive';
import { useFeedback } from '@/components/ui/Feedback';
import '@/styles/guide.css';

/**
 * The Drive connection, as a person sees it: not connected, connected as someone, or needs
 * reconnecting.
 *
 * Same shape as SarvamKeyCard, and the same rule underneath: none of the security lives here. This
 * component never sees the sealed refresh token — `driveStatus` selects the display fields by name
 * — and it cannot start a connection either, because consent is a redirect to Google. Hence a plain
 * link to /api/drive/connect rather than an action: the browser has to leave.
 *
 * Wrapped in .guide because every g- class is scoped under it and /profile is not a guide page.
 */

const bytes = (n?: number) => {
  if (!Number.isFinite(n)) return '';
  const gb = (n as number) / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round((n as number) / 1024 ** 2)} MB`;
};

export default function DriveCard({ returnTo = '/profile' }: { returnTo?: string }) {
  const { toast, confirm } = useFeedback();
  const [state, setState] = useState<{ connected: boolean; email: string; revoked: boolean } | null>(null);
  const [quota, setQuota] = useState<{ limit?: number; usage?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    driveStatus().then(r => {
      if (!r.success) return;
      setState({ connected: r.connected, email: r.email, revoked: r.revoked });
      setQuota(r.quota || null);
    }).catch(() => {});
  }, []);

  const disconnect = async () => {
    if (!(await confirm({
      title: 'Disconnect Google Drive?',
      message: 'Files already in your Drive stay exactly where they are — nothing is deleted. '
             + 'You will not be able to upload anything new until you connect a Drive again.',
      danger: true,
      confirmLabel: 'Disconnect',
    }))) return;
    setBusy(true);
    const res = await disconnectDrive();
    setBusy(false);
    if (!res.success) { toast(res.error || 'Something went wrong', 'error'); return; }
    setState({ connected: false, email: '', revoked: false });
    setQuota(null);
    toast('Drive disconnected — your files are still in Drive', 'success');
  };

  const connect = `/api/drive/connect?to=${encodeURIComponent(returnTo)}`;
  // .g-btn was written for <button>; an inline <a> ignores its min-height and keeps the underline
  const asButton = { display: 'inline-flex', alignItems: 'center', textDecoration: 'none' } as const;
  const used = quota && Number.isFinite(quota.usage) && Number.isFinite(quota.limit)
    ? `${bytes(quota.usage)} of ${bytes(quota.limit)} used`
    : '';

  return (
    <div className="guide">
      <div className="g-key">
        <p className="g-key-state">
          {state === null ? 'Checking your Drive…'
            : state.revoked ? <>Reconnect needed <span className="g-chip">access was withdrawn</span></>
            : state.connected ? <>Connected as <span className="g-chip accent"><code>{state.email || 'your Google account'}</code></span></>
            : <>No Drive connected yet</>}
        </p>

        <p style={{ marginTop: '8px', fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          {state?.revoked
            ? 'Google is no longer letting us add files to this Drive — usually because access was removed from your Google account settings. Reconnect to upload again. Nothing already saved has been lost.'
            : state?.connected
            ? <>Files you upload go into <code>ALL-YOU-NEED</code> in this Drive, in your own account. {used}</>
            : 'Uploads need a Drive. Your files live in your own Google account, in a folder called ALL-YOU-NEED — not on our servers.'}
        </p>

        <div className="g-key-row">
          {state?.connected && !state.revoked ? (
            <>
              <a href={connect} className="g-btn" style={asButton}>Use a different Drive</a>
              <button onClick={disconnect} disabled={busy} className="g-btn danger">
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </>
          ) : (
            <a href={connect} className="g-btn primary" style={asButton}>
              {state?.revoked ? 'Reconnect Drive' : 'Connect Google Drive'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
