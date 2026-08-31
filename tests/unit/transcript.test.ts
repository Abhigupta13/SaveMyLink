import { describe, test, expect } from 'vitest';
import { mergeFinals, joinTranscripts } from '@/lib/transcript';

/**
 * The repetition bug, pinned with the two real transcripts it was reported with.
 *
 * Both showed one short sentence rendered as a ladder of its own prefixes. The words were
 * recognised correctly every time; they were written down more than once. It happens at two levels
 * and the first fix only caught the second, which is why it was reported again:
 *
 *   1. WITHIN one session - Android's WebView makes every result a longer prefix of the same
 *      sentence, so looping and concatenating builds the ladder directly.
 *   2. ACROSS restarted sessions - onend banks a finished session's finals, and a WebView keeps its
 *      results list across the restart, so the bank is already in there.
 */

describe('mergeFinals', () => {
  test('disjoint pieces are joined with a space', () => {
    expect(mergeFinals('do you have', 'any contact')).toBe('do you have any contact');
  });

  test('a cumulative result replaces rather than appends', () => {
    expect(mergeFinals('I am', 'I am checking')).toBe('I am checking');
  });

  test('a replayed shorter result does not shorten what we already have', () => {
    expect(mergeFinals('I am checking if', 'I am')).toBe('I am checking if');
  });

  test('empties on either side are left alone', () => {
    expect(mergeFinals('', 'add task')).toBe('add task');
    expect(mergeFinals('add task', '')).toBe('add task');
    expect(mergeFinals('', '')).toBe('');
  });

  test('is idempotent: applying it to its own output changes nothing', () => {
    const once = mergeFinals('I am', 'I am checking if the bike');
    expect(mergeFinals('I am', once)).toBe(once);
    expect(mergeFinals(once, once)).toBe(once);
  });

  test('stray whitespace never becomes a double space', () => {
    expect(mergeFinals('do you have ', '  any contact ')).toBe('do you have any contact');
  });
});

describe('joinTranscripts — the reported ladders', () => {
  /** Second report, verbatim from the screenshot. */
  test('a cumulative WebView result list collapses to the sentence', () => {
    const results = [
      'I am', 'I am checking', 'I am checking if', 'I am checking if the',
      'I am checking if the bike', 'I am checking if the bike recording',
      'I am checking if the bike recording is', 'I am checking if the bike recording is fixed',
    ];
    expect(joinTranscripts(results)).toBe('I am checking if the bike recording is fixed');
  });

  /** First report. Concatenating these is what produced "add add task add task to ...". */
  test('the first report collapses too', () => {
    const results = ['add', 'add task', 'add task to', 'add task to fix', 'add task to fix the mic recording'];
    expect(joinTranscripts(results)).toBe('add task to fix the mic recording');
  });

  test('a disjoint Chrome result list is still joined, not collapsed', () => {
    expect(joinTranscripts(['do you have', 'any contact', 'about Sarabjit Bal']))
      .toBe('do you have any contact about Sarabjit Bal');
  });

  test('a mixed list — cumulative then a genuinely new piece', () => {
    expect(joinTranscripts(['open', 'open the', 'open the locker', 'and find my passport']))
      .toBe('open the locker and find my passport');
  });

  test('an empty list is an empty string, not "undefined"', () => {
    expect(joinTranscripts([])).toBe('');
  });
});

describe('across restarted sessions', () => {
  /**
   * onend banks the finished session; the next session is merged onto the bank. Both engines end
   * up at the same sentence, which is the whole point of not branching on which one we are on.
   */
  test('an engine that KEEPS its results list', () => {
    const sessions = ['add', 'add task', 'add task to fix the mic'];
    let banked = '';
    for (const s of sessions) banked = mergeFinals(banked, s);
    expect(banked).toBe('add task to fix the mic');
  });

  test('an engine that CLEARS its results list', () => {
    const sessions = ['add', 'task', 'to fix the mic'];
    let banked = '';
    for (const s of sessions) banked = mergeFinals(banked, s);
    expect(banked).toBe('add task to fix the mic');
  });
});
