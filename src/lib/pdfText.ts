import path from 'path';
import { MAX_DOC_TEXT } from '@/lib/docText';
import { ensurePdfParseEnvironment } from '@/lib/pdfParseWorker';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_DOC_TEXT);

export type PdfTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'needs_password' | 'wrong_password' | 'failed' };

/** Heuristic: many encrypted PDFs include `/Encrypt` in the file header/trailer region. */
export function pdfBufferLooksEncrypted(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 256 * 1024));
  const head = slice.toString('latin1');
  return head.includes('/Encrypt');
}

function errorsInChain(error: unknown): Error[] {
  const out: Error[] = [];
  const seen = new Set<object>();
  let cur: unknown = error;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) {
      out.push(cur);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return out;
}

function isPasswordError(error: unknown, PasswordException?: typeof import('pdf-parse').PasswordException): boolean {
  for (const err of errorsInChain(error)) {
    if (PasswordException && err instanceof PasswordException) return true;
    const name = err.name || '';
    const msg = String(err.message || '').toLowerCase();
    if (name.includes('Password') || msg.includes('password') || msg.includes('encrypted')) return true;
    if (msg.includes('incorrect password') || msg.includes('needs password')) return true;
    const details = (err as Error & { details?: unknown }).details;
    if (typeof details === 'string' && details.toLowerCase().includes('password')) return true;
  }
  return false;
}

function passwordFailureReason(
  error: unknown,
  password: string | undefined,
  PasswordException?: typeof import('pdf-parse').PasswordException,
): 'needs_password' | 'wrong_password' {
  const msg = errorsInChain(error)
    .map((e) => String(e.message || '').toLowerCase())
    .join(' ');
  const noPasswordGiven = msg.includes('no password');
  if (password && !noPasswordGiven) return 'wrong_password';
  if (password && noPasswordGiven) return 'needs_password';
  return password ? 'wrong_password' : 'needs_password';
}

/** Extract text from a PDF buffer, optionally with a user-supplied password. */
export async function extractPdfText(buf: Buffer, password?: string): Promise<PdfTextResult> {
  const encryptedHint = pdfBufferLooksEncrypted(buf);
  try {
    await ensurePdfParseEnvironment();
    const pdfParse = await import('pdf-parse');
    const { PDFParse, PasswordException } = pdfParse;

    const opts: { data: Uint8Array; password?: string } = { data: new Uint8Array(buf) };
    if (password) opts.password = password;

    const parser = new PDFParse(opts);
    try {
      const text = clean((await parser.getText()).text || '');
      if (!text.trim() && encryptedHint && !password) {
        return { ok: false, reason: 'needs_password' };
      }
      return { ok: true, text };
    } finally {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup failures so they never mask a successful read.
      }
    }
  } catch (error) {
    const pdfParse = await import('pdf-parse').catch(() => null);
    const PasswordException = pdfParse?.PasswordException;
    if (isPasswordError(error, PasswordException)) {
      return { ok: false, reason: passwordFailureReason(error, password, PasswordException) };
    }
    if (encryptedHint && !password) {
      return { ok: false, reason: 'needs_password' };
    }
    console.error('extractPdfText failed', error);
    return { ok: false, reason: 'failed' };
  }
}

export function isPdf(mimeType: string, name: string): boolean {
  return mimeType === 'application/pdf' || path.extname(name).toLowerCase() === '.pdf';
}
