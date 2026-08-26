'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  right?: React.ReactNode;
}

export default function AuthField({ label, type = 'text', value, onChange, onBlur, error, placeholder, autoFocus, autoComplete, right }: Props) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  const ref = useRef<HTMLInputElement>(null);

  /* Autofill does not tell React.
     Chrome and password managers write input.value straight into the DOM without firing the event
     React listens for, so the box looks full while our state is still empty — and validation then
     says "Please enter your email" under a visibly filled field, and submit refuses. Two catches:
     the CSS animation Chrome runs on an autofilled field (see .field:-webkit-autofill in
     globals.css), and a check on mount for managers that fill before hydration. */
  const sync = () => {
    const v = ref.current?.value ?? '';
    if (v && v !== value) onChange(v);
  };
  useEffect(() => {
    const t = setTimeout(sync, 120);
    return () => clearTimeout(t);
    // Mount only: later edits come through onChange like any other typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label>{label}</label>
        {right}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          ref={ref}
          onAnimationStart={e => { if (e.animationName === 'authAutofill') sync(); }}
          className={`field ${error ? 'invalid' : ''}`}
          type={isPassword && show ? 'text' : type}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={!!error}
          style={isPassword ? { paddingRight: '44px' } : undefined}
        />
        {isPassword && (
          <button type="button" className="auth-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} tabIndex={-1}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
      {error && <span className="auth-field-error">{error}</span>}
    </div>
  );
}
