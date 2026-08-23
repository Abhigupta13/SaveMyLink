'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, AlertCircle } from 'lucide-react';
import { registerUser, authProviders } from '@/actions/auth';
import AuthField from '@/components/auth/AuthField';
import GoogleButton from '@/components/auth/GoogleButton';
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
  useEffect(() => { authProviders().then(p => setGoogle(p.google)); }, []);

  const check = () => ({
    name: validateName(name),
    email: validateEmail(email),
    password: validatePassword(password),
    confirm: confirm !== password ? 'Passwords do not match' : '',
  });

  const blur = (field: string) => {
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
    if (res.success) router.push('/auth/signin?message=Account created. Please sign in.');
    else if (res.field) { setErrors(e => ({ ...e, [res.field!]: res.error! })); setTouched(t => ({ ...t, [res.field!]: true })); }
    else setFormError(res.error || 'Could not create your account. Please try again.');
  };

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <h1 className="auth-h1">Create your vault</h1>
        <p className="auth-sub">
          {invitedEmail
            ? 'Finish signing up and the project you were invited to will be waiting.'
            : 'Links, notes, tasks and meetings — all in one place.'}
        </p>

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
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary, or the whole route opts out of static rendering
export default function SignupPage() {
  return (
    <Suspense fallback={<div className="auth-wrap"><div className="auth-box"><div className="loading-spinner" /></div></div>}>
      <SignupForm />
    </Suspense>
  );
}
