/**
 * Which locker files Jarvis should extract text for on this question (pure — testable in node).
 */

import { terms, typeHints } from '@/lib/retrieval';

export function docNeedsText(doc: { type?: string; text?: string | null | undefined }) {
  return doc.type === 'file' && (doc.text == null || doc.text === '');
}

export function isRetryableExtract(mimeType = '', name = '') {
  const ext = name.toLowerCase();
  return mimeType === 'application/pdf'
    || mimeType.startsWith('text/')
    || ext.endsWith('.pdf')
    || ext.endsWith('.txt')
    || ext.endsWith('.md')
    || ext.endsWith('.csv');
}

export function pickDocsToHydrate<T extends { _id: unknown; name?: string; text?: string | null; type?: string; mimeType?: string }>(
  docs: T[],
  question: string,
  limit = 6,
): T[] {
  const candidates = docs.filter(d => docNeedsText(d));
  if (!candidates.length) return [];

  const hints = typeHints(question);
  const ts = terms(question);
  const q = question.toLowerCase();

  const scored = candidates.map(d => {
    const name = (d.name || '').toLowerCase();
    let score = 0;
    if (hints.has('document')) score += 2;
    for (const t of ts) {
      if (name.includes(t)) score += 3;
    }
    if (name.length > 2 && q.includes(name)) score += 10;
    return { d, score };
  }).sort((a, b) => b.score - a.score || String(a.d.name).localeCompare(String(b.d.name)));

  const byName = scored.filter(x => x.score >= 3);
  if (byName.length) return byName.slice(0, limit).map(x => x.d);

  const withSignal = scored.filter(x => x.score > 0).slice(0, limit);
  if (withSignal.length) return withSignal.map(x => x.d);
  if (hints.has('document')) return candidates.slice(0, limit);
  return [];
}
