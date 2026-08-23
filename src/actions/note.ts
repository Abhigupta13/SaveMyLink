'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Note } from "@/lib/models/Note";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

async function uid() {
  const session = await getServerSession(authOptions);
  return session?.user?.id || null;
}

export async function getNotes() {
  try {
    await connectToDatabase();
    const userId = await uid();
    if (!userId) return { success: false, error: 'Unauthorized' };
    const notes = await Note.find({ userId }).sort({ pinned: -1, updatedAt: -1 }).limit(500).lean();
    return { success: true, notes: JSON.parse(JSON.stringify(notes)) };
  } catch (error) {
    console.error('Failed to get notes:', error);
    return { success: false, error: 'Failed to fetch notes' };
  }
}

export async function createNote(data: { title?: string; body: string }) {
  try {
    await connectToDatabase();
    const userId = await uid();
    if (!userId) return { success: false, error: 'Unauthorized' };
    if (!data.body?.trim() && !data.title?.trim()) return { success: false, error: 'Note is empty' };
    const note = await Note.create({ userId, title: data.title?.trim(), body: data.body?.trim() || '' });
    revalidatePath('/notes');
    return { success: true, note: JSON.parse(JSON.stringify(note)) };
  } catch (error) {
    console.error('Failed to create note:', error);
    return { success: false, error: 'Failed to save note' };
  }
}

export async function updateNote(id: string, data: { title?: string; body?: string; pinned?: boolean }) {
  try {
    await connectToDatabase();
    const userId = await uid();
    if (!userId) return { success: false, error: 'Unauthorized' };
    const note = await Note.findOneAndUpdate({ _id: id, userId }, data, { new: true });
    if (!note) return { success: false, error: 'Note not found' };
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
    const userId = await uid();
    if (!userId) return { success: false, error: 'Unauthorized' };
    await Note.findOneAndDelete({ _id: id, userId });
    revalidatePath('/notes');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete note:', error);
    return { success: false, error: 'Failed to delete note' };
  }
}
