/**
 * Help Jarvis retrieval and intent parsing when the user types or dictates imperfectly.
 * The LLM system prompt carries the main interpretation; this adds search tokens locally.
 */

const EXPANSIONS: [RegExp, string][] = [
  [/\b(expnse|expence|expenss|expenes|expnes|speding|spnding|spennding)\b/i, 'expense expenses spending spent'],
  [/\b(tsk|taks|takss|toodoo|todoo)\b/i, 'task tasks todo'],
  [/\b(meting|meating|meetng|meting)\b/i, 'meeting meetings mom minutes'],
  [/\b(notess|noets|ntoes)\b/i, 'note notes'],
  [/\b(projct|projet|porject)\b/i, 'project projects'],
  [/\b(contct|contat|conatct)\b/i, 'contact contacts'],
  [/\b(documnt|documet|documets)\b/i, 'document documents file files'],
  [/\b(tomoro|tommorrow|tommorow|tmrw|tomm)\b/i, 'tomorrow'],
  [/\b(today|tday|todai|aaj)\b/i, 'today'],
  [/\b(yestarday|yesturday|yday)\b/i, 'yesterday'],
  [/\b(remind|reminder|remindr)\b/i, 'remind reminder due'],
  [/\b(assgn|assigne|asign)\b/i, 'assign assigned assignee'],
  [/\b(bokmark|bokmrk|bookmrk)\b/i, 'bookmark link save'],
  [/\b(wats|wat|whats|wht)\b/i, 'what'],
  [/\b(how much|howmany|hw much)\b/i, 'how much total sum'],
];

/** Duplicate hint terms onto the query string for retrieval / typeHints — original text unchanged for the model. */
export function expandJarvisQuery(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;
  const seen = new Set<string>();
  let extra = '';
  for (const [re, words] of EXPANSIONS) {
    if (!re.test(raw)) continue;
    for (const w of words.split(/\s+/)) {
      if (!seen.has(w)) {
        seen.add(w);
        extra += ` ${w}`;
      }
    }
  }
  return extra ? `${raw}${extra}` : raw;
}
