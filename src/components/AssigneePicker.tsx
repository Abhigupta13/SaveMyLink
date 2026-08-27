'use client';

import { Check } from 'lucide-react';

/**
 * Who a task is on. One shared task, several people, any of them ticks it.
 *
 * Toggles rather than a native `<select multiple>`: on a 390px phone the native control is a
 * scrolling box you have to long-press or ctrl-click to add a second name to, which is a mouse
 * gesture. These are 40px targets you tap, and what is selected is readable without opening
 * anything. The first person tapped stays first in the list — that is the primary assignee, the
 * one shown on a collapsed task row.
 */
export default function AssigneePicker({ options, value, onChange, myEmail, labelOf, id }: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  myEmail: string;
  labelOf?: (email: string) => string;
  id?: string;
}) {
  // The local part where no names are known: four full addresses wrap to four lines at 390px.
  const label = (e: string) => (e === myEmail ? 'me' : labelOf ? labelOf(e) : e.split('@')[0]);
  const toggle = (email: string) =>
    onChange(value.includes(email) ? value.filter(e => e !== email) : [...value, email]);

  // Me first. Assigning to yourself is the common case and it should be the first thumb target,
  // not wherever your address happens to sit in the group's member list.
  const ordered = options.includes(myEmail) ? [myEmail, ...options.filter(e => e !== myEmail)] : options;

  return (
    <div className="pick-row" id={id} role="group" aria-label="Assigned to">
      {ordered.map(email => {
        const on = value.includes(email);
        return (
          <button key={email} type="button" className={`pick ${on ? 'on' : ''}`} aria-pressed={on}
            title={email} onClick={() => toggle(email)}>
            {on && <Check size={13} aria-hidden="true" />}
            {label(email)}
          </button>
        );
      })}
      {options.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Nobody is in this group yet.</span>}
    </div>
  );
}
