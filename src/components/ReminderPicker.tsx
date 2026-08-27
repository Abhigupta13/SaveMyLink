'use client';

import { REMINDER_OPTIONS, REMINDER_FOOTNOTE, DEFAULT_CHOICE, type ReminderChoice } from '@/lib/reminderRule';

/**
 * "Remind me" — wherever a task is created or edited.
 *
 * A native <select>, deliberately. On the phone Android renders it as a full-width sheet of
 * 48px rows, which is the most thumb-friendly picker on the device and one we do not have to
 * build, keyboard-map or screen-read ourselves. Five chips would wrap to two lines inside a
 * quick-add row and repeat five times over on a meeting's confirm list; the select is one line
 * wherever it lands, at 390px and at 1440.
 *
 * `inline` is the crowded-row phrasing (the options name themselves, no heading needed);
 * without it the picker gets a heading and the standing footnote about what never changes.
 */
export default function ReminderPicker({
  id, value, onChange, inline = false, disabled = false, style,
}: {
  id?: string;
  value?: ReminderChoice | null;
  onChange: (next: ReminderChoice) => void;
  inline?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const choice = value || DEFAULT_CHOICE;
  const select = (
    <select
      id={id}
      className="field"
      aria-label="When to remind me"
      value={choice}
      disabled={disabled}
      onChange={e => onChange(e.target.value as ReminderChoice)}
      style={{ color: choice === 'none' ? 'var(--text-tertiary)' : 'var(--text-primary)', ...style }}
    >
      {REMINDER_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{inline ? o.inline : o.label}</option>
      ))}
    </select>
  );

  if (inline) return select;
  return (
    <>
      <label htmlFor={id} style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Remind me</label>
      {select}
      <p style={{ margin: '-4px 0 0', fontSize: '0.7rem', lineHeight: 1.45, color: 'var(--text-tertiary)' }}>{REMINDER_FOOTNOTE}</p>
    </>
  );
}
