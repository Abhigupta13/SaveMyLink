'use client';

import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import Link from 'next/link';
import { sarvamKeyStatus, setSarvamKey, clearSarvamKey } from '@/actions/sarvamKey';
import { useFeedback } from '@/components/ui/Feedback';

/**
 * Bring your own Sarvam key.
 *
 * The billing sentence is not decoration — this field hands a third party's paid credential to
 * our server, and the person typing it deserves to read who charges them before they paste it.
 * The key itself never comes back: once saved, this shows four characters and nothing else.
 */
export default function SarvamKeyCard() {
  const { toast, confirm } = useFeedback();
  const [last4, setLast4] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sarvamKeyStatus().then(r => { if (r.success) setLast4(r.last4 || null); }).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    const res = await setSarvamKey(value);
    setBusy(false);
    if (!res.success) { toast(res.error || 'Something went wrong', 'error'); return; }
    setLast4(res.last4);
    setValue('');            // never keep the plaintext around after it is stored
    setEditing(false);
    toast('Key saved — Hindi meetings now use the upgraded engine', 'success');
  };

  const remove = async () => {
    if (!(await confirm({
      title: 'Remove your Sarvam key?',
      message: 'Meetings go back to the free engine. Your key stays valid on Sarvam — remove it there too if you want it dead.',
      danger: true,
      confirmLabel: 'Remove key',
    }))) return;
    const res = await clearSarvamKey();
    if (!res.success) { toast(res.error || 'Something went wrong', 'error'); return; }
    setLast4(null);
    toast('Key removed', 'success');
  };

  return (
    <div className="card" style={{ marginTop: '14px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <span className="row-icon"><Languages size={18} strokeWidth={2.2} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700 }}>Upgraded Hindi transcription</span>
        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {last4
            ? <>Using your own Sarvam key <strong>•••• {last4}</strong></>
            : 'Hindi and Hinglish already work free. Your own Sarvam key buys a sharper engine — better with names and long meetings.'}
        </span>

        {editing ? (
          <div style={{ marginTop: '10px' }}>
            <input
              type="password" value={value} onChange={e => setValue(e.target.value)}
              placeholder="Paste your Sarvam API key" autoComplete="off" className="field"
              style={{ width: '100%' }} autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button onClick={save} disabled={busy || !value.trim()} className="btn-primary"
                style={{ padding: '8px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', opacity: busy || !value.trim() ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Save key'}
              </button>
              <button onClick={() => { setEditing(false); setValue(''); }} className="subtle-link">Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setEditing(true)} className="subtle-link">{last4 ? 'Replace key' : 'Add your key'}</button>
            {last4 && <button onClick={remove} className="subtle-link" style={{ color: 'var(--danger-color)' }}>Remove</button>}
          </div>
        )}

        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '10px', lineHeight: 1.5 }}>
          Sarvam bills this key directly — you pay them, not us. We store it encrypted and never
          show it again.{' '}
          {/* Inherits the note's tertiary colour otherwise, and reads as prose rather than a link */}
          <Link href="/terms" style={{ color: 'var(--accent-color)', fontWeight: 700 }}>Terms &amp; your data</Link>
        </span>
      </div>
    </div>
  );
}
