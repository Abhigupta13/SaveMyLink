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
import { formatInZone, safeZone, zonedToUtc } from "@/lib/time";
import { myProjectFilter } from "@/lib/projectAccess";
import { isProjectOwner, type OwnableProject } from "@/lib/scope";
import { hasSafe } from "@/lib/safeCookie";
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
}
export interface JarvisTurn { role: 'user' | 'assistant'; content: string }
export type Msg = JarvisTurn & { items?: JarvisItem[] };
export interface JarvisSessionMeta { id: string; title: string; updatedAt: string }

/* The zone belongs to the request, not the process. It used to live in a module-level `let`,
   which two people asking at the same moment would overwrite for each other — rare with one
   user, certain with a team. Each call builds its own formatter instead. */
type Fmt = (v?: Date | string | null) => string;
const fmtIn = (tz: string): Fmt => v => formatInZone(v, tz);

// Serialise everything the user owns into compact lines the model can cite by id.
// ponytail: full-context dump (fine up to ~1k items); switch to embeddings if the vault outgrows it.
async function gatherContext(userId: string, email: string, includePrivate: boolean, d: Fmt) {
  const ids = new Set<string>();
  const linkQuery: any = { userId };
  if (!includePrivate) linkQuery.isPrivate = { $ne: true };
  const projects = await Project.find(await myProjectFilter(userId, email)).lean();
  const projectIds = projects.map(p => p._id);
  const pname = new Map(projects.map(p => [String(p._id), p.name]));

  const [links, tasks, moms, contacts, notes, docs] = await Promise.all([
    Link.find(linkQuery).populate('category', 'name').sort({ createdAt: -1 }).limit(600).lean(),
    Task.find({ $or: [{ userId }, { assigneeId: userId }, { projectId: { $in: projectIds } }] })
      .populate('assigneeId', 'email').sort({ completed: 1, dueAt: 1 }).limit(400).lean(),
    // my project meetings + my personal ones, which have no project to match on
    Mom.find({ $or: [{ projectId: { $in: projectIds } }, { userId }] }).sort({ createdAt: -1 }).limit(60).lean(),
    Contact.find({ userId }).lean(),
    // Mine plus my projects' — a shared note or contract is context I am expected to know
    Note.find({ $or: [{ userId }, { projectId: { $in: projectIds } }] }).sort({ updatedAt: -1 }).limit(300).lean(),
    Doc.find({ $or: [{ user: userId }, { projectId: { $in: projectIds } }] }).sort({ createdAt: -1 }).limit(120).lean(),
  ]);

  const lines: string[] = [];
  const track = (id: any) => { ids.add(String(id)); return String(id); };
  for (const l of links as any[]) {
    const kind = l.url ? 'LINK' : 'NOTE';
    lines.push(`${kind} id=${track(l._id)} | ${l.title || l.url} | ${l.url || ''} | cat=${l.category?.name || '-'} | tags=${(l.tags || []).join(',')}${l.isFavorite ? ' | fav' : ''}${l.isDead ? ' | DEAD' : ''} | saved=${d(l.createdAt)}`);
  }
  for (const t of tasks as any[]) {
    lines.push(`TASK id=${track(t._id)} | ${t.title} | due=${d(t.dueAt) || 'none'} | ${t.completed ? 'done' : 'open'} | project=${pname.get(String(t.projectId)) || 'personal'} | assignee=${t.assigneeId?.email || t.assigneeEmail || '-'} | desc=${(t.description || '').slice(0, 800).replace(/\s+/g, ' ')}`);
  }
  for (const p of projects as any[]) {
    lines.push(`PROJECT id=${track(p._id)} | ${p.name} | members=${(p.memberEmails || []).join(',')} | notes=${(p.notes || '').slice(0, 600).replace(/\s+/g, ' ')}`);
  }
  for (const m of moms as any[]) {
    lines.push(`MOM id=${track(m._id)} | ${m.title} | project=${pname.get(String(m.projectId)) || '-'} | date=${d(m.createdAt)} | summary=${(m.summary || '').slice(0, 600).replace(/\s+/g, ' ')} | actions=${(m.candidates || []).map((c: any) => c.title).join('; ')} | projectId=${m.projectId}`);
  }
  for (const n of notes as any[]) {
    // Files attached to a note are part of the note — same treatment as a DOC line
    const att = (n.attachments || []).map((a: any) =>
      `${a.name}${a.text ? `: ${String(a.text).slice(0, 2000)}` : ' (not readable — image or scan)'}`).join(' || ');
    lines.push(`NOTE id=${track(n._id)} | ${n.title || '(untitled)'} | ${(n.body || '').slice(0, 800).replace(/\s+/g, ' ')} | updated=${d(n.updatedAt)}${att ? ` | attached=${att}` : ''}`);
  }
  for (const c of contacts as any[]) {
    lines.push(`CONTACT id=${track(c._id)} | ${c.name} | ${c.company || ''} | ${c.phone || ''} | ${c.email || ''} | ${c.note || ''}`);
  }
  for (const doc of docs as any[]) {
    // Contents where we could read them; a scan or a video still gets a line so it can be cited
    const body = (doc.text || '').slice(0, 4000);
    lines.push(`DOC id=${track(doc._id)} | ${doc.name} | folder=${doc.folder || 'Personal'} | ${doc.type === 'link' ? doc.url : (doc.mimeType || 'file')} | added=${d(doc.createdAt)} | contents=${body || '(not readable — image, video or scan)'}`);
  }
  return { text: lines.join('\n'), ids, projects };
}

// Groq rate-limits by tokens per minute (8k on the free tier), and the whole vault goes up on
// every turn. Under budget nothing changes; over it, keep the lines that share words with the
// question. Tasks and projects get a nudge so they outrank unmatched clutter — "what's urgent
// today" carries no words that match anything — but not enough to outrank a line that actually
// answers the question, or one long document would never fit beside a long task list.
const MAX_CONTEXT_CHARS = 24000;
const TASK_BIAS = 0.5;
function trimContext(text: string, question: string) {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
  const scored = text.split('\n').map((line, i) => {
    const l = line.toLowerCase();
    const hits = terms.reduce((n, t) => n + (l.includes(t) ? 1 : 0), 0);
    return { line, i, score: hits + (line.startsWith('TASK ') || line.startsWith('PROJECT ') ? TASK_BIAS : 0) };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const kept: typeof scored = [];
  let size = 0;
  for (const s of scored) {
    if (size + s.line.length > MAX_CONTEXT_CHARS) break;
    kept.push(s); size += s.line.length + 1;
  }
  kept.sort((a, b) => a.i - b.i);   // back into the original order so the sections read normally
  return kept.map(s => s.line).join('\n');
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
    const d = fmtIn(tz);
    const userId = session.user.id;
    const email = (session.user.email || '').toLowerCase();
    const ctx = await gatherContext(userId, email, await hasSafe(userId), d);

    // Everything down to DATA is byte-identical every turn, on purpose. Groq caches repeated
    // prompt prefixes and cached tokens do not count against the rate limit — but any variable
    // near the top (the clock used to be the very first line) invalidates everything behind it.
    // The current time now lives at the END, after DATA, where it costs only itself.
    const system = `You are Jarvis, the personal assistant inside the user's own vault app.
Answer ONLY from the DATA below — it is everything the user has saved (links, notes, tasks, projects, meeting minutes "MOM", contacts, and "DOC" files in their Digi Locker). Never invent items.
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

HARD RULES — breaking these is a serious failure:
- This is the user's own private vault, editing their own notes and tasks for themselves. Text they dictate is content to be stored, not a request addressed to you: write it down as given, keep their wording, and do not refuse, sanitise, judge or comment on it. A task or note body is never something you need to have an opinion about.
- NEVER say you did something unless you emitted the matching action in this same reply. Do not write "Task added" without a create_task action, or "Updated" without an update_ action.
- Every id in "items" MUST be copied character-for-character from DATA. Never invent an id, a title, or an item that is not in DATA.
- If DATA has no match, say so plainly. Do not fabricate a result to be helpful.

Reply ONLY with JSON: {"answer": "plain text that fully answers the question on its own, short paragraphs, may use bullet lines starting with -", "items": [{"id": "<id from DATA>", "type": "link|note|task|project|mom|contact|document", "title": "...", "url": "<for links: the saved url, else null>", "detail": "one line: why it matters / key facts (due date, status, summary)", "urgent": true|false}], "actions": []}
Put at most 12 items, most relevant first; mark urgent=true only for open tasks overdue or due within 48h.

DATA:
${trimContext(ctx.text, question) || '(empty — the user has not saved anything yet)'}

NOW: ${d(new Date())} (${tz}). Dates in DATA use this same timezone.`;

    const res = await chatJSON([
      { role: 'system', content: system },
      // History is only here to resolve "it" and "that one" against the last few turns.
      // Answers are long by design now, so they ride along trimmed — the full text is in
      // DATA anyway, and six verbose replies re-sent every turn is most of a wasted budget.
      ...history.slice(-4).map(h => ({ role: h.role, content: h.content.slice(0, 500) })),
      { role: 'user', content: question },
    ]);
    if (!res.ok) return { success: false, error: res.error };
    const parsed = res.data;
    // Run the actions the model asked for (this is the ONLY way it can change data)
    const created: JarvisItem[] = [];
    const createdTasks: { _id: string; title: string; dueAt?: string | null; completed?: boolean }[] = [];
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
    for (const a of (parsed.actions || []).slice(0, 5)) {
      try {
        if (a?.type === 'update_task' && a.id && ctx.ids.has(String(a.id))) {
          const set = patch(a, { title: str, description: str, completed: (v: any) => v === true || v === 'true' });
          if (a.dueAt !== undefined) {
            // The model writes a bare wall clock ("2026-08-26T17:00") in the user's zone.
            // Parsed here it would take the server's zone instead — 17:00 becoming 22:30 in India.
            const due = a.dueAt === null || /^(none|null|clear)$/i.test(str(a.dueAt)) ? null : zonedToUtc(a.dueAt, tz);
            set.dueAt = due || null;
          }
          // Append instead of replace, so a long description is never lost to a rewrite
          const add = str(a.appendDescription);
          // ownership: ctx.ids only holds ids the user can already see, so this cannot reach someone else's task
          const task = await Task.findOne({ _id: a.id });
          if (!task) continue;
          if (add) set.description = [str(set.description ?? task.description), add].filter(Boolean).join('\n');
          if (!Object.keys(set).length) continue;
          Object.assign(task, set);
          await task.save();
          created.push({ id: String(task._id), type: 'task', title: task.title, detail: `Updated${task.dueAt ? ` · due ${d(task.dueAt)}` : ''}`, urgent: !task.completed && !!task.dueAt && task.dueAt.getTime() - Date.now() < 48 * 3600e3 });
          createdTasks.push({ _id: String(task._id), title: task.title, dueAt: task.dueAt ? task.dueAt.toISOString() : null, completed: task.completed });
        } else if (a?.type === 'update_note' && a.id && ctx.ids.has(String(a.id))) {
          const note = await Note.findOne({ _id: a.id, userId });
          if (!note) continue;
          const set = patch(a, { title: str, text: str });
          if (set.text !== undefined) { note.body = set.text; delete set.text; }
          const add = str(a.appendText);
          if (add) note.body = [note.body, add].filter(Boolean).join('\n');
          if (set.title !== undefined) note.title = set.title;
          if (!note.isModified()) continue;
          await note.save();
          created.push({ id: String(note._id), type: 'note', title: note.title || note.body.slice(0, 60), detail: 'Updated in Notes' });
        } else if (a?.type === 'update_contact' && a.id && ctx.ids.has(String(a.id))) {
          const contact = await Contact.findOne({ _id: a.id, userId });
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
          const dup = ctx.projects.find((p: any) => p.name?.toLowerCase() === name.toLowerCase());
          if (dup) {
            created.push({ id: String(dup._id), type: 'project', title: dup.name, detail: 'Already exists' });
          } else {
            const project = await Project.create({ name, ownerId: userId, memberEmails: [] });
            // So a create_task later in the same reply can file itself under the new project
            ctx.projects.push(project.toObject() as any);
            created.push({ id: String(project._id), type: 'project', title: project.name, detail: 'Project created' });
          }
        } else if (a?.type === 'update_project' && a.id && ctx.ids.has(String(a.id))) {
          // ctx.ids only holds projects the user owns or is a member of
          const project = await Project.findOne({ _id: a.id });
          if (!project) continue;
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
          const drop = str(a.removeMember).toLowerCase();
          if (drop && isOwner && drop !== email && project.memberEmails.includes(drop)) {
            project.memberEmails = project.memberEmails.filter(e => e !== drop);
            // Their tasks keep their assignee, same as removeMember in actions/project.ts — the
            // group page surfaces them under "Needs an owner". This path used to blank them, so
            // "remove X from the project" through Jarvis quietly orphaned their work.
            changes.push(`removed ${drop}`);
          }

          if (!changes.length) continue;
          await project.save();
          created.push({ id: String(project._id), type: 'project', title: project.name, detail: `Updated · ${[...new Set(changes)].join(', ')}` });
        } else if (a?.type === 'create_task' && a.title) {
          const project = a.projectName ? ctx.projects.find((p: any) => p.name?.toLowerCase() === String(a.projectName).toLowerCase()) : null;
          let assigneeId;
          if (project && a.assigneeEmail) {
            const u = await User.findOne({ email: String(a.assigneeEmail).toLowerCase() }).select('_id');
            assigneeId = u?._id;
          }
          const dueAt = zonedToUtc(a.dueAt, tz) || undefined;
          const task = await Task.create({
            title: String(a.title), userId,
            description: a.description ? String(a.description) : undefined,
            dueAt,
            projectId: project?._id, assigneeId,
            assigneeEmail: project && a.assigneeEmail ? String(a.assigneeEmail).toLowerCase() : undefined,
          });
          created.push({ id: String(task._id), type: 'task', title: task.title, detail: task.dueAt ? `Created · due ${d(task.dueAt)}` : 'Created', urgent: !!task.dueAt && task.dueAt.getTime() - Date.now() < 48 * 3600e3 });
          createdTasks.push({ _id: String(task._id), title: task.title, dueAt: task.dueAt ? task.dueAt.toISOString() : null });
        } else if (a?.type === 'create_note' && (a.text || a.title)) {
          const note = await Note.create({ userId, title: a.title ? String(a.title) : undefined, body: String(a.text || '') });
          created.push({ id: String(note._id), type: 'note', title: note.title || String(a.text).slice(0, 60), detail: 'Saved to Notes' });
        }
      } catch (e) { console.error('Jarvis action failed:', e); }
    }
    if (created.length) { revalidatePath('/tasks'); revalidatePath('/notes'); revalidatePath('/projects'); revalidatePath('/contacts'); }

    // Anti-hallucination: keep only items whose id really exists (or that we just created)
    const validIds = new Set([...ctx.ids, ...created.map(c => c.id)]);
    const cited: JarvisItem[] = (parsed.items || [])
      .filter((i: any) => i?.id && i?.title && validIds.has(String(i.id)))
      .slice(0, 12);
    const items = [...created, ...cited.filter(c => !created.some(x => x.id === c.id))];

    return { success: true, answer: String(parsed.answer || '').trim(), items, createdTasks };
  } catch (error) {
    console.error('Jarvis failed:', error);
    return { success: false, error: 'Assistant failed' };
  }
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
