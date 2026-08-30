'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { accountAuthMode, deleteMyAccount } from '@/actions/account';
import { useFeedback } from '@/components/ui/Feedback';

/**
 * The one irreversible thing in Profile. It opens its own dialog rather than the shared confirm()
 * because it needs inputs — the re-auth secret, and the Private Safe PIN when one exists — but it
 * wears the same confirm-overlay/confirm-box skin so it reads as part of the app.
 *
 * Asking for the PIN is the point: the safe is the one thing the account password alone cannot
 * open, so destroying it on the password alone would make the irreversible path easier than the
 * reading path. The server checks both again; this only stops offering what would fail.
 */
export default function DeleteAccountCard() {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [hasPassword, setHasPassword] = useState(true);
  const [email, setEmail] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setSecret(''); setPin('');
    const mode = await accountAuthMode();
    setHasPassword(mode.hasPassword);
    setHasPin(mode.hasPin);
    setEmail(mode.email);
    setOpen(true);
  };

  const submit = async () => {
    if (!secret.trim()) return toast(hasPassword ? 'Enter your password' : 'Type your email to confirm', 'error');
    if (hasPin && !pin.trim()) return toast('Enter your Private Safe PIN', 'error');
    setBusy(true);
    const res = await deleteMyAccount({ password: secret, pin: hasPin ? pin.trim() : undefined });
    setBusy(false);
    if (res?.error) return toast(res.error, 'error');
    // Content is gone; end the session and land on the public page.
    await signOut({ callbackUrl: '/' });
  };

  return (
    <>
      <button onClick={start} className="card" style={{
        display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
        marginTop: '14px', textAlign: 'left', cursor: 'pointer', font: 'inherit',
        color: 'var(--danger-color)', border: '1px solid color-mix(in srgb, var(--danger-color) 25%, transparent)',
      }}>
        <span className="row-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger-color)' }}>
          <Trash2 size={18} strokeWidth={2.2} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Delete my account</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Erase your content. This cannot be undone.
          </span>
        </span>
      </button>

      {open && (
        <div className="confirm-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true"
            style={{ textAlign: 'left', maxWidth: '440px' }}>
            <div className="confirm-icon danger" style={{ margin: '0 0 12px' }}><AlertTriangle size={20} /></div>
            <h3 style={{ textAlign: 'left' }}>Delete your account?</h3>
            <p style={{ textAlign: 'left' }}>
              We erase your links, notes, tasks, meetings and transcripts, documents, contacts and
              private PIN <strong>immediately</strong>. Groups you own are handed to the next owner,
              or deleted if you are the only member.
            </p>
            <p style={{ textAlign: 'left', marginTop: '8px' }}>
              We keep only your <strong>name and email</strong> for up to 90 days for our
              records, then erase those too.
            </p>

            

            <label style={{ display: 'block', marginTop: '10px', fontSize: '0.82rem', fontWeight: 700 }}>
              {hasPassword ? 'Confirm your password' : 'Type your email to confirm'}
              <input value={secret} onChange={e => setSecret(e.target.value)}
                type={hasPassword ? 'password' : 'email'}
                placeholder={hasPassword ? 'Your account password' : email}
                autoComplete={hasPassword ? 'current-password' : 'email'}
                className="input" style={inputStyle} />
            </label>

            {/* Only when a safe exists. Asking everyone for a PIN most of them never set would be
                a wall in front of the one screen that must not be confusing. */}
            {hasPin && (
              <label style={{ display: 'block', marginTop: '10px', fontSize: '0.82rem', fontWeight: 700 }}>
                Your Private Safe PIN
                <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  type="password" inputMode="numeric" autoComplete="off" placeholder="4-digit PIN"
                  className="input" style={inputStyle} />
                <span style={{ display: 'block', marginTop: '4px', fontWeight: 600, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Everything in your safe is deleted too, so we ask for the PIN that opens it.
                </span>
              </label>
            )}

            <div className="confirm-actions" style={{ marginTop: '16px' }}>
              <button className="confirm-cancel" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="confirm-ok danger" onClick={submit} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: '6px', padding: '10px 12px', borderRadius: '10px',
  border: '1px solid var(--border-color)', background: 'var(--surface-2, var(--bg-secondary))',
  color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 500,
};
