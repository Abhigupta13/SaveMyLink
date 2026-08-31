import { describe, test, expect } from 'vitest';
import {
  detectMention, keepMention, queryOf, insertMention, mentionsIn, MAX_QUERY,
} from '@/lib/mentionTrigger';

/**
 * The whole reason this module exists is that chat's version assumes the caret is at the end of the
 * value. In a note it is not, and the failure that mattered was destructive: a pick would have
 * replaced everything from the `@` to the end of the note. So the caret-in-the-middle cases below
 * are the point of the file, not edge cases around it.
 */

// caret marked with | in the fixtures, stripped before use
const at = (s: string): [string, number] => [s.replace('|', ''), s.indexOf('|')];

describe('detectMention', () => {
  test('opens on an @ being typed at the end', () => {
    const [v, c] = at('see @|');
    expect(detectMention(v, c)).toEqual({ tokenStart: 4, queryStart: 5 });
  });

  test('opens on an @ at the very start of the note', () => {
    const [v, c] = at('@su|');
    expect(detectMention(v, c)).toEqual({ tokenStart: 0, queryStart: 1 });
  });

  /* The case chat cannot do. The caret is mid-note with paragraphs after it; the token under the
     cursor is what counts, not the last token in the string. */
  test('opens mid-note, ignoring everything after the caret', () => {
    const [v, c] = at('the gate photo @su| and then a long paragraph that follows after it');
    expect(detectMention(v, c)).toEqual({ tokenStart: 15, queryStart: 16 });
  });

  test('opens at the start of a line, not just after a space', () => {
    const [v, c] = at('first line\n@ga|');
    expect(detectMention(v, c)).toEqual({ tokenStart: 11, queryStart: 12 });
  });

  /* An address is not a mention. This is decided by what precedes the @, and getting it wrong
     means every email typed into a note pops a picker. */
  test('an email address never opens a picker', () => {
    for (const s of ['abhi@example.com|', 'mail abhi@x|', 'a@|']) {
      const [v, c] = at(s);
      expect(detectMention(v, c)).toBeNull();
    }
  });

  test('no @ before the caret means nothing is open', () => {
    const [v, c] = at('just some words|');
    expect(detectMention(v, c)).toBeNull();
  });

  /* The caret sits before an @ that appears later in the note — that @ is not being typed. */
  test('an @ after the caret is not the one being typed', () => {
    const [v, c] = at('words| and @later');
    expect(detectMention(v, c)).toBeNull();
  });

  test('gives up once the query is plainly prose', () => {
    const long = '@' + 'x'.repeat(MAX_QUERY + 1);
    expect(detectMention(long, long.length)).toBeNull();
    const okLen = '@' + 'x'.repeat(MAX_QUERY);
    expect(detectMention(okLen, okLen.length)).not.toBeNull();
  });

  test('a caret out of range is clamped rather than throwing', () => {
    expect(() => detectMention('@a', 999)).not.toThrow();
    expect(() => detectMention('@a', -5)).not.toThrow();
    expect(detectMention('', 0)).toBeNull();
    expect(detectMention(null as unknown as string, 0)).toBeNull();
  });
});

describe('keepMention', () => {
  const open = { tokenStart: 4, queryStart: 5 };

  test('survives a space, because attachment names have spaces', () => {
    const [v, c] = at('see @gate photo|');
    expect(keepMention(open, v, c)).toEqual(open);
  });

  test('closes when the @ is deleted', () => {
    const [v, c] = at('see gate|');
    expect(keepMention(open, v, c)).toBeNull();
  });

  test('closes when the caret moves back behind the @', () => {
    const [v, c] = at('see| @gate');
    expect(keepMention(open, v, c)).toBeNull();
  });

  test('closes on a newline — that person has moved on', () => {
    const [v, c] = at('see @gate\nnext line|');
    expect(keepMention(open, v, c)).toBeNull();
  });

  test('closes once the query is prose', () => {
    const v = 'see @' + 'x'.repeat(MAX_QUERY + 5);
    expect(keepMention(open, v, v.length)).toBeNull();
  });

  test('null in, null out', () => {
    expect(keepMention(null, 'see @g', 6)).toBeNull();
  });
});

describe('queryOf — bounded by the caret, never the end of the note', () => {
  test('reads only up to the caret', () => {
    const [v, c] = at('see @Su| and a whole paragraph after');
    const open = detectMention(v, c)!;
    expect(queryOf(v, open, c)).toBe('su');
  });

  test('is lowercased and trimmed so matching is forgiving', () => {
    const [v, c] = at('see @  GATE |');
    expect(queryOf(v, { tokenStart: 4, queryStart: 5 }, c)).toBe('gate');
  });

  test('an empty query right after @ lists everything', () => {
    const [v, c] = at('see @|');
    expect(queryOf(v, { tokenStart: 4, queryStart: 5 }, c)).toBe('');
  });
});

describe('insertMention — the destructive case', () => {
  /* The bug this module exists to prevent: chat's version replaces to end-of-string, which in a
     note would delete every paragraph after the cursor. */
  test('keeps everything after the caret', () => {
    const [v, c] = at('intro @ga| and the rest of the note survives');
    const open = detectMention(v, c)!;
    const out = insertMention(v, open, c, 'gate.jpg');
    expect(out.value).toBe('intro @gate.jpg  and the rest of the note survives');
    expect(out.value).toContain('the rest of the note survives');
  });

  test('replaces the whole token, not just appends', () => {
    const [v, c] = at('@ga|');
    const out = insertMention(v, detectMention(v, c)!, c, 'gate.jpg');
    expect(out.value).toBe('@gate.jpg ');
    expect(out.value).not.toContain('@ga@');
  });

  test('returns a caret sitting after the inserted name, not at the end of the note', () => {
    const [v, c] = at('intro @ga| trailing text here');
    const out = insertMention(v, detectMention(v, c)!, c, 'gate.jpg');
    expect(out.caret).toBe('intro @gate.jpg '.length);
    expect(out.caret).toBeLessThan(out.value.length);   // the writer is not thrown to the bottom
  });

  test('a multi-line note keeps its later lines', () => {
    const [v, c] = at('line one\n@g|\nline three');
    const out = insertMention(v, detectMention(v, c)!, c, 'photo.png');
    expect(out.value).toBe('line one\n@photo.png \nline three');
  });
});

describe('mentionsIn — read-time matching', () => {
  const labels = ['gate.jpg', 'photo', 'photo of the gate'];

  test('finds a mention that is really there', () => {
    expect(mentionsIn('see @gate.jpg here', labels)).toEqual(['gate.jpg']);
  });

  /* Longest first, or @photo matches inside @photo of the gate and renders half a name as text. */
  test('prefers the longest matching label', () => {
    expect(mentionsIn('see @photo of the gate here', labels)).toEqual(['photo of the gate']);
  });

  test('a bare @ the person typed stays plain text', () => {
    expect(mentionsIn('email me @ work', labels)).toEqual([]);
    expect(mentionsIn('abhi@example.com', labels)).toEqual([]);
  });

  test('finds several, in the order they appear', () => {
    expect(mentionsIn('@photo then @gate.jpg', labels)).toEqual(['photo', 'gate.jpg']);
  });

  test('does not run past the end or loop forever', () => {
    expect(mentionsIn('@', labels)).toEqual([]);
    expect(mentionsIn('', labels)).toEqual([]);
    expect(mentionsIn('@gate.jpg', [])).toEqual([]);
  });
});
