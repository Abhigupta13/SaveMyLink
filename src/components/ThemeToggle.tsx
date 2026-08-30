'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor, Check, ChevronDown } from 'lucide-react';

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
   a flash, since the attribute arrives already correct in the HTML.

   A pill in the corner of the profile header rather than a row in the settings list, and a pill
   that NAMES the current setting rather than a bare icon. Two rules it must keep:
   • It says the SETTING, never the effect. On "system" it says System — saying "Dark" would
     become a lie the moment the OS flips at sunset.
   • Tapping opens the three options. A control that changes state on tap without ever showing
     the alternatives is one you have to poke to discover, which on a theme means flashing the
     whole app at someone to answer a question.
   data-theme is ABSENT when the setting is system, hence the 'system' default. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setTheme((document.documentElement.dataset.theme as Theme) || 'system'); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();          // the accounts sheet listens for Escape too
      setOpen(false);
      pillRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const pick = (next: Theme) => {
    setOpen(false);
    if (next === theme) return;
    setTheme(next);
    setBusy(true);
    document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.reload();
  };

  const current = OPTIONS.find(o => o.value === theme) || OPTIONS[2];
  const CurrentIcon = current.Icon;

  return (
    /* Its own element, and a sibling of the header button rather than a child — the header opens
       the accounts sheet, and a tap on this pill must not reach it. */
    <div className="theme-pop" ref={boxRef}>
      {/* stopPropagation on the pill: it is a SIBLING of the header button today, so there is no
          path to the account sheet — this keeps that true if it is ever nested inside a trigger. */}
      <button
        ref={pillRef}
        type="button"
        className="theme-pill"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${current.label}`}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
      >
        <CurrentIcon size={15} strokeWidth={2.3} />
        {current.label}
        <ChevronDown size={13} strokeWidth={2.6} className="theme-pill-caret" />
      </button>

      {open && (
        <div className="theme-menu" role="menu" aria-label="Theme">
          {OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              className={`theme-item ${theme === value ? 'on' : ''}`}
              disabled={busy}
              onClick={() => pick(value)}
            >
              <Icon size={16} strokeWidth={2.2} />
              <span>{label}</span>
              {theme === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
