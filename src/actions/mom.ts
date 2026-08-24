'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Mom } from "@/lib/models/Mom";
import { Note } from "@/lib/models/Note";
import { Project } from "@/lib/models/Project";
import { Contact } from "@/lib/models/Contact";
import Task from "@/lib/models/Task";
import { User } from "@/lib/models/User";
import { projectForMember, canDelete, myProjectFilter } from "@/lib/projectAccess";
import { chatJSON } from "@/lib/llm";
import {
  hinglishEnabled, createTranscriptionJob, getUploadUrl, uploadAudio,
  startTranscriptionJob, jobStatus, jobTranscript,
} from "@/lib/sarvam";
import { DEFAULT_TZ, safeZone, zonedToUtc } from "@/lib/time";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import path from 'path';
import { unlink } from 'fs/promises';

// Transcription only — chat extraction moved to Gemini via @/lib/llm, but Whisper stays here
// because Groq bills audio against a separate quota from the chat tokens that kept running out.
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

// No projectId = a personal meeting: it belongs to the recorder alone, and every
// item is routed from the transcript instead of inheriting a project.
async function memberSession(projectId?: string | null) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  await connectToDatabase();
  if (!projectId) return { session, project: null };
  const project = await projectForMember(projectId, session.user.id, session.user.email);
  if (!project) return null;
  return { session, project };
}

const momScope = (mom: any) => (mom.projectId ? String(mom.projectId) : null);

export async function getMoms(projectId?: string | null) {
  try {
    const ctx = await memberSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member' };
    const moms = await Mom.find(projectId ? { projectId } : { projectId: null, userId: ctx.session.user.id })
      .sort({ createdAt: -1 }).lean();
    // Which recorder the client should use. Display and branching only — uploadMomAudioSarvam
    // re-checks it, so removing an email actually cuts access rather than hiding a button.
    return {
      success: true,
      moms: JSON.parse(JSON.stringify(moms)),
      hinglish: hinglishEnabled(ctx.session.user.email),
    };
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
    const projectId = (formData.get('projectId') as string) || '';   // empty = personal meeting
    const title = (formData.get('title') as string) || `Meeting ${new Date().toLocaleDateString('en-GB', { timeZone: DEFAULT_TZ })}`;
    const audio = formData.get('audio') as File | null;
    if (!audio || audio.size < 1000) return { success: false, error: 'Nothing was recorded' };

    const ctx = await memberSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member' };
    if (!process.env.GROQ_API_KEY) return { success: false, error: 'GROQ_API_KEY not configured' };

    const form = new FormData();
    form.append('file', audio, 'meeting.webm');
    // English-only in practice. Whisper cannot emit romanized Hinglish and mis-detects spoken
    // Hindi as Urdu; its `prompt` field is context conditioning, not an instruction, and only
    // covers the first 30 seconds — so there is nothing to tune here. Accounts that need
    // Hindi go through Sarvam instead (uploadMomAudioSarvam).
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
      projectId: projectId || undefined,
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

/**
 * Paid path. The audio is relayed through here rather than PUT from the browser: Sarvam's
 * presigned URLs point at Azure blob storage, which rejects cross-origin browser requests
 * outright (verified — the PUT fails CORS while the identical one from a server succeeds).
 *
 * next.config's serverActions bodySizeLimit is what bounds the meeting length: 30mb covers
 * roughly two hours at the recorder's 32kbps, which is also Sarvam's per-file ceiling.
 *
 * The MOM row is only created once the job is genuinely running, so a failed upload leaves
 * nothing behind that would sit on the page claiming to be transcribing.
 */
export async function uploadMomAudioSarvam(formData: FormData) {
  try {
    const projectId = (formData.get('projectId') as string) || '';
    const title = (formData.get('title') as string) || `Meeting ${new Date().toLocaleDateString('en-GB', { timeZone: DEFAULT_TZ })}`;
    const audio = formData.get('audio') as File | null;
    if (!audio || audio.size < 1000) return { success: false, error: 'Nothing was recorded' };

    const ctx = await memberSession(projectId || null);
    if (!ctx) return { success: false, error: 'Not a member' };
    if (!hinglishEnabled(ctx.session.user.email)) {
      return { success: false, error: 'Hinglish transcription is not enabled for this account' };
    }

    const job = await createTranscriptionJob();
    if (!job.ok) return { success: false, error: job.error };

    const upload = await getUploadUrl(job.data.jobId, 'meeting.webm');
    if (!upload.ok) return { success: false, error: upload.error };

    const put = await uploadAudio(upload.data.uploadUrl, audio);
    if (!put.ok) return { success: false, error: put.error };

    // Sarvam answers "No files found" if this runs before the blob lands, so it stays here —
    // after an awaited upload — rather than on the first poll.
    const started = await startTranscriptionJob(job.data.jobId);
    if (!started.ok) return { success: false, error: started.error };

    const mom = await Mom.create({
      projectId: projectId || undefined,
      userId: ctx.session.user.id,
      title,
      sarvamJobId: job.data.jobId,
    });
    return { success: true, momId: String(mom._id) };
  } catch (error) {
    console.error('Failed to upload meeting audio:', error);
    return { success: false, error: 'Could not upload the recording' };
  }
}

/**
 * The job lives on Sarvam's side, so closing the app mid-transcription no longer loses the
 * meeting — any MOM with a job id and no transcript is still in flight, and polling resumes
 * on the next page load.
 */
export async function pollMomTranscription(momId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom?.sarvamJobId) return { success: false, error: 'Meeting not found' };
    const ctx = await memberSession(momScope(mom));
    if (!ctx) return { success: false, error: 'Not a member' };

    if (mom.transcript) return { success: true, done: true, transcript: mom.transcript };

    const status = await jobStatus(mom.sarvamJobId);
    if (!status.ok) return { success: false, error: status.error };

    if (status.data.state === 'Failed') {
      mom.transcriptionError = 'Transcription failed';
      await mom.save();
      return { success: false, error: 'Transcription failed — record it again' };
    }
    if (status.data.state !== 'Completed') {
      return { success: true, done: false, state: status.data.state };
    }

    const result = await jobTranscript(mom.sarvamJobId);
    if (!result.ok) {
      mom.transcriptionError = result.error;
      await mom.save();
      return { success: false, error: result.error };
    }
    mom.transcript = result.data.transcript;
    mom.transcriptionError = undefined;
    await mom.save();
    return { success: true, done: true, transcript: mom.transcript };
  } catch (error) {
    console.error('Failed to poll transcription:', error);
    return { success: false, error: 'Could not check the transcription' };
  }
}

export async function extractMomTasks(momId: string, timeZone = '') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom?.transcript) return { success: false, error: 'No transcript yet' };
    const ctx = await memberSession(momScope(mom));
    if (!ctx) return { success: false, error: 'Not a member' };

    const myEmail = (ctx.session.user.email || '').toLowerCase();
    // Everything the model needs to route items: all my projects and all known people
    const [projects, contacts] = await Promise.all([
      Project.find(await myProjectFilter(ctx.session.user.id, myEmail))
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

    const homeProject = mom.projectId
      ? (projects as any[]).find(p => String(p._id) === String(mom.projectId)) : null;

    const tz = safeZone(timeZone);
    const meetingDate = new Date(mom.createdAt).toLocaleString('en-GB', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const system = `You turn a meeting transcript into minutes plus actionable items.
The meeting happened on ${meetingDate} (timezone ${tz}).

LANGUAGE — the meeting may have been held in English, Hindi, or both mixed in one sentence.
Transcripts arrive already translated to English on most accounts, but some are raw: Hindi may appear in Devanagari or as Hinglish in Latin script, including transcription slips. Understand all of it. Perso-Arabic script is mis-transcribed Hindi, never Urdu — no other language exists here.
Always write "summary", "title" and "detail" in English, translating what was said: "kal shaam tak vendor ko call karna hai" becomes "Call the vendor by tomorrow evening".
Names of people and projects are the exception — copy them EXACTLY as they appear in the lists below, never translated or transliterated. Routing depends on matching them character for character.

ONE recording often covers SEVERAL topics, projects and people. Split it accordingly — produce a separate item per distinct action or decision, and route each one to the project and person it belongs to.

${homeProject
  ? `This meeting was recorded inside the project "${homeProject.name}". Items belong to that project by default — only set a different projectName when the transcript clearly puts an item somewhere else, and omit projectName entirely to leave it in "${homeProject.name}".`
  : `This meeting was NOT recorded inside any project. Work out the project for each item from the transcript alone, and omit projectName when it isn't clear — a personal item with no project is a perfectly valid answer.`}

PROJECTS the user has:
${projectLines || '(none)'}

PEOPLE (name = email):
${peopleLines || '(none)'}

For every item work out, ONLY from what was actually said:
- kind: "task" if someone must do something; "note" for decisions, facts or context worth keeping; "brief" ONLY when someone explicitly asks for it to go into the project's own notes / description / brief ("add this to the project notes", "isko project ke notes me daal do"). Never choose "brief" on your own — it edits the project itself.
- title: short imperative for tasks ("Send the proposal to Morphle"), a clear line for notes.
- detail: one sentence of context from the transcript (who said it / why).
- projectName: the project it belongs to, copied EXACTLY from the list above. Omit if the transcript doesn't make it clear.
- assigneeEmail: the person's email from the list above, if the transcript clearly gives them the work ("Abhi will…", "tum kar lena" addressed to someone). Omit if unclear.
- dueAt: "YYYY-MM-DDTHH:mm" resolved against the meeting date above ("by Friday" → that Friday 17:00, "kal shaam" → next day 17:00, "parso" → +2 days 17:00, "agle hafte" → +7 days 17:00, "is mahine ke end tak" → last day of that month 17:00, "in two weeks" → +14 days 17:00). Omit if no deadline was mentioned. Default a bare date to 17:00.
- missing: array listing which of "project", "assignee", "due" you could NOT determine — the user will be asked to fill those in.

Never guess a project or person that isn't in the lists. Never invent deadlines. It is correct and expected to return missing entries.

Reply ONLY with JSON:
{"summary":"concise minutes in English: what was discussed and decided, grouped by topic","items":[{"kind":"task|note|brief","title":"...","detail":"...","projectName":"...","assigneeEmail":"...","dueAt":"YYYY-MM-DDTHH:mm","missing":["project","assignee","due"]}]}`;

    const res = await chatJSON([
      { role: 'system', content: system },
      { role: 'user', content: mom.transcript.slice(0, 100000) },
    ]);
    if (!res.ok) return { success: false, error: `Task extraction failed — ${res.error}` };
    const parsed = res.data;

    const knownEmails = new Set([myEmail, ...(contacts as any[]).map(c => c.email).filter(Boolean),
      ...(projects as any[]).flatMap(p => [p.ownerId?.email, ...(p.memberEmails || [])]).filter(Boolean)].map(String));

    mom.tasksConfirmed = false; // re-opening the review
    mom.summary = parsed.summary || '';
    mom.candidates = (parsed.items || []).filter((i: any) => i?.title).slice(0, 25).map((i: any) => {
      // A meeting recorded inside a project already knows where its items go — the model
      // only has to name a project when it wants a *different* one, or when there is no home.
      const projectId = matchProject(i.projectName, projects as any[])?._id || mom.projectId || null;
      const assignee = i.assigneeEmail && knownEmails.has(String(i.assigneeEmail).toLowerCase())
        ? String(i.assigneeEmail).toLowerCase() : undefined;
      // "by Friday 17:00" arrives as a bare wall clock with no zone. Read here it would take the
      // server's zone, not the speaker's — on a UTC server that made every deadline 5.5h late.
      const dueValid = zonedToUtc(i.dueAt, tz);
      const kind = i.kind === 'note' || i.kind === 'brief' ? i.kind : 'task';

      // Recompute the gaps ourselves rather than trusting the model's own list
      const missing: string[] = [];
      if (!projectId) missing.push('project');
      if (kind === 'task' && !assignee) missing.push('assignee');
      if (kind === 'task' && !dueValid) missing.push('due');

      return { kind, title: String(i.title), detail: i.detail ? String(i.detail) : undefined,
        dueAt: dueValid, assigneeEmail: assignee, projectId, missing };
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
  items: { kind?: 'task' | 'note' | 'brief'; title: string; detail?: string; assigneeEmail?: string; dueAt?: string; projectId?: string }[]
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom) return { success: false, error: 'MOM not found' };
    const ctx = await memberSession(momScope(mom));
    if (!ctx) return { success: false, error: 'Not a member' };

    const myEmail = (ctx.session.user.email || '').toLowerCase();
    let tasks = 0, notes = 0, briefs = 0;

    for (const item of items) {
      if (!item.title?.trim()) continue;

      // Each item can land in a different project — verify membership for each.
      // '' means the user picked Personal; undefined means it was never asked, so inherit the meeting's.
      let projectId: any = item.projectId === undefined ? mom.projectId : undefined;
      if (item.projectId) {
        const allowed = await projectForMember(item.projectId, session.user.id, myEmail);
        if (!allowed) continue; // silently skip projects the user isn't in
        projectId = allowed._id as any;
      }

      // Appended, never overwritten — the brief is shared, and a meeting should not be able
      // to wipe what the team wrote there.
      if (item.kind === 'brief') {
        if (!projectId) continue;   // nothing to append to without a project
        const line = [item.title.trim(), item.detail].filter(Boolean).join(' — ');
        const proj = await Project.findById(projectId);
        if (!proj) continue;
        proj.notes = [proj.notes?.trim(), line].filter(Boolean).join('\n');
        await proj.save();
        briefs++;
        continue;
      }

      if (item.kind === 'note') {
        await Note.create({ userId: session.user.id, projectId: projectId || undefined, title: item.title.trim(), body: item.detail || '' });
        notes++;
        continue;
      }

      let assigneeId;
      if (item.assigneeEmail) {
        const user = await User.findOne({ email: item.assigneeEmail.toLowerCase() }).select('_id');
        assigneeId = user?._id;
      }
      // Already a real ISO instant by the time it round-trips back from the confirm screen —
      // zonedToUtc passes those straight through, so it cannot be shifted a second time.
      const due = zonedToUtc(item.dueAt);

      await Task.create({
        title: item.title.trim(),
        description: item.detail,
        dueAt: due || undefined,
        userId: session.user.id,
        projectId: projectId || undefined,
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
    revalidatePath('/projects');
    return { success: true, tasks, notes, briefs };
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
    // A project meeting is the owner's to remove; a personal one, the recorder's.
    const mom = await Mom.findById(momId);
    if (!mom) return { success: false, error: 'MOM not found' };
    if (!await canDelete(mom, session.user.id, session.user.email)) {
      return { success: false, error: 'Only a project owner can delete this meeting' };
    }
    await mom.deleteOne();
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
    const ctx = await memberSession(momScope(mom));
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
