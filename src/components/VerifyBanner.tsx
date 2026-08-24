'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { MailWarning, X } from 'lucide-react';
import { verificationStatus, resendVerification, verifyEmail } from '@/actions/auth';
import OtpInput from '@/components/auth/OtpInput';

/**
 * Why an invited project is not showing up. Membership is granted by email string, so shared work
 * stays hidden until the address is confirmed (see lib/projectAccess) — without this the app would
 * just look broken to the one person we most need to keep: someone's teammate on day one.
 *
 * The whole flow lives in the banner rather than on a page of its own: the account already exists,
 * so there is nothing to carry between screens, and one fewer route is one fewer thing to explain.
 */
export default function VerifyBanner() {
  const { data: session, status } = useSession();
  const email = session?.user?.email || '';
  const [state, setState] = useState<{ verified: boolean; invited: boolean } | null>(null);
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // `state` starts null and nothing renders until the check resolves, so the banner never flashes
  // in and back out — and there is no synchronous setState in the effect body to cascade renders.
  useEffect(() => {
    if (status !== 'authenticated' || !email) return;
    let cancelled = false;
    (async () => {
      try { if (sessionStorage.getItem('verifyBannerDismissed')) return; } catch { /* private mode */ }
      const res = await verificationStatus(email).catch(() => null);
      if (res && !cancelled) setState(res);
    })();
    return () => { cancelled = true; };
  }, [status, email]);

  if (dismissed || !state || state.verified) return null;

  const send = async () => {
    setBusy(true);
    const res = await resendVerification(email);
    setBusy(false);
    if ('error' in res && res.error) return setError(res.error);
    setStep('code');
    setError('');
    setNote(('code' in res && res.code) ? `Email is not configured — your code is ${res.code}` : `Code sent to ${email}.`);
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code');
    setBusy(true);
    const res = await verifyEmail(email, code);
    setBusy(false);
    if ('success' in res) { setState({ verified: true, invited: false }); window.location.reload(); return; }
    setError(res.error || 'Could not confirm your email.');
  };

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem('verifyBannerDismissed', '1'); } catch { /* private mode */ }
  };

  return (
    <div className="verify-banner">
      <span className="verify-banner-icon"><MailWarning size={18} /></span>

      <div className="verify-banner-body">
        <strong>
          {state.invited
            ? 'Confirm your email to see the project you were added to'
            : 'Confirm your email address'}
        </strong>
        <span>
          {state.invited
            ? `Someone shared work with ${email}. We keep it hidden until we know the address is yours.`
            : `We'll send a 6-digit code to ${email}. Until then, anything shared with you stays hidden.`}
        </span>

        {step === 'code' && (
          <div className="verify-banner-code">
            <OtpInput value={code} onChange={v => { setCode(v); setError(''); }} invalid={!!error} />
            <button className="btn-primary" onClick={confirm} disabled={busy}>{busy ? 'Confirming…' : 'Confirm'}</button>
          </div>
        )}

        {note && !error && <span className="verify-banner-note">{note}</span>}
        {error && <span className="verify-banner-error">{error}</span>}
      </div>

      {step === 'idle' && (
        <button className="btn-primary verify-banner-cta" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send me a code'}
        </button>
      )}
      <button className="icon-btn" onClick={dismiss} title="Hide until next time" aria-label="Hide"><X size={16} /></button>
    </div>
  );
}
