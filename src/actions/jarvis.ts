'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Link } from "@/lib/models/Link";
import Task from "@/lib/models/Task";
import { Project } from "@/lib/models/Project";
import { Mom } from "@/lib/models/Mom";
import { Contact } from "@/lib/models/Contact";
import { Note } from "@/lib/models/Note";
import { Document as Doc } from "@/lib/models/Document";
import { JarvisSession } from "@/lib/models/JarvisSession";
import { chatJSON } from "@/lib/llm";
import { formatInZone, formatStamp, safeZone, zonedToUtc } from "@/lib/time";
import { myProjectFilter } from "@/lib/projectAccess";
import { retrieve, type Candidate } from "@/lib/retrieval";
import { isProjectOwner, isProjectCreator, canWrite, type OwnableProject } from "@/lib/scope";
import { hasSafe } from "@/lib/safeCookie";
import { assistantFilter, privacyOnWrite } from "@/lib/privacy";
import { isAdmin } from "@/lib/isAdmin";
import { dayKey, spendQuestion, capMessage, SHARED_OUT_MESSAGE, JARVIS_DAILY_LIMIT } from "@/lib/jarvisLimit";
import { isHowTo, HOW_IT_WORKS, EXTRA_PAGES } from "@/lib/manual";
import { NAV } from "@/lib/nav";
import { memberCount } from "@/lib/visibility";
import { dropAssignee } from "@/lib/dropAssignee";
import { extractUrl, hostnameOf } from "@/lib/url";
import { Category } from "@/lib/models/Category";
import { createLink } from "@/actions/link";
import { createTask, updateTask, toggleTask } from "@/actions/task";
import { User } from "@/lib/models/User";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

export interface JarvisItem {
  id: string;
  type: 'link' | 'note' | 'task' | 'project' | 'mom' | 'contact' | 'document';
  title: string;
  url?: string | null;
  detail?: string;
  urgent?: boolean;
  project?: string;   // the group that can see it; absent = personal
}
export interface JarvisTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Ids this turn cited. Sent back so "the one after that" still has something to point at.
   *  Never trusted: an id only survives if it is also in the caller's own scoped context. */
  ids?: string[];
}
export type Msg = JarvisTurn & { items?: JarvisItem[] };
export interface JarvisSessionMeta { id: string; title: string; updatedAt: string }

/**
 * A write Jarvis wants to make into a shared group, held back until the user says yes.
 * `action` is the model's own request, handed to the client and handed straight back — the server
 * revalidates every field of it either way, so nothing here is trusted on the return trip.
 */
export interface JarvisPending { action: unknown; group: string; people: number }

/** Every page Jarvis may open. An href not in this set is dropped, whatever the model wrote. */
const DESTINATIONS = new Set<string>([...NAV.map(n => n.href), ...EXTRA_PAGES.map(p => p.href)]);

/* The zone belongs to the request, not the process. It used to live in a module-level `let`,
   which two people asking at the same moment would overwrite for each other — rare with one
   user, certain with a team. Each call builds its own formatter instead. */
type Fmt = (v?: Date | string | null) => string;
const fmtIn = (tz: string): Fmt => v => formatInZone(v, tz);
/* The same instant WITH the year, for every string the model reads. A person reading their own
   task list knows the year; the model is asked to emit dueAt as "YYYY-MM-DDTHH:mm" and cannot
   write one without it. See formatStamp in lib/time for what that cost. */
const stampIn = (tz: string): Fmt => v => formatStamp(v, tz);

// Every item the user may read, each as one line the model can cite by id — and as the fields
// lib/retrieval scores against, so only the few dozen that answer the question are actually sent.
async function gatherContext(userId: string, email: string, includePrivate: boolean, d: Fmt) {
  const ids = new Set<string>();
  const groupOf = new Map<string, string>();   // id → group name, for the shared chip on cited items

  /**
   * Jarvis is the ONE place the safe adds instead of swapping, and this is the fragment that does
   * it: `{}` with the safe open — everything, private and not — and an exclusion with it shut.
   * A list that answers "your notes" with only the secret ones is a list; an assistant that
   * answers "what are my tasks?" with only the secret ones is broken.
   *
   * The other half of the bargain is that shut means SHUT. Every personal query below carries
   * this, so with the safe locked a private record cannot be cited, summarised, counted or even
   * acknowledged — it is not in the context at all, and Jarvis can only speak from the context.
   * It was on links alone, which is why locked Jarvis would happily read out a private note.
   *
   * Project branches never carry it. A group record cannot be private (lib/privacy) and hiding
   * shared work because you opened your own safe would be the exact opposite of the rule.
   */
  const personal = assistantFilter(includePrivate) ?? {};

  const linkQuery: any = { userId, ...personal };
  const projects = await Project.find(await myProjectFilter(userId, email)).lean();
  const projectIds = projects.map(p => p._id);
  const pname = new Map(projects.map(p => [String(p._id), p.name]));
  // Where an assignee branch may look: my own personal work, or a group I can actually open.
  const reachable = [{ projectId: null }, { projectId: { $in: projectIds } }];

  const [links, tasks, moms, contacts, notes, docs] = await Promise.all([
    Link.find(linkQuery).populate('category', 'name').sort({ createdAt: -1 }).limit(600).lean(),
    /* The assignee branches are group work — someone else handed it to me — so they stay open.
       Open in BOTH safe states, which is what that meant, but not open to every group: they used
       to carry no project scope, so a task in a group I am not on became prompt context and Jarvis
       could quote work I have no way to open. Scoped to what I can actually reach, exactly as
       lib/digest, getMyOpenTasks and search now are. */
    Task.find({ $or: [
      { userId, ...personal },
      { assigneeId: userId, $or: reachable },
      { assigneeIds: userId, $or: reachable },
      { projectId: { $in: projectIds } },
    ] })
      .populate('assigneeId', 'email').sort({ completed: 1, dueAt: 1 }).limit(400).lean(),
    // my project meetings + my personal ones, which have no project to match on
    Mom.find({ $or: [{ projectId: { $in: projectIds } }, { userId, ...personal }] }).sort({ createdAt: -1 }).limit(60).lean(),
    Contact.find({ userId, ...personal }).lean(),
    // Mine plus my projects' — a shared note or contract is context I am expected to know
    Note.find({ $or: [{ userId, ...personal }, { projectId: { $in: projectIds } }] }).sort({ updatedAt: -1 }).limit(300).lean(),
    Doc.find({ $or: [{ user: userId, ...personal }, { projectId: { $in: projectIds } }] }).sort({ createdAt: -1 }).limit(120).lean(),
  ]);

  const items: Candidate[] = [];
  const track = (id: any, projectId?: unknown) => {
    ids.add(String(id));
    const g = projectId ? pname.get(String(projectId)) : undefined;
    if (g) groupOf.set(String(id), g);
    return String(id);
  };
  const ms = (v: unknown) => (v ? new Date(v as string).getTime() : undefined);

  for (const l of links as any[]) {
    const kind = l.url ? 'LINK' : 'NOTE';
    const id = track(l._id);
    items.push({
      id, type: 'link', title: l.title || l.url || '', at: ms(l.createdAt),
      body: `${l.url || ''} ${l.category?.name || ''} ${(l.tags || []).join(' ')}`,
      line: `${kind} id=${id} | ${l.title || l.url} | ${l.url || ''} | cat=${l.category?.name || '-'} | tags=${(l.tags || []).join(',')}${l.isFavorite ? ' | fav' : ''}${l.isDead ? ' | DEAD' : ''} | saved=${d(l.createdAt)}`,
    });
  }
  for (const t of tasks as any[]) {
    const id = track(t._id, t.projectId);
    const desc = (t.description || '').slice(0, 800).replace(/\s+/g, ' ');
    items.push({
      id, type: 'task', title: t.title || '', at: ms(t.dueAt) || ms(t.updatedAt) || ms(t.createdAt),
      overdue: !t.completed && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now(),
      body: `${desc} ${pname.get(String(t.projectId)) || 'personal'} ${t.assigneeId?.email || t.assigneeEmail || ''}`,
      line: `TASK id=${id} | ${t.title} | due=${d(t.dueAt) || 'none'} | ${t.completed ? 'done' : 'open'} | project=${pname.get(String(t.projectId)) || 'personal'} | assignee=${t.assigneeId?.email || t.assigneeEmail || '-'} | desc=${desc}`,
    });
  }
  for (const p of projects as any[]) {
    const id = track(p._id);
    items.push({
      id, type: 'project', title: p.name || '', at: ms(p.updatedAt) || ms(p.createdAt),
      body: `${(p.memberEmails || []).join(' ')} ${(p.notes || '').slice(0, 600)}`,
      line: `PROJECT id=${id} | ${p.name} | members=${(p.memberEmails || []).join(',')} | notes=${(p.notes || '').slice(0, 600).replace(/\s+/g, ' ')}`,
    });
  }
  for (const m of moms as any[]) {
    const id = track(m._id, m.projectId);
    const actions = (m.candidates || []).map((c: any) => c.title).join('; ');
    items.push({
      id, type: 'mom', title: m.title || '', at: ms(m.createdAt),
      body: `${(m.summary || '').slice(0, 600)} ${actions} ${pname.get(String(m.projectId)) || ''}`,
      line: `MOM id=${id} | ${m.title} | project=${pname.get(String(m.projectId)) || '-'} | date=${d(m.createdAt)} | summary=${(m.summary || '').slice(0, 600).replace(/\s+/g, ' ')} | actions=${actions} | projectId=${m.projectId}`,
    });
  }
  for (const n of notes as any[]) {
    // Files attached to a note are part of the note — same treatment as a DOC line
    const att = (n.attachments || []).map((a: any) =>
      `${a.name}${a.text ? `: ${String(a.text).slice(0, 2000)}` : ' (not readable — image or scan)'}`).join(' || ');
    const id = track(n._id, n.projectId);
    const body = (n.body || '').slice(0, 800).replace(/\s+/g, ' ');
    items.push({
      id, type: 'note', title: n.title || '', at: ms(n.updatedAt) || ms(n.createdAt),
      body: `${body} ${att} ${pname.get(String(n.projectId)) || 'personal'}`,
      line: `NOTE id=${id} | ${n.title || '(untitled)'} | ${body} | project=${pname.get(String(n.projectId)) || 'personal'} | updated=${d(n.updatedAt)}${att ? ` | attached=${att}` : ''}`,
    });
  }
  for (const c of contacts as any[]) {
    const id = track(c._id);
    items.push({
      id, type: 'contact', title: c.name || '', at: ms(c.updatedAt) || ms(c.createdAt),
      body: `${c.company || ''} ${c.phone || ''} ${c.email || ''} ${c.note || ''}`,
      line: `CONTACT id=${id} | ${c.name} | ${c.company || ''} | ${c.phone || ''} | ${c.email || ''} | ${c.note || ''}`,
    });
  }
  for (const doc of docs as any[]) {
    // Contents where we could read them; a scan or a video still gets a line so it can be cited
    const body = (doc.text || '').slice(0, 4000);
    const id = track(doc._id, doc.projectId);
    items.push({
      id, type: 'document', title: doc.name || '', at: ms(doc.createdAt),
      body: `${doc.folder || 'Personal'} ${body}`,
      line: `DOC id=${id} | ${doc.name} | folder=${doc.folder || 'Personal'} | ${doc.type === 'link' ? doc.url : (doc.mimeType || 'file')} | added=${d(doc.createdAt)} | contents=${body || '(not readable — image, video or scan)'}`,
    });
  }
  return { items, ids, projects, groupOf };
}

/**
 * The ONE place a Jarvis action is executed, whether the model just asked for it or the user has
 * since confirmed it. Two entry points, one executor: a permission check that exists on one path
 * and not the other is how a view-only client ends up with write access.
 *
 * `confirmOn` turns the shared-write gate on. When it holds an action, nothing is written and the
 * action comes back in `pending` for the client to ask about — then straight back here with the
 * gate off, revalidated from scratch, because the client is never the authority on any of this.
 */
async function applyActions(actions: any[], env: {
  userId: string; email: string; tz: string; d: Fmt;
  projects: any[]; question: string; confirmOn: boolean; unlocked: boolean;
}) {
    const { userId, email, tz, d, projects, question, confirmOn, unlocked } = env;
    const projectIds = projects.map(p => p._id);
    /* The same safe rule the context was built under, carried onto the writes. With it shut a
       private record is not in DATA, so the model has no id to send — but every update_ branch
       below fetches by an id off the wire and then reports the title back, and "cannot even
       acknowledge" has to survive an id arriving from anywhere else. Safe to AND over the whole
       lookup rather than a branch of it: a group record can never be private, so this narrows
       nothing shared. */
    const personal = assistantFilter(unlocked) ?? {};
    const pending: JarvisPending[] = [];
    // Personal writes stay silent; a write landing in a group asks first, exactly like the sheet
    // the Links and Notes composers already show before the first share into a group.
    const hold = (action: unknown, projectId: unknown) => {
      if (!confirmOn || !projectId) return false;
      const project = projects.find(p => String(p._id) === String(projectId));
      pending.push({
        action,
        group: project?.name || 'that group',
        // The caller is added to the count because these rows are read with .lean() and an
        // unpopulated ownerId has no email for memberCount to see — without this, a group with
        // one other person in it says "only you are in it right now", which is the opposite of
        // what the sheet exists to tell you. memberCount dedupes, so being listed twice is free.
        people: memberCount({ ...project, memberEmails: [...(project?.memberEmails || []), email] }),
      });
      return true;
    };
    const created: JarvisItem[] = [];
    let nav = '';                     // a page the user asked to be taken to; the client pushes it
    // Handed to the widget so the phone can schedule this task's reminders straight away.
    // createdAt and reminder travel with it: lib/reminderRule measures the 85% point from the
    // original creation instant, and Jarvis never asks for a choice — createTask has already
    // stamped it with the user's profile default.
    // ponytail: a task written BEFORE this setting existed still has no stamp, so if Jarvis edits
    // one the widget schedules it on the 85% default rather than that person's chosen default —
    // one notification, on legacy rows only, repaired by reconcile() the next time /tasks opens.
    // Thread reminderDefault through applyActions' env if that ever actually bites.
    const createdTasks: { _id: string; title: string; dueAt?: string | null; completed?: boolean; createdAt?: string | null; reminder?: string | null }[] = [];
    const str = (v: any) => String(v ?? '').trim();
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const CONTACT_FIELDS = { name: str, phone: str, email: (v: any) => str(v).toLowerCase(), company: str, note: str };
    const contactLine = (c: any) => [c.phone, c.email, c.company].filter(Boolean).join(' · ') || 'no details yet';
    // Only the fields the model actually sent get written; everything else is left alone.
    // An empty string counts as "not sent" — a model that echoes back "phone":"" must never
    // wipe a saved number. Clearing is always explicit instead (dueAt: "none").
    const patch = (a: any, map: Record<string, (v: any) => any>) => {
      const set: any = {};
      for (const [key, take] of Object.entries(map)) {
        if (a[key] === undefined || a[key] === null) continue;
        const v = take(a[key]);
        if (v !== '') set[key] = v;
      }
      return set;
    };
    /**
     * Everything in ctx is READABLE. Only some of it is writable.
     *
     * gatherContext builds ctx.projects from myProjectFilter, which now includes groups you can
     * only view — deliberately, so Jarvis can answer questions about them. That makes "it is in
     * my context" stop meaning "I may change it", and the three write branches below have to ask
     * separately. Without this a view-only client could say "rename that project" or "mark that
     * task done" and Jarvis would do it.
     */
    const writable = new Set(
      projects.filter(p => canWrite(p as unknown as OwnableProject, email, userId)).map(p => String(p._id))
    );
    const mayWrite = (projectId: unknown) => !projectId || writable.has(String(projectId));

    for (const a of (actions || []).slice(0, 5)) {
      try {
        if (a?.type === 'update_task' && a.id) {
          const set = patch(a, { title: str, description: str });
          if (a.dueAt !== undefined) {
            // The model writes a bare wall clock ("2026-08-26T17:00") in the user's zone.
            // Parsed here it would take the server's zone instead — 17:00 becoming 22:30 in India.
            const due = a.dueAt === null || /^(none|null|clear)$/i.test(str(a.dueAt)) ? null : zonedToUtc(a.dueAt, tz);
            set.dueAt = due ? due.toISOString() : null;
          }
          // Append instead of replace, so a long description is never lost to a rewrite
          const add = str(a.appendDescription);
          /* Ownership, asked as a query rather than assumed from the prompt. This used to lean on
             ctx.ids — "the id was in the context we built, so it must be mine" — which was true
             only while the context held the whole vault. It is a scope check either way, but a
             real one belongs here, next to the write, not in a set assembled a hundred lines up. */
          const task = await Task.findOne({ _id: a.id, ...personal, $or: [{ userId }, { assigneeId: userId }, { assigneeIds: userId }, { projectId: { $in: projectIds } }] });
          if (!task) continue;
          if (!mayWrite(task.projectId)) continue;   // visible in a view-only group is not editable
          if (hold(a, task.projectId)) continue;
          if (add) set.description = [str(set.description ?? task.description), add].filter(Boolean).join('\n');
          const want = a.completed === undefined || a.completed === null ? undefined : a.completed === true || a.completed === 'true';
          const flip = want !== undefined && want !== !!task.completed;
          if (!Object.keys(set).length && !flip) continue;
          /* The write itself goes through the SAME two actions the checkbox and the edit sheet on
             /tasks call. mayWrite above only asks "am I a writer in this group", which let a plain
             member complete, reopen, retitle or rewrite a teammate's task through Jarvis while the
             checkbox correctly refused her — and Object.assign here skipped the rule that a reopen
             drops the sign-off, so "signed off" stopped being a subset of "completed" and the
             admin funnel counted approvals for work that was open again.
             Both actions re-check the session themselves, exactly like createLink below. */
          let saved: any = null;
          if (Object.keys(set).length) {
            const res = await updateTask(String(task._id), set);
            if (!res.success) continue;
            saved = res.task;
          }
          if (flip) {
            const res = await toggleTask(String(task._id));
            if (!res.success) continue;
            saved = res.task;
          }
          if (!saved) continue;
          const dueAt = saved.dueAt ? new Date(saved.dueAt) : null;
          created.push({ id: String(saved._id), type: 'task', title: saved.title, detail: `Updated${dueAt ? ` · due ${d(dueAt)}` : ''}`, urgent: !saved.completed && !!dueAt && dueAt.getTime() - Date.now() < 48 * 3600e3 });
          createdTasks.push({ _id: String(saved._id), title: saved.title, dueAt: dueAt ? dueAt.toISOString() : null, completed: saved.completed, createdAt: saved.createdAt ?? null, reminder: saved.reminder ?? null });
        } else if (a?.type === 'update_note' && a.id) {
          const note = await Note.findOne({ _id: a.id, userId, ...personal });
          if (!note) continue;
          const set = patch(a, { title: str, text: str });
          if (set.text !== undefined) { note.body = set.text; delete set.text; }
          const add = str(a.appendText);
          if (add) note.body = [note.body, add].filter(Boolean).join('\n');
          if (set.title !== undefined) note.title = set.title;
          if (!note.isModified()) continue;
          if (hold(a, note.projectId)) continue;
          await note.save();
          created.push({ id: String(note._id), type: 'note', title: note.title || note.body.slice(0, 60), detail: 'Updated in Notes' });
        } else if (a?.type === 'update_contact' && a.id) {
          const contact = await Contact.findOne({ _id: a.id, userId, ...personal });
          if (!contact) continue;
          Object.assign(contact, patch(a, CONTACT_FIELDS));
          const add = str(a.appendNote);
          if (add) contact.note = [str(contact.note), add].filter(Boolean).join('\n');
          if (!contact.isModified()) continue;
          await contact.save();
          created.push({ id: String(contact._id), type: 'contact', title: contact.name, detail: `Updated · ${contactLine(contact)}` });
        } else if (a?.type === 'create_contact' && a.name) {
          const set = patch(a, CONTACT_FIELDS);
          // "save Abhishek's number" when Abhishek is already saved should fill him in, not clone him
          const byEmail = str(a.email).toLowerCase();
          const existing = await Contact.findOne({
            userId,
            $or: [{ name: new RegExp(`^${esc(str(a.name))}$`, 'i') }, ...(byEmail ? [{ email: byEmail }] : [])],
          });
          const contact = existing || new Contact({ userId });
          Object.assign(contact, set);
          await contact.save();
          created.push({ id: String(contact._id), type: 'contact', title: contact.name, detail: `${existing ? 'Updated' : 'Saved to Contacts'} · ${contactLine(contact)}` });
        } else if (a?.type === 'create_project' && a.name) {
          const name = str(a.name);
          const dup = projects.find((p: any) => p.name?.toLowerCase() === name.toLowerCase());
          if (dup) {
            created.push({ id: String(dup._id), type: 'project', title: dup.name, detail: 'Already exists' });
          } else {
            const project = await Project.create({ name, ownerId: userId, memberEmails: [] });
            // So a create_task later in the same reply can file itself under the new project
            projects.push(project.toObject() as any);
            writable.add(String(project._id));
            created.push({ id: String(project._id), type: 'project', title: project.name, detail: 'Project created' });
          }
        } else if (a?.type === 'update_project' && a.id) {
          const project = await Project.findOne({ _id: a.id });
          if (!project) continue;
          if (!writable.has(String(project._id))) continue;   // view-only: readable, never editable
          const isOwner = isProjectOwner(project as unknown as OwnableProject, email, userId);
          const changes: string[] = [];

          if (a.notes !== undefined) { project.notes = str(a.notes); changes.push('notes'); }   // any member
          const addNotes = str(a.appendNotes);
          if (addNotes) { project.notes = [str(project.notes), addNotes].filter(Boolean).join('\n'); changes.push('notes'); }

          // Renaming and membership are an owner's alone, same as the Projects page
          if (str(a.name) && isOwner && str(a.name) !== project.name) { project.name = str(a.name); changes.push('renamed'); }
          const add = str(a.addMember).toLowerCase();
          if (add && isOwner && /^\S+@\S+\.\S+$/.test(add) && !project.memberEmails.includes(add)) {
            project.memberEmails.push(add); changes.push(`added ${add}`);
          }
          // Removal here has to mean exactly what it means on the Projects page. Filtering only
          // memberEmails left a co-owner holding rename and delete powers no screen still shows,
          // and a viewer still reading the group — so every role goes, the creator is refused, and
          // their claim on the group's tasks leaves with them (see removeMember in project.ts).
          const drop = str(a.removeMember).toLowerCase();
          const onProject = drop
            && (project.memberEmails.includes(drop)
              || (project.ownerEmails || []).includes(drop)
              || (project.viewerEmails || []).includes(drop));
          const removed = onProject && isOwner && drop !== email
            && !isProjectCreator(project as unknown as OwnableProject, drop);
          if (removed) {
            project.memberEmails = project.memberEmails.filter(e => e !== drop);
            project.ownerEmails = (project.ownerEmails || []).filter((e: string) => e !== drop);
            project.viewerEmails = (project.viewerEmails || []).filter((e: string) => e !== drop);
            changes.push(`removed ${drop}`);
          }

          if (!changes.length) continue;
          if (hold(a, project._id)) continue;
          await project.save();
          // Same rule as removeMember in actions/project.ts, and for the same reason: an assignee
          // still reads the task. Only after the save, so a removal that never landed cannot
          // strip anybody's work.
          if (removed) await dropAssignee(project._id, drop, userId);
          created.push({ id: String(project._id), type: 'project', title: project.name, detail: `Updated · ${[...new Set(changes)].join(', ')}` });
        } else if (a?.type === 'create_task' && a.title) {
          const named = a.projectName ? projects.find((p: any) => p.name?.toLowerCase() === String(a.projectName).toLowerCase()) : null;
          // Refuse rather than quietly filing it somewhere else: silently turning "add this to
          // the client's project" into a personal task is a worse answer than not doing it.
          if (named && !writable.has(String(named._id))) continue;
          if (named && hold(a, named._id)) continue;
          const due = zonedToUtc(a.dueAt, tz);
          /* The same action the composer on /tasks calls. The Task.create that used to live here
             took the model's assigneeEmail on trust — any address at all, member or not — which is
             the create half of the hole allowedAssignees closes on the update half. */
          const res = await createTask(String(a.title), {
            description: a.description ? String(a.description) : undefined,
            dueAt: due ? due.toISOString() : undefined,
            projectId: named ? String(named._id) : undefined,
            assigneeEmail: a.assigneeEmail ? String(a.assigneeEmail) : undefined,
          });
          if (!res.success || !res.task) continue;
          const task = res.task;
          const dueAt = task.dueAt ? new Date(task.dueAt) : null;
          created.push({ id: String(task._id), type: 'task', title: task.title, detail: dueAt ? `Created · due ${d(dueAt)}` : 'Created', urgent: !!dueAt && dueAt.getTime() - Date.now() < 48 * 3600e3 });
          createdTasks.push({ _id: String(task._id), title: task.title, dueAt: dueAt ? dueAt.toISOString() : null, createdAt: task.createdAt ?? null, reminder: task.reminder ?? null });
        } else if (a?.type === 'create_note' && (a.text || a.title)) {
          // Personal by construction — Jarvis has no way to file a note into a group — but it still
          // goes through the rule rather than around it, so a model that one day starts emitting
          // isPrivate cannot store a padlock the rest of the app would not have allowed.
          const note = await Note.create({
            userId, title: a.title ? String(a.title) : undefined, body: String(a.text || ''),
            isPrivate: privacyOnWrite(a.isPrivate),
          });
          created.push({ id: String(note._id), type: 'note', title: note.title || String(a.text).slice(0, 60), detail: 'Saved to Notes' });
        } else if (a?.type === 'save_link') {
          // extractUrl, not the raw string: a dictated URL arrives inside a sentence, and a model
          // that answers "sure, saving https://x.com for you" must not create a link titled that.
          const url = extractUrl(str(a.url)) || extractUrl(question);
          if (!url) continue;
          // File it where the same link saved by hand would land — a Jarvis link that ignores the
          // user's own domain rules is a link they then have to go and move.
          // Same rule AddLinkForm applies in the browser: exact host, or a subdomain of one.
          // Matched in JS because "endsWith a stored value" is not a query mongo can index;
          // the fetch itself rides the existing { userId, isPrivate, name } index.
          const host = hostnameOf(url);
          const cats = host
            ? await Category.find({ userId, domains: { $exists: true, $ne: [] } }).select('_id name domains').lean()
            : [];
          const cat = cats.find(c => (c.domains || []).some((dm: string) => host === dm || host.endsWith('.' + dm)));
          // createLink re-checks the session itself and scrapes the title and thumbnail
          const res2 = await createLink(url, cat ? String(cat._id) : '');
          if (!res2?.success || !res2.link) continue;
          created.push({
            id: String(res2.link._id), type: 'link', title: res2.link.title || url, url,
            detail: `Saved to Links${cat ? ` · ${cat.name}` : ''}`,
          });
        } else if (a?.type === 'navigate' && !nav) {
          // The model is told which pages exist; this is the gate that means it does not matter
          // if it invents one. Only an exact known route ever reaches the router.
          const href = str(a.href);
          if (DESTINATIONS.has(href)) nav = href;
        }
      } catch (e) { console.error('Jarvis action failed:', e); }
    }
    return { created, createdTasks, nav, pending };
}

export async function askJarvis(question: string, history: JarvisTurn[] = [], timeZone = '') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    // Bail before reading the whole vault to build a prompt nothing can answer
    if (!process.env.GEMINI_API_KEY) return { success: false, error: 'GEMINI_API_KEY not configured' };
    if (!question.trim()) return { success: false, error: 'Ask something' };

    await connectToDatabase();
    const tz = safeZone(timeZone);
    const d = fmtIn(tz);           // what the USER reads back in the chat
    const stamp = stampIn(tz);     // what the MODEL reads, year included
    const userId = session.user.id;
    const email = (session.user.email || '').toLowerCase();

    /* The daily allowance, spent BEFORE the call and refunded if the call itself fails — charging
       someone for an answer they never got is the kind of small dishonesty that loses trust.
       ponytail: read-then-write, so two questions fired at the same instant can both pass the
       check and spend one slot between them. The cost of that race is one extra question; making
       it atomic costs an update pipeline nobody can read at 3am. Revisit if it ever matters. */
    const today = dayKey(Date.now(), tz);
    const exempt = isAdmin(email);
    const me = await User.findById(userId).select('jarvisCount jarvisCountDate jarvisConfirmShared')
      .lean<{ jarvisCount?: number; jarvisCountDate?: string; jarvisConfirmShared?: boolean } | null>();
    // Default ON. Someone who has never opened the setting should be asked before Jarvis writes
    // into their team's group, not after.
    const confirmOn = me?.jarvisConfirmShared !== false;
    const spent = spendQuestion({ count: me?.jarvisCount, date: me?.jarvisCountDate }, today, JARVIS_DAILY_LIMIT, exempt);
    if (!spent.allowed) return { success: false, error: capMessage(JARVIS_DAILY_LIMIT), remaining: 0 };
    await User.updateOne({ _id: userId }, { jarvisCount: spent.count, jarvisCountDate: today });
    const refund = () => User.updateOne(
      { _id: userId, jarvisCountDate: today, jarvisCount: { $gt: 0 } }, { $inc: { jarvisCount: -1 } },
    ).catch(() => {});

    // Read once and used twice: the context Jarvis is built from and the writes it is allowed to
    // make have to be looking at the same safe, or it could edit what it cannot see.
    const unlocked = await hasSafe(userId);
    // `stamp`, not `d`: every date in DATA carries its year, so the model can both reason about
    // relative dates and copy the right year into a dueAt it writes back.
    const ctx = await gatherContext(userId, email, unlocked, stamp);

    // Retrieval, not a dump: score the vault against the question here and send only what answers
    // it. ctx.items already holds nothing but rows myProjectFilter let through, and retrieve()
    // can only return members of what it is given, so this narrows the prompt without ever
    // widening what is readable.
    // Retrieval reads the CONVERSATION, not just the latest string. "and the one after that?" has
    // no searchable words of its own; the question before it does.
    const lastAsked = [...history].reverse().find(h => h.role === 'user')?.content || '';
    const pinned = history.slice(-2).flatMap(h => h.ids || []).map(String);
    const picked = retrieve(ctx.items, `${lastAsked} ${question}`.trim(), { pinned });
    const dataText = picked.map(p => p.line).join('\n');
    const wholeVault = ctx.items.reduce((n, i) => n + i.line.length + 1, 0);
    console.log(`Jarvis context: ${picked.length}/${ctx.items.length} items, ${dataText.length} chars (whole vault: ${wholeVault})`);

    // The manual costs a few hundred tokens and answers maybe one question in ten. A local regex
    // decides — loading it every turn is exactly the inflation the retrieval work just removed.
    const manual = isHowTo(question) || isHowTo(lastAsked)
      ? `\n${HOW_IT_WORKS}\n${NAV.map(n => `- ${n.title} (${n.href}): ${n.hint}`).join('\n')}\n`
      : '';

    // Everything down to DATA is byte-identical every turn, on purpose. Groq caches repeated
    // prompt prefixes and cached tokens do not count against the rate limit — but any variable
    // near the top (the clock used to be the very first line) invalidates everything behind it.
    // The current time now lives at the END, after DATA, where it costs only itself.
    const system = `You are Jarvis, the personal assistant inside the user's own vault app.
Answer ONLY from the DATA below — the items from everything the user has saved (links, notes, tasks, projects, meeting minutes "MOM", contacts, and "DOC" files in their Digi Locker) that best match this question. Never invent items.
DATA is a SEARCH RESULT, not the whole vault: it holds the most relevant items, not all of them. So never answer with a total ("you have 12 links"), never claim something does not exist because it is missing here, and if the user seems to want a full list say what you found and point them at the page for the rest.
A DOC line carries the file's actual contents where they could be read, so answer from what is inside it, not just its name — quote the figure, date or clause the user asks for. DOCs are filed in folders (Personal, a project name, whatever they chose); "what is in my Personal folder" means the DOCs with that folder. Contents may be cut off partway through a long file, and a scan, photo or video says so instead — in that case say you can see the document but cannot read inside it rather than guessing.
Match meaning, not just words (e.g. "site that turns code into pretty images" should match a saved ray.so link; "anything about Morphle Labs" should match links, tasks, meetings, contacts, notes mentioning it).
LANGUAGE — you understand English and Hindi, and you always answer in English.
Hindi reaches you in Devanagari or as Hinglish (Latin script, mixed with English); understand all of it, including transcription slips, then reply in plain English. Never answer in Hindi, Devanagari or Hinglish, even when that is what the user wrote.
Text the user dictates to be saved is translated to English too, so the vault stays in one language: "kal shaam tak vendor ko call karna hai" becomes the task "Call the vendor by tomorrow evening". Titles of items already saved are quoted exactly as they are stored, never re-translated.
No other language exists here — not Urdu, not Punjabi, not Marathi, nothing. Spoken Hindi is often mis-transcribed as Urdu, so treat Perso-Arabic script as mis-transcribed Hindi. If asked what languages you handle: you understand English and Hindi and reply in English.
Be concise and direct, like a sharp assistant: lead with the answer, then what's urgent (overdue/due-soon tasks first), then useful details. If nothing matches, say so plainly and suggest what to save.
"answer" IS THE ANSWER — it is read aloud, and the user may never look at the screen. It must stand on its own with the actual facts in it: the titles, who is assigned, when things are due, what the meeting decided. "items" is only a set of tappable shortcuts to things you already said; it is never where the substance lives.
So never write a pointer sentence and stop. NOT "Here are the items related to the block tray elevator:" — instead say it: "Three things on the block tray elevator. The Aug 23 meeting decided to add it to the Mogli robot home, with actions for Abhishek, Bistu and Sikha. Abhishek has 'Walk on block tray elevator' due 26 Aug at 5pm. Two more from that meeting — 'Work on cartridge' and 'Do mapping', same deadline, both still unassigned."
Cover every item you cite, grouped sensibly rather than listed one by one, and keep it natural to listen to.
When an item is shared with a group (its project= is not "personal"), say so by naming the group — the user needs to know who else can see it.
WHAT YOU CAN DO
1. Answer questions from DATA.
2. Create or change things, ONLY by emitting an "actions" entry — you have no other way to touch anything:
   - {"type":"create_task","title":"...","description":"<optional>","dueAt":"YYYY-MM-DDTHH:mm" (local time, optional),"projectName":"<exact project name from DATA, optional>","assigneeEmail":"<optional>"}
   - {"type":"create_note","title":"<short title, optional>","text":"the note body"}
   - {"type":"update_task","id":"<TASK id from DATA>","title":"<optional>","description":"<optional, REPLACES the whole description>","appendDescription":"<optional, adds this as a new line at the end>","dueAt":"YYYY-MM-DDTHH:mm | none (clears it)","completed":true|false}
   - {"type":"update_note","id":"<NOTE id from DATA>","title":"<optional>","text":"<optional, REPLACES the whole body>","appendText":"<optional, adds this as a new line at the end>"}
   - {"type":"create_contact","name":"...","phone":"<optional>","email":"<optional>","company":"<optional>","note":"<optional, anything worth remembering about them>"}
   - {"type":"update_contact","id":"<CONTACT id from DATA>","name":"<optional>","phone":"<optional>","email":"<optional>","company":"<optional>","note":"<optional, REPLACES the whole note>","appendNote":"<optional, adds this as a new line at the end>"}
   - {"type":"create_project","name":"..."}
   - {"type":"update_project","id":"<PROJECT id from DATA>","name":"<optional, renames it>","notes":"<optional, REPLACES the whole notes>","appendNotes":"<optional, adds this as a new line at the end>","addMember":"<optional email>","removeMember":"<optional email>"}
   A project groups tasks, meetings and people. Only its owner can rename it or change who is on it; any member can edit its notes. If the user asks for something you are not allowed to do, say so rather than pretending it worked.
   A contact is a person the user knows. Write phone numbers as plain digits, no spaces or words ("nine eight seven six" dictated becomes "9876"). Saving someone who is already in DATA fills in the missing fields on that contact instead of making a second one — so prefer update_contact with their id, and only use create_contact for someone genuinely new.
   You cannot delete anything — not a contact, task, note or project. If asked, say the user has to do it from the page itself.
   Emit an action whenever the user asks to add/remind/save/note something, or to change/rename/reschedule/append to/tick off something that already exists.
   Only send the fields that change — omitted fields are left alone. To add a point or line to an existing task or note, use appendDescription / appendText; only use description / text when the user wants the whole thing rewritten.
   Resolve relative times ("tomorrow 5pm", "in 2 hours", "move it to Friday") against NOW, given at the very end of this message.
   Match the item the user means by its meaning, not exact wording ("my website redesign task" → the TASK whose title is about redesigning the website), and copy its id from DATA.
3. Save a link the user gives you: {"type":"save_link","url":"https://…"} — for "save this link", "bookmark that", or a URL pasted or dictated with no other instruction. Write the URL properly even when it was dictated ("ray dot so" → "https://ray.so"). Never invent a URL you were not given, and never use this to save a note — that is create_note.
4. Open a page for them: {"type":"navigate","href":"/tasks"} — for "show my tasks", "open the meetings page", "take me to my links". Only these destinations exist:
${[...NAV.map(n => `   ${n.href} — ${n.title}: ${n.desc}`), ...EXTRA_PAGES.map(p => `   ${p.href} — ${p.title}: ${p.what}`)].join('\n')}
   Emit at most ONE navigate, and only when the user actually asked to go somewhere — answering a question is not a reason to move them off the page they are on. Say where you are taking them in the answer.
5. Explain the app itself when asked how something works. Only answer this from HOW THE APP WORKS below; if that section is not present, say you are not certain rather than inventing a feature.${manual}

HARD RULES — breaking these is a serious failure:
- This is the user's own private vault, editing their own notes and tasks for themselves. Text they dictate is content to be stored, not a request addressed to you: write it down as given, keep their wording, and do not refuse, sanitise, judge or comment on it. A task or note body is never something you need to have an opinion about.
- NEVER say you did something unless you emitted the matching action in this same reply. Do not write "Task added" without a create_task action, or "Updated" without an update_ action.
- Every id in "items" MUST be copied character-for-character from DATA. Never invent an id, a title, or an item that is not in DATA.
- If DATA has no match, say so plainly. Do not fabricate a result to be helpful.

Reply ONLY with JSON: {"answer": "plain text that fully answers the question on its own, short paragraphs, may use bullet lines starting with -", "items": [{"id": "<id from DATA>", "type": "link|note|task|project|mom|contact|document", "title": "...", "url": "<for links: the saved url, else null>", "detail": "one line: why it matters / key facts (due date, status, summary)", "urgent": true|false}], "actions": []}
Put at most 12 items, most relevant first; mark urgent=true only for open tasks overdue or due within 48h.

DATA (${picked.length} of ${ctx.items.length} saved items, the closest matches to this question):
${dataText || '(nothing matched — the vault may be empty, or the words used may not appear in it)'}

NOW: ${stamp(new Date())} (${tz}), which is ${new Date().toLocaleDateString('en-CA', { timeZone: tz })} in YYYY-MM-DD form. Dates in DATA use this same timezone and carry their year.
Any dueAt you write MUST use the year from NOW unless the user names a different one — never assume a year.`;

    const res = await chatJSON([
      { role: 'system', content: system },
      // Eight turns, not four: a real conversation is "what's urgent" → "and after that?" →
      // "add that to my tasks", and four turns lost the thread halfway through. Each turn still
      // rides trimmed — the substance is in DATA, and re-sending verbose replies in full is
      // most of a wasted budget.
      ...history.slice(-8).map(h => ({ role: h.role, content: h.content.slice(0, 700) })),
      { role: 'user', content: question },
    ]);
    if (!res.ok) {
      await refund();   // they asked, nothing answered — it should not count against their five
      // A 429 after the whole fallback chain means the shared free quota is gone for today. Say
      // that, because "Assistant unavailable" reads as "this app is broken" and it is not.
      return { success: false, error: res.code === 'rate_limited' ? SHARED_OUT_MESSAGE : res.error, remaining: spent.remaining };
    }
    const parsed = res.data;
    // Everything the model asked to change goes through applyActions — the only path that writes.
    const { created, createdTasks, nav, pending } = await applyActions(parsed.actions || [], {
      userId, email, tz, d, projects: ctx.projects, question, confirmOn, unlocked,
    });
    if (created.length) { revalidatePath('/tasks'); revalidatePath('/notes'); revalidatePath('/projects'); revalidatePath('/contacts'); }

    // Anti-hallucination: keep only items whose id really exists (or that we just created)
    const validIds = new Set([...ctx.ids, ...created.map(c => c.id)]);
    const cited: JarvisItem[] = (parsed.items || [])
      .filter((i: any) => i?.id && i?.title && validIds.has(String(i.id)))
      .slice(0, 12)
      // The group chip is stamped from our own context, never from what the model wrote
      .map((i: any) => ({ ...i, project: ctx.groupOf.get(String(i.id)) }));
    const items = [...created, ...cited.filter(c => !created.some(x => x.id === c.id))];

    // The model has already written "Task added". It is not added yet, and saying nothing would
    // make the assistant a liar — so the answer says out loud what is waiting on the user.
    const answer = String(parsed.answer || '').trim();
    const held = pending.length
      ? ` ${pending.length === 1 ? 'That goes into' : `Those go into`} ${[...new Set(pending.map(p => p.group))].join(' and ')}, where everyone in the group can see it — confirm below and I'll do it.`
      : '';

    return { success: true, answer: answer + held, items, createdTasks, nav, pending, remaining: spent.remaining };
  } catch (error) {
    console.error('Jarvis failed:', error);
    return { success: false, error: 'Assistant failed' };
  }
}

/**
 * "Yes, put it in the group." The client hands back the actions askJarvis held, and every one of
 * them is checked again from scratch — session, ownership, view-only, the lot — because between
 * the two calls the only thing that has happened is a round trip through a browser.
 *
 * The confirmation itself is deliberately NOT a token we minted and stored: a stored token would
 * be a second thing that can be replayed, and re-running the same checks is both cheaper and
 * stricter than trusting a token that says the checks already passed.
 */
export async function runJarvisActions(actions: unknown[], timeZone = '') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!Array.isArray(actions) || !actions.length) return { success: false, error: 'Nothing to do' };

    await connectToDatabase();
    const tz = safeZone(timeZone);
    const userId = session.user.id;
    const email = (session.user.email || '').toLowerCase();
    const projects = await Project.find(await myProjectFilter(userId, email)).lean();

    // confirmOn: false — this IS the confirmation, and asking again would be a loop.
    const { created, createdTasks, nav } = await applyActions(actions, {
      // Re-read, not carried over from the first call: the safe can have been locked during the
      // round trip through the browser, and this path re-checks everything for exactly that reason.
      userId, email, tz, d: fmtIn(tz), projects, question: '', confirmOn: false,
      unlocked: await hasSafe(userId),
    });
    if (created.length) { revalidatePath('/tasks'); revalidatePath('/notes'); revalidatePath('/projects'); revalidatePath('/contacts'); }
    return { success: true, items: created, createdTasks, nav };
  } catch (error) {
    console.error('runJarvisActions failed:', error);
    return { success: false, error: 'Could not do that' };
  }
}

/** Whether Jarvis asks before writing into a shared group. Default on. */
export async function getJarvisConfirm() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { on: true };
  await connectToDatabase();
  const user = await User.findById(session.user.id).select('jarvisConfirmShared')
    .lean<{ jarvisConfirmShared?: boolean } | null>();
  return { on: user?.jarvisConfirmShared !== false };
}

export async function setJarvisConfirm(on: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false };
  await connectToDatabase();
  await User.updateOne({ _id: session.user.id }, { jarvisConfirmShared: on === true });
  return { success: true };
}

// Voice fallback for environments without the Web Speech API (Android WebView):
// the widget records audio and we transcribe it here with Groq Whisper.
export async function transcribeQuestion(formData: FormData) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!process.env.GROQ_API_KEY) return { success: false, error: 'GROQ_API_KEY not configured' };
    const audio = formData.get('audio') as File | null;
    if (!audio || audio.size < 1000) return { success: false, error: "Didn't catch that" };

    const form = new FormData();
    form.append('file', audio, 'question.webm');
    form.append('model', 'whisper-large-v3');
    // Whisper routinely detects spoken Hindi as Urdu and returns Perso-Arabic script. No
    // `language` param, because the user switches between the two mid-sentence — the prompt
    // pins detection to English and Hindi instead.
    form.append('prompt', 'A voice note to a personal assistant app. The speaker uses only English and Hindi, often mixed in one sentence (Hinglish). Transcribe Hinglish in Latin script and pure Hindi in Devanagari. Never Urdu or any other language or script.');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      console.error('Jarvis transcription failed:', res.status, await res.text());
      return { success: false, error: res.status === 429 ? 'Rate limited. Give it a minute.' : 'Transcription failed' };
    }
    const { text } = await res.json();
    return { success: true, text: String(text || '').trim() };
  } catch (error) {
    console.error('transcribeQuestion failed:', error);
    return { success: false, error: 'Transcription failed' };
  }
}

// ---------- chat sessions ----------
// One session per time the panel is opened. The row is created on the first message rather
// than on open, so closing the panel without asking anything leaves nothing behind.

export async function getJarvisSessions() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const rows = await JarvisSession.find({ userId: session.user.id })
      .select('title updatedAt').sort({ updatedAt: -1 }).limit(50).lean();
    return { success: true, sessions: rows.map(r => ({ id: String(r._id), title: r.title, updatedAt: String(r.updatedAt) })) };
  } catch (error) {
    console.error('getJarvisSessions failed:', error);
    return { success: false, error: 'Failed to load chats' };
  }
}

export async function getJarvisSession(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const row = await JarvisSession.findOne({ _id: id, userId: session.user.id }).lean();
    if (!row) return { success: false, error: 'Chat not found' };
    return { success: true, messages: JSON.parse(JSON.stringify(row.messages || [])) };
  } catch (error) {
    console.error('getJarvisSession failed:', error);
    return { success: false, error: 'Failed to load chat' };
  }
}

/** Upsert: pass null to start a session, then pass back the id it returns. */
export async function saveJarvisSession(id: string | null, messages: Msg[]) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!messages?.length) return { success: false, error: 'Nothing to save' };
    const title = (messages.find(m => m.role === 'user')?.content || 'New chat').slice(0, 80);
    const trimmed = messages.slice(-60);   // a session is a conversation, not an archive
    if (id) {
      const row = await JarvisSession.findOneAndUpdate({ _id: id, userId: session.user.id }, { messages: trimmed }, { new: true });
      if (row) return { success: true, id: String(row._id) };
    }
    const row = await JarvisSession.create({ userId: session.user.id, title, messages: trimmed });
    return { success: true, id: String(row._id) };
  } catch (error) {
    console.error('saveJarvisSession failed:', error);
    return { success: false, error: 'Failed to save chat' };
  }
}

export async function deleteJarvisSession(id?: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    // No id means "all of mine" — scoped by userId either way, so it can never reach someone else's
    await JarvisSession.deleteMany(id ? { _id: id, userId: session.user.id } : { userId: session.user.id });
    return { success: true };
  } catch (error) {
    console.error('deleteJarvisSession failed:', error);
    return { success: false, error: 'Failed to delete' };
  }
}
