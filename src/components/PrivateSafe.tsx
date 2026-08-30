'use client';

import { Lock, Unlock } from 'lucide-react';
import { useUser } from '@/components/UserContext';

/**
 * The Private Safe, as the screen sees it. One file, because the two halves have to agree:
 * what a page says while the safe is open, and what a composer offers while it is being written.
 *
 * lib/privacy is the rule. Two consequences the UI has to carry:
 *
 * 1. The safe SWAPS the personal vault — unlocked shows what IS private and the ordinary list is
 *    gone while it is open. A page that swaps in silence answers "where are my notes?" with
 *    "no notes yet", which is a lie people believe. Hence SafeBanner on every page that swaps,
 *    and SafeEmpty instead of the ordinary empty state.
 * 2. A record filed under a group can never be private. So the toggle leaves and the reason
 *    stays — a switch the server ignores is worse than no switch.
 */

/** How a page names what it is showing. Same word in the banner and the empty state. */
export type SafeNoun = 'links' | 'notes' | 'tasks' | 'meetings' | 'files' | 'people';

/**
 * The persistent "you are not looking at your normal list" strip, with the way back on it.
 * Renders nothing when the safe is locked, so a page can mount it unconditionally.
 *
 * `open` is for the server-rendered pages (/links), which already know the answer off the cookie
 * and would otherwise flash the wrong state for one round trip. Everywhere else the context is
 * the answer.
 */
export function SafeBanner({ noun, also, open }: { noun: SafeNoun; also?: string; open?: boolean }) {
  const { privateSafe, setPrivateSafe } = useUser();
  if (!(open ?? privateSafe)) return null;

  return (
    <div className="safe-banner" role="status">
      <span className="safe-icon on" aria-hidden="true"><Unlock size={18} /></span>
      <span className="safe-banner-title">Private Safe is open</span>
      <span className="safe-banner-sub">
        Showing the {noun} you keep private. Your usual {noun} come back when you lock it.
        {also ? ` ${also}` : ''}
      </span>
      <button type="button" className="safe-lock" onClick={() => setPrivateSafe(false)}>
        <Lock size={15} aria-hidden="true" /> Lock
      </button>
    </div>
  );
}

/**
 * The empty state for a list the safe is currently swapping. It exists because the ordinary one
 * ("No notes yet") is false here and reads as data loss.
 */
export function SafeEmpty({ noun }: { noun: SafeNoun }) {
  const { setPrivateSafe } = useUser();
  return (
    <div className="empty-state">
      <p style={{ fontWeight: 800, marginBottom: '4px' }}>Nothing private here yet</p>
      <p className="empty-hint">
        The safe is open, so this list holds only the {noun} you marked private. The rest of your
        {' '}{noun} are exactly where you left them — lock the safe to see them again.
      </p>
      <button type="button" className="safe-lock" onClick={() => setPrivateSafe(false)} style={{ marginTop: '6px' }}>
        <Lock size={15} aria-hidden="true" /> Lock the safe
      </button>
    </div>
  );
}

/**
 * The composer control. `groupName` is the group the record is being filed under, if any — pass it
 * and the switch is replaced by the reason it is gone, which is the whole point: privacyOnWrite
 * would drop the flag server-side and the user would never find out.
 *
 * Pass nothing for `groupName` where the group is the page's scope rather than a field in this
 * form (the tasks quick-add, the meeting recorder): the header and the placeholder already say
 * which group you are in, and a permanent grey line under every group's composer is noise.
 */
export function PrivateToggle({ value, onChange, groupName, compact }: {
  value: boolean;
  onChange: (next: boolean) => void;
  groupName?: string;
  /** Drop the second line — for rows that sit inside an already-busy composer. */
  compact?: boolean;
}) {
  const { hasPin } = useUser();

  if (groupName) {
    return (
      <p className="private-note">
        <Unlock size={14} aria-hidden="true" />
        Everyone in {groupName} can see this, so it cannot be private.
      </p>
    );
  }

  return (
    <label className={`private-toggle ${value ? 'on' : ''}`}>
      <span className="safe-icon sm" aria-hidden="true">{value ? <Lock size={15} /> : <Unlock size={15} />}</span>
      <span className="private-toggle-text">
        <span className="private-toggle-title">Private</span>
        {!compact && (
          <span className="field-hint">
            {value
              ? (hasPin
                ? 'Kept in the Private Safe — visible only while the safe is open.'
                : 'Kept in the Private Safe — you pick a PIN the first time you open it.')
              : 'Sits in your normal list.'}
          </span>
        )}
      </span>
      <span className="switch">
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        <span className="slider round"></span>
      </span>
    </label>
  );
}

/**
 * What the server says happened when filing into a group cleared the flag. Nothing failed, so
 * this is an 'info' toast everywhere it is used, never an error.
 */
export function droppedPrivacy(groupName?: string) {
  return groupName
    ? `Filed under ${groupName} — everyone in the group can see it, so it is no longer private.`
    : 'Filed under a group — everyone in it can see it, so it is no longer private.';
}
