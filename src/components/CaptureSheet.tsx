'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AddLinkForm from './AddLinkForm';
import { findLinkByUrl } from '@/actions/link';
import { createNote } from '@/actions/note';

export default function CaptureSheet({ url, title, categories }: { url?: string; title?: string; categories: any[] }) {
  const router = useRouter();
  const [duplicate, setDuplicate] = useState<{ title?: string; createdAt?: string } | null>(null);

  useEffect(() => {
    if (!url) return;
    findLinkByUrl(url).then(({ link }) => setDuplicate(link));
  }, [url]);

  const handleSaved = async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      // Return the user to the app they shared from
      const { SendIntent } = await import('@mindlib-capacitor/send-intent');
      SendIntent.finish();
    } else {
      router.push('/links');
      router.refresh();
    }
  };

  if (!url) {
    // Shared plain text with no URL → save as a note
    return <NoteCapture initialText={title || ''} onSaved={handleSaved} />;
  }

  return (
    <div className="container" style={{ padding: '16px', maxWidth: '520px' }}>
      <h2 className="modal-title" style={{ marginBottom: '16px' }}>Save to Vault</h2>
      {duplicate && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px', borderRadius: '14px',
          background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
          color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600
        }}>
          Already saved{duplicate.createdAt ? ` on ${new Date(duplicate.createdAt).toLocaleDateString()}` : ''}
          {duplicate.title ? ` — “${duplicate.title}”` : ''}
        </div>
      )}
      <AddLinkForm initialUrl={url} initialTitle={title} categories={categories} onSaved={handleSaved} />
    </div>
  );
}

function NoteCapture({ initialText, onSaved }: { initialText: string; onSaved: () => void }) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const res = await createNote({ body: text.trim() });
    setSaving(false);
    if (res.success) onSaved();
    else alert(res.error || 'Failed to save note');
  };

  return (
    <div className="container" style={{ padding: '16px', maxWidth: '520px' }}>
      <h2 className="modal-title" style={{ marginBottom: '16px' }}>Save note</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
        style={{
          width: '100%', padding: '16px', borderRadius: '18px', background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.95rem',
          lineHeight: 1.6, resize: 'vertical', outline: 'none', fontFamily: 'inherit'
        }}
      />
      <button onClick={handleSave} disabled={saving || !text.trim()} className="btn-primary"
        style={{ marginTop: '14px', width: '100%', height: '52px', borderRadius: '16px', fontWeight: 800 }}>
        {saving ? 'Saving…' : 'Save to Vault'}
      </button>
    </div>
  );
}
