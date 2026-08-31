/**
 * Whether to ask for feedback on the way out — and, much more importantly, when NOT to.
 *
 * A prompt on exit is the most intrusive moment in an app: the person has finished and is leaving.
 * Asked every time it stops being a question and becomes a toll, and the honest outcome of that is
 * not more feedback but fewer opens. So the default answer here is NO, and every rule below exists
 * to keep it that way:
 *
 *  · Never on the first few sessions. Someone who has opened the app twice has nothing to tell you
 *    yet, and being asked makes the app feel like it wants something from them before it has given
 *    anything.
 *  · Once asked, a long silence. "Later" means later, not next time.
 *  · Once they have actually sent something, much longer still — they have done the thing being
 *    asked for, and asking again soon reads as not having noticed.
 *  · Repeated dismissals compound. Someone who has said no three times has answered the question.
 *
 * Pure and clock-injected so every branch can be proven without waiting days for a cooldown.
 */

export interface FeedbackState {
  /** How many app sessions have been counted. */
  sessions?: number | null;
  /** When the prompt was last shown, epoch ms. */
  lastAskedAt?: number | null;
  /** When feedback was last actually submitted, epoch ms. */
  lastSentAt?: number | null;
  /** How many times it has been dismissed with "Later" in a row. */
  dismissals?: number | null;
}

/** Nothing until the app has been used enough to have an opinion about. */
export const MIN_SESSIONS = 4;
/** After a "Later". */
export const ASK_COOLDOWN_DAYS = 7;
/** After something was actually sent. */
export const SENT_COOLDOWN_DAYS = 60;
/** Three "Later"s in a row is an answer. */
export const MAX_DISMISSALS = 3;

const DAY = 24 * 60 * 60 * 1000;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Should the exit prompt appear?
 *
 * Every unreadable or missing value resolves to "do not ask". A corrupt localStorage entry must
 * degrade into silence, never into a prompt that cannot be escaped — the failure mode people
 * actually punish.
 */
export function shouldAskOnExit(state: FeedbackState | null | undefined, now: number = Date.now()): boolean {
  if (!state) return false;

  if (num(state.sessions) < MIN_SESSIONS) return false;
  if (num(state.dismissals) >= MAX_DISMISSALS) return false;

  const sent = num(state.lastSentAt);
  if (sent && now - sent < SENT_COOLDOWN_DAYS * DAY) return false;

  const asked = num(state.lastAskedAt);
  if (asked && now - asked < ASK_COOLDOWN_DAYS * DAY) return false;

  /* A clock that jumped backwards — a device whose time was wrong and got corrected — leaves a
     timestamp in the future. Treat that as "just asked" rather than as ancient history, so a bad
     clock cannot turn into a prompt on every single exit. */
  if (asked > now || sent > now) return false;

  return true;
}

/** After the prompt is shown. */
export const afterAsked = (state: FeedbackState, now: number = Date.now()): FeedbackState =>
  ({ ...state, lastAskedAt: now });

/** After "Later" — the dismissal count is what eventually stops the asking for good. */
export const afterDismissed = (state: FeedbackState, now: number = Date.now()): FeedbackState =>
  ({ ...state, lastAskedAt: now, dismissals: num(state.dismissals) + 1 });

/**
 * After something was actually sent. The dismissal streak resets: it counts consecutive refusals,
 * and this was not a refusal — somebody who sends feedback once should not be closer to being
 * silenced forever than somebody who never engaged at all.
 */
export const afterSent = (state: FeedbackState, now: number = Date.now()): FeedbackState =>
  ({ ...state, lastSentAt: now, lastAskedAt: now, dismissals: 0 });

/** One more session seen. Counted on mount, once per app load. */
export const afterSession = (state: FeedbackState): FeedbackState =>
  ({ ...state, sessions: num(state.sessions) + 1 });
