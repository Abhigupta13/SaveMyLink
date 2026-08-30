/**
 * Google Drive over plain fetch — the only file storage this app has.
 *
 * No `googleapis`: that package is tens of megabytes of generated clients for four endpoints, and
 * every one of those megabytes is cold-start latency on a serverless function that only ever wants
 * to PUT a PDF somewhere. The REST surface is small enough to write out.
 *
 * The access token is a required argument, never looked up here. Same split `sarvam.ts` has from
 * `sarvamAccess.ts`: this file is transport and imports no model, and `driveAuth.ts` is the single
 * place that answers "whose Drive". A transport that could reach for a token itself is one upload
 * away from silently writing into the wrong person's account.
 *
 * Everything the app writes lives under the `drive.file` scope, which means Drive shows us only the
 * files WE created. That is the point — the user's own documents stay invisible to this app — but it
 * also shapes the code: a folder lookup can only ever find our own folders, so `ensureFolder` is
 * safe to call on every upload.
 *
 * Failures throw `DriveError` rather than returning null, matching lib/storage.ts, because a lost
 * upload must never look like a successful one. The two best-effort calls (`shareReader`,
 * `trashFile`) return a boolean instead, and say why at each one.
 */

import { randomBytes } from 'crypto';
import { DRIVE_ROOT, safeFolderName, safeFileName } from '@/lib/driveFolders';
import { appUrl } from '@/lib/url';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** The narrowest scope that can still write: files this app created, and nothing else in Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';

/** Short-lived and httpOnly — the browser half of the pair whose other half is the signed state. */
export const OAUTH_NONCE_COOKIE = 'driveOAuth';

/**
 * Registered in the Google Cloud console, and sent a SECOND time when the code is exchanged: Google
 * compares the two and rejects a mismatch. One builder, so connect and callback cannot drift apart.
 * The origin fallback only matters on a deploy with no app URL configured, which is already broken.
 */
/**
 * The request's OWN origin wins over the configured one.
 *
 * Google compares this string twice — once at consent and once at token exchange — and it must also
 * be registered on the OAuth client. Deriving it from the request means localhost, production and a
 * tunnel each send the origin the browser is genuinely on, so one client serves all of them with no
 * env var to keep in step. `appUrl()` stays as the fallback for a caller that has no request.
 *
 * This is the same class of bug that produced `Error 400: invalid_request`: a single configured URL
 * cannot be correct in two environments at once.
 */
export const driveRedirectUri = (origin?: string) => `${String(origin || '') || appUrl()}/api/drive/callback`;

/**
 * The origin the BROWSER actually asked for, taken from the Host header.
 *
 * Not `req.nextUrl.origin`: `scripts/dev-safe.js` starts Next with `-H 0.0.0.0`, and that binding
 * address is what `nextUrl` then reports — so the redirect_uri came out as
 * `http://0.0.0.0:3000/api/drive/callback`, which Google refuses outright as non-compliant. The
 * Host header is what the user typed, which is also the only thing that can match a registered URI.
 *
 * A non-routable or missing host falls through to the configured URL rather than being sent to
 * Google to be rejected.
 */
export function originOf(req: { headers: Headers; nextUrl: URL }): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const bad = !host || host.startsWith('0.0.0.0') || host.startsWith('[::]');
  if (bad) return appUrl() || req.nextUrl.origin;
  const proto = req.headers.get('x-forwarded-proto')
    || (/^(localhost|127\.|\[::1\])/i.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** The root folder's name, overridable per deploy so a staging environment does not share a tree. */
export const driveRootName = () => safeFolderName(process.env.DRIVE_FOLDER_NAME, DRIVE_ROOT);

/**
 * The consent screen lets a user untick an individual permission, and Google then hands back a
 * perfectly valid token that cannot write a single file. Reading the granted scope back is the only
 * way to tell that apart from success before the first upload fails in front of them.
 */
export const hasDriveScope = (scope?: string | null) =>
  String(scope || '').split(/\s+/).includes('https://www.googleapis.com/auth/drive.file');

/**
 * Plain assignments rather than TypeScript parameter properties: scripts/self-check.mjs loads this
 * file under node's strip-only type removal, which refuses to rewrite a constructor for you.
 */
export class DriveError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = '') {
    super(message);
    this.name = 'DriveError';
    this.status = status;
    this.detail = detail;
  }
}

export interface DriveFile { id: string; name?: string; mimeType?: string; size?: string }
export interface DriveAbout { email: string; name?: string; limit?: number; usage?: number }

/* ── Pure builders. Exported so scripts/self-check.mjs can assert the wire format with no network,
      no token and no Google account — the multipart body in particular is the kind of thing that is
      either exactly right or silently rejected with a 400 that explains nothing. ── */

/**
 * Drive's `q` language is single-quoted, so a group called "Ravi's Team" ends the string early and
 * turns the query into a syntax error. Backslashes first, or it would escape our own escapes.
 */
export const escapeQuery = (value: string) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const folderQuery = (name: string, parentId?: string | null) =>
  `mimeType='${FOLDER_MIME}' and trashed=false and name='${escapeQuery(name)}' `
  + `and '${escapeQuery(parentId || 'root')}' in parents`;

export const listUrl = (q: string) =>
  `${API}/files?${new URLSearchParams({ q, spaces: 'drive', fields: 'files(id,name)', pageSize: '10' })}`;

/** Every id goes through encodeURIComponent — Drive ids are opaque, and a stray `/` is a new path. */
export const fileUrl = (fileId: string, params?: Record<string, string>) =>
  `${API}/files/${encodeURIComponent(fileId)}${params ? `?${new URLSearchParams(params)}` : ''}`;

export const uploadUrl = () => `${UPLOAD}?uploadType=multipart&fields=id,name,mimeType,size`;

/**
 * `sendNotificationEmail=false` is not a preference. Without it Google mails every member of the
 * group, from the uploader's own address, every time a file is shared — which on a busy project is
 * a mailbox full of noise the user never asked us to send on their behalf.
 */
export const permissionsUrl = (fileId: string) =>
  `${API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id`;

export const aboutUrl = () =>
  `${API}/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)`;

/**
 * A mime type from an uploaded file is attacker-controlled and lands in a header line inside the
 * multipart body. A CRLF in it would let the uploader forge extra part headers, so anything that is
 * not a bare type/subtype becomes the honest unknown.
 */
export const safeMime = (mimeType?: string | null) => {
  const bare = String(mimeType || '').split(';')[0].trim();
  return /^[A-Za-z0-9!#$&^_.+-]{1,80}\/[A-Za-z0-9!#$&^_.+-]{1,80}$/.test(bare) ? bare : 'application/octet-stream';
};

/**
 * Only `bytes=` ranges reach Google. The value arrives as a client request header, and a fetch
 * header carrying a newline is a request-splitting attempt, not a video seek.
 */
export const safeRange = (range?: string | null) =>
  /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(String(range || '')) ? String(range) : null;

/**
 * `uploadType=multipart` wants `multipart/related`, and the global FormData emits
 * `multipart/form-data` — Drive answers that with a 400 that says nothing useful. Hence the body by
 * hand. The boundary is random because it must not appear in the file's own bytes, and a fixed one
 * would leave that to luck.
 */
export function multipartBody(
  metadata: Record<string, unknown>,
  bytes: Uint8Array,
  mimeType: string,
): { boundary: string; body: Buffer } {
  const boundary = `ayn${randomBytes(16).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${safeMime(mimeType)}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, body: Buffer.concat([head, Buffer.from(bytes), tail]) };
}

/* ── Transport ── */

/** What the user is told. The raw Google body goes to the log, never to a browser. */
function reason(status: number, detail: string): string {
  if (status === 401) return 'Google Drive needs reconnecting';
  if (status === 403 && /storageQuotaExceeded/.test(detail)) return 'Your Google Drive is full';
  if (status === 403) return 'Google Drive refused that (permission or rate limit)';
  if (status === 404) return 'That file is no longer in Drive';
  return `Google Drive error (${status})`;
}

async function call<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  if (!token) throw new DriveError('No Google Drive connected for this account', 401);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  } catch (error) {
    console.error('Drive call failed:', url.split('?')[0], error);
    throw new DriveError('Could not reach Google Drive', 0, String(error));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Drive error:', res.status, url.split('?')[0], detail.slice(0, 400));
    throw new DriveError(reason(res.status, detail), res.status, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * Find the folder, or make it. Idempotent by lookup rather than by bookkeeping, because an id we
 * stored last week is gone the moment the user drags that folder into their Drive bin — and a
 * stored id that 404s would strand every upload until somebody reconnected.
 *
 * ponytail: two uploads racing on a brand-new group can both miss the lookup and create two folders
 * of the same name. Drive allows it, the files still land somewhere sensible, and the fix (a lock,
 * or a rename sweep) costs more than the mess. Revisit if it is ever actually seen.
 */
export async function ensureFolder(token: string, name: string, parentId?: string | null): Promise<string> {
  const clean = safeFolderName(name);
  const found = await call<{ files?: { id: string }[] }>(token, listUrl(folderQuery(clean, parentId)));
  const existing = found?.files?.[0]?.id;
  if (existing) return existing;

  const made = await call<{ id?: string }>(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean, mimeType: FOLDER_MIME, parents: [parentId || 'root'] }),
  });
  if (!made?.id) throw new DriveError('Drive created a folder but returned no id', 0);
  return made.id;
}

/**
 * `ALL-YOU-NEED/<subfolder>`, both rungs idempotent, returning the id an upload should be parented
 * to. The root's own id is not handed back: a caller that has it would eventually be tempted to
 * cache it, and the whole reason this resolves every time is that a stored id goes stale the moment
 * the user tidies their Drive.
 */
export async function resolveTree(token: string, subfolder: string): Promise<string> {
  const rootId = await ensureFolder(token, driveRootName());
  return ensureFolder(token, subfolder, rootId);
}

export async function uploadFile(
  token: string,
  parentId: string,
  buffer: Uint8Array,
  name: string,
  mimeType: string,
): Promise<DriveFile> {
  const { boundary, body } = multipartBody(
    { name: safeFileName(name), parents: parentId ? [parentId] : undefined },
    buffer,
    mimeType,
  );
  const file = await call<DriveFile>(token, uploadUrl(), {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  if (!file?.id) throw new DriveError('Drive accepted the upload but returned no file id', 0);
  return file;
}

/**
 * The raw Response, deliberately unread: `/api/files` streams `res.body` straight through, so a
 * 200MB video never becomes a 200MB Buffer inside a function with a 1GB ceiling. The caller checks
 * `res.ok` — a 404 here is a normal outcome, because the user can delete the file in their own Drive.
 */
export async function downloadFile(token: string, fileId: string, range?: string | null): Promise<Response> {
  const bytes = safeRange(range);
  return fetch(fileUrl(fileId, { alt: 'media', supportsAllDrives: 'true' }), {
    headers: { Authorization: `Bearer ${token}`, ...(bytes ? { Range: bytes } : {}) },
  });
}

/**
 * Trash, never `files.delete`. This is the user's own Drive: removing an app row is our decision to
 * make, and permanently destroying their copy of the file is not. Trash is reversible for 30 days,
 * by them, in their own interface, with no help from us.
 *
 * Best-effort on purpose — a file already gone from Drive must not block the app-side delete, or
 * the row becomes undeletable.
 */
export async function trashFile(token: string, fileId: string): Promise<boolean> {
  try {
    await call(token, fileUrl(fileId, { fields: 'id' }), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience only, and never load-bearing: `/api/files` is the authoritative read path and works
 * for a teammate with no Google account at all. This only means the file is ALSO openable straight
 * from their own Drive. `reader`, never writer — a teammate editing the uploader's copy in place is
 * not something this app can see, undo, or explain afterwards.
 *
 * Note the deliberate omission: removing someone from a project does not revoke this. App-side
 * access stops immediately; their Drive copy persists, the same way a downloaded file would.
 */
export async function shareReader(token: string, fileId: string, email: string): Promise<boolean> {
  const address = String(email || '').trim().toLowerCase();
  if (!address.includes('@')) return false;
  try {
    await call(token, permissionsUrl(fileId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: address }),
    });
    return true;
  } catch {
    return false;   // no Google account on that address, sharing barred by policy, rate limit
  }
}

/**
 * Which Google account is connected, and how full it is. The address matters on its own: a
 * password-only user connects whatever Drive they like, and "your files are in Drive" is useless
 * advice if the app cannot say WHICH Drive.
 */
export async function about(token: string): Promise<DriveAbout> {
  const data = await call<{
    user?: { emailAddress?: string; displayName?: string };
    storageQuota?: { limit?: string; usage?: string };
  }>(token, aboutUrl());
  const limit = Number(data?.storageQuota?.limit);
  const usage = Number(data?.storageQuota?.usage);
  return {
    email: data?.user?.emailAddress || '',
    name: data?.user?.displayName || undefined,
    // A Workspace account with pooled storage reports no limit at all, which is not the same as 0
    limit: Number.isFinite(limit) ? limit : undefined,
    usage: Number.isFinite(usage) ? usage : undefined,
  };
}
