import { describe, test, expect } from 'vitest';
import { scorePunctuality, PUNCTUAL_DAYS, type PunctualRow } from '@/lib/punctuality';

/**
 * The rule behind the number on the home page.
 *
 * Worth holding to account for the same reason lib/scope and lib/taskAccess are: it is a small
 * amount of arithmetic that people will read as a judgement about themselves, so every way it can
 * quietly lie needs a test. The two that matter most are the window (an abandoned task from March
 * must not still be scoring you in September) and the updatedAt fallback (rows ticked before
 * completedAt existed).
 */

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0); // 1 Sep 2026, midday — fixed so the window is exact
const days = (n: number) => n * 24 * 3600e3;
const ago = (n: number) => new Date(NOW - days(n)).toISOString();
const ahead = (n: number) => new Date(NOW + days(n)).toISOString();

const done = (dueAt: string, completedAt: string): PunctualRow => ({ completed: true, dueAt, completedAt });
const open = (dueAt: string): PunctualRow => ({ completed: false, dueAt });

describe('scorePunctuality', () => {
  test('nothing to score is not a score of zero', () => {
    expect(scorePunctuality([], NOW)).toEqual({ onTime: 0, late: 0, missed: 0, scored: 0, rate: 0 });
  });

  test('finished before the deadline is on time, after it is late', () => {
    const s = scorePunctuality([
      done(ago(5), ago(6)),   // a day early
      done(ago(5), ago(5)),   // exactly on the dot
      done(ago(5), ago(4)),   // a day over
    ], NOW);
    expect(s.onTime).toBe(2);
    expect(s.late).toBe(1);
    expect(s.rate).toBe(67);
  });

  /**
   * The decision the whole metric rests on. If open-and-overdue did not count, the way to score
   * 100% would be to stop ticking things off, which is the opposite of what the number is for.
   */
  test('open work past its date counts against you', () => {
    const s = scorePunctuality([done(ago(5), ago(6)), open(ago(3))], NOW);
    expect(s.missed).toBe(1);
    expect(s.scored).toBe(2);
    expect(s.rate).toBe(50);
  });

  test('open work still within its deadline is not counted either way', () => {
    const s = scorePunctuality([done(ago(5), ago(6)), open(ahead(3))], NOW);
    expect(s.missed).toBe(0);
    expect(s.scored).toBe(1);
    expect(s.rate).toBe(100);
  });

  test('work with no deadline is never scored', () => {
    const rows: PunctualRow[] = [
      { completed: true, completedAt: ago(2) },
      { completed: false },
      { completed: true, dueAt: null, completedAt: ago(2) },
    ];
    expect(scorePunctuality(rows, NOW).scored).toBe(0);
  });

  /** Both axes are windowed, or an abandoned task from last spring scores you forever. */
  test('the window bounds completions and misses alike', () => {
    const old = PUNCTUAL_DAYS + 10;
    const s = scorePunctuality([
      done(ago(old), ago(old - 1)),  // finished late, long ago
      open(ago(old)),               // missed, long ago
      done(ago(2), ago(3)),         // in the window
    ], NOW);
    expect(s).toMatchObject({ onTime: 1, late: 0, missed: 0, scored: 1, rate: 100 });
  });

  /**
   * A task DUE outside the window but FINISHED inside it still counts — the score is about when you
   * did the work, not when it was set. Only the miss bucket keys off the due date, because for open
   * work that is the only date there is.
   */
  test('an old deadline met recently still counts', () => {
    const s = scorePunctuality([done(ago(PUNCTUAL_DAYS + 5), ago(2))], NOW);
    expect(s).toMatchObject({ late: 1, scored: 1, rate: 0 });
  });

  describe('rows ticked before completedAt existed', () => {
    test('updatedAt stands in when there is no stamp', () => {
      const rows: PunctualRow[] = [
        { completed: true, dueAt: ago(5), updatedAt: ago(6) },
        { completed: true, dueAt: ago(5), updatedAt: ago(4) },
      ];
      expect(scorePunctuality(rows, NOW)).toMatchObject({ onTime: 1, late: 1, scored: 2 });
    });

    test('a real stamp always wins over updatedAt', () => {
      // Finished on time, then edited a week later. This is the exact case updatedAt gets wrong,
      // and the reason the field was added rather than derived.
      const s = scorePunctuality([{ completed: true, dueAt: ago(20), completedAt: ago(21), updatedAt: ago(1) }], NOW);
      expect(s).toMatchObject({ onTime: 1, late: 0 });
    });

    test('a finished row with neither date is dropped, not guessed at', () => {
      expect(scorePunctuality([{ completed: true, dueAt: ago(5) }], NOW).scored).toBe(0);
    });
  });

  test('the three buckets always account for the whole score', () => {
    const s = scorePunctuality([
      done(ago(9), ago(10)), done(ago(8), ago(7)), open(ago(4)), open(ahead(4)),
      { completed: true, completedAt: ago(1) },
    ], NOW);
    expect(s.onTime + s.late + s.missed).toBe(s.scored);
    expect(s.rate).toBe(Math.round((s.onTime / s.scored) * 100));
  });
});
