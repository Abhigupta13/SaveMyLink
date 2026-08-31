import { describe, test, expect } from 'vitest';
import { mergeFinals } from '@/lib/transcript';

/**
 * The repetition bug, pinned.
 *
 * Reported as "Jarvis recording shows repetitive words", and the screenshot showed one short
 * sentence rendered as a ladder of its own prefixes:
 *
 *   add add task add task to add task to fish add task to fish fix ...
 *
 * The words were recognised correctly every time; they were written down more than once. A speech
 * session is restarted whenever the engine ends it, and the previous session's finals were banked
 * and prepended — correct only if a restarted session starts with an empty results list. Chrome
 * clears it. Android's WebView does not, so the bank was added to text that already contained it.
 */

describe('mergeFinals', () => {
  test('nothing banked yet: the session speaks for itself', () => {
    expect(mergeFinals('', 'add task')).toBe('add task');
  });

  test('an engine that CLEARS the results list: the bank is what carries the earlier words', () => {
    expect(mergeFinals('add ', 'task to fix the mic')).toBe('add task to fix the mic');
  });

  /** The reported bug. Before: 'add ' + 'add task' = 'add add task'. */
  test('an engine that KEEPS the results list: the bank is already in there', () => {
    expect(mergeFinals('add ', 'add task')).toBe('add task');
    expect(mergeFinals('add task ', 'add task to fish')).toBe('add task to fish');
  });

  /**
   * The property that actually prevents the ladder. onresult fires many times per session and each
   * one recomputes from the whole list, so merging has to be safe to apply to its own output -
   * however many times an index is replayed, the text cannot grow.
   */
  test('is idempotent: applying it to its own output changes nothing', () => {
    const banked = 'add task ';
    const finals = 'add task to fish';
    const once = mergeFinals(banked, finals);
    expect(mergeFinals(banked, once)).toBe(once);
    expect(mergeFinals(once, once)).toBe(once);
  });

  test('a whole dictation, one restart per phrase, never doubles', () => {
    // Each entry is what a restarted session reports when the engine kept the list.
    const sessions = ['add', 'add task', 'add task to', 'add task to fix', 'add task to fix the mic'];
    let banked = '';
    for (const finals of sessions) banked = mergeFinals(banked, finals);
    expect(banked).toBe('add task to fix the mic');
  });

  test('and the same dictation on an engine that clears between phrases', () => {
    const sessions = ['add ', 'task ', 'to ', 'fix ', 'the mic'];
    let banked = '';
    for (const finals of sessions) banked = mergeFinals(banked, finals);
    expect(banked).toBe('add task to fix the mic');
  });

  test('an empty session leaves the bank alone', () => {
    expect(mergeFinals('add task', '')).toBe('add task');
    expect(mergeFinals('', '')).toBe('');
  });

  /**
   * Deliberately NOT deduplicated: two sessions that genuinely begin the same way are only a prefix
   * match by coincidence, and dropping one would delete words the person said. The engine-kept case
   * always contains the bank as a prefix of a LONGER string; this is a different shape.
   */
  test('a genuine repeat that is not a prefix of the bank is kept', () => {
    expect(mergeFinals('add task ', 'and add a note')).toBe('add task and add a note');
  });
});
