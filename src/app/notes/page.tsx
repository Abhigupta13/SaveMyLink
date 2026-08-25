'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Pin, Trash2, X, Paperclip, Camera, FileText, Image as ImageIcon } from 'lucide-react';
import { getNotes, createNote, updateNote, deleteNote, attachToNote, removeAttachment } from '@/actions/note';
import { getProjects, createProject } from '@/actions/project';
import ProjectPicker from '@/components/ProjectPicker';
import { useFeedback } from '@/components/ui/Feedback';
import { shrinkImage } from '@/lib/shrinkImage';
import { formatTime, formatDay } from '@/lib/time';
import { isProjectOwner } from '@/lib/scope';

const isImage = (a: any) => (a.mimeType || '').startsWith('image/');
const sizeOf = (b?: number) => !b ? '' : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

const preview = (b: string) => b.replace(/\s+/g, ' ').slice(0, 160);
const when = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? formatTime(d) : formatDay(d);
};

export default function NotesPage() {
  const { toast, confirm } = useFeedback();
  const { data: session, status } = useSession();
  const myEmail = (session?.user?.email || '').toLowerCase();
  const [notes, setNotes] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [scope, setScope] = useState<any | null>(null);   // null = Personal, same as Tasks and Meetings
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null); // note being edited, or {} for new
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [noteProject, setNoteProject] = useState('');   // project of the note being edited
  const [q, setQ] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Attaching creates the note server-side if it did not exist, so later saves target that row
  const noteIdRef = useRef<string | null>(null);

  // Arriving from a group's workspace: ?project=<id> opens this page already in that scope, so
  // "write a note" from inside a project does not silently drop you into Personal. The page is
  // dynamically rendered, so useSearchParams needs no Suspense boundary here.
  const wantedProject = useSearchParams().get('project');

  const load = useCallback(async () => {
    const [res, p] = await Promise.all([getNotes(), getProjects()]);
    if (res.success) setNotes(res.notes || []);
    if (p.success) {
      setProjects(p.projects || []);
      // Only a project actually returned to me — the id came from a URL and is not to be trusted
      // into the picker just because it was typed there.
      if (wantedProject) setScope((p.projects || []).find((x: { _id: string }) => String(x._id) === wantedProject) || null);
    }
    setLoading(false);
  }, [wantedProject]);
  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);
  // `capture` is ignored on desktop, where the button would just be a second file picker.
  // Checked after mount so the server and first client render agree.
  useEffect(() => { setHasCamera(window.matchMedia('(pointer: coarse)').matches); }, []);

  const open = (note: any | null) => {
    setEditing(note || {});
    setTitle(note?.title || '');
    setBody(note?.body || '');
    // A new note lands in whatever scope you are looking at — that is what you meant by being there
    setNoteProject(note ? (note.projectId?._id || '') : (scope?._id || ''));
    setAttachments(note?.attachments || []);
    noteIdRef.current = note?._id || null;
  };

  const save = async () => {
    const id = noteIdRef.current;
    // An attachment alone is a note worth keeping, even with no words in it
    if (!title.trim() && !body.trim() && !attachments.length) {
      if (id) await deleteNote(id);   // created by an attach that was then removed again
      setEditing(null); load(); return;
    }
    const res = id
      ? await updateNote(id, { title: title.trim(), body: body.trim(), projectId: noteProject })
      : await createNote({ title: title.trim(), body: body.trim(), projectId: noteProject });
    if (res.success) { setEditing(null); load(); } else toast(res.error || 'Something went wrong', 'error');
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const picked of Array.from(files)) {
      const file = await shrinkImage(picked);
      const fd = new FormData();
      fd.append('file', file);
      const res = await attachToNote(noteIdRef.current, fd);
      if (res.success) {
        noteIdRef.current = res.noteId!;   // first attach on a new note creates it
        setAttachments(a => [...a, res.attachment]);
      } else toast(res.error || 'Could not attach that', 'error');
    }
    setUploading(false);
    // Cleared so picking the same file twice in a row still fires onChange
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  };

  const detach = async (key: string) => {
    if (!noteIdRef.current) return;
    setAttachments(a => a.filter(x => x.key !== key));
    const res = await removeAttachment(noteIdRef.current, key);
    if (!res.success) toast(res.error || 'Could not remove it', 'error');
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Delete this note?', danger: true, confirmLabel: 'Delete' }))) return;
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

  // Notes in a project are a project owner's to delete; personal notes are mine.
  const canRemove = (n: any) => {
    const pid = n?.projectId?._id || n?.projectId;
    if (!pid) return true;
    const proj = projects.find((p: any) => String(p._id) === String(pid));
    return isProjectOwner(proj, myEmail);
  };

  const inScope = notes.filter(n => (scope ? n.projectId?._id === scope._id : !n.projectId));
  const filtered = inScope.filter(n => !q || `${n.title || ''} ${n.body}`.toLowerCase().includes(q.toLowerCase()));
  // Chip counts, so you can see where the notes are without switching scope
  const counts = notes.reduce((acc: Record<string, number>, n) => {
    const key = n.projectId?._id || 'personal';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  if (editing) {
    return (
      <div className="container" style={{ padding: '20px 16px 120px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <button className="icon-btn" onClick={save} title="Back"><X size={16} /></button>
          <span style={{ flex: 1, fontWeight: 800, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {editing._id ? `Edited ${when(editing.updatedAt)}` : 'New note'}
          </span>
          <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx"
            onChange={e => attach(e.target.files)} />
          {/* Separate input: `capture` on the one above would force the camera for PDFs too.
              The attribute opens the system camera directly — no plugin, no CAMERA permission. */}
          <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment"
            onChange={e => attach(e.target.files)} />
          {hasCamera && (
            <button className="icon-btn" onClick={() => cameraRef.current?.click()} disabled={uploading}
              title="Take a photo" aria-label="Take a photo">
              <Camera size={16} />
            </button>
          )}
          <button className="icon-btn" onClick={() => fileRef.current?.click()} disabled={uploading}
            title="Attach image or document" aria-label="Attach image or document">
            <Paperclip size={16} />
          </button>
          {noteIdRef.current && canRemove(editing) && <button className="icon-btn danger" onClick={() => remove(noteIdRef.current!)} title="Delete"><Trash2 size={16} /></button>}
          <button className="btn-primary" onClick={save} style={{ padding: '9px 20px', borderRadius: '12px', fontWeight: 800 }}>Done</button>
        </div>
        <input className="field" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)}
          style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '10px', background: 'transparent', border: 'none', padding: '4px 0' }} autoFocus={!editing._id} />

        {projects.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <select className="field" value={noteProject} onChange={e => setNoteProject(e.target.value)}
              style={{ fontSize: '0.8rem', fontWeight: 700, padding: '7px 10px', width: 'auto' }}>
              <option value="">Personal — only me</option>
              {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
              {noteProject ? 'Everyone in this project can see and edit it.' : 'Private to you.'}
            </span>
          </div>
        )}
        <textarea className="field" placeholder="Write anything…" value={body} onChange={e => setBody(e.target.value)}
          rows={attachments.length ? 10 : 16} style={{ background: 'transparent', border: 'none', padding: '4px 0', resize: 'vertical', lineHeight: 1.65, fontSize: '0.95rem' }} />

        {(attachments.length > 0 || uploading) && (
          <div className="note-attachments">
            {attachments.map(a => (
              <div key={a.key} className="note-attach">
                <a href={a.url} target="_blank" rel="noreferrer" className="note-attach-open" title={a.name}>
                  {isImage(a)
                    ? <img src={a.url} alt="" loading="lazy" />
                    : <span className="note-attach-glyph">{(a.mimeType || '').includes('pdf') ? <FileText size={20} /> : <ImageIcon size={20} />}</span>}
                  <span className="note-attach-name">{a.name}</span>
                  <span className="note-attach-size">{sizeOf(a.size)}</span>
                </a>
                <button className="note-attach-del" onClick={() => detach(a.key)} title="Remove" aria-label="Remove attachment">
                  <X size={13} />
                </button>
              </div>
            ))}
            {uploading && <div className="note-attach uploading">Uploading…</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '18px', gap: '12px' }}>
        <div>
          <h1 className="page-title">{scope ? scope.name : 'Notes'}</h1>
          <p className="page-subtitle">
            {inScope.length
              ? `${inScope.length} note${inScope.length === 1 ? '' : 's'}${scope ? ' · shared with the project' : ' · private to you'}`
              : 'Anything you want to remember'}
          </p>
        </div>
        <button className="btn-primary" onClick={() => open(null)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '12px', fontWeight: 800 }}>
          <Plus size={18} /> New
        </button>
      </header>

      <div style={{ marginBottom: '16px' }}>
        <ProjectPicker
          projects={projects}
          activeId={scope?._id || null}
          counts={counts}
          onSelect={setScope}
          onCreate={async (name) => {
            const res = await createProject(name);
            if (res.success) { setProjects(ps => [...ps, res.project]); setScope(res.project); }
            else toast(res.error || 'Something went wrong', 'error');
            return res;
          }}
        />
      </div>

      {inScope.length > 5 && (
        <input className="field" placeholder="Search notes…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: '16px' }} />
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>{q ? 'No matches' : scope ? `No notes in ${scope.name}` : 'No notes yet'}</p>
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
              {n.attachments?.length > 0 && (
                <div className="note-clip"><Paperclip size={11} /> {n.attachments.length}</div>
              )}
              <div className="note-time">
                {/* Whose it is only matters once a note is shared — in Personal it is always mine */}
                {n.projectId && n.userId?.email && n.userId.email.toLowerCase() !== myEmail && (
                  <span className="chip" style={{ marginRight: '6px' }}>{n.userId.name || n.userId.email}</span>
                )}
                {when(n.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
