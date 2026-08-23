'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

type Theme = (typeof OPTIONS)[number]['value'];

/* State lives in the cookie; layout.tsx turns it into <html data-theme> on the
   server. Switching reloads rather than flipping the attribute in place —
   Chrome leaves background-color and border-color stuck on the old palette when
   a whole token set changes at once, and a reload has neither that problem nor
   a flash, since the attribute arrives already correct in the HTML. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setTheme((document.documentElement.dataset.theme as Theme) || 'system'); }, []);

  const pick = (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    setBusy(true);
    document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.reload();
  };

  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} disabled={busy}
          className={`segment ${theme === value ? 'on' : ''}`} onClick={() => pick(value)}>
          <Icon size={16} strokeWidth={2.2} /> {label}
        </button>
      ))}
    </div>
  );
}
