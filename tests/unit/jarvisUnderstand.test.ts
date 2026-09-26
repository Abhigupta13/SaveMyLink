import { describe, expect, it } from 'vitest';
import { expandJarvisQuery } from '../../src/lib/jarvisUnderstand';

describe('expandJarvisQuery', () => {
  it('leaves clean text unchanged', () => {
    expect(expandJarvisQuery('tasks due tomorrow')).toBe('tasks due tomorrow');
  });

  it('appends retrieval tokens for common typos without removing original', () => {
    const out = expandJarvisQuery('wat r my taks due tomoro');
    expect(out.startsWith('wat r my taks due tomoro')).toBe(true);
    expect(out).toMatch(/\btask\b/);
    expect(out).toMatch(/\btomorrow\b/);
    expect(out).toMatch(/\bwhat\b/);
  });

  it('expands expense misspellings', () => {
    const out = expandJarvisQuery('expnse on amzon');
    expect(out).toMatch(/\bexpense\b/);
    expect(out).toMatch(/\bexpenses\b/);
  });
});
