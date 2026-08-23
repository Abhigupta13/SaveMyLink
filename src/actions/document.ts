'use server'

import connectToDatabase from '@/lib/mongodb';
import { Document } from '@/lib/models/Document';
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import fs from 'fs';
import path from 'path';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { extractText } from '@/lib/docText';

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
      const buf = await readFile(path.join(process.cwd(), 'public', doc.url));
      doc.text = await extractText(buf, doc.mimeType, doc.name);
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
    const docs = await Document.find({ user: userId }).select('-text').sort({ createdAt: -1 }).lean();
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

export async function addDocument(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  const name = formData.get('name') as string;
  const type = formData.get('type') as 'file' | 'link';
  const externalLink = formData.get('externalLink') as string;
  const file = formData.get('file') as File | null;
  const folder = ((formData.get('folder') as string) || '').trim() || DEFAULT_FOLDER;

  try {
    await connectToDatabase();

    let url = '';
    let mimeType = '';
    let size = 0;
    let text = '';

    if (type === 'file' && file) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      // Secure file name
      const fileExt = path.extname(file.name);
      const safeName = file.name.substring(0, file.name.lastIndexOf('.')).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const fileName = `${Date.now()}-${safeName}${fileExt}`;
      const filePath = path.join(uploadDir, fileName);
      await writeFile(filePath, buffer);

      url = `/uploads/${fileName}`;
      mimeType = file.type;
      size = file.size;
      // Once, here, rather than on every Jarvis question
      text = await extractText(buffer, mimeType, file.name);
    } else if (type === 'link') {
      url = externalLink;
      mimeType = 'text/html';
    }

    const doc = await Document.create({
      user: userId,
      name,
      folder,
      type,
      url,
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
      const filePath = path.join(process.cwd(), 'public', doc.url);
      if (fs.existsSync(filePath)) {
        await unlink(filePath);
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
