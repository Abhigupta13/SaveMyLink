'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { hintFor } from '@/lib/nav';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Plus, Trash2, X, Check, ArrowRight, BadgeCheck } from 'lucide-react';
import { getTasks, getMyOpenTasks, createTask, toggleTask, deleteTask, updateTask } from '@/actions/task';
import { getProjects, createProject, deleteProject, renameProject } from '@/actions/project';
import ProjectPicker from '@/components/ProjectPicker';
import AssigneePicker from '@/components/AssigneePicker';
import ReminderPicker from '@/components/ReminderPicker';
import type { ReminderChoice } from '@/lib/reminderRule';
import { reconcile, ensurePermissions } from '@/lib/taskNotifications';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';
import { useShareNotice } from '@/components/ShareNotice';
import { useUser } from '@/components/UserContext';
import { SafeBanner, SafeEmpty, PrivateToggle, droppedPrivacy } from '@/components/PrivateSafe';
import { formatTime, formatDay } from '@/lib/time';
import { isProjectOwner, canWrite } from '@/lib/scope';
import { assigneeEmailsOf } from '@/lib/taskAccess';

type Group = { key: string; label: string; tasks: any[]; cls?: string };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function fmtDue(iso: string) {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const diffDays = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  const time = formatTime(d);
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Tomorrow · ${time}`;
  if (diffDays === -1) return `Yesterday · ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} · ${time}`;
  return `${formatDay(d)} · ${time}`;
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
  const { confirmShare, shareDialog } = useShareNotice();
  const { privateSafe } = useUser();
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string[]>([]);   // several people, one shared task
  const [loading, setLoading] = useState(true);
  // Distinct from "no tasks": empty means empty, this means we could not find out.
  const [failed, setFailed] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<any | null>(null); // task being edited
  const [draft, setDraft] = useState<{ title: string; description: string; dueAt: string; assigneeEmails: string[]; projectId: string; reminder: ReminderChoice | null; isPrivate: boolean }>(
    { title: '', description: '', dueAt: '', assigneeEmails: [], projectId: '', reminder: null, isPrivate: false });
  // The quick-add starts in whichever vault you are looking at: a task added with the safe open
  // and saved outside it would vanish the moment the list refreshed.
  const [newPrivate, setNewPrivate] = useState(false);
  useEffect(() => { setNewPrivate(privateSafe); }, [privateSafe]);
  // The profile default. It pre-fills the quick-add and stands in for every task written before
  // the setting existed — the phone needs it to know what a task with no reminder of its own means.
  const [reminderDefault, setReminderDefault] = useState<ReminderChoice | null>(null);
  const [remind, setRemind] = useState<ReminderChoice | null>(null);

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
      description: task.description || '',
      dueAt: toLocalInput(task.dueAt),
      assigneeEmails: assigneeEmailsOf(task),
      projectId: task.projectId ? String(task.projectId) : '',
      // A task written before the setting existed opens showing what it actually does today —
      // the profile default — rather than an empty control that means nothing.
      reminder: task.reminder || reminderDefault,
      isPrivate: !!task.isPrivate,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const group = projects.find(p => p._id === draft.projectId);
    if (!(await confirmShare(group))) return;
    const res = await updateTask(editing._id, {
      title: draft.title.trim() || editing.title,
      description: draft.description.trim(),
      dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      assigneeEmails: draft.projectId ? draft.assigneeEmails : [],
      projectId: draft.projectId || null,
      reminder: draft.reminder,
      isPrivate: draft.isPrivate,
    });
    if (res.success) {
      // Moving a private task into a group is the one move that quietly unlocks it. Say so.
      if (res.privacyDropped) toast(droppedPrivacy(group?.name), 'info');
      setEditing(null);
      fetchTasks(activeProject?._id);
      refreshReminders();
    } else toast(res.error || 'Something went wrong', 'error');
  };

  const myEmail = (session?.user?.email || '').toLowerCase();
  // Only a project's owner may delete work inside it; personal tasks stay mine.
  const canRemove = (t: any) => {
    const pid = t?.projectId?._id || t?.projectId;
    if (!pid) return true;
    const proj = projects.find((p: any) => String(p._id) === String(pid)) || activeProject;
    return isProjectOwner(proj, myEmail);
  };

  const memberOptions = activeProject
    ? [...new Set([myEmail, activeProject.ownerId?.email, ...(activeProject.memberEmails || []), ...(activeProject.viewerEmails || [])])].filter(Boolean)
    : [];

  /** Personal tasks are always yours. Inside a group, view-only means read-only here too. */
  const canEdit = !activeProject || canWrite(activeProject, myEmail);

  /* A throw used to leave the spinner running for the rest of the session, and a resolved
     `success: false` rendered "Nothing here yet" — which reads as "your tasks are done" when it
     actually means we never found out. `failed` keeps them apart. */
  const fetchTasks = useCallback(async (projectId?: string) => {
    setFailed(false);
    try {
      const res = await getTasks(projectId);
      if (res.success) setTasks(res.tasks || []);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  const fetchProjects = useCallback(async () => {
    const res = await getProjects();
    if (res.success) setProjects(res.projects || []);
  }, []);
  const refreshReminders = useCallback(async () => {
    const res = await getMyOpenTasks();
    if (!res.success) return;
    const fallback = (res.reminderDefault as ReminderChoice) || null;
    setReminderDefault(fallback);
    setRemind(prev => prev ?? fallback);   // the quick-add starts on your default, then stays where you put it
    reconcile(res.tasks || [], fallback);
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return; // status, not session object (identity changes on refetch)
    fetchProjects();
    fetchTasks();
    ensurePermissions().then(refreshReminders);
  }, [status, fetchProjects, fetchTasks, refreshReminders]);

  const switchProject = (project: any | null) => {
    setActiveProject(project);
    setAssignee([]);
    setLoading(true);
    fetchTasks(project?._id);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (!(await confirmShare(activeProject))) return;
    const t = title; setTitle('');
    const tempId = `tmp-${Date.now()}`;
    setTasks(prev => [{ _id: tempId, title: t, completed: false, dueAt: due ? new Date(due).toISOString() : null, isTemp: true }, ...prev]);
    const res = await createTask(t, {
      dueAt: due ? new Date(due).toISOString() : undefined,
      projectId: activeProject?._id,
      assigneeEmails: activeProject ? (assignee.length ? assignee : [myEmail]) : undefined,
      reminder: remind || undefined,   // undefined means "whatever my profile default is", resolved server-side
      isPrivate: newPrivate,
    });
    if (res.success) {
      if (res.privacyDropped) toast(droppedPrivacy(activeProject?.name), 'info');
      setDue(''); fetchTasks(activeProject?._id); refreshReminders();
    }
    else { setTasks(prev => prev.filter(x => x._id !== tempId)); toast(res.error || 'Something went wrong', 'error'); }
  };

  /* The optimistic tick is reverted by the refetch when the server refuses — but the REASON was
     being dropped on the floor, so the box ticked, silently un-ticked, and the person was left
     with no idea whether they had mis-tapped or the app was broken. A refusal here is usually a
     rule (someone else's task, or nobody assigned yet), and a rule the user cannot see is
     indistinguishable from a bug. */
  const handleToggle = async (id: string) => {
    setTasks(prev => prev.map(x => x._id === id ? { ...x, completed: !x.completed } : x));
    const res = await toggleTask(id);
    if (!res.success) {
      fetchTasks(activeProject?._id);
      toast(res.error || 'Could not update that task', 'error');
    }
    refreshReminders();
  };

  const handleDelete = async (id: string) => {
    setTasks(prev => prev.filter(x => x._id !== id));
    const res = await deleteTask(id);
    if (!res.success) {
      fetchTasks(activeProject?._id);
      toast(res.error || 'Could not delete that task', 'error');
    }
    refreshReminders();
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

  /**
   * The named chip, plus a "+2" for the rest. A shared task shows one name and a count rather than
   * a row of chips that wraps to three lines on a phone — the others are in the tooltip, and in the
   * edit sheet if you actually need them.
   *
   * If I am one of the assignees the chip is *me*, whether or not I am the primary. Showing a
   * colleague's name on work I am holding reads as somebody else's task, which is the one thing
   * this row must never say.
   */
  const mineFirst = (list: string[]) =>
    list.includes(myEmail) ? [myEmail, ...list.filter(e => e !== myEmail)] : list;

  const assigneeLabel = (t: any) => {
    const [email, ...rest] = mineFirst(assigneeEmailsOf(t));
    if (!email) return null;
    const isMe = email === myEmail;
    return (
      <>
        <span className={`chip ${isMe ? 'me' : ''}`} title={email} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span className="avatar-xs" style={{ width: '14px', height: '14px', fontSize: '0.55rem' }}>{email[0].toUpperCase()}</span>
          {isMe ? 'me' : email.split('@')[0]}
        </span>
        {rest.length > 0 && <span className="chip more" title={`Also ${rest.join(', ')}`}>+{rest.length}</span>}
      </>
    );
  };

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      {shareDialog}
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
        />
      </div>

      {/* Tasks is a list with a filter. Meetings, files, people and the brief live in the
          project workspace — one home per project instead of two half-built ones. */}
      {activeProject && (
        <Link href={`/projects/${activeProject._id}`} className="card"
          style={{ padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
          Open the {activeProject.name} workspace — meetings, files, notes, people
          <ArrowRight size={15} style={{ marginLeft: 'auto', flexShrink: 0 }} />
        </Link>
      )}

      {/* Personal only: a group's tasks never swap, so the banner would be describing a list the
          safe is not touching. */}
      {!activeProject && <SafeBanner noun="tasks" />}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Edit task</h2>
              <button className="modal-close" onClick={() => setEditing(null)} aria-label="Close"><X size={22} /></button>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              <input className="field" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Task" autoFocus />
              <textarea className="field" rows={4} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                placeholder="Description — details, checklist, links…" style={{ resize: 'vertical', lineHeight: 1.5 }} />
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Due</label>
              <input className="field" type="datetime-local" value={draft.dueAt} onChange={e => setDraft(d => ({ ...d, dueAt: e.target.value }))}
                style={{ color: draft.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
              {/* No deadline, nothing to be reminded about — the control would be a lie */}
              {draft.dueAt && <ReminderPicker id="task-remind" value={draft.reminder}
                onChange={next => setDraft(d => ({ ...d, reminder: next }))} />}
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Project</label>
              <select className="field" value={draft.projectId} onChange={e => setDraft(d => ({ ...d, projectId: e.target.value, assigneeEmails: [] }))}>
                <option value="">Personal (no project)</option>
                {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
              {draft.projectId && (
                <>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Assigned to <span style={{ fontWeight: 600, color: 'var(--text-tertiary)' }}>— anyone tapped can tick it off</span>
                  </label>
                  <AssigneePicker myEmail={myEmail} value={draft.assigneeEmails}
                    onChange={next => setDraft(d => ({ ...d, assigneeEmails: next }))}
                    options={[...new Set([myEmail,
                      ...(projects.find(p => p._id === draft.projectId)?.ownerId?.email ? [projects.find(p => p._id === draft.projectId).ownerId.email] : []),
                      ...(projects.find(p => p._id === draft.projectId)?.memberEmails || []),
                      ...draft.assigneeEmails].filter(Boolean))]} />
                </>
              )}
              {/* Directly under the Project select, because that select is what takes the switch
                  away — the reason lands where the cause is. */}
              <PrivateToggle value={draft.isPrivate} onChange={next => setDraft(d => ({ ...d, isPrivate: next }))}
                groupName={projects.find(p => p._id === draft.projectId)?.name} />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', marginTop: '6px' }}>
                {canRemove(editing) ? (
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

      <form onSubmit={handleCreate} className="quick-add" data-tour="task-add">
        <div className="quick-add-main">
          <input type="text" disabled={!canEdit}
            placeholder={canEdit ? (activeProject ? `Add a task to ${activeProject.name}…` : 'Add a task…') : `You have view-only access to ${activeProject?.name}`}
            value={title} onChange={e => setTitle(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={!title.trim()} style={{ padding: '9px 18px', borderRadius: '12px', fontWeight: 800, opacity: title.trim() ? 1 : 0.5 }}>Add</button>
        </div>
        <div className="quick-add-meta">
          <input className="field" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} title="Due" style={{ color: due ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
          {/* Only once there is a deadline to be reminded of. It appears where the eye already
              is, immediately after setting the date. */}
          {due && <ReminderPicker inline value={remind} onChange={setRemind} />}
          {/* Nobody tapped means it is yours, which is what adding a task to your own group
              usually means — the same default the single-select had. */}
          {activeProject && <AssigneePicker options={memberOptions} value={assignee} onChange={setAssignee} myEmail={myEmail} />}
          {/* No group branch here on purpose: inside a group the scope is the page, already named
              in the title and the placeholder, and a permanent "this cannot be private" line under
              every group's quick-add is noise. The switch is simply not on offer there. */}
          {!activeProject && <PrivateToggle compact value={newPrivate} onChange={setNewPrivate} />}
        </div>
      </form>

      {loading ? (
        <Loading label="Loading your tasks" />
      ) : failed ? (
        <LoadError what="your tasks" onRetry={() => fetchTasks(activeProject?._id)} />
      ) : tasks.length === 0 && privateSafe && !activeProject ? (
        // "Nothing here yet" would be about the list the safe is currently hiding.
        <SafeEmpty noun="tasks" />
      ) : tasks.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>Nothing here yet</p>
          <p className="empty-hint">{hintFor('/tasks')}</p>
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
                  <button className={`task-check ${t.completed ? 'on' : ''}`} onClick={() => handleToggle(t._id)}
                    disabled={!canEdit} aria-label="toggle">
                    {t.completed && <svg width="12" height="9" viewBox="0 0 14 10" fill="none"><path d="M1.5 5L5.5 9L12.5 1.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0, cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && !t.isTemp && openEdit(t)}>
                    <div className="task-title">{t.title}</div>
                    {t.description && <div className="task-desc">{t.description}</div>}
                    {(t.dueAt || activeProject || t.signedOffAt) && (
                      <div className="task-meta">
                        {t.dueAt && <span className={`chip ${overdue ? 'overdue' : isToday ? 'today' : ''}`}>{fmtDue(t.dueAt)}</span>}
                        {activeProject && assigneeLabel(t)}
                        {/* Read-only here. Signing off is an owner's act and this list has no
                            owner context per row — the group page is where the control lives. */}
                        {t.signedOffAt && (
                          <span className="chip signed" title={`Signed off by ${t.signedOffBy?.name || t.signedOffBy?.email || 'an owner'}`}>
                            <BadgeCheck size={11} /> signed off
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {canRemove(t) && <button className="task-del" onClick={() => handleDelete(t._id)} title="Delete">×</button>}
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
