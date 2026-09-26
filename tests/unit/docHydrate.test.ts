import { describe, expect, test } from 'vitest';
import { docNeedsText, pickDocsToHydrate } from '@/lib/docHydrate';

describe('pickDocsToHydrate', () => {
  const docs = [
    { _id: '1', name: 'invoice-march.pdf', type: 'file', text: '', mimeType: 'application/pdf' },
    { _id: '2', name: 'photo.jpg', type: 'file', text: '', mimeType: 'image/jpeg' },
    { _id: '3', name: 'contract.pdf', type: 'file', text: 'already read', mimeType: 'application/pdf' },
  ];

  test('docNeedsText ignores non-files and populated text', () => {
    expect(docNeedsText({ type: 'link', text: '' })).toBe(false);
    expect(docNeedsText({ type: 'file', text: 'x' })).toBe(false);
    expect(docNeedsText({ type: 'file', text: '' })).toBe(true);
    expect(docNeedsText({ type: 'file', text: undefined })).toBe(true);
  });

  test('matches document questions to filenames', () => {
    const picked = pickDocsToHydrate(docs, 'What does the invoice say?');
    expect(picked.map(d => d._id)).toEqual(['1']);
  });

  test('document hint pulls unread files when no keyword match', () => {
    const picked = pickDocsToHydrate(docs, 'show my PDF documents');
    expect(picked.map(d => d._id)).toEqual(['1']);
  });

  test('skips hydration when no signal', () => {
    expect(pickDocsToHydrate(docs, 'what tasks are due')).toEqual([]);
  });
});
