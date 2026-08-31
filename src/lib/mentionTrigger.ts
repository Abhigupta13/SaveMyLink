/**
 * The `@` autocomplete, made safe for a textarea somebody types in the MIDDLE of.
 *
 * Project chat has this already (`detectTrigger`/`keepTrigger` in app/projects/[id]/page.tsx), and
 * it is correct there for a reason that does not survive the move: chat's composer is a single-line
 * <input>, so its query is allowed to run to the end of the string and a pick always replaces a
 * suffix. Notes are a multi-line <textarea>. Put that same code behind one and it breaks the moment
 * anybody goes back to add a sentence:
 *
 *   · the "current token" is `value.lastIndexOf(' ')`, which is the last token in the WHOLE note,
 *     not the one under the cursor;
 *   · the query runs to end-of-string, so typing `@sun` halfway up a note searches for
 *     "sun" plus every remaining paragraph;
 *   · a pick would replace everything from the `@` to the end of the note — deleting the rest of
 *     what the person wrote.
 *
 * So everything here is anchored on the caret instead, and lives in lib/ where it can be proven
 * without a browser. Newlines count as boundaries as well as spaces: in a textarea a token at the
 * start of a line is the common case, and treating only spaces as separators makes the first word
 * of every line invisible to the picker.
 */

export interface MentionTrigger {
  /** Index of the `@`. */
  tokenStart: number;
  /** Index just after the `@`, where the query begins. */
  queryStart: number;
}

/** Past this the person is writing prose, not still choosing from a list. */
export const MAX_QUERY = 40;

const BOUNDARY = /\s/;

/**
 * Is there an open `@` immediately before the caret?
 *
 * The token is read backwards from the caret to the nearest whitespace or the start of the note, so
 * only the word actually being typed can open a picker.
 *
 * Returns null for an `@` that is part of a word — `abhi@example.com` must stay an email address,
 * not a half-open mention. That is decided by what precedes the `@`, which has to be whitespace or
 * nothing at all.
 */
export function detectMention(value: string, caret: number): MentionTrigger | null {
  if (typeof value !== 'string') return null;
  const at = Math.max(0, Math.min(Number(caret) || 0, value.length));

  // Walk back from the caret to the boundary that starts this token.
  let start = at;
  while (start > 0 && !BOUNDARY.test(value[start - 1])) start--;

  if (value[start] !== '@') return null;
  // An `@` that is glued to the end of a previous word is an address, not a mention.
  if (start > 0 && !BOUNDARY.test(value[start - 1])) return null;
  if (at - (start + 1) > MAX_QUERY) return null;

  return { tokenStart: start, queryStart: start + 1 };
}

/**
 * Keep an open picker open while the query grows — including across a space, because attachment
 * names have spaces in them and closing on the first one would make half of them unreachable.
 *
 * Closes when the `@` itself is edited away, when the caret moves back behind it (the person went
 * to fix something earlier), or when the query is long enough to be prose.
 */
export function keepMention(open: MentionTrigger | null, value: string, caret: number): MentionTrigger | null {
  if (!open) return null;
  if (typeof value !== 'string') return null;
  const at = Math.max(0, Math.min(Number(caret) || 0, value.length));

  if (value[open.tokenStart] !== '@') return null;   // the trigger was deleted or overwritten
  if (at < open.queryStart) return null;             // caret moved off the front of it
  if (at - open.queryStart > MAX_QUERY) return null;

  /* A newline ends it outright. Spaces are tolerated so multi-word names stay searchable, but
     somebody who pressed Enter has moved on to the next line and is no longer choosing. */
  if (value.slice(open.queryStart, at).includes('\n')) return null;

  return open;
}

/** What has been typed after the `@`, bounded by the caret rather than by the end of the note. */
export function queryOf(value: string, open: MentionTrigger, caret: number): string {
  const at = Math.max(0, Math.min(Number(caret) || 0, value.length));
  return value.slice(open.queryStart, Math.max(open.queryStart, at)).trim().toLowerCase();
}

/**
 * Replace the `@query` under the caret with `@label `, leaving everything after the caret alone.
 *
 * Returns the new caret so the caller can restore it — a textarea whose value is replaced puts the
 * cursor at the end by default, which in a long note throws the writer to the bottom of the page
 * mid-sentence.
 */
export function insertMention(
  value: string, open: MentionTrigger, caret: number, label: string,
): { value: string; caret: number } {
  const at = Math.max(0, Math.min(Number(caret) || 0, value.length));
  const token = `@${label} `;
  const next = value.slice(0, open.tokenStart) + token + value.slice(at);
  return { value: next, caret: open.tokenStart + token.length };
}

/**
 * Every `@label` in a note that matches something real, in the order they appear.
 *
 * Read-time only, and matched against the labels actually stored on the note — so a bare `@` a
 * person typed themselves stays plain text, exactly as chat's renderBody does it. Longest labels
 * first, or `@photo` would match inside `@photo of the gate` and cut the name in half.
 */
export function mentionsIn(value: string, labels: string[]): string[] {
  if (typeof value !== 'string' || !labels.length) return [];
  const ordered = [...new Set(labels.filter(Boolean))].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '@') {
      const hit = ordered.find(l => value.startsWith(l, i + 1));
      if (hit) { found.push(hit); i += hit.length + 1; continue; }
    }
    i++;
  }
  return found;
}
