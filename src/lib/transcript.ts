/**
 * Joining the pieces a speech engine hands back into the sentence somebody actually said.
 *
 * Two engines behave differently and the code has to work on both.
 *
 * Chrome splits an utterance into DISJOINT results: ["do you have", "any contact"]. Those want
 * joining with a space.
 *
 * Android's WebView emits CUMULATIVE results, each a longer prefix of the same utterance:
 * ["I am", "I am checking", "I am checking if", "I am checking if the bike"]. Joining those
 * produces the ladder that was reported:
 *
 *   I am I am I am checking I am checking if I am checking if the I am checking if the bike ...
 *
 * The same shape appears a second time one level up: sessions are short-lived, so onend banks what
 * a finished session finalised and the next session's results are merged onto it — and a WebView
 * keeps its results list across that restart, so the new session's finals already contain the bank.
 *
 * One rule covers both, at both levels: if one side already starts with the other, it IS the whole
 * thing. Otherwise they are different pieces and get joined.
 *
 * Deliberately idempotent — mergeFinals(a, mergeFinals(a, b)) === mergeFinals(a, b) — because
 * onresult fires many times per session and recomputes from the whole list each time, so this gets
 * applied to its own output constantly.
 *
 * The one thing it gets wrong: saying "I am checking" and then "I am checking again" in a single
 * breath collapses to the second. That is a real loss, and it is the right trade — an engine that
 * repeats prefixes makes dictation unusable, while a person immediately restating their own words
 * verbatim is rare and still leaves the longer, more complete version standing.
 */
export function mergeFinals(a: string, b: string): string {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  // A cumulative engine, or a replay of an index already seen: one side is the whole thing.
  if (right.startsWith(left)) return right;
  if (left.startsWith(right)) return left;
  return `${left} ${right}`;
}

/**
 * Fold a whole SpeechRecognitionResultList down to one string, applying the rule above pairwise.
 *
 * Taking transcripts rather than the result objects so this stays pure and testable — the browser
 * type is a live, index-addressed object that is awkward to fake and pointless to mock.
 */
export function joinTranscripts(parts: readonly string[]): string {
  return parts.reduce((acc, part) => mergeFinals(acc, part), '');
}
