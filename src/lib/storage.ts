import path from 'path';
import fs from 'fs';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * The one place uploaded bytes are stored. Notes attachments and the Digi Locker both go
 * through here so there is a single upload path to secure, and a single place to change.
 *
 * S3 when configured, local disk otherwise. The fallback is not a nicety — Vercel's filesystem
 * is read-only apart from an ephemeral /tmp, so writing under public/ works on a laptop and
 * fails in production. Local disk stays only so a dev machine works before AWS is set up.
 *
 * Nothing is ever public. Objects are private and read back through /api/files, which checks
 * the session first — these are passport scans, not blog images.
 */

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'ap-south-1';
export const usingS3 = !!(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

const s3 = () => new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const localPath = (key: string) => path.join(process.cwd(), 'public', 'uploads', key);

/** Keys start with the owner's id so /api/files can authorise from the key alone. */
export function makeKey(userId: string, filename: string) {
  const ext = path.extname(filename).slice(0, 10);
  const stem = path.basename(filename, path.extname(filename)).replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
  // Date.now alone collides when two files are saved in the same millisecond
  return `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${stem}${ext}`;
}

export function ownsKey(userId: string, key: string) {
  return key.startsWith(`${userId}/`) && !key.includes('..');
}

export async function saveUpload(userId: string, file: File): Promise<{ key: string; url: string; mimeType: string; size: number; buffer: Buffer }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = makeKey(userId, file.name || 'file');

  if (usingS3) {
    await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: file.type || undefined }));
  } else {
    const dest = localPath(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buffer);
  }
  // Stable and non-guessable-by-others; the route resolves it to real bytes behind auth
  return { key, url: `/api/files/${key}`, mimeType: file.type || '', size: file.size, buffer };
}

/** A short-lived direct URL (S3), or null when the route should stream the file itself. */
export async function readUrl(key: string): Promise<string | null> {
  if (!usingS3) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
}

export async function readBytes(key: string): Promise<Buffer | null> {
  try {
    if (usingS3) {
      const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    }
    return await readFile(localPath(key));
  } catch {
    return null;   // deleted underneath us, or never written
  }
}

export async function deleteUpload(key: string) {
  try {
    if (usingS3) await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    else if (fs.existsSync(localPath(key))) await unlink(localPath(key));
  } catch (error) {
    console.error('deleteUpload failed for', key, error);   // orphaned bytes beat a failed delete
  }
}
