import { describe, test, expect } from 'vitest';
import { safeContentType, safeFilename } from '@/lib/fileType';

/**
 * What Content-Type a stored file may be served with — described by its own source as "the most
 * dangerous decision in the file-serving route", and until now untested.
 *
 * The threat is concrete. `mimeType` comes from `file.type`, supplied by the browser that uploaded
 * it. A user can upload a file declaring `text/html`. Served back from the app's own origin at
 * /api/files/... with the session cookie attached, that is stored XSS against every member of the
 * group it was shared into.
 *
 * src/lib/fileType.ts says it is kept "pure and import-free: scripts/self-check.mjs runs it under
 * plain node." It does not — the same false promise as src/lib/driveState.ts and the five dead
 * driveKey imports. Three security-critical modules written expecting coverage that never arrived.
 */

describe('safeContentType — types that execute', () => {
  /**
   * The one people are surprised by, and the reason an allowlist is not enough on its own: an SVG
   * is a document that can carry script, and users genuinely do upload them expecting an image.
   */
  test('SVG is forced to download however it is declared', () => {
    expect(safeContentType('image/svg+xml')).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
  });

  test('every executable type downloads rather than rendering', () => {
    for (const t of [
      'text/html', 'application/xhtml+xml', 'text/xml', 'application/xml',
      'text/javascript', 'application/javascript', 'application/x-httpd-php',
      'text/x-python', 'application/xslt+xml',
    ]) {
      expect(safeContentType(t)).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
    }
  });

  /**
   * The dangerous type wins from EITHER source. An uploader who declares `image/png` while Drive
   * reports `text/html` must not get an inline render off the stored value — which is why the
   * NEVER_INLINE loop runs over every candidate before the inline loop starts.
   */
  test('a dangerous type in either position wins over a safe one', () => {
    expect(safeContentType('image/png', 'text/html').disposition).toBe('attachment');
    expect(safeContentType('text/html', 'image/png').disposition).toBe('attachment');
    expect(safeContentType('application/pdf', 'image/svg+xml').disposition).toBe('attachment');
  });

  /** Case and parameters are attacker-controlled too, so normalisation happens before the lookup. */
  test('case and charset parameters cannot smuggle a type past the check', () => {
    expect(safeContentType('TEXT/HTML').disposition).toBe('attachment');
    expect(safeContentType('text/html; charset=utf-8').disposition).toBe('attachment');
    expect(safeContentType('  Image/SVG+XML  ').disposition).toBe('attachment');
  });
});

describe('safeContentType — types that may render', () => {
  test('the allowlist renders inline with its real type', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'video/mp4', 'audio/mpeg']) {
      expect(safeContentType(t)).toEqual({ type: t, disposition: 'inline' });
    }
  });

  test('the stored type wins when both are allowed', () => {
    expect(safeContentType('image/png', 'image/jpeg')).toEqual({ type: 'image/png', disposition: 'inline' });
  });

  test('falls through to Drive when the stored type is missing', () => {
    expect(safeContentType(null, 'application/pdf')).toEqual({ type: 'application/pdf', disposition: 'inline' });
    expect(safeContentType('', 'image/png')).toEqual({ type: 'image/png', disposition: 'inline' });
  });
});

describe('safeContentType — everything else', () => {
  /** An Office file or a zip: a real type worth reporting, but still a download. */
  test('known but non-inline types keep their type and download', () => {
    expect(safeContentType('application/zip')).toEqual({ type: 'application/zip', disposition: 'attachment' });
    expect(safeContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
      .toEqual({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', disposition: 'attachment' });
  });

  test('nonsense and absent types fall back to octet-stream', () => {
    expect(safeContentType(null, null)).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
    expect(safeContentType('not-a-mime')).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
    expect(safeContentType('../../etc/passwd')).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
  });

  /** A CR or LF reaching a header value is response splitting. */
  test('control characters are stripped rather than reaching a header', () => {
    const got = safeContentType('image/png\r\nX-Injected: yes');
    expect(got.type).not.toMatch(/[\r\n]/);
    // Stripping leaves a string that is no longer the png it claimed, so it must not render inline.
    expect(got.disposition).toBe('attachment');
  });
});

describe('safeFilename', () => {
  test('keeps an ordinary name', () => {
    expect(safeFilename('contract.pdf')).toBe('contract.pdf');
  });

  /** Quotes would terminate the filename="..." parameter early; CRLF would split the response. */
  test('removes what would break out of a Content-Disposition header', () => {
    expect(safeFilename('in"valid.pdf')).toBe('invalid.pdf');
    expect(safeFilename('back\\slash.pdf')).toBe('backslash.pdf');
    expect(safeFilename('bad\r\nX-Injected: yes.pdf')).toBe('badX-Injected: yes.pdf');
    expect(safeFilename('a"; attachment; filename="evil.html')).toBe('a; attachment; filename=evil.html');
  });

  test('never returns empty — an unnamed download still needs a name', () => {
    expect(safeFilename('')).toBe('file');
    expect(safeFilename(null)).toBe('file');
    expect(safeFilename(undefined)).toBe('file');
    expect(safeFilename('   ')).toBe('file');
    expect(safeFilename('\r\n')).toBe('file');
  });

  test('caps the length', () => {
    expect(safeFilename('x'.repeat(400))).toHaveLength(120);
  });
});
