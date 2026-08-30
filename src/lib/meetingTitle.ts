/**
 * What a meeting is called.
 *
 * A recording has to be named the moment it starts, which is before anybody has said a word — so
 * the only honest name available at that point is the date, and three meetings on a busy Tuesday
 * all got the same one. The transcript is where the real name is: people usually say what a
 * meeting is ("this is the Q3 planning call", "aaj ka standup"), and when they don't, what they
 * spent the time discussing is still a better label than a timestamp the card already shows.
 *
 * Pure and import-free so scripts/self-check.mjs can assert it. The cleaner is the part that has to
 * hold: it takes a string straight out of a language model and puts it in the heading of somebody's
 * meeting, so "unusable" has to be a real answer rather than something that slips through.
 */

/** Long enough for a real name, short enough not to wreck a card or a list row. */
export const MAX_TITLE = 70;

/** The name a recording gets before anyone has spoken. Replaced later if the transcript names it. */
export function dateTitle(now: Date, timeZone: string): string {
  return `Meeting ${now.toLocaleDateString('en-GB', { timeZone })}`;
}

/**
 * A model's answer, made safe to display — or null, meaning keep the date.
 *
 * Null is the important return. A meeting called "Meeting" or "Untitled" is worse than one called
 * by its date: it looks like a name, so nobody thinks to fix it, and it carries less than the
 * timestamp it replaced.
 */
export function cleanMeetingTitle(raw: unknown): string | null {
  let title = String(raw ?? '').replace(/\s+/g, ' ').trim();

  // Models like to wrap a title in quotes and to finish it like a sentence.
  title = title.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  title = title.replace(/[.:;,]+$/, '').trim();

  // Anything this long is a summary that ignored the instruction, not a title — and truncating it
  // would produce a plausible-looking name for a meeting nobody can recognise.
  if (title.length < 3 || title.length > 200) return null;

  // The placeholders. Refusing these is the whole reason this returns null rather than a string.
  if (/^(meeting|meetings|untitled|untitled meeting|minutes|mom|discussion|general discussion|call|recording|transcript|no title|n\/?a)$/i.test(title)) {
    return null;
  }

  // A model asked not to use a date sometimes does anyway. Left alone that is the old behaviour
  // wearing a new coat.
  if (/^meeting\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/i.test(title)) return null;

  if (title.length > MAX_TITLE) {
    // Cut on a word so the ellipsis lands somewhere a person would have stopped.
    title = title.slice(0, MAX_TITLE).replace(/\s+\S*$/, '').trim() + '…';
  }
  return title;
}
