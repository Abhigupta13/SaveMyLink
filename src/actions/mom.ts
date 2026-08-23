'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Mom } from "@/lib/models/Mom";
import Task from "@/lib/models/Task";
import { User } from "@/lib/models/User";
import { projectForMember } from "@/lib/projectAccess";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import fs from 'fs';
import path from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

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

export async function uploadMomAudio(formData: FormData) {
  try {
    const projectId = formData.get('projectId') as string;
    const title = (formData.get('title') as string) || `Meeting ${new Date().toLocaleDateString()}`;
    const audio = formData.get('audio') as File | null;
    if (!audio) return { success: false, error: 'No audio' };

    const ctx = await memberSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member' };

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'mom');
    if (!fs.existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    const fileName = `${Date.now()}-${ctx.session.user.id}.webm`;
    await writeFile(path.join(uploadDir, fileName), Buffer.from(await audio.arrayBuffer()));

    const mom = await Mom.create({
      projectId,
      userId: ctx.session.user.id,
      title,
      audioUrl: `/uploads/mom/${fileName}`,
    });
    return { success: true, mom: JSON.parse(JSON.stringify(mom)) };
  } catch (error) {
    console.error('Failed to upload MOM audio:', error);
    return { success: false, error: 'Failed to upload recording' };
  }
}

export async function transcribeMom(momId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom) return { success: false, error: 'MOM not found' };
    const ctx = await memberSession(String(mom.projectId));
    if (!ctx) return { success: false, error: 'Not a member' };
    if (!process.env.GROQ_API_KEY) return { success: false, error: 'GROQ_API_KEY not configured' };

    const filePath = path.join(process.cwd(), 'public', mom.audioUrl);
    const buffer = await fs.promises.readFile(filePath);

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/webm' }), 'meeting.webm');
    // whisper-large-v3 handles Hinglish code-switching well
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

    mom.transcript = text || '';
    await mom.save();
    return { success: true, transcript: mom.transcript };
  } catch (error) {
    console.error('Failed to transcribe MOM:', error);
    return { success: false, error: 'Transcription failed' };
  }
}

export async function extractMomTasks(momId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom?.transcript) return { success: false, error: 'No transcript yet' };
    const ctx = await memberSession(String(mom.projectId));
    if (!ctx) return { success: false, error: 'Not a member' };

    const members = [...new Set([ctx.session.user.email, ...(ctx.project.memberEmails || [])])].filter(Boolean);
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You extract minutes of meeting from transcripts (which may be Hinglish — mixed Hindi/English). Reply ONLY with JSON: {"summary": "concise MOM: key points and decisions, in English", "tasks": [{"title": "actionable task in English", "assigneeEmail": "email if a specific person was clearly given this task, else omit"}]}. Team member emails: ' + (members.join(', ') || 'none listed'),
          },
          { role: 'user', content: mom.transcript.slice(0, 100000) },
        ],
      }),
    });
    if (!res.ok) {
      console.error('Groq extraction failed:', await res.text());
      return { success: false, error: `Task extraction failed (${res.status})` };
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    mom.summary = parsed.summary || '';
    mom.candidates = (parsed.tasks || [])
      .filter((t: any) => t?.title)
      .map((t: any) => ({ title: String(t.title), assigneeEmail: t.assigneeEmail || undefined }));
    await mom.save();
    return { success: true, mom: JSON.parse(JSON.stringify(mom)) };
  } catch (error) {
    console.error('Failed to extract MOM tasks:', error);
    return { success: false, error: 'Task extraction failed' };
  }
}

export async function confirmMomTasks(
  momId: string,
  tasks: { title: string; assigneeEmail?: string; dueAt?: string }[]
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await connectToDatabase();
    const mom = await Mom.findById(momId);
    if (!mom) return { success: false, error: 'MOM not found' };
    const ctx = await memberSession(String(mom.projectId));
    if (!ctx) return { success: false, error: 'Not a member' };

    for (const t of tasks) {
      let assigneeId;
      if (t.assigneeEmail) {
        const assignee = await User.findOne({ email: t.assigneeEmail.toLowerCase() }).select('_id');
        assigneeId = assignee?._id;
      }
      await Task.create({
        title: t.title,
        dueAt: t.dueAt ? new Date(t.dueAt) : undefined,
        userId: session.user.id,
        projectId: mom.projectId,
        assigneeId,
        assigneeEmail: t.assigneeEmail?.toLowerCase(),
        momId: mom._id,
      });
    }

    mom.tasksConfirmed = true;
    await mom.save();
    revalidatePath('/tasks');
    return { success: true, created: tasks.length };
  } catch (error) {
    console.error('Failed to confirm MOM tasks:', error);
    return { success: false, error: 'Failed to create tasks' };
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
    await unlink(path.join(process.cwd(), 'public', mom.audioUrl)).catch(() => {});
    return { success: true };
  } catch (error) {
    console.error('Failed to delete MOM:', error);
    return { success: false, error: 'Failed to delete' };
  }
}
