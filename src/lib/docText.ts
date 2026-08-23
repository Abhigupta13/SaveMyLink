import path from 'path';

// Enough of a document for Jarvis to answer from without any one file crowding out the vault.
export const MAX_DOC_TEXT = 12000;

const TEXT_EXT = ['.txt', '.md', '.csv', '.json', '.log', '.yml', '.yaml', '.html', '.xml'];
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_DOC_TEXT);

/**
 * Best-effort plain text from an uploaded file.
 * '' means "tried, nothing to read" — images, video, audio and Office files land here, and
 * Jarvis still sees their name and folder. Never throws: a document that will not parse is
 * still a document worth storing.
 */
export async function extractText(buf: Buffer, mimeType = '', name = ''): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  try {
    if (mimeType === 'application/pdf' || ext === '.pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try { return clean((await parser.getText()).text || ''); }
      finally { await parser.destroy(); }
    }
    if (mimeType.startsWith('text/') || TEXT_EXT.includes(ext)) return clean(buf.toString('utf8'));
  } catch (error) {
    console.error('extractText failed for', name, error);
  }
  return '';
}
