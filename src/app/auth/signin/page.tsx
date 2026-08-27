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
  // next-auth bounces a failed provider sign-in back here with ?error=<code>. Saying only
  // "please sign in" for every code hid the fact that Google had failed at all, and left the
  // founder hunting a password problem that never existed.
  const errParam = params.get('error');
  const [formError, setFormError] = useState(
    !errParam ? ''
      : errParam === 'SessionRequired' ? 'Please sign in to continue.'
      : errParam === 'OAuthAccountNotLinked' ? 'That email already has a password. Sign in with it below.'
      : errParam === 'AccessDenied' ? 'Google sign-in was refused for that account.'
      : `Google sign-in did not complete (${errParam}). Try again, or use your email and password.`
  );
  const message = params.get('message') || '';
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => { authProviders().then(p => setGoogle(p.google)); }, []);

  const check = () => ({
    email: validateEmail(email),
    password: !password ? 'Please enter your password' : '',
  });
  /* Leaving a field you never filled is not a mistake yet. The email box is autofocused, so
     clicking "Continue with Google" blurs it and used to answer with "Please enter your email"
     while the redirect was already running. An empty field stays quiet until submit; a filled one
     is still checked on the way out, which is where format mistakes want catching. */
  const blur = (f: string) => {
    const value = f === 'email' ? email : password;
    if (!value) { setTouched(t => ({ ...t, [f]: false })); return; }
    setTouched(t => ({ ...t, [f]: true }));
    setErrors(check());
  };
  const err = (f: string) => (touched[f] ? errors[f] : '') || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const next = check();
    setErrors(next);
    setTouched({ email: true, password: true });
    if (Object.values(next).some(Boolean)) return;

    setLoading(true);
    // callbackUrl is passed explicitly on purpose. Left out, next-auth defaults it to the CURRENT
    // url — and after a failed Google attempt that url still carries ?error=OAuthCallback, which
    // next-auth then reads back out of its own SUCCESS response. The sign-in worked, the cookie
    // was set, and the page still said the password was wrong.
    const target = params.get('callbackUrl') || '/';
    const res = await signIn('credentials', { email: email.trim(), password, redirect: false, callbackUrl: target });
    setLoading(false);
    // Only next-auth's credentials rejection means the password was wrong. Anything else is our
    // problem, not theirs, and saying "incorrect password" for it sends people hunting a password
    // that was never the issue.
    if (res?.error) {
      setFormError(res.error === 'CredentialsSignin'
        ? 'Incorrect email or password. Please try again.'
        : 'Something went wrong signing you in. Please try again.');
    } else { router.push(target); router.refresh(); }
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
