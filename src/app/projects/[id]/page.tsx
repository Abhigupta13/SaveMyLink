'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Trash2, X, Check, Download, Pencil, ChevronDown, StickyNote, FileText } from 'lucide-react';
import { getTasks, createTask, toggleTask, deleteTask, updateTask } from '@/actions/task';
import { getProjects, addMember, removeMember, addOwner, removeOwner, deleteProject, updateProjectNotes, renameProject } from '@/actions/project';
import { getMoms } from '@/actions/mom';
import { getNotes } from '@/actions/note';
import { getDocuments } from '@/actions/document';
import PersonPicker from '@/components/PersonPicker';
import MomSection from '@/components/MomSection';
import { useFeedback } from '@/components/ui/Feedback';
import { formatTime, formatDay, formatDate } from '@/lib/time';
import { isProjectOwner, isProjectCreator } from '@/lib/scope';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function fmtDue(iso: string) {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  const time = formatTime(d);
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Tomorrow · ${time}`;
  if (diffDays === -1) return `Yesterday · ${time}`;
  return `${formatDay(d)} · ${time}`;
}
const fmtDate = (iso: string) => formatDate(iso);

type Section = 'tasks' | 'meetings' | 'notes' | 'files' | 'about' | 'people';

export default function ProjectWorkspace() {
  const { toast, confirm } = useFeedback();
  const { data: session, status } = useSession();
  const router = useRouter();
  const projectId = String(useParams().id || '');

  const [projects, setProjects] = useState<any[]>([]);
  const [project, setProject] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [moms, setMoms] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [openSections, setOpenSections] = useState<Record<Section, boolean>>({ tasks: true, meetings: true, notes: true, files: true, about: false, people: true });

  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [inviting, setInviting] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);
  const [renaming, setRenaming] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', dueAt: '', assigneeEmail: '' });

  const myEmail = (session?.user?.email || '').toLowerCase();
  const isOwner = isProjectOwner(project, myEmail);
  const isCreator = isProjectCreator(project, myEmail);
  const [busyOwner, setBusyOwner] = useState('');

  const handleOwner = async (email: string, promote: boolean) => {
    setBusyOwner(email);
    const res = promote ? await addOwner(projectId, email) : await removeOwner(projectId, email);
    setBusyOwner('');
    if (!res.success) return toast(res.error || 'Something went wrong', 'error');
    toast(promote ? `${email} is now an owner` : `${email} is no longer an owner`, 'success');
    load();
  };

  const memberOptions = useMemo(
    () => (project ? [...new Set([project.ownerId?.email, ...(project.memberEmails || [])])].filter(Boolean) as string[] : []),
    [project]
  );
  // email -> { name, hasAccount }, resolved server-side from User then your own Contacts
  const people = useMemo(
    () => new Map<string, any>((project?.people || []).map((p: any) => [p.email, p])),
    [project]
  );
  /** Their name if we know one, otherwise the address — never an empty label. */
  const nameOf = useCallback((email: string) => people.get(email)?.name || email, [people]);
  const shortOf = useCallback(
    (email: string) => people.get(email)?.name?.split(' ')[0] || email.split('@')[0],
    [people]
  );

  const toLocalInput = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fetchTasks = useCallback(async () => {
    const res = await getTasks(projectId);
    if (res.success) setTasks(res.tasks || []);
  }, [projectId]);

  const fetchMoms = useCallback(async () => {
    const res = await getMoms(projectId);
    if (res.success) setMoms(res.moms || []);
  }, [projectId]);

  // Notes and documents are fetched whole and filtered here — both actions already return
  // only what I may see, and neither list is big enough to be worth a project-scoped query.
  const fetchNotes = useCallback(async () => {
    const res = await getNotes();
    if (res.success) setNotes((res.notes || []).filter((n: any) => n.projectId?._id === projectId));
  }, [projectId]);

  const fetchFiles = useCallback(async () => {
    const res = await getDocuments();
    setFiles((res.docs || []).filter((d: any) => d.projectId?._id === projectId));
  }, [projectId]);

  const load = useCallback(async () => {
    const res = await getProjects();
    const found = res.success ? (res.projects || []).find((p: any) => String(p._id) === projectId) : null;
    if (!found) { setNotFound(true); setLoading(false); return; }
    setProjects(res.projects || []);
    setProject(found);
    setNotesDraft(found.notes || '');
    setRenaming(found.name);
    await Promise.all([fetchTasks(), fetchMoms(), fetchNotes(), fetchFiles()]);
    setLoading(false);
  }, [projectId, fetchTasks, fetchMoms, fetchNotes, fetchFiles]);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  /**
   * A shared project changes under you — someone ticks off a task, adds a meeting, joins.
   * Re-fetch whenever you come back to the tab. Catches nearly everything a poll would, with
   * no timer hitting the database while the page sits open in the background.
   * ponytail: focus-only; add polling or sockets if people are ever in here simultaneously.
   */
  useEffect(() => {
    if (status !== 'authenticated') return;
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [status, load]);

  // ---------- tasks ----------
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await createTask(title, {
      dueAt: due ? new Date(due).toISOString() : undefined,
      projectId,
      assigneeEmail: assignee || myEmail,
    });
    if (res.success) { setTitle(''); setDue(''); fetchTasks(); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  const handleToggle = async (id: string) => {
    setTasks(prev => prev.map(x => x._id === id ? { ...x, completed: !x.completed } : x));
    const res = await toggleTask(id);
    if (!res.success) fetchTasks();
  };

  const handleDelete = async (id: string) => {
    setTasks(prev => prev.filter(x => x._id !== id));
    const res = await deleteTask(id);
    if (!res.success) { toast(res.error || 'Could not delete', 'error'); fetchTasks(); }
  };

  const openEdit = (task: any) => {
    setEditing(task);
    setDraft({
      title: task.title || '',
      description: task.description || '',
      dueAt: toLocalInput(task.dueAt),
      assigneeEmail: task.assigneeId?.email || task.assigneeEmail || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await updateTask(editing._id, {
      title: draft.title.trim() || editing.title,
      description: draft.description.trim(),
      dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      assigneeEmail: draft.assigneeEmail || null,
    });
    if (res.success) { setEditing(null); fetchTasks(); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  // ---------- project ----------
  const handleRename = async () => {
    const name = renaming.trim();
    if (!name || name === project.name) return;
    const res = await renameProject(projectId, name);
    if (res.success) setProject((p: any) => ({ ...p, name }));
    else { toast(res.error || 'Something went wrong', 'error'); setRenaming(project.name); }
  };

  const handleSaveNotes = async () => {
    const res = await updateProjectNotes(projectId, notesDraft);
    if (res.success) { setNotesSaved(true); setProject((p: any) => ({ ...p, notes: notesDraft })); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  const handleInvite = async (raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    const res = await addMember(projectId, email);
    setInviting(false);
    if (res.success) {
      // Reload rather than patch: the server resolved their name and whether they have an
      // account, and neither is knowable from here.
      await load();
      // Say plainly whether mail actually went out — SMTP being unconfigured is silent otherwise
      toast(res.emailed ? `Invite emailed to ${email}` : `${email} added — no invite email sent (SMTP not configured)`,
        res.emailed ? 'success' : 'error');
    } else toast(res.error || 'Something went wrong', 'error');
  };

  const handleRemove = async (email: string) => {
    if (!await confirm({ title: `Remove ${nameOf(email)}?`, message: 'Their tasks stay in the project but become unassigned.', danger: true, confirmLabel: 'Remove' })) return;
    const res = await removeMember(projectId, email);
    if (res.success) { setProject((p: any) => ({ ...p, memberEmails: (p.memberEmails || []).filter((e: string) => e !== email) })); fetchTasks(); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  const handleDeleteProject = async () => {
    if (!await confirm({ title: `Delete "${project.name}"?`, message: 'The project and its tasks and meetings go with it.', danger: true, confirmLabel: 'Delete' })) return;
    const res = await deleteProject(projectId);
    if (res.success) router.push('/projects');
    else toast(res.error || 'Something went wrong', 'error');
  };

  const open = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);
  const overdue = open.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now());
  const toggleSection = (s: Section) => setOpenSections(o => ({ ...o, [s]: !o[s] }));

  if (status === 'unauthenticated') {
    return (
      <div className="container" style={{ padding: '80px 16px', textAlign: 'center' }}>
        <h2 className="page-title">Project</h2>
        <Link href="/auth/signin" className="btn-primary" style={{ display: 'inline-block', padding: '12px 32px', borderRadius: '14px', fontWeight: 800 }}>Sign in</Link>
      </div>
    );
  }
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}><div className="loading-spinner"></div></div>;
  if (notFound || !project) {
    return (
      <div className="container" style={{ padding: '80px 16px', textAlign: 'center' }}>
        <h2 className="page-title">Not found</h2>
        <p className="page-subtitle" style={{ marginBottom: '24px' }}>This project does not exist, or you are not a member.</p>
        <Link href="/projects" className="btn-primary" style={{ display: 'inline-block', padding: '12px 32px', borderRadius: '14px', fontWeight: 800 }}>All projects</Link>
      </div>
    );
  }

  const sectionHead = (key: Section, label: string, count: number, extra?: React.ReactNode) => (
    <div className="ws-head">
      <button className="ws-head-btn" onClick={() => toggleSection(key)}>
        <ChevronDown size={16} style={{ transform: openSections[key] ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
        {label} <span className="count">{count}</span>
      </button>
      {extra}
    </div>
  );

  return (
    <>
      <div className="container ws-page print-hide" style={{ padding: '24px 16px 120px' }}>
        <Link href="/projects" className="subtle-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
          <ArrowLeft size={15} /> Projects
        </Link>

        <header style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '18px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input className="ws-title" value={renaming} onChange={e => setRenaming(e.target.value)} onBlur={handleRename}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              disabled={!isOwner} title={isOwner ? 'Click to rename' : 'Only an owner can rename'} />
            <p className="page-subtitle">
              {[overdue.length && `${overdue.length} overdue`, `${open.length} open`, `${moms.length} meeting${moms.length === 1 ? '' : 's'}`, `${memberOptions.length} member${memberOptions.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            </p>
            {/* Who started this group, stated once. It is the only thing the old "creator" chip
                actually told you, and it belongs with the group, not beside a person's name. */}
            {project.ownerId?.email && (
              <p className="ws-created">
                Created by {project.ownerId.email === myEmail ? 'you' : nameOf(project.ownerId.email)} · {fmtDate(project.createdAt)}
              </p>
            )}
          </div>
          <button className="icon-btn" onClick={() => window.print()} title="Download as PDF"><Download size={16} /></button>
          {isCreator && <button className="icon-btn danger" onClick={handleDeleteProject} title="Delete project"><Trash2 size={16} /></button>}
        </header>

        <div className="ws-grid">
          <div className="ws-main">

        {/* ---------- Tasks ---------- */}
        <section className="ws-section">
          {sectionHead('tasks', 'Tasks', open.length)}
          {openSections.tasks && (
            <>
              <form onSubmit={handleCreate} className="quick-add">
                <div className="quick-add-main">
                  <input type="text" placeholder={`Add a task to ${project.name}…`} value={title} onChange={e => setTitle(e.target.value)} />
                  <button type="submit" className="btn-primary" disabled={!title.trim()} style={{ padding: '9px 18px', borderRadius: '12px', fontWeight: 800, opacity: title.trim() ? 1 : 0.5 }}>Add</button>
                </div>
                <div className="quick-add-meta">
                  <input className="field" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} title="Due — reminders are automatic"
                    style={{ color: due ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                  <select className="field" value={assignee} onChange={e => setAssignee(e.target.value)}>
                    <option value="">Assign to me</option>
                    {memberOptions.filter(e => e !== myEmail).map(email => <option key={email} value={email}>{nameOf(email)}</option>)}
                  </select>
                </div>
              </form>

              {tasks.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '4px 2px 12px' }}>No tasks yet.</p>
              ) : (
                [...open, ...(showDone ? done : [])].map(t => {
                  const isOverdue = t.dueAt && !t.completed && new Date(t.dueAt).getTime() < Date.now();
                  const who = t.assigneeId?.email || t.assigneeEmail;
                  return (
                    <div key={t._id} className={`task-row ${t.completed ? 'done' : ''}`}>
                      <button className={`task-check ${t.completed ? 'on' : ''}`} onClick={() => handleToggle(t._id)} aria-label="toggle">
                        {t.completed && <svg width="12" height="9" viewBox="0 0 14 10" fill="none"><path d="M1.5 5L5.5 9L12.5 1.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => openEdit(t)}>
                        <div className="task-title">{t.title}</div>
                        {t.description && <div className="task-desc">{t.description}</div>}
                        <div className="task-meta">
                          {t.dueAt && <span className={`chip ${isOverdue ? 'overdue' : ''}`}>{fmtDue(t.dueAt)}</span>}
                          {who && <span className={`chip ${who === myEmail ? 'me' : ''}`} title={who}>{who === myEmail ? 'me' : shortOf(who)}</span>}
                        </div>
                      </div>
                      {isOwner && <button className="task-del" onClick={() => handleDelete(t._id)} title="Delete">×</button>}
                    </div>
                  );
                })
              )}
              {done.length > 0 && (
                <button className="subtle-link" onClick={() => setShowDone(v => !v)} style={{ marginTop: '8px', fontSize: '0.8rem' }}>
                  {showDone ? 'Hide' : 'Show'} {done.length} done
                </button>
              )}
            </>
          )}
        </section>

        {/* ---------- Meetings ---------- */}
        <section className="ws-section">
          {sectionHead('meetings', 'Meetings', moms.length)}
          {openSections.meetings && (
            <MomSection project={project} projects={projects} myEmail={myEmail} memberOptions={memberOptions}
              onTasksCreated={() => { fetchTasks(); fetchMoms(); fetchNotes(); load(); }} />
          )}
        </section>

        {/* ---------- Notes ---------- */}
        <section className="ws-section">
          {sectionHead('notes', 'Notes', notes.length)}
          {openSections.notes && (
            <>
              {notes.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem', padding: '8px 0' }}>
                  No notes yet — meetings file them here automatically.
                </p>
              ) : notes.map(n => (
                <Link key={n._id} href="/notes" className="task-row" style={{ textDecoration: 'none', alignItems: 'flex-start' }}>
                  <StickyNote size={15} style={{ flexShrink: 0, marginTop: '3px', color: 'var(--text-tertiary)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="task-title">{n.title || 'Untitled note'}</div>
                    {n.body && <div className="task-desc">{n.body.replace(/\s+/g, ' ').slice(0, 140)}</div>}
                    <div className="task-meta">
                      <span className="chip">{n.userId?.name || n.userId?.email || 'me'}</span>
                      <span className="chip">{fmtDate(n.updatedAt)}</span>
                    </div>
                  </div>
                </Link>
              ))}
              <Link href="/notes" className="subtle-link" style={{ display: 'inline-block', marginTop: '8px', fontSize: '0.8rem' }}>
                Write a note →
              </Link>
            </>
          )}
        </section>

          </div>{/* /ws-main */}

          <aside className="ws-rail">
        {/* ---------- People ---------- */}
        <section className="ws-section">
          {sectionHead('people', 'People', memberOptions.length)}
          {openSections.people && (
            <>
              {memberOptions.map(email => {
                const creator = isProjectCreator(project, email);
                const owner = creator || isProjectOwner(project, email);
                const load = open.filter(t => (t.assigneeId?.email || t.assigneeEmail) === email).length;
                return (
                  <div key={email} className="task-row">
                    <span className="avatar-xs" style={{ width: '28px', height: '28px', fontSize: '0.75rem' }}>{nameOf(email)[0].toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="task-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email === myEmail ? `${nameOf(email)} (you)` : nameOf(email)}
                      </div>
                      <div className="task-meta">
                        {/* The address still matters — it is what an invite was sent to */}
                        {people.get(email)?.name && <span className="chip" title={email}>{email}</span>}
                        {/* One word for one power. "creator" read as a second, higher rank
                            when it is only a fact about the past — who made the group, which
                            the "Created by" note under the title already says. */}
                        {owner && <span className="chip" title="Can add members, rename, and delete shared work">owner</span>}
                        <span className="chip">{load} open</span>
                        {/* "pending", not "invite sent" — members added before invite emails
                            existed never got one, and the chip should not claim otherwise */}
                        {!people.get(email)?.hasAccount && <span className="chip" title="No account yet — they see the project once they sign up with this address">pending</span>}
                      </div>
                    </div>
                    {/* Any owner may promote or demote; the creator is permanent, so their row
                        offers nothing. Removing a co-owner strips their owner rights too. */}
                    {isOwner && !creator && email !== myEmail && (
                      <button className="subtle-link" onClick={() => handleOwner(email, !owner)} disabled={busyOwner === email}>
                        {owner ? 'Remove owner' : 'Make owner'}
                      </button>
                    )}
                    {isOwner && !owner && <button className="task-del" onClick={() => handleRemove(email)} title="Remove">×</button>}
                  </div>
                );
              })}
              {/* Owner only — addMember is owner-scoped server-side, so showing this to a
                  member would just fail. Picking beats typing: a typo'd address silently
                  emails a stranger, or nobody. */}
              {isOwner && (
                <PersonPicker exclude={memberOptions} onPick={handleInvite} busy={inviting} />
              )}
            </>
          )}
        </section>

        {/* ---------- Files ---------- */}
        <section className="ws-section">
          {sectionHead('files', 'Files', files.length)}
          {openSections.files && (
            <>
              {files.length === 0 ? null : files.map(d => (
                <a key={d._id} href={d.url} target="_blank" rel="noreferrer" className="task-row" style={{ textDecoration: 'none' }}>
                  <FileText size={15} style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="task-title">{d.name}</div>
                    <div className="task-meta"><span className="chip">{fmtDate(d.createdAt)}</span></div>
                  </div>
                </a>
              ))}
              <Link href="/d-locker" className="subtle-link" style={{ display: 'inline-block', marginTop: files.length ? '8px' : '0', fontSize: '0.8rem' }}>
                {files.length ? 'Open the Digi Locker →' : 'Add from the Digi Locker →'}
              </Link>
            </>
          )}
        </section>

        {/* ---------- About: one shared description of the project, not a note per thought ---------- */}
        <section className="ws-section">
          {sectionHead('about', 'About', notesDraft ? 1 : 0)}
          {openSections.about && (
            <>
              <textarea className="field" rows={8} placeholder="What this project is — context, decisions, links…" value={notesDraft}
                onChange={e => { setNotesDraft(e.target.value); setNotesSaved(false); }} style={{ resize: 'vertical', lineHeight: 1.6 }} />
              <button onClick={handleSaveNotes} disabled={notesSaved} className="btn-primary"
                style={{ marginTop: '10px', padding: '10px 24px', borderRadius: '12px', fontWeight: 800, opacity: notesSaved ? 0.5 : 1 }}>
                {notesSaved ? 'Saved' : 'Save'}
              </button>
            </>
          )}
        </section>

          </aside>
        </div>{/* /ws-grid */}

        {editing && (
          <div className="modal-overlay" onClick={() => setEditing(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
              <div className="modal-header">
                <h2 className="modal-title">Edit task</h2>
                <button className="modal-close" onClick={() => setEditing(null)}><X size={22} /></button>
              </div>
              <div style={{ display: 'grid', gap: '10px' }}>
                <input className="field" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Task" autoFocus />
                <textarea className="field" rows={4} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="Description — details, checklist, links…" style={{ resize: 'vertical', lineHeight: 1.5 }} />
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Due</label>
                <input className="field" type="datetime-local" value={draft.dueAt} onChange={e => setDraft(d => ({ ...d, dueAt: e.target.value }))}
                  style={{ color: draft.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Assigned to</label>
                <select className="field" value={draft.assigneeEmail} onChange={e => setDraft(d => ({ ...d, assigneeEmail: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {[...new Set([...memberOptions, draft.assigneeEmail].filter(Boolean))].map(email => (
                    <option key={email} value={email}>{email === myEmail ? 'me' : email}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', marginTop: '6px' }}>
                  {isOwner ? (
                    <button className="icon-btn danger" title="Delete task"
                      onClick={async () => { if (await confirm({ title: 'Delete this task?', danger: true, confirmLabel: 'Delete' })) { handleDelete(editing._id); setEditing(null); } }}>
                      <Trash2 size={16} />
                    </button>
                  ) : <span />}
                  <button className="btn-primary" onClick={saveEdit} style={{ padding: '11px 26px', borderRadius: '12px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={16} /> Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Printed report — hidden on screen, and the only thing on the page when printing. */}
      <div className="print-only">
        <h1>{project.name}</h1>
        <p className="print-sub">
          {memberOptions.length} member{memberOptions.length === 1 ? '' : 's'} · {open.length} open · {done.length} done · {moms.length} meeting{moms.length === 1 ? '' : 's'}
          <br />Exported {fmtDate(new Date().toISOString())}
        </p>

        <h2>People</h2>
        <ul>
          {memberOptions.map(email => (
            <li key={email}>{email}{isProjectOwner(project, email) ? ' — owner' : ''} · {open.filter(t => (t.assigneeId?.email || t.assigneeEmail) === email).length} open</li>
          ))}
        </ul>

        <h2>Open tasks ({open.length})</h2>
        {open.length === 0 ? <p>None.</p> : (
          <table>
            <thead><tr><th>Task</th><th>Due</th><th>Owner</th></tr></thead>
            <tbody>
              {open.map(t => (
                <tr key={t._id}>
                  <td>
                    <strong>{t.title}</strong>
                    {t.description && <div className="print-desc">{t.description}</div>}
                  </td>
                  <td>{t.dueAt ? fmtDue(t.dueAt) : '—'}</td>
                  <td>{(t.assigneeId?.email || t.assigneeEmail || '—').split('@')[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {done.length > 0 && (
          <>
            <h2>Completed ({done.length})</h2>
            <ul>{done.map(t => <li key={t._id}>{t.title}</li>)}</ul>
          </>
        )}

        {notesDraft && (<><h2>Notes</h2><p className="print-pre">{notesDraft}</p></>)}

        {moms.length > 0 && (
          <>
            <h2>Meetings ({moms.length})</h2>
            {moms.map(m => (
              <div key={m._id} className="print-block">
                <h3>{m.title} <span className="print-sub">{fmtDate(m.createdAt)}</span></h3>
                {m.summary && <p className="print-pre">{m.summary}</p>}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
