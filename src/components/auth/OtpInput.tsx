'use client';

import { useRef } from 'react';

// 6 separate boxes with auto-advance, backspace and paste support
export default function OtpInput({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const setAt = (i: number, d: string) => {
    const next = value.padEnd(6, ' ').split('');
    next[i] = d || ' ';
    onChange(next.join('').replace(/ /g, ' ').trimEnd().replace(/\s/g, ''));
  };

  const handleChange = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '').slice(-1);
    const arr = value.split('');
    while (arr.length < 6) arr.push('');
    arr[i] = d;
    onChange(arr.join('').slice(0, 6));
    if (d && i < 5) refs.current[i + 1]?.focus();
  };

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i]?.trim() && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="otp-row" onPaste={handlePaste}>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          className={`otp-box ${invalid ? 'invalid' : ''}`}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={(value[i] || '').trim()}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          onFocus={e => e.target.select()}
          aria-label={`Digit ${i + 1}`}
          autoFocus={i === 0}
        />
      ))}
    </div>
  );
}
