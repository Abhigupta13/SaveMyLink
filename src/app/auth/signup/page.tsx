'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, AlertCircle, CheckCircle2 } from 'lucide-react';
import { registerUser, verifyEmail, resendVerification, authProviders } from '@/actions/auth';
import AuthField from '@/components/auth/AuthField';
import GoogleButton from '@/components/auth/GoogleButton';
import OtpInput from '@/components/auth/OtpInput';
import AuthShell from '@/components/auth/AuthShell';
import { PASSWORD_RULES, validateName, validateEmail, validatePassword } from '@/lib/validation';

function SignupForm() {
  const router = useRouter();
  // A project invite carries the address it was sent to. It has to match for memberEmails to
  // let them in, so prefill it rather than asking them to retype it exactly.
  const invitedEmail = (useSearchParams().get('email') || '').trim().toLowerCase();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  // Second step rather than a second page: a half-finished signup that survives a refresh would
  // need the password kept somewhere, and the account already exists by the time the code is sent.
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [banner, setBanner] = useState('');
  const [devCode, setDevCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { authProviders().then(p => setGoogle(p.google)); }, []);
  useEffect(() => {
    if (!seconds) return;
    const t = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const check = () => ({
    name: validateName(name),
    email: validateEmail(email),
    password: validatePassword(password),
    confirm: confirm !== password ? 'Passwords do not match' : '',
  });

  /* Same rule as sign-in: an empty field you are leaving is not a mistake yet, or clicking
     "Sign up with Google" answers with "Please enter your name" while the redirect is running.
     A filled field is still checked on the way out. */
  const blur = (field: string) => {
    const value = ({ name, email, password, confirm } as Record<string, string>)[field] ?? '';
    if (!value) { setTouched(t => ({ ...t, [field]: false })); return; }
    setTouched(t => ({ ...t, [field]: true }));
    setErrors(check());
  };
  const err = (field: string) => (touched[field] ? errors[field] : '') || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const next = check();
    setErrors(next);
    setTouched({ name: true, email: true, password: true, confirm: true });
    if (Object.values(next).some(Boolean)) return;

    setLoading(true);
    const res = await registerUser({ name, email, password });
    setLoading(false);
    if ('success' in res) {
      setStep('code');
      setSeconds(45);
      setDevCode(('code' in res && res.code) || '');
      setBanner(res.message || 'Check your email for the 6-digit code.');
      setErrors({});
    } else if (res.field) { setErrors(e => ({ ...e, [res.field!]: res.error! })); setTouched(t => ({ ...t, [res.field!]: true })); }
    else setFormError(res.error || 'Could not create your account. Please try again.');
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setErrors({ code: 'Enter the 6-digit code' });
    setLoading(true);
    const res = await verifyEmail(email.trim(), code);
    setLoading(false);
    if ('success' in res) router.push('/auth/signin?message=Email confirmed. Please sign in.');
    else setErrors({ [res.field || 'code']: res.error || 'Could not confirm your email.' });
  };

  const resend = async () => {
    setLoading(true);
    const res = await resendVerification(email.trim());
    setLoading(false);
    if ('error' in res && res.error) return setErrors({ code: res.error });
    setSeconds(45);
    setDevCode(('code' in res && res.code) || '');
    setBanner(('message' in res && res.message) || 'New code sent.');
    setErrors({});
  };

  if (step === 'code') return (
    <AuthShell title="Confirm your email" sub={<>We sent a 6-digit code to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong> · expires in 10 minutes.</>}>

        {banner && <div className="auth-banner success"><CheckCircle2 size={16} /> {banner}</div>}
        {devCode && <div className="auth-banner success" style={{ letterSpacing: '0.2em', fontWeight: 800 }}>{devCode}</div>}

        <form onSubmit={submitCode} noValidate>
          <div className="auth-field">
            <div className="auth-label-row"><label>6-digit code</label></div>
            <OtpInput value={code} onChange={v => { setCode(v); setErrors({}); }} invalid={!!errors.code} />
            {errors.code && <span className="auth-field-error"><AlertCircle size={12} style={{ verticalAlign: '-2px' }} /> {errors.code}</span>}
          </div>
          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? 'Confirming…' : 'Confirm email'}
          </button>
        </form>

        <p className="auth-foot">
          {seconds > 0
            ? <span style={{ color: 'var(--text-tertiary)' }}>Resend code in {seconds}s</span>
            : <button className="subtle-link" onClick={resend} disabled={loading}>Resend code</button>}
          {' · '}
          <button className="subtle-link" onClick={() => { setStep('form'); setCode(''); setBanner(''); setErrors({}); }}>Use a different email</button>
        </p>
    </AuthShell>
  );

  return (
    <AuthShell title="Create your vault" sub={invitedEmail
      ? 'Finish signing up and the project you were invited to will be waiting.'
      : 'Links, notes, tasks and meetings — for work and for everything else.'}>

        {formError && <div className="auth-banner error"><AlertCircle size={16} /> {formError}</div>}

        {google && <GoogleButton label="Sign up with Google" />}

        <form onSubmit={handleSubmit} noValidate>
          <AuthField label="Name" value={name} onChange={setName} onBlur={() => blur('name')} error={err('name')} placeholder="Your name" autoComplete="name" autoFocus />
          <AuthField label="Email" type="email" value={email} onChange={setEmail} onBlur={() => blur('email')} error={err('email')} placeholder="you@example.com" autoComplete="email" />
          <AuthField label="Password" type="password" value={password} onChange={setPassword} onBlur={() => blur('password')} error={err('password')} placeholder="••••••••" autoComplete="new-password" />

          {password && (
            <ul className="pw-rules">
              {PASSWORD_RULES.map(r => {
                const ok = r.test(password);
                return <li key={r.label} className={ok ? 'ok' : ''}>{ok ? <Check size={12} /> : <span className="dot" />}{r.label}</li>;
              })}
            </ul>
          )}

          <AuthField label="Confirm password" type="password" value={confirm} onChange={setConfirm} onBlur={() => blur('confirm')} error={err('confirm')} placeholder="••••••••" autoComplete="new-password" />

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-foot">Already have an account? <Link href="/auth/signin">Sign in</Link></p>
        <p className="auth-foot" style={{ fontSize: '0.72rem' }}>
          By creating an account you agree to our <Link href="/terms">Terms &amp; how your data is handled</Link>.
        </p>
    </AuthShell>
  );
}

// useSearchParams needs a Suspense boundary, or the whole route opts out of static rendering
export default function SignupPage() {
  return (
    <Suspense fallback={<AuthShell title="Create your vault"><div className="loading-spinner" /></AuthShell>}>
      <SignupForm />
    </Suspense>
  );
}
