import { describe, test, expect } from 'vitest';
import {
  shouldAskOnExit, afterAsked, afterDismissed, afterSent, afterSession,
  MIN_SESSIONS, ASK_COOLDOWN_DAYS, SENT_COOLDOWN_DAYS, MAX_DISMISSALS,
  type FeedbackState,
} from '@/lib/feedbackPrompt';

/**
 * This decides whether to interrupt somebody who is closing the app. The property under test is
 * therefore not "does it ask" but "does it stay quiet" — a prompt that reappears on every exit is
 * the version people uninstall over, and it is the version you get from any single missing guard.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ready = { sessions: MIN_SESSIONS, lastAskedAt: 0, lastSentAt: 0, dismissals: 0 };

describe('shouldAskOnExit — the default is silence', () => {
  test('asks once the app has actually been used', () => {
    expect(shouldAskOnExit(ready, NOW)).toBe(true);
  });

  test('never on a new install', () => {
    for (let s = 0; s < MIN_SESSIONS; s++) {
      expect(shouldAskOnExit({ ...ready, sessions: s }, NOW)).toBe(false);
    }
    expect(shouldAskOnExit({ ...ready, sessions: MIN_SESSIONS }, NOW)).toBe(true);
  });

  /* Boundary stated in elapsed time from the ask, not in offsets from NOW — the earlier version of
     this test got its own arithmetic wrong and reported a bug in working code. */
  test('"Later" means later, not next time', () => {
    const askedAt = NOW;
    const justAsked = { ...ready, lastAskedAt: askedAt };
    const after = (ms: number) => shouldAskOnExit(justAsked, askedAt + ms);

    expect(after(0)).toBe(false);
    expect(after(DAY)).toBe(false);
    expect(after(ASK_COOLDOWN_DAYS * DAY - 1)).toBe(false);   // a millisecond short
    expect(after(ASK_COOLDOWN_DAYS * DAY)).toBe(true);        // the cooldown is over
  });

  test('having sent something buys a much longer silence', () => {
    const sent = { ...ready, lastSentAt: NOW, lastAskedAt: NOW };
    expect(shouldAskOnExit(sent, NOW + (ASK_COOLDOWN_DAYS + 1) * DAY)).toBe(false);
    expect(shouldAskOnExit(sent, NOW + SENT_COOLDOWN_DAYS * DAY + DAY)).toBe(true);
  });

  test('three refusals is an answer, and it is permanent', () => {
    const refused = { ...ready, dismissals: MAX_DISMISSALS, lastAskedAt: 0 };
    expect(shouldAskOnExit(refused, NOW)).toBe(false);
    // Not even years later.
    expect(shouldAskOnExit(refused, NOW + 5000 * DAY)).toBe(false);
  });

  /* A device whose clock was wrong and then corrected leaves a timestamp in the future. Reading
     that as "ancient" would make now - asked negative and ask on every single exit. */
  test('a timestamp in the future does not become a prompt on every exit', () => {
    expect(shouldAskOnExit({ ...ready, lastAskedAt: NOW + 10 * DAY }, NOW)).toBe(false);
    expect(shouldAskOnExit({ ...ready, lastSentAt: NOW + 10 * DAY }, NOW)).toBe(false);
  });

  test('anything unreadable stays silent rather than prompting', () => {
    expect(shouldAskOnExit(null, NOW)).toBe(false);
    expect(shouldAskOnExit(undefined, NOW)).toBe(false);
    expect(shouldAskOnExit({}, NOW)).toBe(false);
    for (const junk of [NaN, Infinity, -5, 'lots' as unknown as number, null]) {
      expect(shouldAskOnExit({ ...ready, sessions: junk as number }, NOW)).toBe(false);
    }
  });

  test('a corrupt cooldown cannot unlock the prompt early', () => {
    // Garbage in lastAskedAt reads as 0 (never asked) — which only matters because the session
    // and dismissal guards still stand between that and a prompt.
    expect(shouldAskOnExit({ sessions: 0, lastAskedAt: NaN }, NOW)).toBe(false);
    expect(shouldAskOnExit({ sessions: MIN_SESSIONS, dismissals: MAX_DISMISSALS, lastAskedAt: NaN }, NOW)).toBe(false);
  });
});

describe('the transitions', () => {
  test('being shown starts the short cooldown without counting as a refusal', () => {
    const s = afterAsked(ready, NOW);
    expect(s.lastAskedAt).toBe(NOW);
    expect(s.dismissals).toBe(0);
    expect(shouldAskOnExit(s, NOW + DAY)).toBe(false);
  });

  test('"Later" counts, and three of them end it', () => {
    let s: FeedbackState = ready;
    for (let i = 1; i <= MAX_DISMISSALS; i++) {
      s = afterDismissed(s, NOW + i * ASK_COOLDOWN_DAYS * DAY * 2);
      expect(s.dismissals).toBe(i);
    }
    expect(shouldAskOnExit(s, NOW + 9999 * DAY)).toBe(false);
  });

  /* Sending is not refusing. Someone who engaged once must not end up nearer to being silenced
     forever than someone who ignored every prompt. */
  test('sending resets the refusal streak', () => {
    const refusedTwice = { ...ready, dismissals: 2 };
    const s = afterSent(refusedTwice, NOW);
    expect(s.dismissals).toBe(0);
    expect(s.lastSentAt).toBe(NOW);
    expect(shouldAskOnExit(s, NOW + SENT_COOLDOWN_DAYS * DAY + DAY)).toBe(true);
  });

  test('sessions only ever count up, from whatever junk was stored', () => {
    expect(afterSession({}).sessions).toBe(1);
    expect(afterSession({ sessions: 3 }).sessions).toBe(4);
    expect(afterSession({ sessions: -9 }).sessions).toBe(1);
    expect(afterSession({ sessions: NaN }).sessions).toBe(1);
  });

  test('a full refuse-then-send-then-refuse cycle behaves', () => {
    let s = afterSession({ sessions: MIN_SESSIONS });
    expect(shouldAskOnExit(s, NOW)).toBe(true);
    s = afterDismissed(s, NOW);
    expect(shouldAskOnExit(s, NOW + DAY)).toBe(false);
    const later = NOW + (ASK_COOLDOWN_DAYS + 1) * DAY;
    expect(shouldAskOnExit(s, later)).toBe(true);
    s = afterSent(s, later);
    expect(shouldAskOnExit(s, later + DAY)).toBe(false);
  });
});
