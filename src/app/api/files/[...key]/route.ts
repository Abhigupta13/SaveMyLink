import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ownsKey, readUrl, readBytes } from '@/lib/storage';
import connectToDatabase from '@/lib/mongodb';
import { Document } from '@/lib/models/Document';
import { Note } from '@/lib/models/Note';
import { Suggestion } from '@/lib/models/Suggestion';
import { myProjectIds } from '@/lib/projectAccess';
import { isAdmin } from '@/lib/isAdmin';

/**
 * A file shared through a project is not stored under my id, so the key prefix alone would
 * 404 it for every member but the uploader. Only reached when the cheap check fails.
 */
async function sharedWithMe(key: string, userId: string, email?: string | null) {
  await connectToDatabase();
  const ids = await myProjectIds(userId, email);
  if (!ids.length) return false;
  return !!(await Document.exists({ key, projectId: { $in: ids } })
         || await Note.exists({ 'attachments.key': key, projectId: { $in: ids } }));
}

/**
 * A "Help us improve" screenshot is stored under the reporter's id, so the inbox would 404 every
 * image. Narrow on purpose: an admin gets those keys and nothing else in anyone's account.
 */
async function adminShot(key: string, email?: string | null) {
  if (!isAdmin(email)) return false;
  await connectToDatabase();
  return !!(await Suggestion.exists({ 'shot.key': key }));
}

/**
 * Every uploaded file is read through here, so a passport scan needs a session rather than
 * just the URL. Keys are prefixed with the owner's id, which is what makes the common case
 * checkable without a database round-trip.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const key = (await params).key.map(decodeURIComponent).join('/');
  if (!ownsKey(session.user.id, key)
      && !(await sharedWithMe(key, session.user.id, session.user.email))
      && !(await adminShot(key, session.user.email)))
    return new NextResponse('Not found', { status: 404 });

  // S3: hand back a short-lived signed URL so the bytes never proxy through the server
  const signed = await readUrl(key);
  if (signed) return NextResponse.redirect(signed);

  const bytes = await readBytes(key);
  if (!bytes) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=300' },
  });
}
