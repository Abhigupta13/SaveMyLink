'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft, MoreVertical, AlertTriangle, ChevronRight, Trash2, X, Check, Download, Pencil,
  UserPlus, Users, StickyNote, FileText, BadgeCheck, Mic, CheckSquare, History, BookOpen,
  MessageSquare, Send, Paperclip,
} from 'lucide-react';
import { getMessages, sendMessage, editMessage, deleteMessage, markChatRead } from '@/actions/message';
import { goConnectDrive } from '@/lib/driveConnect';
import { useDriveGate } from '@/components/useDriveGate';
import { getTasks, createTask, toggleTask, deleteTask, updateTask, signOffTask, getReminderDefault } from '@/actions/task';
import { getProjectWorkspace, addMember, removeMember, setProjectRole, deleteProject, updateProjectNotes, renameProject, getProjectEvents } from '@/actions/project';
import { getNotes, createNote, deleteNote } from '@/actions/note';
import { addDocument } from '@/actions/document';
import PersonPicker from '@/components/PersonPicker';
import MomSection from '@/components/MomSection';
import { useFeedback } from '@/components/ui/Feedback';
import { formatTime, formatDay, formatDate } from '@/lib/time';
import { isProjectOwner, isProjectCreator, isProjectViewer, canWrite, canChat } from '@/lib/scope';
import { needsOwner, assigneeEmailOf, assigneeEmailsOf } from '@/lib/taskAccess';
import AssigneePicker from '@/components/AssigneePicker';
import ReminderPicker from '@/components/ReminderPicker';
import type { ReminderChoice } from '@/lib/reminderRule';
import { phrase, DEFAULT_DAYS, fromMeeting } from '@/lib/activity';
import { escapeRegex } from '@/lib/regex';
import '@/styles/workspace.css';

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

/** Same shape as fmtDue but looking backwards — the trail only ever shows things that happened. */
function fmtWhen(iso: string) {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  if (diffDays === 0) return formatTime(d);
  if (diffDays === -1) return `Yesterday · ${formatTime(d)}`;
  return `${formatDay(d)} · ${formatTime(d)}`;
}

/** The trail is the one list on this page with a stable, known shape — it is written by one helper. */
type ActivityEvent = { _id: string; verb: string; subject?: string; at: string; actorId?: { email?: string; name?: string } };

/**
 * The eight places a group's work lives. Each is a screen you open, not a panel you unfold:
 * at 390px an accordion is a column of shut doors you scroll past to reach the one you want,
 * and People and What changed were the two that were always in the way.
 */
type Section = 'meetings' | 'tasks' | 'notes' | 'chat' | 'people' | 'activity' | 'files' | 'about';

/** A message the panel holds. Written by one action, so the shape is known. */
type ChatMessage = {
  _id: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  refs?: { kind: 'task' | 'mom' | 'note' | 'user'; id?: string; email?: string; label: string }[];
  attachments?: { name: string; key: string; url: string; mimeType?: string; size?: number }[];
  authorId?: { email?: string; name?: string };
};
/** Chosen in the composer, not yet sent. The server re-resolves every one of these. */
type PendingRef = { kind: 'task' | 'mom' | 'note' | 'user'; id?: string; email?: string; label: string };
/** The only fields the pickers read off a task, meeting or note — the page holds them as `any`. */
type Listed = { _id: string; title?: string; body?: string };

/**
 * What typing at the start of a word opens. `@` is a person because that is what `@` means in every
 * other chat app; the rest are `/` commands so the three of them read as one family.
 */
const REF_COMMANDS: { token: string; kind: Exclude<PendingRef['kind'], 'user'>; hint: string }[] = [
  { token: '/task', kind: 'task', hint: 'a task in this group' },
  { token: '/mom', kind: 'mom', hint: 'a meeting' },
  { token: '/note', kind: 'note', hint: 'a note' },
];

/** Where an open autocomplete started, so a pick can replace exactly what was typed to open it. */
type Trigger = { kind: PendingRef['kind']; token: string; tokenStart: number; queryStart: number };

/** Past this the person is clearly writing a sentence, not still choosing. */
const MAX_QUERY = 30;

/**
 * Keep an open autocomplete open across spaces.
 *
 * Detection alone looks at the last word, which closes the list the moment you type "/task gate" or
 * reach the surname in "@Chat Test". Both are the normal way to narrow a list, so once a trigger is
 * open it survives until its token is edited away, a choice is made, Escape is pressed, or the query
 * gets long enough that it is plainly prose.
 */
function keepTrigger(open: Trigger | null, value: string): Trigger | null {
  if (!open) return null;
  if (!value.startsWith(open.token, open.tokenStart)) return null;
  if (value.length < open.queryStart) return null;
  return value.length - open.queryStart <= MAX_QUERY ? open : null;
}

/**
 * The token being typed — everything after the last space — and what it is asking for.
 *
 * Only ever the LAST token, so a `@` in the middle of a finished sentence stays a `@`. The query
 * runs to the end of the draft, which is why picking always replaces a suffix and never has to
 * splice around text the person has already written.
 */
function detectTrigger(value: string): Trigger | null {
  const tokenStart = value.lastIndexOf(' ') + 1;
  const token = value.slice(tokenStart);
  if (token.startsWith('@')) return { kind: 'user', token: '@', tokenStart, queryStart: tokenStart + 1 };
  const cmd = REF_COMMANDS.find(c => token.startsWith(c.token));
  if (cmd) return { kind: cmd.kind, token: cmd.token, tokenStart, queryStart: tokenStart + cmd.token.length };
  return null;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ProjectWorkspace() {
  const { toast, confirm } = useFeedback();
  const ensureDrive = useDriveGate();
  const { data: session, status } = useSession();
  const router = useRouter();
  const projectId = String(useParams().id || '');

  const [projects, setProjects] = useState<any[]>([]);
  const [project, setProject] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [moms, setMoms] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const groupFileRef = useRef<HTMLInputElement>(null);
  const [addingFile, setAddingFile] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [section, setSection] = useState<Section | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const summaryScroll = useRef(0);

  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string[]>([]);   // several people, one shared task
  const [inviting, setInviting] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState({ title: '', body: '' });
  const [savingNote, setSavingNote] = useState(false);
  const [notesSaved, setNotesSaved] = useState(true);
  const [renaming, setRenaming] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [draft, setDraft] = useState<{ title: string; description: string; dueAt: string; assigneeEmails: string[]; reminder: ReminderChoice | null }>(
    { title: '', description: '', dueAt: '', assigneeEmails: [], reminder: null });
  // The profile default: what the quick-add starts on, and what a task written before the setting
  // existed is actually doing today.
  const [reminderDefault, setReminderDefault] = useState<ReminderChoice | null>(null);
  const [remind, setRemind] = useState<ReminderChoice | null>(null);

  // ---------- Chat ----------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /* Messages from other people that landed since this reader last opened the panel — not the size
     of the thread. Zeroed locally the moment the panel opens, so stepping back out shows a settled
     card instead of the old number until the next workspace load. */
  const [unread, setUnread] = useState(0);
  const [chatDraft, setChatDraft] = useState('');
  const [chatRefs, setChatRefs] = useState<PendingRef[]>([]);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [editingMsg, setEditingMsg] = useState<{ id: string; body: string } | null>(null);
  // Which message is showing its Edit/Remove. Hover does this on a desktop; a phone has no hover,
  // so tapping the bubble is what reveals them — the long-press equivalent every chat app has.
  const [selMsg, setSelMsg] = useState<string | null>(null);
  // The newest message already held. The poll asks for what arrived after it rather than re-reading
  // the page every five seconds — a busy group otherwise ships fifty rows to say nothing changed.
  const lastSeen = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const [chatFile, setChatFile] = useState<File | null>(null);

  const myEmail = (session?.user?.email || '').toLowerCase();
  const isOwner = isProjectOwner(project, myEmail);
  const isCreator = isProjectCreator(project, myEmail);
  // The single question every control on this page asks. The server answers it again with
  // writerScope — this only stops offering things that would fail.
  const canEdit = canWrite(project, myEmail);
  // Everyone on the project talks, view-only included — the one place a viewer may write, and the
  // reason it is its own predicate rather than a second reading of canWrite.
  const canPost = canChat(project, myEmail);
  const [busyOwner, setBusyOwner] = useState('');

  const roleOf = useCallback((email: string): 'owner' | 'member' | 'viewer' => {
    if (isProjectOwner(project, email)) return 'owner';
    return isProjectViewer(project, email) ? 'viewer' : 'member';
  }, [project]);

  const handleRole = async (email: string, role: 'owner' | 'member' | 'viewer') => {
    setBusyOwner(email);
    const res = await setProjectRole(projectId, email, role);
    setBusyOwner('');
    if (!res.success) return toast(res.error || 'Something went wrong', 'error');
    toast(`${nameOf(email)} is now ${role === 'viewer' ? 'view-only' : `a${role === 'owner' ? 'n' : ''} ${role}`}`, 'success');
    load();
  };

  const memberOptions = useMemo(
    () => (project ? [...new Set([project.ownerId?.email, ...(project.memberEmails || []), ...(project.viewerEmails || [])])].filter(Boolean) as string[] : []),
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

  const fetchNotes = useCallback(async () => {
    const res = await getNotes(projectId);
    if (res.success) setNotes(res.notes || []);
  }, [projectId]);

  const fetchEvents = useCallback(async () => {
    const res = await getProjectEvents(projectId, days);
    if (res.success) setEvents(res.events || []);
  }, [projectId, days]);

  /**
   * One call for the whole page. It used to make six from the browser, two of which fetched every
   * note and every document in every group I am in so this page could throw away the ones that
   * were not its own.
   */
  const load = useCallback(async () => {
    const res = await getProjectWorkspace(projectId, days);
    if (!res.success || !res.project) { setNotFound(true); setLoading(false); return; }
    setProject(res.project);
    setProjects(res.projects || []);
    setTasks(res.tasks || []);
    setMoms(res.moms || []);
    setNotes(res.notes || []);
    setFiles(res.documents || []);
    setEvents(res.events || []);
    setUnread(res.unreadCount || 0);
    setNotesDraft(res.project.notes || '');
    setRenaming(res.project.name);
    setLoading(false);
  }, [projectId, days]);

  // `days` is a dependency, so changing the trail's window re-runs this — a second effect for it
  // would fetch the trail twice on mount.
  // ponytail: the whole page reloads to move one dropdown. One call now instead of six, so it is
  // cheap enough to leave; split it out if the trail's window turns into something people play with.
  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    getReminderDefault().then(r => {
      const choice = (r.choice as ReminderChoice) || null;
      setReminderDefault(choice);
      setRemind(prev => prev ?? choice);
    }).catch(() => {});
  }, [status]);

  /**
   * A shared project changes under you — someone ticks off a task, adds a meeting, joins.
   * Re-fetch when the tab becomes visible again. Catches nearly everything a poll would, with
   * no timer hitting the database while the page sits open in the background.
   *
   * visibilitychange only. `focus` fires on top of it for the same return-to-tab, and also every
   * time the window regains focus from a dialog, so the two together reloaded the whole page
   * repeatedly while nothing had changed.
   * ponytail: still not live; add polling or sockets if people are ever in here simultaneously.
   */
  useEffect(() => {
    if (status !== 'authenticated') return;
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [status, load]);

  /**
   * The chat is the one place on this page where "not live" is actually felt, so it polls — but
   * only while its panel is open and the tab is visible, and only for what has arrived since the
   * newest message it already holds. Closed panel, hidden tab, unmounted page: no timer, no
   * invocation, no bill. The precedent is MomSection, which has long-polled a server action on this
   * host since MOM shipped; websockets are not available here.
   */
  /**
   * What the open autocomplete is offering, filtered by whatever has been typed after the trigger.
   *
   * A plain value, not a useMemo. The lists are small, the React Compiler memoizes it anyway, and a
   * hook here was actively a hazard: it has to sit above the loading early-return or the hook order
   * changes between renders, which is precisely how this panel crashed the first time.
   */
  const pickerQuery = trigger ? chatDraft.slice(trigger.queryStart).trim().toLowerCase() : '';
  const pickerAll: PendingRef[] = !trigger ? []
    : trigger.kind === 'user' ? memberOptions.map(e => ({ kind: 'user', email: e, label: nameOf(e) }))
    : trigger.kind === 'task' ? (tasks as Listed[]).map(t => ({ kind: 'task', id: t._id, label: t.title || 'a task' }))
    : trigger.kind === 'mom' ? (moms as Listed[]).map(m => ({ kind: 'mom', id: m._id, label: m.title || 'a meeting' }))
    : (notes as Listed[]).map(n => ({ kind: 'note', id: n._id, label: n.title || 'Untitled note' }));
  const pickerOptions: PendingRef[] = pickerAll
    // Matched on the address as well as the name: half of a group is people whose name nobody has
    // filled in yet, whose label IS their email.
    .filter(o => !pickerQuery || o.label.toLowerCase().includes(pickerQuery) || (o.email || '').toLowerCase().includes(pickerQuery))
    .slice(0, 6);

  const pullMessages = useCallback(async () => {
    const since = lastSeen.current;
    const res = await getMessages(projectId, since ? { after: since } : undefined);
    if (!res.success) return;
    const incoming = (res.messages || []) as ChatMessage[];
    if (!incoming.length) return;
    lastSeen.current = incoming[incoming.length - 1].createdAt;
    /* Something arrived into an open panel, so it has been read by definition — this poll only
       runs while the chat is on screen. Marking read only when the thread actually moves keeps
       this to one small write per new message rather than one every five seconds per viewer.
       Fire-and-forget: a failed stamp leaves the count high until the next open, which is a
       stale badge, not a broken chat. */
    markChatRead(projectId).catch(() => {});
    setUnread(0);
    setMessages(prev => {
      // Merge by id, never append: a poll can race the optimistic echo of your own send, and a
      // re-read of the newest page has to be able to replace a row that was edited or removed.
      const byId = new Map(prev.map(m => [m._id, m]));
      for (const m of incoming) byId.set(m._id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, [projectId]);

  useEffect(() => {
    if (status !== 'authenticated' || section !== 'chat') return;
    // Re-read the newest page every time the panel opens. `after` alone would never see an edit or
    // a removal, because neither moves createdAt.
    lastSeen.current = null;
    let alive = true;
    /* Opening the panel is the read, whether or not anything new arrives in it. Without this an
       empty poll leaves the badge standing on a chat the person is looking at.
       Cleared on the server's answer rather than optimistically: a stamp that did not land should
       not leave a card claiming everything has been read. */
    markChatRead(projectId).then(() => { if (alive) setUnread(0); }).catch(() => {});
    const tick = () => { if (alive && document.visibilityState === 'visible') pullMessages(); };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [status, section, pullMessages, projectId]);

  // A new message lands at the bottom, which is where the eye already is.
  useEffect(() => { if (section === 'chat') chatEnd.current?.scrollIntoView({ block: 'end' }); }, [messages, section]);

  /**
   * Opening a section is a real history entry, so the Android back gesture — the only "back" that
   * exists in the webview — closes the section instead of leaving the group. The URL is left alone
   * on purpose: the state rides on the entry, and a phone that lands here from a notification
   * should still open on the recorder. Next.js supports the native history API directly.
   */
  const openSection = (s: Section) => {
    summaryScroll.current = window.scrollY;
    window.history.pushState({ wk: s }, '');
    setSection(s);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const to = ((e.state as { wk?: Section } | null)?.wk) ?? null;
      setSection(to);
      // Coming back to the summary lands you where you left it, not at the top of the page.
      const y = to ? 0 : summaryScroll.current;
      requestAnimationFrame(() => window.scrollTo(0, y));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A screen reader is otherwise still parked on the card you tapped, reading the old screen.
  useEffect(() => { if (section) headRef.current?.focus(); }, [section]);

  // Menus close on Escape and on a tap anywhere else — no hover, nothing that needs a mouse.
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  // ---------- tasks ----------
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await createTask(title, {
      dueAt: due ? new Date(due).toISOString() : undefined,
      projectId,
      assigneeEmails: assignee.length ? assignee : [myEmail],
      reminder: remind || undefined,   // undefined = whatever my profile default is, resolved server-side
    });
    if (res.success) { setTitle(''); setDue(''); setAssignee([]); fetchTasks(); fetchEvents(); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  const handleToggle = async (id: string) => {
    setTasks(prev => prev.map(x => x._id === id ? { ...x, completed: !x.completed } : x));
    const res = await toggleTask(id);
    if (!res.success) fetchTasks();
    else fetchEvents();
  };

  /** The owner's half of the two states: the assignee ticked it, an owner answers for it. */
  const handleSignOff = async (id: string) => {
    const res = await signOffTask(id);
    if (!res.success) return toast(res.error || 'Something went wrong', 'error');
    fetchTasks(); fetchEvents();
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
      assigneeEmails: assigneeEmailsOf(task),
      // A task with no choice of its own opens showing what it actually does — the profile default.
      reminder: task.reminder || reminderDefault,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await updateTask(editing._id, {
      title: draft.title.trim() || editing.title,
      description: draft.description.trim(),
      dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      assigneeEmails: draft.assigneeEmails,
      reminder: draft.reminder,
    });
    if (res.success) { setEditing(null); fetchTasks(); fetchEvents(); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  // ---------- project ----------
  const handleRename = async () => {
    const name = renaming.trim();
    setRenameOpen(false);
    if (!name || name === project.name) return setRenaming(project.name);
    const res = await renameProject(projectId, name);
    if (res.success) { setProject((p: any) => ({ ...p, name })); fetchEvents(); }
    else { toast(res.error || 'Something went wrong', 'error'); setRenaming(project.name); }
  };

  const handleSaveNotes = async () => {
    const res = await updateProjectNotes(projectId, notesDraft);
    if (res.success) { setNotesSaved(true); setProject((p: any) => ({ ...p, notes: notesDraft })); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  /**
   * Writing a note without leaving the group. The Notes tab was a link with no project in it, so
   * "write a note" from inside a project dropped you into Personal and the note ended up nowhere
   * near the work it was about. Attachments still go through the full editor.
   */
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteDraft.title.trim() && !noteDraft.body.trim()) return;
    setSavingNote(true);
    const res = await createNote({ title: noteDraft.title.trim(), body: noteDraft.body.trim(), projectId });
    setSavingNote(false);
    if (!res.success) return toast(res.error || 'Something went wrong', 'error');
    setNoteDraft({ title: '', body: '' });
    fetchNotes();
  };

  const handleDeleteNote = async (note: { _id: string; title?: string }) => {
    if (!await confirm({ title: `Delete "${note.title || 'this note'}"?`, message: 'It goes for everyone in the group.', danger: true, confirmLabel: 'Delete' })) return;
    const res = await deleteNote(note._id);
    // canDelete is owner-only for project notes and is enforced server-side; if it refuses,
    // say so rather than removing the row optimistically and putting it back.
    if (!res.success) return toast(res.error || 'Could not delete', 'error');
    fetchNotes();
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
    if (!await confirm({ title: `Remove ${nameOf(email)}?`, message: 'Their tasks stay in the project, still in their name, and are listed under "Needs an owner" until someone picks them up.', danger: true, confirmLabel: 'Remove' })) return;
    const res = await removeMember(projectId, email);
    if (res.success) { setProject((p: any) => ({ ...p, memberEmails: (p.memberEmails || []).filter((e: string) => e !== email) })); fetchTasks(); fetchEvents(); }
    else toast(res.error || 'Something went wrong', 'error');
  };

  const handleDeleteProject = async () => {
    setMenuOpen(false);
    if (!await confirm({ title: `Delete "${project.name}"?`, message: 'The project and its tasks and meetings go with it.', danger: true, confirmLabel: 'Delete' })) return;
    const res = await deleteProject(projectId);
    if (res.success) router.push('/projects');
    else toast(res.error || 'Something went wrong', 'error');
  };

  const open = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);
  const overdue = open.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now());
  // Open work nobody in the group is holding: assigned to someone who has left, or never
  // assigned at all. Both are the same failure — a promise made in a meeting with no name on it.
  const unheld = open.filter(t => needsOwner(t, memberOptions));
  // The viewer's own work, soonest first — which puts what is already late at the top, and work
  // with no date at the bottom where it belongs.
  const mine = open
    .filter(t => assigneeEmailsOf(t).includes(myEmail))
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));
  const toReview = moms.filter(m => !m.tasksConfirmed).length;

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

  /** One row, wherever a task is shown — Yours on the summary, All tasks behind its card. */
  const taskRow = (t: any) => {
    const isOverdue = t.dueAt && !t.completed && new Date(t.dueAt).getTime() < Date.now();
    // One named chip plus a "+2" for anyone else on it. One shared task, so this is one row with a
    // count — not one row per person, and not three chips that wrap the meta line on a phone.
    // My own name leads when I am on it: a colleague's name on work I am holding reads as somebody
    // else's task, which is the one thing this row must never say.
    const all = assigneeEmailsOf(t);
    const [who, ...alsoWho] = all.includes(myEmail) ? [myEmail, ...all.filter(e => e !== myEmail)] : all;
    return (
      <div key={t._id} className={`task-row ${t.completed ? 'done' : ''}`}>
        <button className={`task-check ${t.completed ? 'on' : ''}`} onClick={() => handleToggle(t._id)}
          disabled={!canEdit} aria-label={t.completed ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}>
          {t.completed && <svg width="12" height="9" viewBox="0 0 14 10" fill="none"><path d="M1.5 5L5.5 9L12.5 1.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && openEdit(t)}>
          <div className="task-title">{t.title}</div>
          {t.description && <div className="task-desc">{t.description}</div>}
          <div className="task-meta">
            {t.dueAt && <span className={`chip ${isOverdue ? 'overdue' : ''}`}>{fmtDue(t.dueAt)}</span>}
            {who && <span className={`chip ${who === myEmail ? 'me' : ''}`} title={who}>{who === myEmail ? 'me' : shortOf(who)}</span>}
            {alsoWho.length > 0 && (
              <span className="chip more" title={`Also ${alsoWho.map(nameOf).join(', ')} — any of them can tick it off`}>+{alsoWho.length}</span>
            )}
            {t.signedOffAt && (
              <span className="chip signed" title={`Signed off by ${t.signedOffBy?.name || t.signedOffBy?.email || 'an owner'} · ${fmtDate(t.signedOffAt)}`}>
                <BadgeCheck size={11} /> signed off
              </span>
            )}
          </div>
        </div>
        {/* Ticking is the assignee's; signing off is the owner's. Offered only once the work is
            actually done — approving unfinished work is what would make the number on /admin
            stop meaning anything. */}
        {isOwner && t.completed && (
          <button className="subtle-link" style={{ flexShrink: 0 }} onClick={() => handleSignOff(t._id)}>
            {t.signedOffAt ? 'Undo sign-off' : 'Sign off'}
          </button>
        )}
        {isOwner && <button className="task-del" onClick={() => handleDelete(t._id)} title="Delete">×</button>}
      </div>
    );
  };

  /**
   * Typing `@` or `/task` at the start of a word opens the picker for that kind.
   *
   * The trigger token is removed once a choice is made, so the message stays a sentence and the
   * reference travels beside it as data — never as text the server would have to parse back out.
   * The server re-resolves every reference against this project regardless of what arrives here.
   */
  const onChatInput = (value: string) => {
    setChatDraft(value);
    // An open list keeps filtering across spaces; only when it has been edited away do we look for
    // a fresh trigger. Doing it the other way round closes the list on "@Chat Test".
    setTrigger(keepTrigger(trigger, value) ?? detectTrigger(value));
    setPickerIndex(0);
  };

  /**
   * Arrow keys move through the list, Enter takes the highlighted one, Escape closes it — the
   * behaviour every other chat app has trained people to expect. Enter only sends when nothing is
   * open, so choosing a person never posts a half-written message by accident.
   */
  const onChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!trigger || !pickerOptions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => (i + 1) % pickerOptions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(i => (i - 1 + pickerOptions.length) % pickerOptions.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); addRef(pickerOptions[pickerIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); setTrigger(null); }
  };

  /**
   * A person becomes text — `@Their Name` lands in the sentence, the way a mention reads in any
   * other chat app. A task, meeting or note does NOT: it is an attachment, not a word, so it leaves
   * the sentence alone and rides along as a card under the message.
   *
   * Either way the structured reference travels beside the text and the server re-resolves it. The
   * text is for people; the ref is what the app can actually check.
   */
  const addRef = (ref: PendingRef) => {
    if (trigger) {
      const before = chatDraft.slice(0, trigger.tokenStart);
      setChatDraft(ref.kind === 'user' ? `${before}@${ref.label} ` : before);
    }
    setChatRefs(r => (r.some(x => x.kind === ref.kind && (x.id || x.email) === (ref.id || ref.email)) ? r : [...r, ref]));
    setTrigger(null);
    setPickerIndex(0);
    chatInput.current?.focus();
  };

  /**
   * A file goes into the group from inside the group.
   *
   * It used to be a link out to the Digi Locker, which meant leaving the project, filing the
   * document, choosing the group again from a dropdown, and coming back — four steps to do the
   * thing the empty state was already asking for. The row it creates is the same Document either
   * way, so the locker still lists it.
   */
  const pickGroupFile = async () => {
    if (await ensureDrive(`/projects/${projectId}`)) groupFileRef.current?.click();
  };

  const addGroupFile = async (picked: File | null) => {
    if (!picked) return;
    setAddingFile(true);
    const fd = new FormData();
    fd.append('name', picked.name);
    fd.append('type', 'file');
    fd.append('file', picked);
    fd.append('projectId', projectId);
    // Never private: the whole group can open this the moment it lands, so a padlock on it would
    // be a promise the app cannot keep. privacyOnWrite says the same thing server-side.
    fd.set('isPrivate', 'false');
    const res = await addDocument(fd);
    setAddingFile(false);
    if (groupFileRef.current) groupFileRef.current.value = '';   // so the same file can be picked twice
    if (res.success) {
      toast(`${picked.name} added to ${project.name}`, 'success');
      load();
      fetchEvents();
    } else if (res.needsDrive) {
      toast('Taking you to Google to connect your Drive…', 'info');
      goConnectDrive();
    } else toast(res.error || 'Could not add that file', 'error');
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = chatDraft.trim();
    // A photo with no caption is a whole message on a site, so either half is enough to send.
    if ((!body && !chatFile) || sending) return;
    setSending(true);
    const res = await sendMessage(projectId, body, chatRefs, chatFile);
    setSending(false);
    if (!res.success) {
      if (res.needsDrive) {
        toast('Taking you to Google to connect your Drive…', 'info');
        return goConnectDrive();
      }
      return toast(res.error || 'Message not sent', 'error');
    }
    setChatDraft(''); setChatRefs([]); setTrigger(null); setPickerIndex(0);
    setChatFile(null);
    if (chatFileRef.current) chatFileRef.current.value = '';   // so the same file can be picked twice
    const sent = res.message as ChatMessage | undefined;
    if (sent) {
      lastSeen.current = sent.createdAt;
      setMessages(prev => [...prev.filter(m => m._id !== sent._id), sent]);
    }
    fetchEvents();   // the trail carries it too, and this panel is often opened straight after
  };

  /**
   * A reference renders from the label stored with the message, never from a fresh lookup — so a
   * chip still reads correctly after the task it points at has been deleted, which is exactly when
   * someone comes looking for what was said about it. Tapping one goes to where that thing lives.
   */
  /**
   * A mention belongs IN the sentence, highlighted, the way it reads in every other chat app — so
   * the body is split on the mention text the composer inserted. Splitting on the stored reference
   * rather than on any bare `@word` means an address somebody simply typed out is left alone.
   *
   * A person is stored as their address — the identity that survives a rename and works for someone
   * who has not signed up yet — and read back as their name while they are still on the group.
   */
  const renderBody = (m: ChatMessage) => {
    const names = (m.refs || []).filter(r => r.kind === 'user').map(r => `@${nameOf(r.email || r.label)}`);
    if (!names.length) return m.body;
    const rx = new RegExp(`(${names.map(escapeRegex).join('|')})`, 'g');
    return m.body.split(rx).map((part, i) =>
      names.includes(part) ? <span key={i} className="ch-mention">{part}</span> : part);
  };

  /**
   * Referenced work rides UNDER the message as a card, not inside the sentence — it is an object,
   * not a word. Tapping it goes to where that thing actually lives.
   */
  const refCard = (r: NonNullable<ChatMessage['refs']>[number], i: number) => {
    if (r.kind === 'user') return null;
    const Icon = r.kind === 'task' ? CheckSquare : r.kind === 'mom' ? Mic : StickyNote;
    const go = () => (r.kind === 'note'
      ? router.push(`/notes?project=${projectId}`)
      : openSection(r.kind === 'task' ? 'tasks' : 'meetings'));
    return (
      <button key={i} type="button" className="ch-ref" onClick={go}>
        <Icon size={13} />
        <span className="ch-ref-label">{r.label}</span>
        <ChevronRight size={13} />
      </button>
    );
  };

  const handleDeleteMessage = async (m: ChatMessage) => {
    if (!await confirm({ title: 'Remove this message?', message: 'It stays in the thread marked as removed, so the conversation around it still reads.', danger: true, confirmLabel: 'Remove' })) return;
    const res = await deleteMessage(m._id);
    if (!res.success) return toast(res.error || 'Could not remove it', 'error');
    setMessages(prev => prev.map(x => x._id === m._id ? { ...x, body: '', refs: [], deletedAt: new Date().toISOString() } : x));
  };

  const handleSaveEdit = async () => {
    if (!editingMsg) return;
    const body = editingMsg.body.trim();
    if (!body) return;
    const res = await editMessage(editingMsg.id, body);
    if (!res.success) return toast(res.error || 'Could not save the edit', 'error');
    setMessages(prev => prev.map(x => x._id === editingMsg.id ? { ...x, body, editedAt: new Date().toISOString() } : x));
    setEditingMsg(null);
  };

  const cards: { key: Section; label: string; count: number; Icon: typeof Mic; note?: string; warn?: boolean }[] = [
    { key: 'meetings', label: 'Meetings', count: moms.length, Icon: Mic, note: toReview ? `${toReview} to review` : undefined },
    { key: 'tasks', label: 'All tasks', count: open.length, Icon: CheckSquare, note: overdue.length ? `${overdue.length} overdue` : undefined, warn: true },
    { key: 'notes', label: 'Notes', count: notes.length, Icon: StickyNote },
    /* The one card whose number is not a total. "47" on a group you have read every word of is a
       number you can do nothing with; what is worth a glance from the summary screen is how much
       of it is new to you. Which also means it is the one card that SHOULD read 0 once the panel
       has been opened — the old `Math.max` against the loaded thread existed to stop exactly that,
       and would now hold the badge up at the message count forever.

       Labelled either way, because every card beside it counts totals and a bare "0" here would
       otherwise read as an empty chat rather than a read one. */
    {
      key: 'chat', label: 'Chat', count: unread, Icon: MessageSquare,
      note: unread ? 'unread' : 'all caught up',
    },
    { key: 'people', label: 'People', count: memberOptions.length, Icon: Users },
    { key: 'activity', label: 'What changed', count: events.length, Icon: History },
    { key: 'files', label: 'Files', count: files.length, Icon: FileText },
    { key: 'about', label: 'About', count: notesDraft ? 1 : 0, Icon: BookOpen },
  ];
  const here = cards.find(c => c.key === section);
  // The recorder is the top of this page, and it is also the top of Meetings. Everywhere else it
  // is hidden rather than unmounted, so drilling in mid-recording does not stop the recording.
  const showRecorder = section === null || section === 'meetings';

  return (
    <>
      <div className="container wk print-hide" style={{ padding: '16px 16px 120px' }}>

        <div className="wk-bar">
          <Link href="/projects" className="wk-back"><ArrowLeft size={16} /> Groups</Link>
          <div className="wk-menu-wrap" ref={menuRef}>
            <button className="wk-icon" onClick={() => setMenuOpen(v => !v)}
              aria-label="Group tools" aria-haspopup="menu" aria-expanded={menuOpen}>
              <MoreVertical size={18} />
            </button>
            {/* Owner tools live here so a doer never meets them. Everyone keeps the report —
                it is a read of what they can already see, and taking it away from members
                would be a capability lost, not a permission enforced. */}
            {menuOpen && (
              <div className="wk-menu" role="menu">
                {isOwner && (
                  <>
                    <button role="menuitem" onClick={() => { setMenuOpen(false); setRenameOpen(true); }}><Pencil size={16} /> Rename group…</button>
                    <button role="menuitem" onClick={() => openSection('people')}><UserPlus size={16} /> Invite someone</button>
                    <button role="menuitem" onClick={() => openSection('people')}><Users size={16} /> Members &amp; roles</button>
                    <hr />
                  </>
                )}
                <button role="menuitem" onClick={() => { setMenuOpen(false); window.print(); }}><Download size={16} /> Download as PDF</button>
                {/* Creator only — the one action with no undo. */}
                {isCreator && <button role="menuitem" className="danger" onClick={handleDeleteProject}><Trash2 size={16} /> Delete group</button>}
              </div>
            )}
          </div>
        </div>

        {/* Head: the group's name, and the one line of numbers worth reading before you record. */}
        {here ? (
          <div className="wk-panel-head">
            <button className="wk-icon" onClick={() => window.history.back()} aria-label={`Back to ${project.name}`}><ArrowLeft size={18} /></button>
            <h1 ref={headRef} tabIndex={-1}>{here.label}</h1>
            <span className="wk-pill">{here.count}</span>
          </div>
        ) : (
          <header className="wk-head">
            <p className="wk-eyebrow">Group</p>
            <h1>{project.name}</h1>
            <p className="wk-lede">
              {overdue.length > 0 && <><span className="wk-warn">{plural(overdue.length, 'task')} overdue</span> · </>}
              <b>{open.length}</b> open · <b>{memberOptions.length}</b> {memberOptions.length === 1 ? 'person' : 'people'}
              {project.ownerId?.email && <> · started by {project.ownerId.email === myEmail ? 'you' : shortOf(project.ownerId.email)}, {fmtDate(project.createdAt)}</>}
            </p>
          </header>
        )}

        {/* The recorder, and directly under it the meetings whose items nobody has confirmed yet —
            unfinished work, so it belongs on the way in rather than behind a card. Its position in
            the tree never changes, so a recording survives drilling into a section and back. */}
        <div className={showRecorder ? '' : 'wk-hide'}>
          <MomSection project={project} projects={projects} myEmail={myEmail} memberOptions={memberOptions}
            onTasksCreated={load} pendingOnly={section !== 'meetings'}
            afterRecorder={unheld.length > 0 && (
              <button className="wk-band" onClick={() => openSection('tasks')}>
                <AlertTriangle size={15} />
                <span>{plural(unheld.length, 'task')} nobody is holding</span>
                <ChevronRight size={16} />
              </button>
            )} />
        </div>

        {/* ---------- The summary: your own work, then a door into everything else ---------- */}
        {!section && (
          <>
            {/* MomSection shows the two newest meetings still waiting on someone; the rest are one
                tap away rather than stacked here. */}
            {toReview > 2 && (
              <button className="subtle-link wk-more" onClick={() => openSection('meetings')}>
                {toReview - 2} more meeting{toReview - 2 === 1 ? '' : 's'} still to review →
              </button>
            )}

            <section className="wk-block">
              <div className="wk-block-head">
                <p className="wk-eyebrow" style={{ margin: 0 }}>Yours</p>
              </div>
              {mine.length === 0 ? (
                <p className="wk-quiet">
                  Nothing is assigned to you here{open.length > 0 ? ` — ${plural(open.length, 'task')} open in the group` : ''}.
                </p>
              ) : mine.map(taskRow)}
            </section>

            <nav className="wk-cards" aria-label="Everything in this group">
              {cards.map(({ key, label, count, Icon, note, warn }) => (
                <button key={key} className="wk-card" onClick={() => openSection(key)}>
                  <div className="wk-card-top">
                    <span className={`wk-card-n ${count === 0 ? 'zero' : ''}`}>{count}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="wk-card-label"><Icon size={14} aria-hidden="true" /> {label}</span>
                    {note && <p className={`wk-card-note ${warn ? 'warn' : ''}`}>{note}</p>}
                  </div>
                </button>
              ))}
            </nav>
          </>
        )}

        {/* ---------- All tasks ---------- */}
        {section === 'tasks' && (
          <section>
            {/* Rendered only when there is something to say. An always-present empty band is
                furniture; this one has to read as an exception, because that is what it is. */}
            {unheld.length > 0 && (
              <div className="wk-unheld">
                <p className="wk-unheld-label"><AlertTriangle size={14} /> Needs an owner <span className="wk-pill">{unheld.length}</span></p>
                <p className="wk-unheld-note">Nobody in this group is holding this work. Tap one to hand it over.</p>
                {unheld.map(t => {
                  const was = assigneeEmailOf(t);
                  return (
                    <div key={t._id} className="task-row" style={{ cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && openEdit(t)}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="task-title">{t.title}</div>
                        <div className="task-meta">
                          {/* Reuses the `overdue` list rather than reading the clock again — the
                              render must stay pure, and the lists are a handful of rows. */}
                          {t.dueAt && <span className={`chip ${overdue.includes(t) ? 'overdue' : ''}`}>{fmtDue(t.dueAt)}</span>}
                          {/* Naming who used to hold it is the point — the old behaviour blanked
                              this, and the work became indistinguishable from work never given out. */}
                          <span className="chip" title={was || undefined}>{was ? `was ${shortOf(was)}` : 'never assigned'}</span>
                        </div>
                      </div>
                      {canEdit && <span className="subtle-link" style={{ flexShrink: 0 }}>Reassign</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {tasks.length === 0 ? (
              <p className="wk-quiet">No tasks yet. Meetings file them here by themselves.</p>
            ) : [...open, ...(showDone ? done : [])].map(taskRow)}

            {done.length > 0 && (
              <button className="subtle-link wk-foot" onClick={() => setShowDone(v => !v)}>
                {showDone ? 'Hide' : 'Show'} {done.length} done
              </button>
            )}

            {/* Under the list, not over it. What is owed is what you opened this for; the form is
                what you reach for after reading it.
                Hidden rather than shown-and-refused — createTask re-checks with writerScope, so
                leaving it visible would just be a form that fails. */}
            {canEdit && <form onSubmit={handleCreate} className="quick-add" style={{ marginTop: '16px' }}>
              <div className="quick-add-main">
                <input type="text" placeholder={`Add a task to ${project.name}…`} value={title} onChange={e => setTitle(e.target.value)} />
                <button type="submit" className="btn-primary" disabled={!title.trim()} style={{ padding: '9px 18px', borderRadius: '12px', fontWeight: 800, opacity: title.trim() ? 1 : 0.5 }}>Add</button>
              </div>
              <div className="quick-add-meta">
                <input className="field" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} title="Due"
                  style={{ color: due ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                {/* Only once there is a deadline to be reminded of */}
                {due && <ReminderPicker inline value={remind} onChange={setRemind} />}
                {/* Tap several and it stays ONE task that any of them can tick. Nobody tapped
                    means it is yours — the same default the single select had. */}
                <AssigneePicker options={memberOptions} value={assignee} onChange={setAssignee} myEmail={myEmail} labelOf={nameOf} />
              </div>
            </form>}
          </section>
        )}

        {/* ---------- Notes ---------- */}
        {section === 'notes' && (
          <section>
            {notes.length === 0 ? (
              <p className="wk-quiet">No notes yet — meetings file them here automatically.</p>
            ) : notes.map(n => {
              const origin = fromMeeting(n);
              return (
                <div key={n._id} className="task-row" style={{ alignItems: 'flex-start' }}>
                  <StickyNote size={15} style={{ flexShrink: 0, marginTop: '3px', color: 'var(--text-tertiary)' }} />
                  {/* The project travels with the link, so the editor opens on this group */}
                  <Link href={`/notes?project=${projectId}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                    <div className="task-title">{n.title || 'Untitled note'}</div>
                    {n.body && <div className="task-desc">{n.body.replace(/\s+/g, ' ').slice(0, 140)}</div>}
                    <div className="task-meta">
                      <span className="chip">{n.userId?.name || n.userId?.email || 'me'}</span>
                      <span className="chip">{fmtDate(n.updatedAt)}</span>
                      {origin && <span className="chip" title="This note came out of a meeting">{origin}</span>}
                    </div>
                  </Link>
                  {/* canDelete is owner-only for project notes; the server enforces it either way */}
                  {isOwner && <button className="task-del" onClick={() => handleDeleteNote(n)} title="Delete">×</button>}
                </div>
              );
            })}
            {/* Still a composer and not a link out: writing a note here used to mean following a
                link with no project in it, landing in Personal, and filing the note away from the
                work it was about. */}
            {canEdit && (
              <form onSubmit={handleAddNote} className="quick-add" style={{ display: 'block', marginTop: '16px' }}>
                <div className="quick-add-main">
                  <input type="text" placeholder={`Note title — ${project.name}`} value={noteDraft.title}
                    onChange={e => setNoteDraft(d => ({ ...d, title: e.target.value }))} />
                  <button type="submit" className="btn-primary" disabled={savingNote || (!noteDraft.title.trim() && !noteDraft.body.trim())}
                    style={{ padding: '9px 18px', borderRadius: '12px', fontWeight: 800, opacity: (noteDraft.title.trim() || noteDraft.body.trim()) ? 1 : 0.5 }}>
                    {savingNote ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <textarea className="field" rows={3} placeholder="What happened, what was decided…" value={noteDraft.body}
                  onChange={e => setNoteDraft(d => ({ ...d, body: e.target.value }))}
                  style={{ marginTop: '8px', resize: 'vertical', lineHeight: 1.55 }} />
              </form>
            )}
            <Link href={`/notes?project=${projectId}`} className="subtle-link wk-foot">Open the full editor — attachments, pinning →</Link>
          </section>
        )}

        {/* ---------- Chat ---------- */}
        {section === 'chat' && (
          <section className="ch-panel">
            <div className="ch-thread">
              {messages.length === 0 ? (
                <p className="wk-quiet">
                  Nothing said yet. Type <b>@</b> for a person, or <b>/task</b>, <b>/mom</b>, <b>/note</b> to
                  point at something in this group — a message that names the work stays findable.
                </p>
              ) : messages.map((m, i) => {
                const email = (m.authorId?.email || '').toLowerCase();
                const mine = !!email && email === myEmail;
                const gone = !!m.deletedAt;
                const prev = messages[i - 1];
                /* Consecutive messages from one person within five minutes are one turn in the
                   conversation, so only the first carries a name, a time and an avatar. Every chat
                   app does this, and without it a burst of three lines reads as three strangers. */
                const run = !!prev
                  && (prev.authorId?.email || '').toLowerCase() === email
                  && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
                const who = mine ? 'You' : (m.authorId?.name || m.authorId?.email || 'Someone');
                return (
                  <div key={m._id} className={`ch-row${mine ? ' me' : ''}${run ? ' run' : ''}${selMsg === m._id ? ' sel' : ''}`}>
                    {!mine && <div className="ch-avatar" aria-hidden="true">{run ? '' : who.trim().charAt(0).toUpperCase()}</div>}
                    <div className="ch-col">
                      {!run && (
                        <div className="ch-meta">
                          <span className="ch-name">{who}</span>
                          <time dateTime={m.createdAt}>{fmtWhen(m.createdAt)}</time>
                        </div>
                      )}

                      {gone ? (
                        <div className="ch-bubble ch-removed">Message removed</div>
                      ) : editingMsg?.id === m._id ? (
                        <div className="ch-edit">
                          <textarea className="field" rows={3} value={editingMsg.body} autoFocus
                            onChange={e => setEditingMsg({ id: m._id, body: e.target.value })} />
                          <div className="ch-edit-acts">
                            <button type="button" className="btn-primary" onClick={handleSaveEdit}
                              disabled={!editingMsg.body.trim()}>Save</button>
                            <button type="button" className="subtle-link" onClick={() => setEditingMsg(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="ch-bubble" onClick={() => setSelMsg(s => s === m._id ? null : m._id)}>
                            {renderBody(m)}
                            {m.editedAt && <span className="ch-edited">edited</span>}
                          </div>
                          {!!m.attachments?.length && (
                            <div className="ch-refs">
                              {m.attachments.map(a => (
                                /* Opened through /api/files, never a Drive link: half a group may
                                   have signed up with a password and has no Google account to open
                                   a Drive URL with. */
                                <a key={a.key} href={a.url} target="_blank" rel="noopener noreferrer" className="ch-ref">
                                  <Paperclip size={13} />
                                  <span className="ch-ref-label">{a.name}</span>
                                  <ChevronRight size={13} />
                                </a>
                              ))}
                            </div>
                          )}
                          {m.refs?.some(r => r.kind !== 'user') && <div className="ch-refs">{m.refs.map(refCard)}</div>}
                        </>
                      )}

                      {/* The author edits; the author or the group's creator removes. The server
                          checks both again — this only stops offering what would fail. */}
                      {!gone && editingMsg?.id !== m._id && (mine || isCreator) && (
                        <div className="ch-acts">
                          {mine && <button type="button" onClick={() => setEditingMsg({ id: m._id, body: m.body })}>Edit</button>}
                          <button type="button" onClick={() => handleDeleteMessage(m)}>Remove</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEnd} />
            </div>

            {canPost ? (
              <form onSubmit={handleSend} className="ch-form">
                {!!chatRefs.length && (
                  <div className="ch-pending">
                    {chatRefs.map((r, i) => (
                      <button key={i} type="button" className="ch-chip" title="Remove this reference"
                        onClick={() => setChatRefs(cur => cur.filter((_, j) => j !== i))}>
                        {r.kind === 'user' ? `@${r.label}` : r.label}
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                )}

                {trigger && (
                  <div className="ch-picker" role="listbox" aria-label="Insert a reference">
                    {pickerOptions.length === 0
                      ? <div className="ch-picker-empty">Nothing matches</div>
                      : pickerOptions.map((o, i) => (
                        <button key={i} type="button" role="option" aria-selected={i === pickerIndex}
                          className={i === pickerIndex ? 'on' : ''}
                          onMouseEnter={() => setPickerIndex(i)} onClick={() => addRef(o)}>
                          <span className="ch-picker-label">{o.label}</span>
                          {o.kind === 'user' && o.email && o.email !== o.label && <span className="ch-picker-sub">{o.email}</span>}
                        </button>
                      ))}
                  </div>
                )}

                {chatFile && (
                  <div className="ch-pending">
                    <button type="button" className="ch-chip" title="Remove this file"
                      onClick={() => { setChatFile(null); if (chatFileRef.current) chatFileRef.current.value = ''; }}>
                      <Paperclip size={11} /> {chatFile.name}
                      <X size={11} />
                    </button>
                  </div>
                )}

                <div className="ch-input">
                  <input ref={chatFileRef} type="file" id="chat-file" style={{ display: 'none' }}
                    onChange={e => setChatFile(e.target.files?.[0] || null)} />
                  <button type="button" className="ch-clip" title="Attach a file" aria-label="Attach a file"
                    onClick={async () => { if (await ensureDrive()) chatFileRef.current?.click(); }}>
                    <Paperclip size={17} />
                  </button>
                  <input ref={chatInput} type="text" value={chatDraft} autoComplete="off"
                    onChange={e => onChatInput(e.target.value)} onKeyDown={onChatKeyDown}
                    placeholder="Message the group" aria-label={`Message ${project.name}`} />
                  <button type="submit" className="ch-send" disabled={sending || (!chatDraft.trim() && !chatFile)} aria-label="Send">
                    <Send size={16} />
                  </button>
                </div>
                <p className="ch-hint"><b>@</b> a person · <b>/task</b> <b>/mom</b> <b>/note</b> to point at work in this group</p>
              </form>
            ) : (
              <p className="wk-quiet">You can read this conversation but not post in it.</p>
            )}

          </section>
        )}

        {/* ---------- People ---------- */}
        {section === 'people' && (
          <section>
            {memberOptions.map(email => {
              const creator = isProjectCreator(project, email);
              const role = roleOf(email);
              const owner = creator || role === 'owner';
              // Shared work counts against everyone holding it — that is what "N open" means to
              // the person reading their own row.
              const load = open.filter(t => assigneeEmailsOf(t).includes(email)).length;
              /* One control for all three roles instead of a promote button, a demote button and
                 a third for viewers. The creator is permanent, so their row offers nothing, and
                 you cannot change your own — the server refuses both. */
              const canSetRole = isOwner && !creator && email !== myEmail;
              return (
                <div key={email} className="task-row">
                  <span className="avatar-xs" style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}>{nameOf(email)[0].toUpperCase()}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="task-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email === myEmail ? `${nameOf(email)} (you)` : nameOf(email)}
                    </div>
                    <div className="task-meta wk-person">
                      {/* The role slot: the select where it can be changed, the chip where it
                          cannot. Both in the same slot, so the eye finds a member's role in the
                          same place on every row. */}
                      {canSetRole ? (
                        <select className="wk-select wk-role" value={role} disabled={busyOwner === email}
                          onChange={e => handleRole(email, e.target.value as 'owner' | 'member' | 'viewer')} aria-label={`Role for ${nameOf(email)}`}>
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                          <option value="viewer">View only</option>
                        </select>
                      ) : (
                        <>
                          {/* One word for one power. "creator" read as a second, higher rank when
                              it is only a fact about the past — who made the group. */}
                          {owner && <span className="chip" title="Can add members, rename, and delete shared work">owner</span>}
                          {/* Named on the row, because "why can't I type here" is the question a
                              client asks, and the answer should be visible before they ask it. */}
                          {role === 'viewer' && <span className="chip viewer" title="Sees everything in this group and changes nothing">view only</span>}
                        </>
                      )}
                      <span className="chip">{load} open</span>
                      {/* "pending", not "invite sent" — members added before invite emails existed
                          never got one, and the chip should not claim otherwise */}
                      {!people.get(email)?.hasAccount && <span className="chip" title="No account yet — they see the project once they sign up with this address">pending</span>}
                    </div>
                    {people.get(email)?.name && <div className="wk-person-email" title={email}>{email}</div>}
                  </div>
                  {isOwner && !owner && <button className="task-del" onClick={() => handleRemove(email)} title="Remove">×</button>}
                </div>
              );
            })}
            {/* Owner only — addMember is owner-scoped server-side, so showing this to a member
                would just fail. Picking beats typing: a typo'd address silently emails a
                stranger, or nobody. */}
            {isOwner && <div style={{ marginTop: '14px' }}><PersonPicker exclude={memberOptions} onPick={handleInvite} busy={inviting} /></div>}
          </section>
        )}

        {/* ---------- What changed ----------
            The screen that replaces a manager's chasing: who moved what, without asking anyone.
            History cannot be backfilled, which is why this starts recording before it is pretty. */}
        {section === 'activity' && (
          <section>
            <div className="wk-block-head" style={{ justifyContent: 'flex-end' }}>
              <select className="wk-select" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="How far back">
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </div>
            {events.length === 0 ? (
              <p className="wk-quiet">Nothing in the last {days} days.</p>
            ) : events.map(ev => {
              const said = phrase(ev.verb, ev.subject);
              if (!said) return null;   // an event from a newer deploy than this page knows about
              const who = ev.actorId?.name || ev.actorId?.email || 'Someone';
              return (
                <div key={ev._id} className="wk-event">
                  <b>{ev.actorId?.email === myEmail ? 'You' : who.split(' ')[0]}</b>{' '}
                  {said}
                  <span>{fmtWhen(ev.at)}</span>
                </div>
              );
            })}
          </section>
        )}

        {/* ---------- Files ---------- */}
        {section === 'files' && (
          <section>
            {files.length === 0 ? <p className="wk-quiet">No files in this group yet.</p> : files.map(d => (
              <a key={d._id} href={d.url} target="_blank" rel="noreferrer" className="task-row" style={{ textDecoration: 'none' }}>
                <FileText size={15} style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="task-title">{d.name}</div>
                  <div className="task-meta"><span className="chip">{fmtDate(d.createdAt)}</span></div>
                </div>
              </a>
            ))}
            {canEdit && (
              <div style={{ marginTop: '16px' }}>
                <input ref={groupFileRef} type="file" hidden onChange={e => addGroupFile(e.target.files?.[0] || null)} />
                <button type="button" className="btn-primary" onClick={pickGroupFile} disabled={addingFile}
                  style={{ padding: '11px 20px', borderRadius: '14px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Paperclip size={15} />
                  {addingFile ? 'Uploading…' : 'Add a file'}
                </button>
              </div>
            )}
            {/* Still worth keeping: this adds a NEW file, the locker files one you already have. */}
            <Link href="/d-locker" className="subtle-link wk-foot">
              {files.length ? 'Open the Digi Locker →' : 'Or file one you already saved →'}
            </Link>
          </section>
        )}

        {/* ---------- About: one shared description of the group, not a note per thought ---------- */}
        {section === 'about' && (
          <section>
            <label htmlFor="wk-about" className="wk-eyebrow" style={{ display: 'block' }}>What this group is</label>
            <textarea id="wk-about" className="field" rows={10} placeholder={canEdit ? 'Context, decisions, links…' : 'Nothing written yet.'} value={notesDraft}
              readOnly={!canEdit}
              onChange={e => { setNotesDraft(e.target.value); setNotesSaved(false); }} style={{ resize: 'vertical', lineHeight: 1.6 }} />
            {canEdit && (
              <button onClick={handleSaveNotes} disabled={notesSaved} className="btn-primary"
                style={{ marginTop: '12px', padding: '12px 26px', borderRadius: '14px', fontWeight: 800, opacity: notesSaved ? 0.5 : 1 }}>
                {notesSaved ? 'Saved' : 'Save'}
              </button>
            )}
          </section>
        )}

        {renameOpen && (
          <div className="modal-overlay" onClick={() => { setRenameOpen(false); setRenaming(project.name); }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
              <div className="modal-header">
                <h2 className="modal-title">Rename group</h2>
                <button className="modal-close" onClick={() => { setRenameOpen(false); setRenaming(project.name); }} aria-label="Close"><X size={22} /></button>
              </div>
              <input className="field" value={renaming} autoFocus aria-label="Group name"
                onChange={e => setRenaming(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); }} />
              <button className="btn-primary" onClick={handleRename} disabled={!renaming.trim()}
                style={{ marginTop: '12px', padding: '12px 26px', borderRadius: '14px', fontWeight: 800, width: '100%' }}>
                Rename
              </button>
            </div>
          </div>
        )}

        {editing && (
          <div className="modal-overlay" onClick={() => setEditing(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
              <div className="modal-header">
                <h2 className="modal-title">Edit task</h2>
                <button className="modal-close" onClick={() => setEditing(null)} aria-label="Close"><X size={22} /></button>
              </div>
              <div style={{ display: 'grid', gap: '10px' }}>
                <input className="field" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Task" aria-label="Task" autoFocus />
                <textarea className="field" rows={4} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="Description — details, checklist, links…" aria-label="Description" style={{ resize: 'vertical', lineHeight: 1.5 }} />
                <label htmlFor="wk-due" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Due</label>
                <input id="wk-due" className="field" type="datetime-local" value={draft.dueAt} onChange={e => setDraft(d => ({ ...d, dueAt: e.target.value }))}
                  style={{ color: draft.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                {/* No deadline, nothing to be reminded about */}
                {draft.dueAt && <ReminderPicker id="wk-remind" value={draft.reminder}
                  onChange={next => setDraft(d => ({ ...d, reminder: next }))} />}
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Assigned to <span style={{ fontWeight: 600, color: 'var(--text-tertiary)' }}>— anyone tapped can tick it off</span>
                </span>
                <AssigneePicker id="wk-assignee" myEmail={myEmail} labelOf={nameOf} value={draft.assigneeEmails}
                  onChange={next => setDraft(d => ({ ...d, assigneeEmails: next }))}
                  options={[...new Set([...memberOptions, ...draft.assigneeEmails].filter(Boolean))]} />
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
          {plural(memberOptions.length, 'member')} · {open.length} open · {done.length} done · {plural(moms.length, 'meeting')}
          <br />Exported {fmtDate(new Date().toISOString())}
        </p>

        <h2>People</h2>
        <ul>
          {memberOptions.map(email => (
            <li key={email}>{email}{isProjectOwner(project, email) ? ' — owner' : ''} · {open.filter(t => assigneeEmailsOf(t).includes(email)).length} open</li>
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
                  <td>{(assigneeEmailOf(t) || '—').split('@')[0]}</td>
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
