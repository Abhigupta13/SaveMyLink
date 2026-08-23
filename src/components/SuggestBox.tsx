'use client';

import { useState } from 'react';
import { MessageSquarePlus, X } from 'lucide-react';
import { submitSuggestion } from '@/actions/suggestion';
import { shrinkImage } from '@/lib/shrinkImage';
import { useFeedback } from '@/components/ui/Feedback';

const KINDS = [
  { id: 'bug', label: 'Something broke' },
  { id: 'idea', label: 'An idea' },
  { id: 'other', label: 'Other' },
] as const;

/** The "Help us improve" card and its modal. Lives on /profile. */
export default function SuggestBox() {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>('bug');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const close = () => { setOpen(false); setKind('bug'); setMessage(''); setShot(null); };

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
    if (res.success) { close(); toast('Thanks — we got it', 'success'); }
    else toast(res.error || 'Could not send that', 'error');
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="card safe-row"
        style={{ width: '100%', marginTop: '14px', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
        <span className="safe-icon"><MessageSquarePlus size={18} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Help us improve</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Something broken, or an idea? Tell us.
          </span>
        </span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Help us improve</h2>
              <button className="modal-close" onClick={close}>&times;</button>
            </div>

            <form onSubmit={send} style={{ display: 'grid', gap: '14px' }}>
              <div className="seg-group">
                {KINDS.map(k => (
                  <button key={k.id} type="button" className={`seg-btn ${kind === k.id ? 'active' : ''}`}
                    onClick={() => setKind(k.id)}>{k.label}</button>
                ))}
              </div>

              <div>
                <label className="field-label">What happened?</label>
                <textarea className="field" rows={5} autoFocus required value={message}
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

              <button type="submit" className="btn-primary" disabled={sending || !message.trim()}
                style={{ height: '46px', borderRadius: '14px', fontWeight: 800, marginTop: '4px' }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
