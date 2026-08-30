/**
 * The storage key, now that bytes live in somebody's Google Drive.
 *
 *     <uploaderUserId>/drive/<driveFileId>
 *
 * The `<userId>/` prefix is kept from the S3 era because it is load-bearing for authorisation, not
 * decoration: `ownsKey` answers the common case — my own file — with a string comparison and no
 * database round trip at all.
 *
 * What is NEW and dangerous is that the key now also names **a Drive account to open a token for**,
 * and it arrives from a URL path segment the caller controls. So there is one rule the whole
 * feature rests on:
 *
 *   > The owner used for a Drive fetch must come out of a stored database row, never out of the
 *   > request path.
 *
 * `/api/files` implements that by resolving an owner from the row that matched (ownsKey, or the
 * Document/Note/Message row inside one of my projects) and using THAT. `ownerOfKey` exists to read
 * the owner off a key the app itself stored — never off one a stranger just sent. It refuses
 * anything that is not a 24-character hex ObjectId, so a crafted key cannot even name an account.
 *
 * Pure and import-free: scripts/self-check.mjs runs it under plain node.
 */

const OBJECT_ID = /^[0-9a-f]{24}$/;
/** Drive file ids are URL-safe base64-ish; anything else is not one. */
const DRIVE_ID = /^[A-Za-z0-9_-]{6,256}$/;

export function keyFor(userId: string, fileId: string): string {
  return `${userId}/drive/${fileId}`;
}

/**
 * True when this key is mine, decided by string alone.
 *
 * The trailing slash is what stops `u1` matching `u10/drive/x` — a prefix check without it is the
 * classic version of this bug, and it hands one account another's files.
 */
export function ownsKey(userId: string, key: string): boolean {
  return !!userId && !!key && key.startsWith(`${userId}/`) && !key.includes('..');
}

/** The account whose Drive holds this file, or null if the key is not one of ours. */
export function ownerOfKey(key: string | null | undefined): string | null {
  const parts = String(key ?? '').split('/');
  if (parts.length !== 3 || parts[1] !== 'drive') return null;
  return OBJECT_ID.test(parts[0]) ? parts[0] : null;
}

/** The Drive file id inside this key, or null if the key is not one of ours. */
export function driveIdOfKey(key: string | null | undefined): string | null {
  const parts = String(key ?? '').split('/');
  if (parts.length !== 3 || parts[1] !== 'drive') return null;
  return DRIVE_ID.test(parts[2]) ? parts[2] : null;
}

/** A key written by this app, as opposed to a legacy S3/local one or something invented. */
export function isDriveKey(key: string | null | undefined): boolean {
  return ownerOfKey(key) !== null && driveIdOfKey(key) !== null;
}

/**
 * Keys in, Drive file ids out — and only for files in the ACTOR's own Drive.
 *
 * The same rule `deleteUpload` enforces, for the same reason: a group note can carry attachments
 * uploaded by several people, and moving that note into another project is legitimate group work,
 * but it is not permission to reach into a colleague's personal Drive with their credential and
 * hand their file to a new audience. Theirs are skipped; `/api/files` covers those readers anyway.
 */
export function grantableFileIds(
  keys: (string | null | undefined)[] | null | undefined,
  uploaderId?: string | null,
): string[] {
  if (!uploaderId) return [];
  const out = new Set<string>();
  for (const key of keys || []) {
    if (ownerOfKey(key) !== String(uploaderId)) continue;
    const fileId = driveIdOfKey(key);
    if (fileId) out.add(fileId);
  }
  return [...out];
}
