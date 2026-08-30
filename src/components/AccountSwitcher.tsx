'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Check, ChevronDown, Plus, LogOut, Users, X, Loader2 } from 'lucide-react';
import {
  listAccounts, switchAccount, beginAddAccount, removeAccount, signOutActive, signOutAll,
  type AccountRow,
} from '@/actions/accounts';
import { MAX_ACCOUNTS } from '@/lib/accountLocker';
import { initialFor } from '@/lib/avatar';
import { finishIdentityChange } from '@/lib/clientIdentityReset';
import { useFeedback } from '@/components/ui/Feedback';

/**
 * Who you are, and every way of changing that — in one bottom sheet opened by tapping the profile
 * header. The header IS the trigger: an avatar with your name and address under it is already the
 * thing a person reaches for when they want to be somebody else, and the chevron says so.
 *
 * A sheet, not a centred box: on the phone this is a thumb control, and everything in it — switch,
 * add, remove, log out — is a one-tap answer to "not this account". TopNav's avatars keep pushing
 * to /profile untouched; hijacking a primary nav tap breaks the nav model.
 *
 * Log out lives here rather than on the page. It is the same question the rest of the sheet
 * answers, and a full-width "Log out" bar sitting an inch above "Delete my account" was a mis-tap
 * waiting to happen.
 *
 * Controlled, because the page owns `open` — the header is the only way in today, but the state
 * belongs with the screen rather than with this component.
 */
export default function AccountSwitcher({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: session, status } = useSession();
  const { confirm, toast } = useFeedback();
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const user = session?.user;

  /**
   * listAccounts MUTATES cookies (it drops dead and duplicate slots), so it can only be called
   * from an event handler — `cookies().delete()` throws during a server render. An effect on the
   * client is a POST to the action, not a render, which is why this is legal here.
   */
  const load = useCallback(() => {
    listAccounts()
      .then(r => { setRows(r.rows); setFull(r.full); })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { if (open && status === 'authenticated') load(); }, [open, status, load]);

  // Escape closes, and the sheet takes focus when it opens so the keyboard lands inside it rather
  // than back at the top of a page the user can no longer see.
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onOpenChange(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onOpenChange]);

  const onPick = async (row: AccountRow) => {
    if (row.active || row.slot === null || busy) return;
    setBusy(true);
    const res = await switchAccount(row.slot);
    if (res.success) return finishIdentityChange('/');   // full document load, never router.push
    setBusy(false);
    if (res.error === 'expired') {
      // The slot is already dropped server-side. Send them somewhere useful rather than telling
      // them off — the address is prefilled so signing back in is one password away.
      return finishIdentityChange(`/auth/signin?email=${encodeURIComponent(res.email)}`);
    }
    toast(res.error === 'deleted' ? 'That account was deleted' : 'That account is no longer on this device', 'error');
    load();
  };

  const onAdd = async () => {
    if (busy) return;
    setBusy(true);
    const res = await beginAddAccount();
    if (!res.success) { setBusy(false); return toast(res.error, 'error'); }
    // `back` is what makes an abandoned sign-in recoverable: the user is now signed out with
    // their real account sitting in the locker, and the sign-in page offers it back.
    finishIdentityChange(`/auth/signin?add=1&back=${res.slot}`);
  };

  const onRemove = async (row: AccountRow) => {
    if (row.slot === null || busy) return;
    const ok = await confirm({
      title: 'Remove from this device?',
      // Accurate on purpose: under the JWT strategy there is no server session to revoke, so
      // this is not a sign-out and must not claim to be one.
      message: `${row.email} will be taken off this device. It does not sign that account out anywhere else.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setBusy(true);
    await removeAccount(row.slot);
    setBusy(false);
    load();
    toast('Removed from this device', 'success');
  };

  /**
   * Logging out no longer always lands on an empty app: with another account on the device it
   * lands IN that account. Naming it in the confirm is the whole point — someone who taps Log
   * out expecting a signed-out screen and finds a colleague's tasks has been badly surprised by
   * their own device. Asked before the act, because a toast afterwards dies with the document.
   */
  const onLogOut = async () => {
    if (busy) return;
    const { rows: fresh } = await listAccounts();
    const next = fresh.find(r => !r.active && r.state === 'live');
    const ok = await confirm({
      title: 'Log out?',
      message: next
        ? `Log out of ${user?.email}? You'll switch to ${next.email}, which stays signed in on this device.`
        : 'You can sign back in anytime.',
      confirmLabel: 'Log out',
    });
    if (!ok) return;
    setBusy(true);
    await signOutActive();
    await finishIdentityChange('/');
  };

  const onSignOutAll = async () => {
    if (busy) return;
    const ok = await confirm({
      title: 'Sign out of all accounts?',
      message: 'Every account is removed from this device. You can sign back in anytime.',
      confirmLabel: 'Sign out of all',
    });
    if (!ok) return;
    setBusy(true);
    await signOutAll();
    finishIdentityChange('/');
  };

  return (
    <>
      <button className="profile-id" onClick={() => onOpenChange(true)} aria-haspopup="dialog" aria-expanded={open}>
        <span className="user-avatar-large" style={{ width: '86px', height: '86px', fontSize: '2.1rem', marginBottom: '14px' }}>
          {initialFor(user?.name, user?.email)}
        </span>
        <span className="profile-id-name">{user?.name || 'You'}</span>
        <span className="profile-id-mail">{user?.email}</span>
      </button>

      {open && (
        <div className="sheet-overlay" onClick={() => !busy && onOpenChange(false)}>
          <div
            ref={sheetRef}
            className="sheet"
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Your accounts"
            onClick={e => e.stopPropagation()}
          >
            <div className="sheet-grip" aria-hidden="true" />

            <div className="sheet-head">
              <h2>Your accounts</h2>
              <button className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Close" disabled={busy}>
                <X size={16} />
              </button>
            </div>

            {rows === null ? (
              <p style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '56px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                <Loader2 size={14} /> Reading this device…
              </p>
            ) : (
              <div className="acct-list">
                {rows.map(row => (
                  <div className="acct-row" key={row.slot === null ? 'active' : row.slot}>
                    <button
                      className={`acct-pick ${row.active ? 'on' : ''}`}
                      onClick={() => onPick(row)}
                      disabled={busy || row.active}
                    >
                      <span className="avatar-xs acct-av">{initialFor(row.name, row.email)}</span>
                      <span className="acct-lines">
                        <span className="acct-name">{row.name || row.email || 'Signed-out account'}</span>
                        {row.state === 'expired' ? (
                          <>
                            <span className="acct-sub">{row.email}</span>
                            <span className="acct-sub wake">Signed out — tap to sign in</span>
                          </>
                        ) : !row.emailVerified ? (
                          // Second line of defence for the worst confusion this feature can
                          // cause: an unverified account sees a silently empty app.
                          <span className="acct-sub">{row.email} — email not confirmed</span>
                        ) : (
                          <span className="acct-sub">{row.email}</span>
                        )}
                      </span>
                      {row.active && <Check size={17} style={{ flexShrink: 0, color: 'var(--success-color)' }} />}
                    </button>
                    {!row.active && (
                      <button className="acct-remove" onClick={() => onRemove(row)} disabled={busy}
                        aria-label={`Remove ${row.email || 'this account'} from this device`}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="sheet-actions">
              <button className="sheet-act add" onClick={onAdd} disabled={busy || full}>
                <Plus size={17} />
                <span>
                  Add account
                  {full && <small>You can keep {MAX_ACCOUNTS} accounts on this device. Remove one first.</small>}
                </span>
              </button>

              <button className="sheet-act danger" onClick={onLogOut} disabled={busy}>
                <LogOut size={17} /> <span>Log out</span>
              </button>

              {/* Only when it means something different from Log out. With one account on the
                  device the two buttons do exactly the same thing, and offering the same outcome
                  twice in red reads as a choice with a consequence you have not understood. */}
              {(rows?.length ?? 0) > 1 && (
                <button className="sheet-act danger" onClick={onSignOutAll} disabled={busy}>
                  <Users size={17} /> <span>Sign out of all accounts</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
