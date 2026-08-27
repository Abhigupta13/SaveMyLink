'use client';

import { useEffect, useState } from 'react';
import { sarvamKeyStatus, setSarvamKey, clearSarvamKey } from '@/actions/sarvamKey';
import { useFeedback } from '@/components/ui/Feedback';

/**
 * The only interactive part of /sarvam-key: paste a key, replace it, remove it.
 *
 * The security model is entirely in src/actions/sarvamKey.ts and src/lib/secretBox.ts and none of
 * it lives here — this component never sees a stored key. `sarvamKeyStatus` selects
 * `sarvamKey.last4` and nothing else, so the four characters below are all the browser is ever
 * told. The plaintext travels one way, into `setSarvamKey`, and is dropped from state the moment
 * that returns.
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
    <div className="g-key">
      <p className="g-key-state">
        {last4
          ? <>Saved on this account <span className="g-chip accent">•••• <code>{last4}</code></span></>
          : <>No key saved yet</>}
      </p>

      {editing ? (
        <>
          <label htmlFor="sarvam-key">Sarvam API key</label>
          <input
            id="sarvam-key" type="password" value={value} onChange={e => setValue(e.target.value)}
            placeholder="Paste it here" autoComplete="off" spellCheck={false} className="field" autoFocus
          />
          <div className="g-key-row">
            <button onClick={save} disabled={busy || !value.trim()} className="g-btn primary">
              {busy ? 'Saving…' : 'Save key'}
            </button>
            <button onClick={() => { setEditing(false); setValue(''); }} className="g-btn">Cancel</button>
          </div>
        </>
      ) : (
        <div className="g-key-row">
          <button onClick={() => setEditing(true)} className="g-btn primary">{last4 ? 'Replace key' : 'Add your key'}</button>
          {last4 && <button onClick={remove} className="g-btn danger">Remove</button>}
        </div>
      )}
    </div>
  );
}
