'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { hintFor } from '@/lib/nav';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import {
  Plus, Pin, Trash2, X, Paperclip, Camera, FileText, Image as ImageIcon,
  ArrowLeft, Pencil, MoreVertical,
} from 'lucide-react';
import { getNotesWorkspace, createNote, updateNote, deleteNote, attachToNote, removeAttachment } from '@/actions/note';
import { AppCacheNs, invalidateNotesCache } from '@/lib/appDataCache';
import { runStaleQuery } from '@/lib/runStaleQuery';
import { goConnectDrive } from '@/lib/driveConnect';
import { useDriveGate } from '@/components/useDriveGate';
import { createProject } from '@/actions/project';
import ProjectPicker from '@/components/ProjectPicker';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';
import { useShareNotice } from '@/components/ShareNotice';
import { useUser } from '@/components/UserContext';
import { SafeBanner, SafeEmpty, droppedPrivacy } from '@/components/PrivateSafe';
import { shrinkImage } from '@/lib/shrinkImage';
import { formatTime, formatDay } from '@/lib/time';
import { isProjectOwner } from '@/lib/scope';
import { isNoteBodyEmpty, noteBodyPlainText } from '@/lib/noteHtml';
import NoteRichEditor, { type NoteMentionOption } from '@/components/NoteRichEditor';
import NoteBodyView from '@/components/NoteBodyView';
import NoteSettingsSheet from '@/components/NoteSettingsSheet';
import { mentionLabelOf, isImageAttachment } from '@/lib/noteMentionLabels';
import { noteCardStyle } from '@/lib/noteColors';
import CachedAppFileImage from '@/components/CachedAppFileImage';

const isImage = (a: any) => (a.mimeType || '').startsWith('image/');
const sizeOf = (b?: number) => !b ? '' : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const when = (iso: string) => {
  const d = new Date(iso), today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? formatTime(d) : formatDay(d);
};

const firstImage = (attachments: any[] | undefined) =>
  (attachments || []).find((a) => isImage(a));

type PanelMode = 'view' | 'edit';

export default function NotesClient() {
  const { toast, confirm } = useFeedback();
  const { confirmShare, shareDialog } = useShareNotice();
  const { privateSafe } = useUser();
  const ensureDrive = useDriveGate();
  const { data: session, status } = useSession();
  const myEmail = (session?.user?.email || '').toLowerCase();
  const [notes, setNotes] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [scope, setScope] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode | null>(null);
  const [meta, setMeta] = useState<{ updatedAt?: string; pinned?: boolean }>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [noteProject, setNoteProject] = useState('');
  const [notePrivate, setNotePrivate] = useState(false);
  const [noteColor, setNoteColor] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [q, setQ] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const noteIdRef = useRef<string | null>(null);
  const openedAsNewRef = useRef(false);

  const mentionAttachments: NoteMentionOption[] = attachments
    .filter(isImageAttachment)
    .map((a) => ({
      key: a.key,
      url: a.url,
      mimeType: a.mimeType,
      label: mentionLabelOf(a, attachments),
    }));

  const wantedProject = useSearchParams().get('project');
  const notesCacheKey = `all:${privateSafe ? '1' : '0'}`;

  const applyWorkspace = useCallback((data: { notes: any[]; projects: any[] }) => {
    setNotes(data.notes || []);
    setProjects(data.projects || []);
    if (wantedProject) {
      setScope((data.projects || []).find((x: { _id: string }) => String(x._id) === wantedProject) || null);
    }
  }, [wantedProject]);

  const load = useCallback(async (force?: boolean) => {
    await runStaleQuery({
      namespace: AppCacheNs.notesWorkspace,
      cacheKey: notesCacheKey,
      force,
      ui: { setLoading, setRefreshing, setFailed },
      fetch: async () => {
        const res = await getNotesWorkspace();
        if (!res.success || !res.notes) throw new Error(res.error || 'Failed');
        return { notes: res.notes, projects: res.projects || [] };
      },
      apply: applyWorkspace,
    });
  }, [notesCacheKey, applyWorkspace]);

  const reloadNotes = useCallback(() => {
    invalidateNotesCache();
    load(true);
  }, [load]);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, privateSafe, load]);
  useEffect(() => { setHasCamera(window.matchMedia('(pointer: coarse)').matches); }, []);

  const fillDraft = (note: any | null) => {
    setTitle(note?.title || '');
    setBody(note?.body || '');
    setNoteProject(note ? (note.projectId?._id || '') : (scope?._id || ''));
    setNotePrivate(note ? !!note.isPrivate : privateSafe);
    setNoteColor(note?.color || '');
    setAttachments(note?.attachments || []);
    noteIdRef.current = note?._id || null;
    setMeta({ updatedAt: note?.updatedAt, pinned: !!note?.pinned });
  };

  const openNew = () => {
    openedAsNewRef.current = true;
    fillDraft(null);
    setPanelMode('edit');
  };

  const openView = (note: any) => {
    openedAsNewRef.current = false;
    fillDraft(note);
    setPanelMode('view');
  };

  const closePanel = () => {
    setPanelMode(null);
    setSettingsOpen(false);
    noteIdRef.current = null;
  };

  const save = async (): Promise<boolean> => {
    const id = noteIdRef.current;
    if (!title.trim() && isNoteBodyEmpty(body) && !attachments.length) {
      if (id) await deleteNote(id);
      closePanel();
      reloadNotes();
      return true;
    }
    const group = projects.find(p => String(p._id) === noteProject);
    if (!(await confirmShare(group))) return false;
    const payload = {
      title: title.trim(),
      body,
      projectId: noteProject,
      isPrivate: notePrivate,
      color: noteColor,
    };
    const res = id
      ? await updateNote(id, payload)
      : await createNote(payload);
    if (res.success) {
      if (res.privacyDropped) toast(droppedPrivacy(group?.name), 'info');
      if (!id && res.note?._id) noteIdRef.current = res.note._id;
      setMeta(m => ({
        ...m,
        updatedAt: res.note?.updatedAt || m.updatedAt,
        pinned: res.note?.pinned ?? m.pinned,
      }));
      reloadNotes();
      return true;
    }
    toast(res.error || 'Something went wrong', 'error');
    return false;
  };

  const finishEdit = async () => {
    const wasNew = openedAsNewRef.current;
    if (!(await save())) return;
    if (wasNew) {
      openedAsNewRef.current = false;
      closePanel();
    } else setPanelMode('view');
  };

  const persistSettings = async () => {
    const id = noteIdRef.current;
    if (!id) return;
    const group = projects.find(p => String(p._id) === noteProject);
    if (!(await confirmShare(group))) return;
    const res = await updateNote(id, {
      projectId: noteProject,
      isPrivate: notePrivate,
      color: noteColor,
    });
    if (res.success) {
      if (res.privacyDropped) toast(droppedPrivacy(group?.name), 'info');
      reloadNotes();
    } else toast(res.error || 'Could not save options', 'error');
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    if (panelMode === 'view' && noteIdRef.current) void persistSettings();
  };

  const persistChecklistBody = async (id: string, html: string) => {
    setNotes(n => n.map(x => x._id === id ? { ...x, body: html } : x));
    const res = await updateNote(id, { body: html });
    if (!res.success) toast(res.error || 'Could not update checklist', 'error');
    else reloadNotes();
  };

  const saveChecklist = async (html: string) => {
    setBody(html);
    const id = noteIdRef.current;
    if (!id) return;
    await persistChecklistBody(id, html);
  };

  const saveChecklistOnCard = async (noteId: string, html: string) => {
    if (noteIdRef.current === noteId) setBody(html);
    await persistChecklistBody(noteId, html);
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
        noteIdRef.current = res.noteId!;
        setAttachments(a => [...a, res.attachment]);
      } else if (res.needsDrive) {
        toast('Taking you to Google to connect your Drive…', 'info');
        goConnectDrive();
        break;
      } else toast(res.error || 'Could not attach that', 'error');
    }
    setUploading(false);
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
    closePanel();
    const res = await deleteNote(id);
    if (!res.success) reloadNotes();
  };

  const togglePin = async () => {
    const id = noteIdRef.current;
    if (!id) return;
    const next = !meta.pinned;
    setMeta(m => ({ ...m, pinned: next }));
    setNotes(n => n.map(x => x._id === id ? { ...x, pinned: next } : x));
    await updateNote(id, { pinned: next });
    reloadNotes();
  };

  const canRemove = (n: any) => {
    const pid = n?.projectId?._id || n?.projectId;
    if (!pid) return true;
    const proj = projects.find((p: any) => String(p._id) === String(pid));
    return isProjectOwner(proj, myEmail);
  };

  const inScope = notes.filter(n => (scope ? n.projectId?._id === scope._id : !n.projectId));
  const filtered = inScope.filter(n => !q || `${n.title || ''} ${noteBodyPlainText(n.body || '')}`.toLowerCase().includes(q.toLowerCase()));
  const counts = notes.reduce((acc: Record<string, number>, n) => {
    const key = n.projectId?._id || 'personal';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const attachInputs = (
    <>
      <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx"
        onChange={e => attach(e.target.files)} />
      <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment"
        onChange={e => attach(e.target.files)} />
    </>
  );

  const attachmentBlock = (editable: boolean) => (
    (attachments.length > 0 || uploading) && (
      <div className={`note-attachments${editable ? '' : ' note-attachments-view'}`}>
        {attachments.map(a => (
          <div key={a.key} className="note-attach">
            <a href={a.url} target="_blank" rel="noreferrer" className="note-attach-open" title={a.name}>
              {isImage(a)
                ? <CachedAppFileImage url={a.url} alt="" loading="lazy" />
                : <span className="note-attach-glyph">{(a.mimeType || '').includes('pdf') ? <FileText size={20} /> : <ImageIcon size={20} />}</span>}
              <span className="note-attach-name">
                {a.name}
                {isImageAttachment(a) && (
                  <span className="note-attach-mention"> @{mentionLabelOf(a, attachments)}</span>
                )}
              </span>
              <span className="note-attach-size">{sizeOf(a.size)}</span>
            </a>
            {editable && (
              <button className="note-attach-del" onClick={() => detach(a.key)} title="Remove" aria-label="Remove attachment">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {uploading && <div className="note-attach uploading">Uploading…</div>}
      </div>
    )
  );

  const settingsSheet = (
    <NoteSettingsSheet
      open={settingsOpen}
      onClose={closeSettings}
      projects={projects}
      noteProject={noteProject}
      onProjectChange={setNoteProject}
      notePrivate={notePrivate}
      onPrivateChange={setNotePrivate}
      color={noteColor}
      onColorChange={setNoteColor}
    />
  );

  if (panelMode === 'view') {
    const id = noteIdRef.current;
    return (
      <div className="note-detail container" style={noteCardStyle(noteColor)}>
        {attachInputs}
        {settingsSheet}
        <header className="note-detail-head">
          <button type="button" className="icon-btn" onClick={closePanel} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <span className="note-detail-meta">
            {meta.updatedAt ? `Edited ${when(meta.updatedAt)}` : 'Note'}
          </span>
          <div className="note-detail-actions">
            <button type="button" className="icon-btn" onClick={togglePin} title={meta.pinned ? 'Unpin' : 'Pin'} aria-label={meta.pinned ? 'Unpin' : 'Pin'}>
              <Pin size={16} fill={meta.pinned ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Note options">
              <MoreVertical size={18} />
            </button>
            <button type="button" className="icon-btn note-detail-edit" onClick={() => setPanelMode('edit')} aria-label="Edit note">
              <Pencil size={17} />
            </button>
          </div>
        </header>

        <article className="note-detail-scroll">
          {title ? <h1 className="note-detail-title">{title}</h1> : null}
          {body ? (
            <NoteBodyView
              body={body}
              attachments={attachments}
              mode="full"
              className="note-detail-body"
              interactive
              onBodyChange={saveChecklist}
            />
          ) : (
            !attachments.length && <p className="note-detail-empty">This note is empty.</p>
          )}
          {attachmentBlock(false)}
        </article>
      </div>
    );
  }

  if (panelMode === 'edit') {
    const id = noteIdRef.current;
    const isNew = !id;
    return (
      <div className="note-detail container" style={noteCardStyle(noteColor)}>
        {attachInputs}
        {settingsSheet}
        <header className="note-detail-head">
          <button type="button" className="icon-btn" onClick={() => (isNew ? closePanel() : setPanelMode('view'))} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <span className="note-detail-meta">{isNew ? 'New note' : `Editing · ${meta.updatedAt ? when(meta.updatedAt) : ''}`}</span>
          <div className="note-detail-actions">
            {hasCamera && (
              <button type="button" className="icon-btn" onClick={async () => { if (await ensureDrive('/notes')) cameraRef.current?.click(); }} disabled={uploading}
                title="Take a photo" aria-label="Take a photo">
                <Camera size={16} />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={async () => { if (await ensureDrive('/notes')) fileRef.current?.click(); }} disabled={uploading}
              title="Attach" aria-label="Attach">
              <Paperclip size={16} />
            </button>
            <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Note options">
              <MoreVertical size={18} />
            </button>
            {id && canRemove({ _id: id, projectId: noteProject ? { _id: noteProject } : null }) && (
              <button type="button" className="icon-btn danger" onClick={() => remove(id)} title="Delete" aria-label="Delete">
                <Trash2 size={16} />
              </button>
            )}
            <button type="button" className="btn-primary note-detail-done" onClick={() => void finishEdit()}>
              Done
            </button>
          </div>
        </header>

        <div className="note-detail-scroll">
          <textarea
            className="field bare-input note-detail-title-input"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            rows={1}
            autoFocus={isNew}
          />
          <NoteRichEditor
            key={id || 'new'}
            value={body}
            onChange={setBody}
            placeholder="Write anything…"
            minRows={12}
            mentionAttachments={mentionAttachments}
          />
          {attachmentBlock(true)}
        </div>
      </div>
    );
  }

  return (
    <div className="container notes-page">
      {shareDialog}
      <header className="notes-page-head">
        <div>
          <h1 className="page-title">{scope ? scope.name : 'Notes'}</h1>
          <p className="page-subtitle">
            {inScope.length
              ? `${inScope.length} note${inScope.length === 1 ? '' : 's'}${scope ? ' · shared with the project' : ' · only you'}`
              : 'Anything you want to remember'}
          </p>
        </div>
        <button className="btn-primary notes-new-btn" onClick={openNew}>
          <Plus size={18} /> New
        </button>
      </header>

      <div className="notes-scope-picker">
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

      {!scope && <SafeBanner noun="notes" />}

      {inScope.length > 0 && (
        <input className="field notes-page-search" placeholder="Search notes…" value={q} onChange={e => setQ(e.target.value)} />
      )}

      {loading && notes.length === 0 ? (
        <Loading label="Loading your notes" />
      ) : failed && notes.length === 0 ? (
        <LoadError what="your notes" onRetry={() => load(true)} />
      ) : filtered.length === 0 && privateSafe && !scope && !q ? (
        <SafeEmpty noun="notes" />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>{q ? 'No matches' : scope ? `No notes in ${scope.name}` : 'No notes yet'}</p>
          {!q && <p className="empty-hint">{hintFor('/notes')}</p>}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{q ? 'Try a different search.' : 'Tap New — or just tell Jarvis to note something down.'}</p>
        </div>
      ) : (
        <div className="notes-grid">
          {filtered.map(n => {
            const cover = firstImage(n.attachments);
            return (
              <div
                key={n._id}
                className="note-card"
                style={noteCardStyle(n.color)}
                onClick={() => openView(n)}
              >
                <button className="note-pin" onClick={e => { e.stopPropagation(); setNotes(ns => ns.map(x => x._id === n._id ? { ...x, pinned: !x.pinned } : x)); updateNote(n._id, { pinned: !n.pinned }).then(() => reloadNotes()); }} title={n.pinned ? 'Unpin' : 'Pin'}>
                  <Pin size={14} fill={n.pinned ? 'currentColor' : 'none'} />
                </button>
                {cover && (
                  <div className="note-card-cover">
                    <CachedAppFileImage url={cover.url} alt="" loading="lazy" />
                  </div>
                )}
                {n.title && <div className="note-title">{n.title}</div>}
                {n.body && (
                  <NoteBodyView
                    body={n.body}
                    attachments={n.attachments || []}
                    mode="preview"
                    className="note-body"
                    interactive
                    stopCheckboxPropagation
                    onBodyChange={html => void saveChecklistOnCard(n._id, html)}
                  />
                )}
                {n.attachments?.length > 0 && (
                  <div className="note-clip"><Paperclip size={11} /> {n.attachments.length}</div>
                )}
                <div className="note-time">
                  {n.projectId && n.userId?.email && n.userId.email.toLowerCase() !== myEmail && (
                    <span className="chip" style={{ marginRight: '6px' }}>{n.userId.name || n.userId.email}</span>
                  )}
                  {when(n.updatedAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
