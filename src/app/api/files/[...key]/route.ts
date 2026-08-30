import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ownsKey, ownerOfKey, readStream } from '@/lib/storage';
import { safeContentType, safeFilename } from '@/lib/fileType';
import connectToDatabase from '@/lib/mongodb';
import { Document } from '@/lib/models/Document';
import { Note } from '@/lib/models/Note';
import { Message } from '@/lib/models/Message';
import { Suggestion } from '@/lib/models/Suggestion';
import { myProjectIds } from '@/lib/projectAccess';
import { isAdmin } from '@/lib/isAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';   // never prerender an authorised byte stream
export const maxDuration = 30;

/**
 * The only door to a file, and now also the only thing that decides **whose Google Drive gets
 * opened**.
 *
 * That second job is what changed. The key carries the uploader's user id, and the key arrives as a
 * path segment the caller controls — so if the owner were read out of the URL, a crafted key would
 * choose which account's refresh token the server uses. It is not read out of the URL. Every branch
 * below returns the owner from **the row it matched**, and a key matching no row is a 404 before
 * anything reaches Drive.
 *
 * The branches also answer in cost order: a string comparison first, a scoped `exists()` only when
 * that fails.
 */

/** A file shared through a project is not under my id, so the prefix alone would 404 it for every
 *  member but the uploader. Returns the owner off the STORED key, never off the request. */
async function sharedWithMe(key: string, userId: string, email?: string | null): Promise<string | null> {
  await connectToDatabase();
  const ids = await myProjectIds(userId, email);
  if (!ids.length) return null;
  const hit = await Document.exists({ key, projectId: { $in: ids } })
    || await Note.exists({ 'attachments.key': key, projectId: { $in: ids } })
    // Chat attachments. Without this branch every one of them 404s for everyone but its uploader —
    // the moment the chat composer grows a paperclip, this is the line that makes it work.
    || await Message.exists({ 'attachments.key': key, projectId: { $in: ids } });
  return hit ? ownerOfKey(key) : null;
}

/** A "Help us improve" screenshot lives in an admin's Drive. Narrow on purpose: an admin gets those
 *  keys and nothing else in anybody's account. */
async function adminShot(key: string, email?: string | null): Promise<string | null> {
  if (!isAdmin(email)) return null;
  await connectToDatabase();
  return (await Suggestion.exists({ 'shot.key': key })) ? ownerOfKey(key) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const key = (await params).key.map(decodeURIComponent).join('/');

  // Resolve an owner, or 404. Authorisation and credential-selection are one decision here so they
  // cannot drift apart later.
  const owner =
    (ownsKey(session.user.id, key) ? session.user.id : null)
    ?? (await sharedWithMe(key, session.user.id, session.user.email))
    ?? (await adminShot(key, session.user.email));

  if (!owner) return new NextResponse('Not found', { status: 404 });

  // Forwarded so a video or audio attachment plays at all: mobile players open with
  // `Range: bytes=0-1` and refuse to start without a 206.
  const range = req.headers.get('range');
  const out = await readStream(key, owner, range);

  if (out.state === 'no_token') {
    // NOT 404. A 404 tells a teammate the document was deleted; the truth is that its owner has to
    // reconnect their Drive, and only one of those is actionable.
    return new NextResponse('The owner of this file needs to reconnect their Google Drive', { status: 503 });
  }
  if (out.state === 'gone') return new NextResponse('This file was removed from Google Drive', { status: 410 });
  if (out.state !== 'ok') return new NextResponse('Could not read this file', { status: 502 });

  const upstream = out.res;
  const meta = await fileMeta(key);
  const { type, disposition } = safeContentType(meta?.mimeType, upstream.headers.get('content-type'));
  const filename = safeFilename(meta?.name);

  const headers = new Headers();
  headers.set('Content-Type', type);
  headers.set('Content-Disposition', `${disposition}; filename="${filename}"`);
  // The stored mimeType is attacker-supplied (`file.type` from the uploading browser), so even with
  // the allowlist above the browser is told not to go looking for a better guess, and the response
  // is sandboxed so nothing that does slip through can reach this origin.
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  // `private` is not optional and `public`/`s-maxage` must never appear: a shared edge cache holding
  // a passport scan, keyed by URL, sits in front of the auth check above. `immutable` is true here —
  // a key names one Drive file from one upload, so those bytes never change.
  headers.set('Cache-Control', 'private, max-age=3600, immutable');
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new NextResponse(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}

/** The name and declared type we stored, for the headers. Best-effort: a missing row just means
 *  the response falls back to a download with a generic name. */
async function fileMeta(key: string): Promise<{ name?: string; mimeType?: string } | null> {
  try {
    await connectToDatabase();
    const doc = await Document.findOne({ key }).select('name mimeType').lean<{ name?: string; mimeType?: string }>();
    if (doc) return doc;
    const note = await Note.findOne({ 'attachments.key': key }).select('attachments').lean<{ attachments?: { key: string; name?: string; mimeType?: string }[] }>();
    const att = note?.attachments?.find(a => a.key === key);
    if (att) return att;
    const msg = await Message.findOne({ 'attachments.key': key }).select('attachments').lean<{ attachments?: { key: string; name?: string; mimeType?: string }[] }>();
    const matt = msg?.attachments?.find(a => a.key === key);
    if (matt) return matt;
    const sug = await Suggestion.findOne({ 'shot.key': key }).select('shot').lean<{ shot?: { name?: string; mimeType?: string } }>();
    return sug?.shot || null;
  } catch {
    return null;
  }
}
