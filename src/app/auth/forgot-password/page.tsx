'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Check } from 'lucide-react';
import { forgotPassword, resetPasswordWithOtp } from '@/actions/auth';
import AuthField from '@/components/auth/AuthField';
import OtpInput from '@/components/auth/OtpInput';
import AuthShell from '@/components/auth/AuthShell';
import { PASSWORD_RULES, validateEmail, validatePassword } from '@/lib/validation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [devCode, setDevCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!seconds) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const sendCode = async (resend = false) => {
    const v = validateEmail(email);
    setErrors(e => ({ ...e, email: v }));
    if (v) return;
    setLoading(true);
    const res = await forgotPassword(email.trim());
    setLoading(false);
    if (res.success) {
      setStep('code');
      setSeconds(45);
      setDevCode((res as any).code || '');
      setBanner(resend ? 'New code sent.' : res.message || 'Code sent.');
      setErrors({});
    } else setErrors({ email: res.error || 'Could not send the code.' });
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {
      code: /^\d{6}$/.test(code) ? '' : 'Enter the 6-digit code',
      password: validatePassword(password),
      confirm: confirm !== password ? 'Passwords do not match' : '',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setLoading(true);
    const res = await resetPasswordWithOtp(email.trim(), code, password);
    setLoading(false);
    if (res.success) router.push('/auth/signin?message=Password updated. Please sign in.');
    else setErrors({ [res.field || 'code']: res.error || 'Could not reset your password.' });
  };

  return (
    <AuthShell
      title={step === 'email' ? 'Forgot password?' : 'Enter the code'}
      sub={step === 'email' ? 'We’ll email you a 6-digit code.' : <>Sent to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong> · expires in 10 minutes.</>}
    >
        {step === 'email' ? (
          <>
            <form onSubmit={e => { e.preventDefault(); sendCode(); }} noValidate>
              <AuthField label="Email" type="email" value={email} onChange={v => { setEmail(v); setErrors({}); }} error={errors.email} placeholder="you@example.com" autoComplete="email" autoFocus />
              <button type="submit" className="btn-primary auth-submit" disabled={loading}>{loading ? 'Sending…' : 'Send code'}</button>
            </form>
          </>
        ) : (
          <>
            {banner && <div className="auth-banner success"><CheckCircle2 size={16} /> {banner}</div>}
            {devCode && <div className="auth-banner success" style={{ letterSpacing: '0.2em', fontWeight: 800 }}>{devCode}</div>}

            <form onSubmit={submitReset} noValidate>
              <div className="auth-field">
                <div className="auth-label-row"><label>6-digit code</label></div>
                <OtpInput value={code} onChange={v => { setCode(v); setErrors(e => ({ ...e, code: '' })); }} invalid={!!errors.code} />
                {errors.code && <span className="auth-field-error"><AlertCircle size={12} style={{ verticalAlign: '-2px' }} /> {errors.code}</span>}
              </div>

              <AuthField label="New password" type="password" value={password} onChange={setPassword} error={errors.password} placeholder="••••••••" autoComplete="new-password" />
              {password && (
                <ul className="pw-rules">
                  {PASSWORD_RULES.map(r => { const ok = r.test(password); return <li key={r.label} className={ok ? 'ok' : ''}>{ok ? <Check size={12} /> : <span className="dot" />}{r.label}</li>; })}
                </ul>
              )}
              <AuthField label="Confirm password" type="password" value={confirm} onChange={setConfirm} error={errors.confirm} placeholder="••••••••" autoComplete="new-password" />

              <button type="submit" className="btn-primary auth-submit" disabled={loading}>{loading ? 'Updating…' : 'Reset password'}</button>
            </form>

            <p className="auth-foot">
              {seconds > 0
                ? <span style={{ color: 'var(--text-tertiary)' }}>Resend code in {seconds}s</span>
                : <button className="subtle-link" onClick={() => sendCode(true)} disabled={loading}>Resend code</button>}
              {' · '}
              <button className="subtle-link" onClick={() => { setStep('email'); setCode(''); setBanner(''); setErrors({}); }}>Change email</button>
            </p>
          </>
        )}

        <p className="auth-foot"><Link href="/auth/signin">Back to sign in</Link></p>
    </AuthShell>
  );
}
