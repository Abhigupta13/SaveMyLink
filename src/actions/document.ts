'use server'

import connectToDatabase from '@/lib/mongodb';
import { Document } from '@/lib/models/Document';
import { Project } from "@/lib/models/Project";
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import { extractText } from '@/lib/docText';
import { projectForWriter, mineOrMyProjects } from '@/lib/projectAccess';
import { withinProject } from '@/lib/scope';
import { privacyOnWrite, privateFilter } from '@/lib/privacy';
import { hasSafe } from '@/lib/safeCookie';
import { saveUpload, deleteUpload, readBytes } from '@/lib/storage';
import { grantProjectReaders } from '@/lib/driveGrants';

// Not exported: a 'use server' module may only export async functions, and a stray const
// silently strips every export in the file. Mirrors the schema default in Document.ts.
const DEFAULT_FOLDER = 'Personal';

async function readAndExtractText(doc: { key?: string; user: unknown; url: string; mimeType?: string; name?: string }) {
  try {
    const buf = doc.key
      ? await readBytes(doc.key, String(doc.user))
      : await readFile(path.join(process.cwd(), 'public', doc.url));
    return buf ? await extractText(buf, doc.mimeType, doc.name) : '';
  } catch {
    return '';
  }
}

/** Extract and persist text for one file row — used by locker backfill and Jarvis hydration. */
export async function fillDocumentText(doc: {
  _id: unknown;
  user: unknown;
  key?: string;
  url: string;
  mimeType?: string;
  name?: string;
  type?: string;
  text?: string | null;
}): Promise<string> {
  if (doc.type !== 'file') return doc.text ?? '';
  if (doc.text && doc.text.length > 0) return doc.text;
  const text = await readAndExtractText(doc);
  await Document.updateOne({ _id: doc._id }, { text });
  return text;
}

/**
 * Documents uploaded before text extraction existed have no text, so Jarvis cannot read them.
 * Backfill a few on each visit to the locker — the page is already awaiting a spinner here,
 * and it self-heals in a couple of visits rather than needing a migration.
 */
async function backfillText(userId: string, email: string, unlocked: boolean) {
  const scope = await mineOrMyProjects(userId, email, 'user', unlocked);
  const stale = await Document.find({
    ...scope,
    type: 'file',
    $or: [
      { text: { $exists: false } },
      {
        text: '',
        $or: [
          { mimeType: 'application/pdf' },
          { mimeType: { $regex: /^text\// } },
        ],
      },
    ],
  }).limit(4);
  for (const doc of stale) {
    doc.text = await readAndExtractText(doc);
    await doc.save();
  }
}

/**
 * My documents, or — given a projectId — only that project's. The id is ANDed onto my read
 * scope, never substituted for it, so it can only narrow what I could already read.
 */
/** Group file list for workspace bundles — no locker backfill (text not shown on this page). */
export async function loadProjectDocuments(userId: string, email: string, projectId: string) {
  const unlocked = await hasSafe(userId);
  const scope = await mineOrMyProjects(userId, email, 'user', unlocked);
  const docs = await Document.find(withinProject(scope, projectId)).select('-text')
    .populate('projectId', 'name').sort({ createdAt: -1 }).lean();
  return JSON.parse(JSON.stringify(docs));
}

export async function getDocuments(projectId?: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { docs: [], folders: [] };
  const userId = (session.user as any).id;

  try {
    await connectToDatabase();
    const unlocked = await hasSafe(userId);
    await backfillText(userId, session.user.email || '', unlocked).catch(e => console.error('Doc backfill failed:', e));
    const scope = projectId
      ? await mineOrMyProjects(userId, session.user.email, 'user', unlocked)
      : { user: userId, projectId: null, ...privateFilter(unlocked) };
    const docs = projectId
      ? await loadProjectDocuments(userId, session.user.email, projectId)
      : JSON.parse(JSON.stringify(
          await Document.find(withinProject(scope, projectId)).select('-text')
            .populate('projectId', 'name').sort({ createdAt: -1 }).lean(),
        ));
    return { docs };
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
    // Sharing it into a group is exactly the move that makes a padlock a lie, so the flag goes
    // with it. privacyDropped is how the locker gets to tell the user that just happened.
    const doc = await Document.findOne({ _id: id, user: userId });
    if (!doc) return { error: 'Document not found, or not yours to share' };
    const wasPrivate = !!doc.isPrivate;
    const wasIn = String(doc.projectId || '');
    doc.projectId = projectId || null;
    doc.isPrivate = privacyOnWrite(wasPrivate, doc.projectId);
    await doc.save();
    // Only on the way IN, and only when it actually moved: pulling a file back to the locker has
    // nobody new to offer it to, and re-filing it where it already sat would re-run the grants.
    if (projectId && projectId !== wasIn) {
      grantProjectReaders({ projectId, uploaderId: userId, uploaderEmail: session.user.email, keys: [doc.key] });
    }
    revalidatePath('/d-locker');
    return { success: true, privacyDropped: wasPrivate && !doc.isPrivate };
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
  // A checkbox on the upload sheet. Absent, it falls back to the vault the upload was started in,
  // so a file added with the safe open is not written straight into a list the user cannot see.
  const wantPrivate = formData.has('isPrivate')
    ? formData.get('isPrivate') === 'true'
    : await hasSafe(userId);

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
      // Into the uploader's own Google Drive, under ALL-YOU-NEED/<group name> when it is filed
      // under one and ALL-YOU-NEED/digilocker when it is not — read back through /api/files, so a
      // passport scan still needs a session and not just the URL.
      const projectName = projectId
        ? (await Project.findById(projectId).select('name').lean<{ name?: string } | null>())?.name
        : null;
      const saved = await saveUpload(userId, file, { source: 'document', projectName });
      // "No Drive connected" is the common failure now, not an exception — hand the reason back so
      // the locker can offer a Connect button instead of an opaque red toast.
      if (!saved.ok) return { error: saved.message, needsDrive: saved.reason === 'no_drive' || saved.reason === 'drive_revoked' };
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

    const isPrivate = privacyOnWrite(wantPrivate, projectId);
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
      text,
      isPrivate
    });

    // Convenience only, and off the response path — the upload returns now, Google hears about it
    // afterwards. A link has no bytes and a personal upload has nobody to share with; both are
    // no-ops inside the helper rather than a branch here.
    grantProjectReaders({ projectId, uploaderId: userId, uploaderEmail: session.user.email, keys: [key] });

    revalidatePath('/d-locker');
    return {
      success: true,
      doc: JSON.parse(JSON.stringify(doc)),
      privacyDropped: wantPrivate === true && !isPrivate,
    };
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
