'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import AuthField from '@/components/auth/AuthField';
import GoogleButton from '@/components/auth/GoogleButton';
import AuthShell from '@/components/auth/AuthShell';
import { validateEmail } from '@/lib/validation';
import { authProviders } from '@/actions/auth';

function SigninInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState(params.get('error') ? 'Please sign in to continue.' : '');
  const message = params.get('message') || '';
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => { authProviders().then(p => setGoogle(p.google)); }, []);

  const check = () => ({
    email: validateEmail(email),
    password: !password ? 'Please enter your password' : '',
  });
  const blur = (f: string) => { setTouched(t => ({ ...t, [f]: true })); setErrors(check()); };
  const err = (f: string) => (touched[f] ? errors[f] : '') || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const next = check();
    setErrors(next);
    setTouched({ email: true, password: true });
    if (Object.values(next).some(Boolean)) return;

    setLoading(true);
    const res = await signIn('credentials', { email: email.trim(), password, redirect: false });
    setLoading(false);
    if (res?.error) setFormError('Incorrect email or password. Please try again.');
    else { router.push(params.get('callbackUrl') || '/'); router.refresh(); }
  };

  return (
    <AuthShell title="Welcome back" sub="Sign in to your vault.">

        {message && <div className="auth-banner success"><CheckCircle2 size={16} /> {message}</div>}
        {formError && <div className="auth-banner error"><AlertCircle size={16} /> {formError}</div>}

        {google && <GoogleButton label="Continue with Google" />}

        <form onSubmit={handleSubmit} noValidate>
          <AuthField label="Email" type="email" value={email} onChange={setEmail} onBlur={() => blur('email')} error={err('email')} placeholder="you@example.com" autoComplete="email" autoFocus />
          <AuthField label="Password" type="password" value={password} onChange={setPassword} onBlur={() => blur('password')} error={err('password')} placeholder="••••••••" autoComplete="current-password"
            right={<Link href="/auth/forgot-password" className="auth-link-sm">Forgot?</Link>} />
          <button type="submit" className="btn-primary auth-submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <p className="auth-foot">New here? <Link href="/auth/signup">Create an account</Link></p>
    </AuthShell>
  );
}

export default function SigninPage() {
  return <Suspense fallback={null}><SigninInner /></Suspense>;
}
