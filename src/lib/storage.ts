import { driveAccessToken } from '@/lib/driveAuth';
import { resolveTree, uploadFile, downloadFile, trashFile } from '@/lib/drive';
import { folderFor, safeFileName, type UploadSource } from '@/lib/driveFolders';
import { keyFor, ownerOfKey, driveIdOfKey } from '@/lib/driveKey';

/**
 * The one place uploaded bytes are stored — now the user's own Google Drive, and nothing else.
 *
 * There is no S3 bucket and no local-disk fallback any more. The local one was never a real
 * backend: it wrote inside `public/`, which meant every uploaded file was ALSO served statically at
 * `/uploads/<key>` with no auth check — passport scans included — and on a serverless host the
 * filesystem is read-only, so it failed in production anyway. Removing it closes that hole by
 * deletion rather than by another check.
 *
 * The trade the founder chose: no Drive connected means no uploads. That is a real wall in front of
 * a first upload, and it buys a storage bill of zero and a file the user can still open the day
 * they stop using this app.
 *
 * Reads deliberately proxy through `/api/files` rather than handing out a Drive link: a Drive URL
 * only opens for a Google account with permission on the file, and half of a group may have signed
 * up with a password. The app staying the gatekeeper is what keeps those people working.
 */

export type SaveFailure = 'no_drive' | 'drive_revoked' | 'quota' | 'too_large' | 'failed';

export type SaveResult =
  | { ok: true; key: string; url: string; mimeType: string; size: number; buffer: Buffer; fileId: string }
  | { ok: false; reason: SaveFailure; message: string };

/** Vercel rejects a serverless body over ~4.5MB before any of this runs; say so in our own words. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const SAY: Record<SaveFailure, string> = {
  no_drive: 'Connect your Google Drive to upload files.',
  drive_revoked: 'Google Drive is disconnected — reconnect it to upload.',
  quota: 'Your Google Drive is full. Free up space in Drive and try again.',
  too_large: 'File is too large (max 4MB).',
  failed: 'Could not save that file just now.',
};

const fail = (reason: SaveFailure): SaveResult => ({ ok: false, reason, message: SAY[reason] });

/**
 * Can this person upload at all? Display-only — every caller re-checks by actually trying, exactly
 * as `hinglishEnabled` sits in front of `sarvamKeyFor`. It exists so a picker can offer a Connect
 * card BEFORE somebody selects a 4MB file and waits for it to fail.
 */
export async function canUpload(userId: string): Promise<{ ok: boolean; reason?: SaveFailure }> {
  const token = await driveAccessToken(userId);
  return token ? { ok: true } : { ok: false, reason: 'no_drive' };
}

/**
 * Save a file into `ownerUserId`'s Drive, under ALL-YOU-NEED/<folder>.
 *
 * `ownerUserId` is separate from "whoever is uploading" for exactly one case: a feedback screenshot
 * is stored in an admin's Drive, because a person reporting a bug should not need a connected Drive
 * to send one. Everywhere else it is the actor. It is a named argument rather than a hidden branch
 * so that exception is visible at the call site.
 */
export async function saveUpload(
  ownerUserId: string,
  file: File,
  ctx: { source: UploadSource; projectName?: string | null },
): Promise<SaveResult> {
  if (file.size > MAX_UPLOAD_BYTES) return fail('too_large');

  const token = await driveAccessToken(ownerUserId);
  if (!token) return fail('no_drive');

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const name = safeFileName(file.name);
    const mimeType = file.type || 'application/octet-stream';

    const parentId = await resolveTree(token, folderFor(ctx.source, ctx.projectName));
    const created = await uploadFile(token, parentId, buffer, name, mimeType);

    const key = keyFor(ownerUserId, created.id);
    // Stable, and useless without a session: the route resolves it to real bytes behind the same
    // ownership checks that guarded the S3 keys.
    return { ok: true, key, url: `/api/files/${key}`, mimeType, size: file.size, buffer, fileId: created.id };
  } catch (error) {
    const msg = String((error as Error)?.message || error);
    if (/storageQuotaExceeded|quota/i.test(msg)) return fail('quota');
    if (/invalid_grant|unauthor/i.test(msg)) return fail('drive_revoked');
    console.error('Drive upload failed for', ownerUserId, error);
    return fail('failed');
  }
}

/**
 * The bytes, streamed.
 *
 * `ownerId` is REQUIRED and must have come from a stored database row — the row that authorised
 * this read — never from the key in the URL. The key names a Drive account to open a token for, and
 * it arrives as a path segment the caller controls; taking the owner from it would let a crafted
 * URL choose whose credential gets used. The type signature is the enforcement: you cannot read
 * bytes without first having produced an owner.
 */
export type ReadResult =
  | { state: 'ok'; res: Response }
  /** The owner disconnected Drive or revoked us. Not the same as a missing file, and the route
   *  must not say 404 — that tells a teammate the document was deleted, which is untrue. */
  | { state: 'no_token' }
  /** The owner deleted it in their own Drive. `drive.file` means they can, at any time. */
  | { state: 'gone' }
  | { state: 'error' };

export async function readStream(key: string, ownerId: string, range?: string | null): Promise<ReadResult> {
  const fileId = driveIdOfKey(key);
  if (!fileId) return { state: 'error' };
  const token = await driveAccessToken(ownerId);
  if (!token) return { state: 'no_token' };
  try {
    const res = await downloadFile(token, fileId, range);
    if (res.status === 404) return { state: 'gone' };
    if (res.status === 401 || res.status === 403) return { state: 'no_token' };
    if (!res.ok && res.status !== 206) return { state: 'error' };
    return { state: 'ok', res };
  } catch (error) {
    console.error('Drive read failed for', key, error);
    return { state: 'error' };
  }
}

/** Same rule as readStream, for the callers that genuinely need a Buffer to extract text. */
export async function readBytes(key: string, ownerId: string): Promise<Buffer | null> {
  const out = await readStream(key, ownerId);
  if (out.state !== 'ok') return null;
  return Buffer.from(await out.res.arrayBuffer());
}

/**
 * Move a file to the owner's Drive trash.
 *
 * Trash, never a permanent delete: this is somebody's personal Drive, and destroying a file outright
 * because a tap happened in a third-party app is more than this app is entitled to. Drive's 30-day
 * trash is also the only undo the app has.
 *
 * `actorUserId` is the guard on the rule that matters — **the app deletes bytes only from the Drive
 * of the person who clicked.** A group note can carry attachments from several people's Drives, and
 * detaching one from the note is legitimate group work; reaching into a colleague's personal Drive
 * to destroy their file is not. When they differ the row is detached and the bytes are left alone.
 */
export async function deleteUpload(key: string, actorUserId?: string): Promise<void> {
  const owner = ownerOfKey(key);
  const fileId = driveIdOfKey(key);
  if (!owner || !fileId) return;
  if (actorUserId && actorUserId !== owner) {
    console.warn('Left in its owner’s Drive rather than deleted by another member:', key);
    return;
  }
  try {
    const token = await driveAccessToken(owner);
    if (!token) return;   // disconnected: orphaned bytes beat a failed delete, as before
    await trashFile(token, fileId);
  } catch (error) {
    console.error('deleteUpload failed for', key, error);
  }
}

/**
 * The same rule over a batch of keys, for the paths that erase a whole account or a whole group.
 *
 * Best-effort on purpose: a file already gone from Drive, or a Drive we can no longer reach, must
 * never stall an erase the user has already been told is happening — the rows go either way, and a
 * few unreferenced bytes in somebody's own Drive beat a half-deleted account.
 */
export async function deleteUploads(keys: (string | undefined | null)[], actorUserId?: string): Promise<void> {
  for (const key of keys) {
    if (key) await deleteUpload(key, actorUserId).catch(err => console.error('Drive delete failed for', key, err));
  }
}

export { ownsKey, ownerOfKey, driveIdOfKey, keyFor } from '@/lib/driveKey';
