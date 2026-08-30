'use client';

import { useEffect, useState } from 'react';
import { HardDrive, ChevronDown } from 'lucide-react';
import { driveStatus, disconnectDrive } from '@/actions/drive';
import { useFeedback } from '@/components/ui/Feedback';
import '@/styles/guide.css';

/**
 * The Drive connection, as a person sees it: not connected, connected as someone, or needs
 * reconnecting.
 *
 * One row in the Data security group, expanding in place. Collapsed it carries the two facts you
 * actually scan for — which account, and how much room is left; expanded it explains itself and
 * offers the two controls. "Disconnect" is destructive and lives ONLY in the expanded state: a
 * permanently visible Disconnect in a list people scroll past is a mis-tap looking for a thumb.
 * In place rather than in a sheet, because someone whose upload just failed has to be able to see
 * why and fix it without leaving the screen they are on.
 *
 * Same rule underneath as before: none of the security lives here. This component never sees the
 * sealed refresh token — `driveStatus` selects the display fields by name — and it cannot start a
 * connection either, because consent is a redirect to Google. Hence a plain link to
 * /api/drive/connect rather than an action: the browser has to leave.
 *
 * The buttons stay wrapped in .guide because every g- class is scoped under it.
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
  const [open, setOpen] = useState(false);

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
    ? `${bytes(quota.usage)} of ${bytes(quota.limit)}`
    : '';

  // The collapsed line. Never longer than it has to be — it is scanned, not read.
  const summary = state === null ? 'Checking your Drive…'
    : state.revoked ? 'Reconnect needed — access was withdrawn'
    : state.connected ? [state.email || 'your Google account', used].filter(Boolean).join(' · ')
    : 'No Drive connected — uploads need one';

  return (
    <>
      <button className="set-row" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="row-icon"><HardDrive size={18} strokeWidth={2.2} /></span>
        <span className="set-row-text">
          <span className="set-row-title">Where your files are kept</span>
          <span className="set-row-sub">{summary}</span>
        </span>
        <ChevronDown className={`set-row-go set-caret ${open ? 'open' : ''}`} size={18} />
      </button>

      {open && (
        <div className="set-row stack set-detail">
          <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            {state?.revoked
              ? 'Google is no longer letting us add files to this Drive — usually because access was removed from your Google account settings. Reconnect to upload again. Nothing already saved has been lost.'
              : state?.connected
              ? <>Files you upload go into <code>ALL-YOU-NEED</code> in this Drive, in your own account. Nothing is stored on our servers.</>
              : 'Uploads need a Drive. Your files live in your own Google account, in a folder called ALL-YOU-NEED — not on our servers.'}
          </p>

          <div className="guide">
            <div className="g-key-row" style={{ marginTop: 0 }}>
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
      )}
    </>
  );
}
