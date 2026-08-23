'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Plus, Mic, UserPlus, Trash2, X, Check } from 'lucide-react';
import { getTasks, getMyOpenTasks, createTask, toggleTask, deleteTask, updateTask } from '@/actions/task';
import { getProjects, createProject, addMember, deleteProject, updateProjectNotes, renameProject } from '@/actions/project';
import ProjectPicker from '@/components/ProjectPicker';
import { reconcile, ensurePermissions } from '@/lib/taskNotifications';
import { useFeedback } from '@/components/ui/Feedback';

type Group = { key: string; label: string; tasks: any[]; cls?: string };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function fmtDue(iso: string) {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const diffDays = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Tomorrow · ${time}`;
  if (diffDays === -1) return `Yesterday · ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} · ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ` · ${time}`;
}

function groupTasks(tasks: any[]): Group[] {
  const now = Date.now();
  const today = startOfDay(new Date()).getTime();
  const tomorrow = today + 86400000;
  const g: Record<string, any[]> = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
  for (const t of tasks) {
    if (t.completed) g.done.push(t);
    else if (!t.dueAt) g.someday.push(t);
    else {
      const due = new Date(t.dueAt).getTime();
      if (due < now) g.overdue.push(t);
      else if (due < tomorrow) g.today.push(t);
      else g.upcoming.push(t);
    }
  }
  return [
    { key: 'overdue', label: 'Overdue', tasks: g.overdue, cls: 'overdue' },
    { key: 'today', label: 'Today', tasks: g.today },
    { key: 'upcoming', label: 'Upcoming', tasks: g.upcoming },
    { key: 'someday', label: 'No date', tasks: g.someday },
    { key: 'done', label: 'Done', tasks: g.done },
  ].filter(x => x.tasks.length);
}

export default function TasksPage() {
  const { toast, confirm } = useFeedback();
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'tasks' | 'notes'>('tasks');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<any | null>(null); // task being edited
  const [draft, setDraft] = useState({ title: '', dueAt: '', assigneeEmail: '', projectId: '' });

  const toLocalInput = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEdit = (task: any) => {
    setEditing(task);
    setDraft({
      title: task.title || '',
      dueAt: toLocalInput(task.dueAt),
      assigneeEmail: task.assigneeId?.email || task.assigneeEmail || '',
      projectId: task.projectId ? String(task.projectId) : '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await updateTask(editing._id, {
      title: draft.title.trim() || editing.title,
      dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      assigneeEmail: draft.projectId ? (draft.assigneeEmail || null) : null,
      projectId: draft.projectId || null,
    });
    if (res.success) {
      setEditing(null);
      fetchTasks(activeProject?._id);
      refreshReminders();
    } else toast(res.error || 'Something went wrong', 'error');
  };

  const myEmail = (session?.user?.email || '').toLowerCase();
  const memberOptions = activeProject
    ? [...new Set([myEmail, activeProject.ownerId?.email, ...(activeProject.memberEmails || [])])].filter(Boolean)
    : [];

  const fetchTasks = useCallback(async (projectId?: string) => {
    const res = await getTasks(projectId);
    if (res.success) setTasks(res.tasks || []);
    setLoading(false);
  }, []);
  const fetchProjects = useCallback(async () => {
    const res = await getProjects();
    if (res.success) setProjects(res.projects || []);
  }, []);
  const refreshReminders = useCallback(async () => {
    const res = await getMyOpenTasks();
    if (res.success) reconcile(res.tasks || []);
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return; // status, not session object (identity changes on refetch)
    fetchProjects();
    fetchTasks();
    ensurePermissions().then(refreshReminders);
  }, [status, fetchProjects, fetchTasks, refreshReminders]);

  const switchProject = (project: any | null) => {
    setActiveProject(project);
    setShowInvite(false);
    setView('tasks');
    setNotesDraft(project?.notes || '');
    setNotesSaved(true);
    setAssignee('');
    setLoading(true);
    fetchTasks(project?._id);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const t = title; setTitle('');
    const tempId = `tmp-${Date.now()}`;
    setTasks(prev => [{ _id: tempId, title: t, completed: false, dueAt: due ? new Date(due).toISOString() : null, isTemp: true }, ...prev]);
    const res = await createTask(t, {
      dueAt: due ? new Date(due).toISOString() : undefined,
      projectId: activeProject?._id,
      assigneeEmail: activeProject ? (assignee || myEmail) : undefined,
    });
    if (res.success) { setDue(''); fetchTasks(activeProject?._id); refreshReminders(); }
    else { setTasks(prev => prev.filter(x => x._id !== tempId)); toast(res.error || 'Something went wrong', 'error'); }
  };

  const handleToggle = async (id: string) => {
    setTasks(prev => prev.map(x => x._id === id ? { ...x, completed: !x.completed } : x));
    const res = await toggleTask(id);
    if (!res.success) fetchTasks(activeProject?._id);
    refreshReminders();
  };

  const handleDelete = async (id: string) => {
    setTasks(prev => prev.filter(x => x._id !== id));
    const res = await deleteTask(id);
    if (!res.success) fetchTasks(activeProject?._id);
    refreshReminders();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addMember(activeProject._id, inviteEmail);
    if (res.success) {
      const updated = { ...activeProject, memberEmails: [...new Set([...(activeProject.memberEmails || []), inviteEmail.trim().toLowerCase()])] };
      setActiveProject(updated); setProjects(ps => ps.map(p => p._id === updated._id ? updated : p));
      setInviteEmail(''); setShowInvite(false);
    } else toast(res.error || 'Something went wrong', 'error');
  };

  const handleSaveNotes = async () => {
    const res = await updateProjectNotes(activeProject._id, notesDraft);
    if (res.success) {
      setNotesSaved(true);
      const updated = { ...activeProject, notes: notesDraft };
      setActiveProject(updated); setProjects(ps => ps.map(p => p._id === updated._id ? updated : p));
    } else toast(res.error || 'Something went wrong', 'error');
  };

  // open-task counts per scope, refreshed with the task list
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    getMyOpenTasks().then(res => {
      if (!res.success) return;
      const map: Record<string, number> = {};
      for (const t of res.tasks || []) {
        const key = (t as any).projectId ? String((t as any).projectId) : 'personal';
        map[key] = (map[key] || 0) + 1;
      }
      setCounts(map);
    });
  }, [tasks]);

  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const open = tasks.filter(t => !t.completed);
  const overdueCount = groups.find(g => g.key === 'overdue')?.tasks.length || 0;
  const todayCount = groups.find(g => g.key === 'today')?.tasks.length || 0;
  const subtitle = open.length === 0 ? 'All clear'
    : [overdueCount && `${overdueCount} overdue`, todayCount && `${todayCount} due today`, `${open.length} open`].filter(Boolean).join(' · ');

  if (status === 'unauthenticated') {
    return (
      <div className="container" style={{ padding: '80px 16px', textAlign: 'center' }}>
        <h2 className="page-title">Tasks</h2>
        <p className="page-subtitle" style={{ marginBottom: '24px' }}>Sign in to see your tasks.</p>
        <Link href="/auth/signin" className="btn-primary" style={{ display: 'inline-block', padding: '12px 32px', borderRadius: '14px', fontWeight: 800 }}>Sign in</Link>
      </div>
    );
  }

  const assigneeLabel = (t: any) => {
    const email = t.assigneeId?.email || t.assigneeEmail;
    if (!email) return null;
    const isMe = email === myEmail;
    return (
      <span className={`chip ${isMe ? 'me' : ''}`} title={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span className="avatar-xs" style={{ width: '14px', height: '14px', fontSize: '0.55rem' }}>{email[0].toUpperCase()}</span>
        {isMe ? 'me' : email.split('@')[0]}
      </span>
    );
  };

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '18px' }}>
        <h1 className="page-title">{activeProject ? activeProject.name : 'Tasks'}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </header>

      {/* Scope: 4 recent chips + searchable picker */}
      <div style={{ marginBottom: '16px' }}>
        <ProjectPicker
          projects={projects}
          activeId={activeProject?._id || null}
          counts={counts}
          onSelect={switchProject}
          onCreate={async (name) => {
            const res = await createProject(name);
            if (res.success) { await fetchProjects(); switchProject(res.project); }
            else toast(res.error || 'Something went wrong', 'error');
            return res;
          }}
          onRename={async (proj, name) => {
            const res = await renameProject(proj._id, name);
            if (res.success) { await fetchProjects(); if (activeProject?._id === proj._id) setActiveProject({ ...activeProject, name }); }
            else toast(res.error || 'Something went wrong', 'error');
            return res;
          }}
          onDelete={async (proj) => {
            const res = await deleteProject(proj._id);
            if (res.success) { await fetchProjects(); if (activeProject?._id === proj._id) switchProject(null); }
            else toast(res.error || 'Something went wrong', 'error');
            return res;
          }}
          onInvite={() => setShowInvite(true)}
        />
      </div>

      {/* Project toolbar */}
      {activeProject && (
        <div className="card" style={{ padding: '10px 12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
            {memberOptions.map(email => (
              <span key={email} className="avatar-xs" title={email} style={{ width: '26px', height: '26px', fontSize: '0.7rem', border: '2px solid var(--bg-secondary)' }}>
                {email[0].toUpperCase()}
              </span>
            ))}
            <button className="icon-btn" style={{ width: '26px', height: '26px', borderRadius: '50%' }} onClick={() => setShowInvite(v => !v)} title="Invite teammate"><UserPlus size={13} /></button>
          </div>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-tertiary)', padding: '3px', borderRadius: '10px' }}>
            {(['tasks', 'notes'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', background: view === v ? 'var(--bg-secondary)' : 'transparent', color: view === v ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {v}
              </button>
            ))}
          </div>
          <Link href={`/mom?project=${activeProject._id}`} className="icon-btn" title="Meetings (MOM)"><Mic size={15} /></Link>
        </div>
      )}

      {showInvite && activeProject && (
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input className="field" type="email" placeholder="teammate@email.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required autoFocus />
          <button type="submit" className="btn-primary" style={{ padding: '10px 20px', borderRadius: '12px', fontWeight: 800 }}>Invite</button>
        </form>
      )}

      {activeProject && view === 'notes' && (
        <div>
          <textarea className="field" rows={12} placeholder="Project notes — context, decisions, links…" value={notesDraft}
            onChange={e => { setNotesDraft(e.target.value); setNotesSaved(false); }} style={{ resize: 'vertical', lineHeight: 1.6 }} />
          <button onClick={handleSaveNotes} disabled={notesSaved} className="btn-primary" style={{ marginTop: '10px', padding: '10px 24px', borderRadius: '12px', fontWeight: 800, opacity: notesSaved ? 0.5 : 1 }}>
            {notesSaved ? 'Saved' : 'Save notes'}
          </button>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Edit task</h2>
              <button className="modal-close" onClick={() => setEditing(null)}><X size={22} /></button>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              <input className="field" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Task" autoFocus />
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Due</label>
              <input className="field" type="datetime-local" value={draft.dueAt} onChange={e => setDraft(d => ({ ...d, dueAt: e.target.value }))}
                style={{ color: draft.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Project</label>
              <select className="field" value={draft.projectId} onChange={e => setDraft(d => ({ ...d, projectId: e.target.value, assigneeEmail: '' }))}>
                <option value="">Personal (no project)</option>
                {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
              {draft.projectId && (
                <>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Assigned to</label>
                  <select className="field" value={draft.assigneeEmail} onChange={e => setDraft(d => ({ ...d, assigneeEmail: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {[...new Set([myEmail,
                      ...(projects.find(p => p._id === draft.projectId)?.ownerId?.email ? [projects.find(p => p._id === draft.projectId).ownerId.email] : []),
                      ...(projects.find(p => p._id === draft.projectId)?.memberEmails || []),
                      draft.assigneeEmail].filter(Boolean))].map(email => (
                      <option key={email} value={email}>{email === myEmail ? 'me' : email}</option>
                    ))}
                  </select>
                </>
              )}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', marginTop: '6px' }}>
                <button className="icon-btn danger" title="Delete task"
                  onClick={async () => { if (await confirm({ title: 'Delete this task?', danger: true, confirmLabel: 'Delete' })) { handleDelete(editing._id); setEditing(null); } }}>
                  <Trash2 size={16} />
                </button>
                <button className="btn-primary" onClick={saveEdit} style={{ padding: '11px 26px', borderRadius: '12px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Check size={16} /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(!activeProject || view === 'tasks') && (
        <>
          <form onSubmit={handleCreate} className="quick-add">
            <div className="quick-add-main">
              <input type="text" placeholder={activeProject ? `Add a task to ${activeProject.name}…` : 'Add a task…'} value={title} onChange={e => setTitle(e.target.value)} />
              <button type="submit" className="btn-primary" disabled={!title.trim()} style={{ padding: '9px 18px', borderRadius: '12px', fontWeight: 800, opacity: title.trim() ? 1 : 0.5 }}>Add</button>
            </div>
            <div className="quick-add-meta">
              <input className="field" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} title="Due — reminders are automatic" style={{ color: due ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
              {activeProject && (
                <select className="field" value={assignee} onChange={e => setAssignee(e.target.value)}>
                  <option value="">Assign to me</option>
                  {memberOptions.filter(e => e !== myEmail).map(email => <option key={email} value={email}>{email}</option>)}
                </select>
              )}
            </div>
          </form>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontWeight: 800, marginBottom: '4px' }}>Nothing here yet</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Add a task above. Give it a due time and you'll get reminders.</p>
            </div>
          ) : (
            groups.map(g => (
              <section key={g.key} className="task-group">
                <div className={`task-group-label ${g.cls || ''}`} style={{ cursor: g.key === 'done' ? 'pointer' : 'default' }} onClick={() => g.key === 'done' && setShowDone(v => !v)}>
                  {g.label} <span className="count">{g.tasks.length}</span>
                  {g.key === 'done' && <span style={{ marginLeft: 'auto', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{showDone ? 'hide' : 'show'}</span>}
                </div>
                {(g.key !== 'done' || showDone) && g.tasks.map(t => {
                  const overdue = t.dueAt && !t.completed && new Date(t.dueAt).getTime() < Date.now();
                  const isToday = t.dueAt && !overdue && startOfDay(new Date(t.dueAt)).getTime() === startOfDay(new Date()).getTime();
                  return (
                    <div key={t._id} className={`task-row ${t.completed ? 'done' : ''}`} style={{ opacity: t.isTemp ? 0.5 : undefined }}>
                      <button className={`task-check ${t.completed ? 'on' : ''}`} onClick={() => handleToggle(t._id)} aria-label="toggle">
                        {t.completed && <svg width="12" height="9" viewBox="0 0 14 10" fill="none"><path d="M1.5 5L5.5 9L12.5 1.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => !t.isTemp && openEdit(t)}>
                        <div className="task-title">{t.title}</div>
                        {(t.dueAt || activeProject) && (
                          <div className="task-meta">
                            {t.dueAt && <span className={`chip ${overdue ? 'overdue' : isToday ? 'today' : ''}`}>{fmtDue(t.dueAt)}</span>}
                            {activeProject && assigneeLabel(t)}
                          </div>
                        )}
                      </div>
                      <button className="task-del" onClick={() => handleDelete(t._id)} title="Delete">×</button>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
