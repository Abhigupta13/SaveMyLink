'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Note } from "@/lib/models/Note";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { projectForMember, mineOrMyProjects, canDelete } from "@/lib/projectAccess";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { extractText } from "@/lib/docText";

async function me() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return { userId: session.user.id, email: (session.user.email || '').toLowerCase() };
}

/**
 * A note is mine if I wrote it, or if it sits in a project I am a member of — the same
 * boundary tasks and meetings already use, so a note taken in a shared meeting is shared.
 */
async function noteIWrite(id: string, userId: string, email: string) {
  const note = await Note.findById(id);
  if (!note) return null;
  if (String(note.userId) === String(userId)) return note;
  if (!note.projectId) return null;
  return (await projectForMember(String(note.projectId), userId, email)) ? note : null;
}

export async function getNotes() {
  try {
    await connectToDatabase();
    const who = await me();
    if (!who) return { success: false, error: 'Unauthorized' };
    // Attachment text can be 12k a file and the list never renders it — leave it on the server
    const notes = await Note.find(await mineOrMyProjects(who.userId, who.email)).select('-attachments.text')
      .populate('projectId', 'name')   // meeting notes carry their project — shown as a chip on the card
      .populate('userId', 'email name')  // a project note may not be mine, so say whose it is
      .sort({ pinned: -1, updatedAt: -1 }).limit(500).lean();
    return { success: true, notes: JSON.parse(JSON.stringify(notes)) };
  } catch (error) {
    console.error('Failed to get notes:', error);
    return { success: false, error: 'Failed to fetch notes' };
  }
}

export async function createNote(data: { title?: string; body: string; projectId?: string }) {
  try {
    await connectToDatabase();
    const who = await me();
    if (!who) return { success: false, error: 'Unauthorized' };
    if (!data.body?.trim() && !data.title?.trim()) return { success: false, error: 'Note is empty' };
    if (data.projectId && !(await projectForMember(data.projectId, who.userId, who.email)))
      return { success: false, error: 'Not a member of that project' };
    const note = await Note.create({
      userId: who.userId, projectId: data.projectId || undefined,
      title: data.title?.trim(), body: data.body?.trim() || '',
    });
    revalidatePath('/notes');
    return { success: true, note: JSON.parse(JSON.stringify(note)) };
  } catch (error) {
    console.error('Failed to create note:', error);
    return { success: false, error: 'Failed to save note' };
  }
}

export async function updateNote(id: string, data: { title?: string; body?: string; pinned?: boolean; projectId?: string }) {
  try {
    await connectToDatabase();
    const who = await me();
    if (!who) return { success: false, error: 'Unauthorized' };
    const note = await noteIWrite(id, who.userId, who.email);
    if (!note) return { success: false, error: 'Note not found' };

    // Moving a note into a project shares it with that project's members, so verify first.
    // '' is a deliberate choice of Personal; undefined leaves it where it is.
    if (data.projectId !== undefined) {
      if (data.projectId && !(await projectForMember(data.projectId, who.userId, who.email)))
        return { success: false, error: 'Not a member of that project' };
      note.projectId = (data.projectId || undefined) as any;
    }
    if (data.title !== undefined) note.title = data.title;
    if (data.body !== undefined) note.body = data.body;
    if (data.pinned !== undefined) note.pinned = data.pinned;
    await note.save();
    revalidatePath('/notes');
    return { success: true, note: JSON.parse(JSON.stringify(note)) };
  } catch (error) {
    console.error('Failed to update note:', error);
    return { success: false, error: 'Failed to update note' };
  }
}

export async function deleteNote(id: string) {
  try {
    await connectToDatabase();
    const who = await me();
    if (!who) return { success: false, error: 'Unauthorized' };
    const note = await noteIWrite(id, who.userId, who.email);
    if (!note) return { success: false, error: 'Note not found' };
    // Editable by every member, removable only by a project owner
    if (!await canDelete(note, who.userId, who.email)) {
      return { success: false, error: 'Only a project owner can delete this note' };
    }
    await note.deleteOne();
    // Attachments belong to the note, so they go with it rather than lingering as paid-for bytes
    for (const a of note.attachments || []) await deleteUpload(a.key);
    revalidatePath('/notes');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete note:', error);
    return { success: false, error: 'Failed to delete note' };
  }
}

/**
 * Attach a file to a note. The note may not exist yet — a brand new note is created here so
 * you can attach before typing anything, which is how people actually use this.
 */
export async function attachToNote(noteId: string | null, formData: FormData) {
  try {
    await connectToDatabase();
    const who = await me();
    if (!who) return { success: false, error: 'Unauthorized' };
    const userId = who.userId;
    const file = formData.get('file') as File | null;
    if (!file || !file.size) return { success: false, error: 'No file' };
    // Vercel caps a serverless request body at ~4.5MB and next.config's bodySizeLimit cannot
    // raise it, so guard under that: a readable message beats an opaque platform 413.
    // Photos are downscaled in the browser before they get here and land well under it.
    if (file.size > 4 * 1024 * 1024) return { success: false, error: 'File is too large (max 4MB)' };

    const note = noteId
      ? await noteIWrite(noteId, userId, who.email)
      : await Note.create({ userId, body: '' });
    if (!note) return { success: false, error: 'Note not found' };

    const { key, url, mimeType, size, buffer } = await saveUpload(userId, file);
    // Same extraction the Digi Locker uses: '' for images and video, real text for PDFs
    const text = await extractText(buffer, mimeType, file.name);
    note.attachments.push({ name: file.name, key, url, mimeType, size, text });
    await note.save();

    revalidatePath('/notes');
    return { success: true, noteId: String(note._id), attachment: { name: file.name, key, url, mimeType, size } };
  } catch (error) {
    console.error('Failed to attach file:', error);
    return { success: false, error: 'Failed to attach file' };
  }
}

export async function removeAttachment(noteId: string, key: string) {
  try {
    await connectToDatabase();
    const who = await me();
    if (!who) return { success: false, error: 'Unauthorized' };
    const note = await noteIWrite(noteId, who.userId, who.email);
    if (!note) return { success: false, error: 'Note not found' };
    note.attachments = note.attachments.filter(a => a.key !== key);
    await note.save();
    await deleteUpload(key);
    revalidatePath('/notes');
    return { success: true };
  } catch (error) {
    console.error('Failed to remove attachment:', error);
    return { success: false, error: 'Failed to remove attachment' };
  }
}
