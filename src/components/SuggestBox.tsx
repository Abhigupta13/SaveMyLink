'use client';

import { useState } from 'react';
import { MessageSquarePlus, X } from 'lucide-react';
import { submitSuggestion } from '@/actions/suggestion';
import { shrinkImage } from '@/lib/shrinkImage';
import { useFeedback } from '@/components/ui/Feedback';
import { useDialog, dialogProps } from '@/components/ui/useDialog';

const KINDS = [
  { id: 'bug', label: 'Something broke' },
  { id: 'idea', label: 'An idea' },
  { id: 'other', label: 'Other' },
] as const;

/**
 * The "Help us improve" dialog itself, separated from the /profile row that opens it so the exit
 * prompt shows the SAME dialog rather than a second copy that drifts from this one.
 *
 * `laterLabel` swaps the header's × for a named way out. On /profile the × is right — the person
 * opened this deliberately and closing is obvious. On the way out of the app they did not ask for
 * it, so the escape has to be a real, labelled button, and "Later" says the honest thing: this
 * will not be the last time you are asked. `onLater` also carries the caller's own follow-on —
 * on Android that is actually leaving the app, which the person already asked for.
 */
export function SuggestDialog({
  onClose, onLater, laterLabel, title = 'Help us improve', intro,
}: {
  onClose: () => void;
  onLater?: () => void;
  laterLabel?: string;
  title?: string;
  intro?: string;
}) {
  const { toast } = useFeedback();
  const [kind, setKind] = useState<string>('bug');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const dismiss = onLater ?? onClose;
  useDialog(true, dismiss);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('message', message.trim());
    // The page they were on and what they were using: the two things a bug report always misses
    fd.append('page', window.location.pathname);
    fd.append('userAgent', navigator.userAgent);
    if (shot) fd.append('file', await shrinkImage(shot));
    const res = await submitSuggestion(fd);
    setSending(false);
    if (res.success) {
      onClose();
      toast(res.shotDropped ? "Thanks — we got it, but the screenshot couldn't be attached" : 'Thanks — we got it', 'success');
    }
    else toast(res.error || 'Could not send that', 'error');
  };

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}
        {...dialogProps} aria-labelledby="suggest-title">
        <div className="modal-header">
          <h2 className="modal-title" id="suggest-title">{title}</h2>
          {!laterLabel && <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>}
        </div>

        {intro && <p className="suggest-intro">{intro}</p>}

        <form onSubmit={send} style={{ display: 'grid', gap: '14px' }}>
          <div className="seg-group">
            {KINDS.map(k => (
              <button key={k.id} type="button" className={`seg-btn ${kind === k.id ? 'active' : ''}`}
                onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>

          <div>
            <label className="field-label" htmlFor="suggest-what">What happened?</label>
            <textarea className="field" id="suggest-what" rows={5} autoFocus required value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={kind === 'bug'
                ? 'What were you doing, and what went wrong?'
                : 'What would make this better for you?'}
              style={{ resize: 'vertical', minHeight: '110px' }} />
          </div>

          <div>
            <label className="field-label">Screenshot (optional)</label>
            <input type="file" id="suggest-shot" accept="image/*" style={{ display: 'none' }}
              onClick={e => { (e.target as HTMLInputElement).value = ''; }}   // re-picking the same file still fires onChange
              onChange={e => setShot(e.target.files?.[0] || null)} />
            <label htmlFor="suggest-shot" className={`file-drop ${shot ? 'has-file' : ''}`}>
              {shot ? shot.name : 'Add a screenshot…'}
            </label>
            {shot && (
              <button type="button" onClick={() => setShot(null)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '6px 2px 0', padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)' }}>
                <X size={12} /> Remove
              </button>
            )}
          </div>

          <div className="suggest-actions">
            <button type="submit" className="btn-primary" disabled={sending || !message.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            {/* Where a Cancel would be. Named rather than an ×, because this dialog arrived
                uninvited and the way out should be as easy to find as the way through. */}
            {laterLabel && (
              <button type="button" className="btn-ghost suggest-later" onClick={onLater}>{laterLabel}</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** The "Help us improve" row on /profile, and the dialog it opens. */
export default function SuggestBox() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);


  return (
    <>
      {/* A row in the About group on /profile, not a card of its own — see .set-row in globals.css */}
      <button onClick={() => setOpen(true)} className="set-row">
        <span className="row-icon"><MessageSquarePlus size={18} strokeWidth={2.2} /></span>
        <span className="set-row-text">
          <span className="set-row-title">Help us improve</span>
          <span className="set-row-sub">Something broken, or an idea? Tell us.</span>
        </span>
      </button>

      {open && <SuggestDialog onClose={close} />}
    </>
  );
}
