'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Pin, Trash2, X } from 'lucide-react';
import { getNotes, createNote, updateNote, deleteNote } from '@/actions/note';

const preview = (b: string) => b.replace(/\s+/g, ' ').slice(0, 160);
const when = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                 : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function NotesPage() {
  const { status } = useSession();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null); // note being edited, or {} for new
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const res = await getNotes();
    if (res.success) setNotes(res.notes || []);
    setLoading(false);
  }, []);
  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  const open = (note: any | null) => {
    setEditing(note || {});
    setTitle(note?.title || '');
    setBody(note?.body || '');
  };

  const save = async () => {
    if (!title.trim() && !body.trim()) { setEditing(null); return; }
    const res = editing?._id
      ? await updateNote(editing._id, { title: title.trim(), body: body.trim() })
      : await createNote({ title: title.trim(), body: body.trim() });
    if (res.success) { setEditing(null); load(); } else alert(res.error);
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this note?')) return;
    setNotes(n => n.filter(x => x._id !== id));
    setEditing(null);
    const res = await deleteNote(id);
    if (!res.success) load();
  };

  const togglePin = async (note: any) => {
    setNotes(n => n.map(x => x._id === note._id ? { ...x, pinned: !x.pinned } : x));
    await updateNote(note._id, { pinned: !note.pinned });
    load();
  };

  const filtered = notes.filter(n => !q || `${n.title || ''} ${n.body}`.toLowerCase().includes(q.toLowerCase()));

  if (editing) {
    return (
      <div className="container" style={{ maxWidth: '640px', padding: '20px 16px 120px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <button className="icon-btn" onClick={save} title="Back"><X size={16} /></button>
          <span style={{ flex: 1, fontWeight: 800, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {editing._id ? `Edited ${when(editing.updatedAt)}` : 'New note'}
          </span>
          {editing._id && <button className="icon-btn danger" onClick={() => remove(editing._id)} title="Delete"><Trash2 size={16} /></button>}
          <button className="btn-primary" onClick={save} style={{ padding: '9px 20px', borderRadius: '12px', fontWeight: 800 }}>Done</button>
        </div>
        <input className="field" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)}
          style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '10px', background: 'transparent', border: 'none', padding: '4px 0' }} autoFocus={!editing._id} />
        <textarea className="field" placeholder="Write anything…" value={body} onChange={e => setBody(e.target.value)}
          rows={16} style={{ background: 'transparent', border: 'none', padding: '4px 0', resize: 'vertical', lineHeight: 1.65, fontSize: '0.95rem' }} />
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '640px', padding: '24px 16px 120px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '18px', gap: '12px' }}>
        <div>
          <h1 className="page-title">Notes</h1>
          <p className="page-subtitle">{notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : 'Anything you want to remember'}</p>
        </div>
        <button className="btn-primary" onClick={() => open(null)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '12px', fontWeight: 800 }}>
          <Plus size={18} /> New
        </button>
      </header>

      {notes.length > 5 && (
        <input className="field" placeholder="Search notes…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: '16px' }} />
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>{q ? 'No matches' : 'No notes yet'}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{q ? 'Try a different search.' : 'Tap New — or just tell Jarvis to note something down.'}</p>
        </div>
      ) : (
        <div className="notes-grid">
          {filtered.map(n => (
            <div key={n._id} className="note-card" onClick={() => open(n)}>
              <button className="note-pin" onClick={e => { e.stopPropagation(); togglePin(n); }} title={n.pinned ? 'Unpin' : 'Pin'}>
                <Pin size={14} fill={n.pinned ? 'currentColor' : 'none'} />
              </button>
              {n.title && <div className="note-title">{n.title}</div>}
              {n.body && <div className="note-body">{preview(n.body)}</div>}
              <div className="note-time">{when(n.updatedAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
