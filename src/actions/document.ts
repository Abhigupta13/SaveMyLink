'use server'

import connectToDatabase from '@/lib/mongodb';
import { Document } from '@/lib/models/Document';
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import { extractText } from '@/lib/docText';
import { projectForWriter, mineOrMyProjects } from '@/lib/projectAccess';
import { saveUpload, deleteUpload, readBytes } from '@/lib/storage';

// Not exported: a 'use server' module may only export async functions, and a stray const
// silently strips every export in the file. Mirrors the schema default in Document.ts.
const DEFAULT_FOLDER = 'Personal';

/**
 * Documents uploaded before text extraction existed have no text, so Jarvis cannot read them.
 * Backfill a few on each visit to the locker — the page is already awaiting a spinner here,
 * and it self-heals in a couple of visits rather than needing a migration.
 * ponytail: 4 per load; run a script over the collection if a locker is ever big enough to care.
 */
async function backfillText(userId: string) {
  const stale = await Document.find({ user: userId, type: 'file', text: { $exists: false } }).limit(4);
  for (const doc of stale) {
    try {
      // doc.key for anything stored since the move; the legacy path for older public/ files
      const buf = doc.key ? await readBytes(doc.key) : await readFile(path.join(process.cwd(), 'public', doc.url));
      doc.text = buf ? await extractText(buf, doc.mimeType, doc.name) : '';
    } catch {
      doc.text = '';   // file is gone or unreadable — mark it tried so we stop retrying it
    }
    await doc.save();
  }
}

export async function getDocuments() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { docs: [], folders: [] };
  const userId = (session.user as any).id;

  try {
    await connectToDatabase();
    await backfillText(userId).catch(e => console.error('Doc backfill failed:', e));
    // `text` can be 12k a document — the locker page never shows it, so leave it on the server.
    // The folder list is derived from these client-side: a distinct() would miss documents
    // saved before folders existed, which have no folder field at all rather than 'Personal'.
    // Mine, plus anything filed under a project I am in — a shared contract belongs to
    // everyone working on it, not only whoever happened to upload it.
    const scope = await mineOrMyProjects(userId, session.user.email, 'user');
    const docs = await Document.find(scope).select('-text')
      .populate('projectId', 'name').sort({ createdAt: -1 }).lean();
    return { docs: JSON.parse(JSON.stringify(docs)) };
  } catch (error: any) {
    console.error('Error fetching documents:', error);
    return { docs: [], error: error.message };
  }
}

/** Refile a document without re-uploading it. */
export async function moveDocument(id: string, folder: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  try {
    await connectToDatabase();
    const res = await Document.findOneAndUpdate(
      { _id: id, user: (session.user as any).id },
      { folder: folder.trim() || DEFAULT_FOLDER },
      { new: true },
    );
    if (!res) return { error: 'Document not found' };
    revalidatePath('/d-locker');
    return { success: true };
  } catch (error: any) {
    console.error('Error moving document:', error);
    return { error: error.message };
  }
}

/**
 * Share a document with a project, or pull it back to my own locker with ''. Only the
 * uploader may do this: it changes who can see the file, so it is not a member's call.
 */
export async function fileDocumentUnderProject(id: string, projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;
  try {
    await connectToDatabase();
    if (projectId && !(await projectForWriter(projectId, userId, session.user.email)))
      return { error: 'Not a member of that project' };
    const res = await Document.findOneAndUpdate(
      { _id: id, user: userId },
      { projectId: projectId || null },
      { new: true },
    );
    if (!res) return { error: 'Document not found, or not yours to share' };
    revalidatePath('/d-locker');
    return { success: true };
  } catch (error: any) {
    console.error('Error filing document:', error);
    return { error: error.message };
  }
}

export async function addDocument(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  const name = formData.get('name') as string;
  const type = formData.get('type') as 'file' | 'link';
  const externalLink = formData.get('externalLink') as string;
  const file = formData.get('file') as File | null;
  const folder = ((formData.get('folder') as string) || '').trim() || DEFAULT_FOLDER;
  const projectId = ((formData.get('projectId') as string) || '').trim();

  try {
    await connectToDatabase();
    if (projectId && !(await projectForWriter(projectId, userId, session.user.email)))
      return { error: 'Not a member of that project' };

    let url = '';
    let key = '';
    let mimeType = '';
    let size = 0;
    let text = '';

    if (type === 'file' && file) {
      // Shared with note attachments: S3 when configured, local disk on a dev machine, and
      // read back through /api/files so a passport scan needs a session and not just the URL
      const saved = await saveUpload(userId, file);
      url = saved.url;
      key = saved.key;
      mimeType = saved.mimeType;
      size = saved.size;
      // Once, here, rather than on every Jarvis question
      text = await extractText(saved.buffer, mimeType, file.name);
    } else if (type === 'link') {
      url = externalLink;
      mimeType = 'text/html';
    }

    const doc = await Document.create({
      user: userId,
      projectId: projectId || undefined,
      name,
      folder,
      type,
      url,
      key,
      mimeType,
      size,
      text
    });

    revalidatePath('/d-locker');
    return { success: true, doc: JSON.parse(JSON.stringify(doc)) };
  } catch (error: any) {
    console.error('Error adding document:', error);
    return { error: error.message };
  }
}

export async function deleteDocument(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  try {
    await connectToDatabase();
    const doc = await Document.findOne({ _id: id, user: userId });
    if (!doc) return { error: 'Document not found' };

    if (doc.type === 'file') {
      if (doc.key) await deleteUpload(doc.key);
      else {
        // Legacy public/uploads file from before the move to shared storage
        const filePath = path.join(process.cwd(), 'public', doc.url);
        if (fs.existsSync(filePath)) await fs.promises.unlink(filePath).catch(() => {});
      }
    }

    await Document.deleteOne({ _id: id });
    revalidatePath('/d-locker');
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return { error: error.message };
  }
}
