'use client';

import { useState } from 'react';
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
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label>{label}</label>
        {right}
      </div>
      <div style={{ position: 'relative' }}>
        <input
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
