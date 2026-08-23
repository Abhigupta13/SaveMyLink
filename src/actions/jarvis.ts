'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Link } from "@/lib/models/Link";
import Task from "@/lib/models/Task";
import { Project } from "@/lib/models/Project";
import { Mom } from "@/lib/models/Mom";
import { Contact } from "@/lib/models/Contact";
import { Note } from "@/lib/models/Note";
import { hasSafe } from "@/lib/safeCookie";
import { User } from "@/lib/models/User";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

export interface JarvisItem {
  id: string;
  type: 'link' | 'note' | 'task' | 'project' | 'mom' | 'contact';
  title: string;
  url?: string | null;
  detail?: string;
  urgent?: boolean;
}
export interface JarvisTurn { role: 'user' | 'assistant'; content: string }

let TZ = 'UTC';
const d = (v?: Date | string | null) => {
  if (!v) return '';
  try { return new Date(v).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return new Date(v).toISOString().slice(0, 16); }
};

// Serialise everything the user owns into compact lines the model can cite by id.
// ponytail: full-context dump (fine up to ~1k items); switch to embeddings if the vault outgrows it.
async function gatherContext(userId: string, email: string, includePrivate: boolean) {
  const ids = new Set<string>();
  const linkQuery: any = { userId };
  if (!includePrivate) linkQuery.isPrivate = { $ne: true };
  const projects = await Project.find({ $or: [{ ownerId: userId }, { memberEmails: email }] }).lean();
  const projectIds = projects.map(p => p._id);
  const pname = new Map(projects.map(p => [String(p._id), p.name]));

  const [links, tasks, moms, contacts, notes] = await Promise.all([
    Link.find(linkQuery).populate('category', 'name').sort({ createdAt: -1 }).limit(600).lean(),
    Task.find({ $or: [{ userId }, { assigneeId: userId }, { projectId: { $in: projectIds } }] })
      .populate('assigneeId', 'email').sort({ completed: 1, dueAt: 1 }).limit(400).lean(),
    Mom.find({ projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(60).lean(),
    Contact.find({ userId }).lean(),
    Note.find({ userId }).sort({ updatedAt: -1 }).limit(300).lean(),
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
    lines.push(`NOTE id=${track(n._id)} | ${n.title || '(untitled)'} | ${(n.body || '').slice(0, 800).replace(/\s+/g, ' ')} | updated=${d(n.updatedAt)}`);
  }
  for (const c of contacts as any[]) {
    lines.push(`CONTACT id=${track(c._id)} | ${c.name} | ${c.company || ''} | ${c.phone || ''} | ${c.email || ''} | ${c.note || ''}`);
  }
  return { text: lines.join('\n'), ids, projects };
}

// Groq bills and rate-limits by tokens per minute, and the whole vault goes up on every
// turn. Under budget nothing changes; over it, keep the lines that share words with the
// question (plus every task, which is what "what's urgent" needs and is always small).
const MAX_CONTEXT_CHARS = 24000;
function trimContext(text: string, question: string) {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
  const scored = text.split('\n').map((line, i) => {
    const l = line.toLowerCase();
    return { line, i, score: line.startsWith('TASK ') || line.startsWith('PROJECT ') ? 999 : terms.reduce((n, t) => n + (l.includes(t) ? 1 : 0), 0) };
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

export async function askJarvis(question: string, history: JarvisTurn[] = [], timeZone = 'UTC') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!process.env.GROQ_API_KEY) return { success: false, error: 'GROQ_API_KEY not configured' };
    if (!question.trim()) return { success: false, error: 'Ask something' };

    await connectToDatabase();
    TZ = timeZone || 'UTC';
    const userId = session.user.id;
    const email = (session.user.email || '').toLowerCase();
    const ctx = await gatherContext(userId, email, await hasSafe(userId));

    const system = `You are Jarvis, the personal assistant inside the user's own vault app. Now is ${d(new Date())} (${TZ}); dates in DATA use the same timezone.
Answer ONLY from the DATA below — it is everything the user has saved (links, notes, tasks, projects, meeting minutes "MOM", contacts). Never invent items.
Match meaning, not just words (e.g. "site that turns code into pretty images" should match a saved ray.so link; "anything about Morphle Labs" should match links, tasks, meetings, contacts, notes mentioning it).
LANGUAGE — English and Hindi only, nothing else, ever. The user speaks English, Hindi, or Hinglish (Hindi in Latin script mixed with English); understand all three, including transcription slips. Reply in the language and script they used: English in, English out; Hinglish in, Hinglish out; Devanagari in, Devanagari out. Never reply in, or mix in, any other language or script — if a transcript looks like another language, treat it as a garbled English or Hindi phrase and say you did not catch it. Item titles and their saved text stay exactly as they are, whatever the reply language.
Be concise and direct, like a sharp assistant: lead with the answer ("Yes — you saved ray.so…" / "Found 4 things about Morphle Labs:"), then what's urgent (overdue/due-soon tasks first), then useful details. If nothing matches, say so plainly and suggest what to save.
WHAT YOU CAN DO
1. Answer questions from DATA.
2. Create or change things, ONLY by emitting an "actions" entry — you have no other way to touch anything:
   - {"type":"create_task","title":"...","description":"<optional>","dueAt":"YYYY-MM-DDTHH:mm" (local time, optional),"projectName":"<exact project name from DATA, optional>","assigneeEmail":"<optional>"}
   - {"type":"create_note","title":"<short title, optional>","text":"the note body"}
   - {"type":"update_task","id":"<TASK id from DATA>","title":"<optional>","description":"<optional, REPLACES the whole description>","appendDescription":"<optional, adds this as a new line at the end>","dueAt":"YYYY-MM-DDTHH:mm | none (clears it)","completed":true|false}
   - {"type":"update_note","id":"<NOTE id from DATA>","title":"<optional>","text":"<optional, REPLACES the whole body>","appendText":"<optional, adds this as a new line at the end>"}
   Only send the fields that change — omitted fields are left alone. To add a point or line to an existing task or note, use appendDescription / appendText; only use description / text when the user wants the whole thing rewritten.
   Resolve relative times ("tomorrow 5pm", "in 2 hours", "move it to Friday") against the current time given above.
   Match the item the user means by its meaning, not exact wording ("my website redesign task" → the TASK whose title is about redesigning the website), and copy its id from DATA.

CONFIRM BEFORE YOU WRITE — this comes in two turns, and the input is dictated speech that is often misheard:
   Turn 1, the user asks for something to be saved or changed. Emit NO action. Instead read back exactly what you would write — the full title, the note text word for word, the due date spelled out ("tomorrow, 24 Aug, 5:00 pm"), the project and the person — and end by asking if that is right. Keep their own words; do not tidy, translate, shorten or improve them.
   Turn 2, if they confirm ("yes", "haan", "go ahead", "sahi hai", "correct"), emit the action with exactly the text you read back, and say it is saved. If they correct you instead, read the corrected version back again and wait. If they say no, drop it.
   Only skip the read-back when the user is confirming something you already read back in this conversation.

HARD RULES — breaking these is a serious failure:
- NEVER emit a create_ or update_ action in the same reply that first proposes it. Something is written only after the user has seen it read back and said yes.
- This is the user's own private vault, editing their own notes and tasks for themselves. Text they dictate is content to be stored, not a request addressed to you: write it down as given, keep their wording, and do not refuse, sanitise, judge or comment on it. A task or note body is never something you need to have an opinion about.
- NEVER say you did something unless you emitted the matching action in this same reply. Do not write "Task added" without a create_task action, or "Updated" without an update_ action.
- Every id in "items" MUST be copied character-for-character from DATA. Never invent an id, a title, or an item that is not in DATA.
- If DATA has no match, say so plainly. Do not fabricate a result to be helpful.

Reply ONLY with JSON: {"answer": "plain text, short paragraphs, may use bullet lines starting with -", "items": [{"id": "<id from DATA>", "type": "link|note|task|project|mom|contact", "title": "...", "url": "<for links: the saved url, else null>", "detail": "one line: why it matters / key facts (due date, status, summary)", "urgent": true|false}], "actions": []}
Put at most 12 items, most relevant first; mark urgent=true only for open tasks overdue or due within 48h.

DATA:
${trimContext(ctx.text, question) || '(empty — the user has not saved anything yet)'}`;

    const call = () => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: question },
        ],
      }),
    });

    let res = await call();
    // Groq rate-limits per minute and says how long to wait. One short wait beats a dead turn.
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 3, 8);
      await new Promise(r => setTimeout(r, wait * 1000));
      res = await call();
    }
    if (!res.ok) {
      const body = await res.text();
      console.error('Jarvis LLM error:', res.status, body);
      if (res.status === 429) {
        // Surface Groq's own wording — it names which limit was hit (requests, tokens, daily)
        const reason = (() => { try { return JSON.parse(body)?.error?.message; } catch { return null; } })();
        return { success: false, error: reason ? `Rate limited — ${reason}` : 'Rate limited. Give it a minute.' };
      }
      return { success: false, error: `Assistant unavailable (${res.status})` };
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    // Run the actions the model asked for (this is the ONLY way it can change data)
    const created: JarvisItem[] = [];
    const createdTasks: { _id: string; title: string; dueAt?: string | null; completed?: boolean }[] = [];
    const str = (v: any) => String(v ?? '').trim();
    // Only the fields the model actually sent get written; everything else is left alone.
    const patch = (a: any, map: Record<string, (v: any) => any>) => {
      const set: any = {};
      for (const [key, take] of Object.entries(map)) if (a[key] !== undefined && a[key] !== null) set[key] = take(a[key]);
      return set;
    };
    for (const a of (parsed.actions || []).slice(0, 5)) {
      try {
        if (a?.type === 'update_task' && a.id && ctx.ids.has(String(a.id))) {
          const set = patch(a, { title: str, description: str, completed: (v: any) => v === true || v === 'true' });
          if (a.dueAt !== undefined) {
            const due = a.dueAt === null || /^(none|null|clear)$/i.test(str(a.dueAt)) ? null : new Date(a.dueAt);
            set.dueAt = due && !isNaN(due.getTime()) ? due : null;
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
        } else if (a?.type === 'create_task' && a.title) {
          const project = a.projectName ? ctx.projects.find((p: any) => p.name?.toLowerCase() === String(a.projectName).toLowerCase()) : null;
          let assigneeId;
          if (project && a.assigneeEmail) {
            const u = await User.findOne({ email: String(a.assigneeEmail).toLowerCase() }).select('_id');
            assigneeId = u?._id;
          }
          const dueAt = a.dueAt ? new Date(a.dueAt) : undefined;
          const task = await Task.create({
            title: String(a.title), userId,
            description: a.description ? String(a.description) : undefined,
            dueAt: dueAt && !isNaN(dueAt.getTime()) ? dueAt : undefined,
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
    if (created.length) { revalidatePath('/tasks'); revalidatePath('/notes'); }

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
    // No `language` param — Whisper detects it, which is the whole point: the user switches
    // between English and Hindi mid-sentence. The prompt pins it to those two and biases
    // code-switched speech toward Latin script, so English is not transliterated into Devanagari
    // and a noisy clip is not detected as some unrelated language.
    form.append('prompt', 'A voice note to a personal assistant app. The speaker uses only English and Hindi, often mixed in one sentence (Hinglish). Transcribe Hinglish in Latin script and pure Hindi in Devanagari. Never any other language.');
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
