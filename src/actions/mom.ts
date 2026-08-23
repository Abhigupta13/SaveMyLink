'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Mom } from "@/lib/models/Mom";
import { Note } from "@/lib/models/Note";
import { Project } from "@/lib/models/Project";
import { Contact } from "@/lib/models/Contact";
import Task from "@/lib/models/Task";
import { User } from "@/lib/models/User";
import { projectForMember } from "@/lib/projectAccess";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import path from 'path';
import { unlink } from 'fs/promises';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

// Transcripts mis-spell project names; match on letters only, then by containment
const norm = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function matchProject(name: string, projects: any[]) {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  return projects.find(p => norm(p.name) === n)
      || projects.find(p => norm(p.name).includes(n) || n.includes(norm(p.name)))
      || null;
}

async function memberSession(projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  await connectToDatabase();
  const project = await projectForMember(projectId, session.user.id, session.user.email);
  if (!project) return null;
  return { session, project };
}

export async function getMoms(projectId: string) {
  try {
    const ctx = await memberSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member' };
    const moms = await Mom.find({ projectId }).sort({ createdAt: -1 }).lean();
    return { success: true, moms: JSON.parse(JSON.stringify(moms)) };
  } catch (error) {
    console.error('Failed to get MOMs:', error);
    return { success: false, error: 'Failed to fetch MOMs' };
  }
}

/**
 * Records straight to a transcript. The audio is never written to disk: nothing plays it
 * back, the only thing that ever read it was transcription, and on a serverless host the
 * filesystem is read-only (and per-instance), so storing it failed in production and left
 * the meeting stuck with no transcript.
 */
export async function uploadMomAudio(formData: FormData) {
  try {
    const projectId = formData.get('projectId') as string;
    const title = (formData.get('title') as string) || `Meeting ${new Date().toLocaleDateString()}`;
    const audio = formData.get('audio') as File | null;
    if (!audio || audio.size < 1000) return { success: false, error: 'Nothing was recorded' };

    const ctx = await memberSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member' };
    if (!process.env.GROQ_API_KEY) return { success: false, error: 'GROQ_API_KEY not configured' };

    const form = new FormData();
    form.append('file', audio, 'meeting.webm');
    // whisper-large-v3 handles Hinglish code-switching well, and detects the language itself
    form.append('model', 'whisper-large-v3');

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Groq transcription failed:', err);
      return { success: false, error: `Transcription failed (${res.status})` };
    }
    const { text } = await res.json();

    const mom = await Mom.create({
      projectId,
      userId: ctx.session.user.id,
      title,
      transcript: String(text || ''),
    });
    return { success: true, mom: JSON.parse(JSON.stringify(mom)) };
  } catch (error) {
    console.error('Failed to record meeting:', error);
    return { success: false, error: 'Failed to save recording' };
  }
}

export async function extractMomTasks(momId: string, timeZone = 'UTC') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom?.transcript) return { success: false, error: 'No transcript yet' };
    const ctx = await memberSession(String(mom.projectId));
    if (!ctx) return { success: false, error: 'Not a member' };

    const myEmail = (ctx.session.user.email || '').toLowerCase();
    // Everything the model needs to route items: all my projects and all known people
    const [projects, contacts] = await Promise.all([
      Project.find({ $or: [{ ownerId: ctx.session.user.id }, { memberEmails: myEmail }] })
        .populate('ownerId', 'email name').lean(),
      Contact.find({ userId: ctx.session.user.id }).select('name email').lean(),
    ]);

    const projectLines = (projects as any[]).map(p =>
      `- "${p.name}" (members: ${[p.ownerId?.email, ...(p.memberEmails || [])].filter(Boolean).join(', ') || 'none'})`).join('\n');
    const peopleLines = [
      `- me = ${myEmail}`,
      ...(contacts as any[]).filter(c => c.email).map(c => `- ${c.name} = ${c.email}`),
      ...(projects as any[]).flatMap(p => [p.ownerId?.email, ...(p.memberEmails || [])]).filter(Boolean)
        .filter((e, i, a) => a.indexOf(e) === i && e !== myEmail).map(e => `- ${e}`),
    ].join('\n');

    const meetingDate = new Date(mom.createdAt).toLocaleString('en-GB', { timeZone, weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const system = `You turn a meeting transcript into minutes plus actionable items.
The meeting happened on ${meetingDate} (timezone ${timeZone}). The transcript may be Hinglish (mixed Hindi/English).

ONE recording often covers SEVERAL topics, projects and people. Split it accordingly — produce a separate item per distinct action or decision, and route each one to the project and person it belongs to.

PROJECTS the user has:
${projectLines || '(none)'}

PEOPLE (name = email):
${peopleLines || '(none)'}

For every item work out, ONLY from what was actually said:
- kind: "task" if someone must do something; "note" for decisions, facts or context worth keeping.
- title: short imperative for tasks ("Send the proposal to Morphle"), a clear line for notes.
- detail: one sentence of context from the transcript (who said it / why).
- projectName: the project it belongs to, copied EXACTLY from the list above. Omit if the transcript doesn't make it clear.
- assigneeEmail: the person's email from the list above, if the transcript clearly gives them the work ("Abhi will…", "tum kar lena" addressed to someone). Omit if unclear.
- dueAt: "YYYY-MM-DDTHH:mm" resolved against the meeting date above ("by Friday" → that Friday 17:00, "kal shaam" → next day 17:00, "in two weeks" → +14 days 17:00). Omit if no deadline was mentioned. Default a bare date to 17:00.
- missing: array listing which of "project", "assignee", "due" you could NOT determine — the user will be asked to fill those in.

Never guess a project or person that isn't in the lists. Never invent deadlines. It is correct and expected to return missing entries.

Reply ONLY with JSON:
{"summary":"concise minutes in English: what was discussed and decided, grouped by topic","items":[{"kind":"task|note","title":"...","detail":"...","projectName":"...","assigneeEmail":"...","dueAt":"YYYY-MM-DDTHH:mm","missing":["project","assignee","due"]}]}`;

    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: mom.transcript.slice(0, 100000) }],
      }),
    });
    if (!res.ok) {
      console.error('Groq extraction failed:', await res.text());
      return { success: false, error: `Task extraction failed (${res.status})` };
    }
    const parsed = JSON.parse((await res.json()).choices?.[0]?.message?.content || '{}');

    const knownEmails = new Set([myEmail, ...(contacts as any[]).map(c => c.email).filter(Boolean),
      ...(projects as any[]).flatMap(p => [p.ownerId?.email, ...(p.memberEmails || [])]).filter(Boolean)].map(String));

    mom.tasksConfirmed = false; // re-opening the review
    mom.summary = parsed.summary || '';
    mom.candidates = (parsed.items || []).filter((i: any) => i?.title).slice(0, 25).map((i: any) => {
      const project = matchProject(i.projectName, projects as any[]);
      const assignee = i.assigneeEmail && knownEmails.has(String(i.assigneeEmail).toLowerCase())
        ? String(i.assigneeEmail).toLowerCase() : undefined;
      const due = i.dueAt ? new Date(i.dueAt) : null;
      const dueValid = due && !isNaN(due.getTime()) ? due : null;
      const kind = i.kind === 'note' ? 'note' : 'task';

      // Recompute the gaps ourselves rather than trusting the model's own list
      const missing: string[] = [];
      if (!project) missing.push('project');
      if (kind === 'task' && !assignee) missing.push('assignee');
      if (kind === 'task' && !dueValid) missing.push('due');

      return { kind, title: String(i.title), detail: i.detail ? String(i.detail) : undefined,
        dueAt: dueValid, assigneeEmail: assignee, projectId: project?._id || null, missing };
    });
    await mom.save();
    return { success: true, mom: JSON.parse(JSON.stringify(mom)) };
  } catch (error) {
    console.error('Failed to extract MOM tasks:', error);
    return { success: false, error: 'Task extraction failed' };
  }
}

export async function confirmMomTasks(
  momId: string,
  items: { kind?: 'task' | 'note'; title: string; detail?: string; assigneeEmail?: string; dueAt?: string; projectId?: string }[]
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom) return { success: false, error: 'MOM not found' };
    const ctx = await memberSession(String(mom.projectId));
    if (!ctx) return { success: false, error: 'Not a member' };

    const myEmail = (ctx.session.user.email || '').toLowerCase();
    let tasks = 0, notes = 0;

    for (const item of items) {
      if (!item.title?.trim()) continue;

      if (item.kind === 'note') {
        await Note.create({ userId: session.user.id, title: item.title.trim(), body: item.detail || '' });
        notes++;
        continue;
      }

      // Each task can land in a different project — verify membership for each
      let projectId = mom.projectId;
      if (item.projectId) {
        const allowed = await projectForMember(item.projectId, session.user.id, myEmail);
        if (!allowed) continue; // silently skip projects the user isn't in
        projectId = allowed._id as any;
      }

      let assigneeId;
      if (item.assigneeEmail) {
        const user = await User.findOne({ email: item.assigneeEmail.toLowerCase() }).select('_id');
        assigneeId = user?._id;
      }
      const due = item.dueAt ? new Date(item.dueAt) : undefined;

      await Task.create({
        title: item.title.trim(),
        description: item.detail,
        dueAt: due && !isNaN(due.getTime()) ? due : undefined,
        userId: session.user.id,
        projectId,
        assigneeId,
        assigneeEmail: item.assigneeEmail?.toLowerCase(),
        momId: mom._id,
      });
      tasks++;
    }

    mom.tasksConfirmed = true;
    await mom.save();
    revalidatePath('/tasks');
    revalidatePath('/notes');
    return { success: true, tasks, notes };
  } catch (error) {
    console.error('Failed to confirm MOM items:', error);
    return { success: false, error: 'Failed to create items' };
  }
}

export async function deleteMom(momId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    // Recorder only (owns the file)
    const mom = await Mom.findOneAndDelete({ _id: momId, userId: session.user.id });
    if (!mom) return { success: false, error: 'MOM not found or not yours' };
    // Recordings made before transcripts replaced stored audio may still have a file
    if (mom.audioUrl) await unlink(path.join(process.cwd(), 'public', mom.audioUrl)).catch(() => {});
    return { success: true };
  } catch (error) {
    console.error('Failed to delete MOM:', error);
    return { success: false, error: 'Failed to delete' };
  }
}

export async function updateMom(momId: string, data: { title?: string; summary?: string; transcript?: string }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom) return { success: false, error: 'MOM not found' };
    const ctx = await memberSession(String(mom.projectId));
    if (!ctx) return { success: false, error: 'Not a member' };

    if (data.title !== undefined) mom.title = data.title.trim() || mom.title;
    if (data.summary !== undefined) mom.summary = data.summary;
    if (data.transcript !== undefined) mom.transcript = data.transcript;
    await mom.save();
    return { success: true, mom: JSON.parse(JSON.stringify(mom)) };
  } catch (error) {
    console.error('Failed to update MOM:', error);
    return { success: false, error: 'Failed to save changes' };
  }
}
