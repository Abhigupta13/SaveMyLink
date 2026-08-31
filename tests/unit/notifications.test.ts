import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { previewOf, agoLabel, PREVIEW_CHARS, NOTIFICATION_WINDOW_DAYS, MAX_NOTIFICATIONS, MESSAGE_VERB } from '@/lib/notifications';

/**
 * These decide what a person reads on a page summarising OTHER people's messages. The failures
 * worth pinning are the quiet ones: a row that renders empty because somebody posted a photo, or a
 * preview that reprints a whole message the feed was supposed to be a summary of.
 */

describe('previewOf', () => {
  test('short text comes through whole', () => {
    expect(previewOf('Can you check the tilt correction?')).toBe('Can you check the tilt correction?');
  });

  /* A chat message is often several lines; a feed row is one. Truncating at the first newline
     would hide the half that mattered, so it collapses instead. */
  test('newlines and runs of space collapse to one line', () => {
    expect(previewOf('line one\nline two')).toBe('line one line two');
    expect(previewOf('  spaced   out \n\n text  ')).toBe('spaced out text');
  });

  test('long text is cut and marked as cut', () => {
    const long = 'the quick brown fox jumps over the lazy dog and keeps on running well past the edge of the preview window';
    const out = previewOf(long);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);   // +1 for the ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);        // it is a prefix, not a paraphrase
  });

  test('cuts on a word boundary rather than mid-word', () => {
    const out = previewOf('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar');
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1).trimEnd()).not.toMatch(/\s$/);
    // The character before the ellipsis is the end of a word, not a fragment mid-token.
    const words = out.slice(0, -1).trim().split(' ');
    expect(words[words.length - 1]).toMatch(/^[a-z]+$/);
  });

  /* No spaces at all — a long URL, or Devanagari and CJK where space-breaking does nothing useful.
     A word-boundary rule that found no boundary must still cut, not return the whole thing. */
  test('text with no spaces still gets cut', () => {
    const url = 'https://example.com/' + 'a'.repeat(200);
    const out = previewOf(url);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  test('devanagari is cut by length, not mangled', () => {
    const hi = 'क'.repeat(200);
    const out = previewOf(hi);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  /* The case a plain slice renders as a blank row: somebody posted a photo and said nothing. */
  test('an attachment with no words describes itself', () => {
    expect(previewOf('', 1)).toBe('sent a file');
    expect(previewOf('   ', 3)).toBe('sent 3 files');
    expect(previewOf(null, 2)).toBe('sent 2 files');
  });

  test('nothing at all is empty, so the caller can drop the row', () => {
    for (const junk of [undefined, null, '', '   ', '\n\n']) {
      expect(previewOf(junk)).toBe('');
    }
  });

  test('a body that is not a string does not throw', () => {
    expect(() => previewOf({} as unknown)).not.toThrow();
    expect(() => previewOf(42 as unknown)).not.toThrow();
  });
});

describe('agoLabel', () => {
  const NOW = new Date('2026-08-31T12:00:00.000Z').getTime();
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  test('reads as an age, not a clock', () => {
    expect(agoLabel(ago(5_000), NOW)).toBe('just now');
    expect(agoLabel(ago(5 * 60_000), NOW)).toBe('5m');
    expect(agoLabel(ago(3 * 3600_000), NOW)).toBe('3h');
    expect(agoLabel(ago(2 * 86_400_000), NOW)).toBe('2d');
  });

  test('boundaries land on the larger unit, not on 60m or 24h', () => {
    expect(agoLabel(ago(59_000), NOW)).toBe('just now');
    expect(agoLabel(ago(60_000), NOW)).toBe('1m');
    expect(agoLabel(ago(59 * 60_000), NOW)).toBe('59m');
    expect(agoLabel(ago(60 * 60_000), NOW)).toBe('1h');
    expect(agoLabel(ago(23 * 3600_000), NOW)).toBe('23h');
    expect(agoLabel(ago(24 * 3600_000), NOW)).toBe('1d');
  });

  /* A phone whose clock runs a few seconds fast stamps a message in the future. That must read as
     new, not as a negative age or an empty cell. */
  test('a slightly future timestamp reads as new', () => {
    expect(agoLabel(new Date(NOW + 30_000).toISOString(), NOW)).toBe('just now');
  });

  test('past the window it gives up and says the date', () => {
    expect(agoLabel(ago(30 * 86_400_000), NOW)).toMatch(/\d+ \w+/);
  });

  test('junk renders as nothing rather than "Invalid Date"', () => {
    expect(agoLabel('not a date', NOW)).toBe('');
    expect(agoLabel('', NOW)).toBe('');
  });
});

/**
 * The duplicate every message appeared as on the first real render: a chat post writes a Message
 * AND a 'message_posted' Event, and the feed read both. This pins the exclusion to the actual verb
 * the rest of the app emits — renaming it in activity.ts without updating here brings the
 * duplicate back, silently, and only on a screen with real chat traffic.
 */
describe('the message verb is excluded from the activity half', () => {
  test('MESSAGE_VERB is a verb activity.ts actually emits', () => {
    const activity = readFileSync(join(process.cwd(), 'src', 'lib', 'activity.ts'), 'utf8');
    expect(activity).toContain(`'${MESSAGE_VERB}'`);
  });

  test('the notifications query filters it out', () => {
    const action = readFileSync(join(process.cwd(), 'src', 'actions', 'notifications.ts'), 'utf8');
    // Event.find must exclude it, or every message is listed twice, seconds apart.
    expect(action).toMatch(/verb:\s*\{\s*\$ne:\s*MESSAGE_VERB\s*\}/);
  });
});

describe('the feed stays a glance surface', () => {
  test('window and cap are bounded', () => {
    expect(NOTIFICATION_WINDOW_DAYS).toBeGreaterThan(0);
    expect(NOTIFICATION_WINDOW_DAYS).toBeLessThanOrEqual(30);
    // An unbounded feed is an unbounded query and an unbounded payload, sized by how busy a
    // group happens to be that week.
    expect(MAX_NOTIFICATIONS).toBeGreaterThan(0);
    expect(MAX_NOTIFICATIONS).toBeLessThanOrEqual(200);
  });
});
