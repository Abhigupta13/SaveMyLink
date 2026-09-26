/**
 * Which of the user's saved things actually go into Jarvis's prompt.
 *
 * Until now every link, note, task, project, meeting, contact and document went up on every turn
 * and a character budget lopped off whatever did not fit. That is a dump, not retrieval: the
 * budget cut by *position* once it was exceeded, so a long document could crowd out the one task
 * the question was about, and the prompt grew with the vault until it stopped being affordable.
 *
 * This scores candidates against the question locally — no second AI call, no embeddings, no new
 * dependency — and the caller sends only the top few dozen lines.
 *
 * Pure and import-free on purpose: scripts/self-check.mjs runs it under plain node, which cannot
 * resolve `@/`. It also means it knows nothing about mongoose, sessions or scope. **Scope is the
 * caller's job** — retrieval can only ever return items from the array it was handed, so if
 * myProjectFilter never fetched it, nothing here can surface it.
 */

export type CandidateType = 'link' | 'note' | 'task' | 'project' | 'mom' | 'contact' | 'document' | 'expense';

export interface Candidate {
  id: string;
  type: CandidateType;
  title: string;
  /** Everything else worth matching on: tags, description, summary, attachment text, emails. */
  body?: string;
  /** When it was last touched, in ms. Recency settles ties; it never wins on its own. */
  at?: number;
  /** An open task already past its due time — the thing "what's urgent" is asking for. */
  overdue?: boolean;
  /** The prompt line the caller already built. Retrieval only picks; it never formats. */
  line: string;
  /** Shorter line for lower-ranked hits — saves tokens when many items match. */
  shortLine?: string;
}

/** Words that appear in every question and so tell us nothing about which item is meant. */
const STOP = new Set(
  ('a an and any are as at be been but by can could did do does for from get give got had has have her him his how i if in into is it its'
    + ' just know me my need of on or our out say see she so some tell that the their them then there these they this to up us was we were'
    + ' what when where which who whom why will with would you your mujhe mera meri kya hai ho kar ka ke ki ko se par bhi na hi')
    .split(' ')
);

/** Latin, digits and Devanagari — a Hindi question must match a Hindi note. */
const WORD = /[a-z0-9ऀ-ॿ]{2,}/g;

export function terms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(WORD) || []).filter(t => !STOP.has(t)))];
}

/**
 * "urgent", "due", "kal" — the question is about deadlines, so an overdue task deserves to be in
 * the prompt even though it shares no words with the question at all.
 */
const URGENT_ASK = /\b(urgent|urgently|overdue|due|deadline|today|tonight|tomorrow|now|late|pending|soon|aaj|kal|abhi)\b/;

/**
 * A question usually says what KIND of thing it is about. Enough of a nudge to pull the right
 * type into the top forty, never enough to beat a line that actually contains the answer.
 */
const TYPE_HINTS: [RegExp, CandidateType[]][] = [
  [/\b(task|tasks|tsk|taks|todo|to-do|due|deadline|urgent|overdue|assigned|assign|pending|finish|complete|kaam)\b/, ['task']],
  [/\b(link|links|site|website|url|bookmark|bokmark|page|video|article|saved)\b/, ['link']],
  [/\b(meeting|meetings|meting|mom|minutes|call|discussed|decided|standup|sync|baithak)\b/, ['mom']],
  [/\b(note|notes|notess|wrote|jotted|noted)\b/, ['note']],
  [/\b(contact|contacts|contct|phone|number|whatsapp|address|reach|call|email)\b/, ['contact']],
  [/\b(doc|docs|document|documents|documnt|file|files|pdf|invoice|contract|receipt|locker)\b/, ['document']],
  [/\b(project|projects|projct|group|groups|team|client)\b/, ['project']],
  [/\b(expense|expenses|expnse|expenss|spending|spent|cost|price|bought|buy|purchase|payment|bill|money|invested|investment|wasted|rupees|inr|kharcha)\b/, ['expense']],
];
const TYPE_BOOST = 1.2;

export function typeHints(question: string): Set<CandidateType> {
  const q = question.toLowerCase();
  const out = new Set<CandidateType>();
  for (const [re, types] of TYPE_HINTS) if (re.test(q)) for (const t of types) out.add(t);
  return out;
}

/** Smoothed inverse document frequency — common vault words weigh less than rare names. */
const idfWeight = (df: number, n: number) => {
  if (!n || !df) return 1;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5)) + 1;
};

const TITLE_HIT = 3;
const BODY_HIT = 1;
const EXACT_TITLE = 10;   // the user named the thing — it is the answer, not a candidate
const OVERDUE_BOOST = 2.5;
const DATE_MATCH_BOOST = 12;
const DATE_MISMATCH_PENALTY = -8;
const MAX_RECENCY = 0.5;  // strictly below one common-word title hit, so it only ever breaks ties
const HALF_LIFE_DAYS = 30;

const recency = (at: number | undefined, now: number) =>
  !at ? 0 : MAX_RECENCY / (1 + Math.max(0, now - at) / (HALF_LIFE_DAYS * 86_400_000));

export interface DateWindow {
  start: number;
  end: number;
}

export function inDateWindow(at: number | undefined, w: DateWindow | null | undefined): boolean {
  if (!w || at == null) return false;
  return at >= w.start && at < w.end;
}

export function scoreCandidate(
  c: Candidate,
  ts: string[],
  df: Map<string, number>,
  n: number,
  hints: Set<CandidateType>,
  urgentAsk: boolean,
  qNorm: string,
  now: number,
  dateWindow: DateWindow | null | undefined,
  narrowDateType: boolean,
): number {
  const title = (c.title || '').toLowerCase();
  const body = (c.body || '').toLowerCase();
  let score = 0;
  for (const t of ts) {
    const w = idfWeight(df.get(t) || 0, n);
    if (title.includes(t)) score += TITLE_HIT * w;
    else if (body.includes(t)) score += BODY_HIT * w;
  }
  // "tell me about the block tray elevator" naming a saved title exactly
  if (title.length > 2 && qNorm.includes(title)) score += EXACT_TITLE;
  // Deliberately NOT conditional on a word match: "what is urgent today" and "whose number do I
  // have" share no words with the item that answers them, and those are the questions people
  // actually ask. A rare word in a title still scores 3, so a real match outranks the nudge.
  if (hints.has(c.type)) score += TYPE_BOOST;
  if (urgentAsk && c.overdue) score += OVERDUE_BOOST;

  if (dateWindow) {
    const inWin = inDateWindow(c.at, dateWindow);
    const dateTypes: CandidateType[] = ['expense', 'task', 'mom'];
    if (dateTypes.includes(c.type)) {
      if (inWin) score += DATE_MATCH_BOOST;
      else if (narrowDateType && hints.has(c.type) && hints.size === 1) score += DATE_MISMATCH_PENALTY;
      else if (!inWin && hints.has(c.type)) score += DATE_MISMATCH_PENALTY * 0.35;
    }
  }

  return score + recency(c.at, now);
}

export interface RetrieveOptions {
  /** How many lines the prompt gets. Forty is roughly what a person would hand you. */
  limit?: number;
  /** Hard ceiling in characters — one 4,000-character PDF must not eat the whole budget. */
  maxChars?: number;
  now?: number;
  /** Ids the conversation already referred to; they stay in the prompt so "that one" resolves. */
  pinned?: Iterable<string>;
  dateWindow?: DateWindow | null;
  /** When true with a single type hint + dateWindow, off-window typed rows are dropped unless pinned. */
  narrowDateType?: boolean;
  /** Full `line` for the first N picks; after that `shortLine` when present. */
  compactAfter?: number;
}

export const MAX_LINES = 40;
export const MAX_CONTEXT_CHARS = 24000;

/** Line text for the LLM prompt — may use shortLine for lower-ranked hits. */
export function promptLineFor(c: Candidate, rankIndex: number, compactAfter = 8): string {
  if (rankIndex < compactAfter) return c.line;
  return c.shortLine || c.line;
}

/** Drop near-duplicate titles so one question does not send fifteen similar expense rows. */
function mmrPick(
  ranked: { c: Candidate; i: number; score: number }[],
  limit: number,
  maxChars: number,
  compactAfter: number,
  pinned: Set<string>,
): Candidate[] {
  const kept: { c: Candidate; i: number; score: number }[] = [];
  const pickedTitles = new Set<string>();
  let chars = 0;

  for (const r of ranked) {
    if (kept.length >= limit) break;
    const titleKey = (r.c.title || '').toLowerCase().slice(0, 48);
    if (
      kept.length >= 3
      && !pinned.has(r.c.id)
      && titleKey.length > 2
      && pickedTitles.has(titleKey)
      && r.score < 1e5
    ) continue;

    const line = promptLineFor(r.c, kept.length, compactAfter);
    if (chars + line.length > maxChars) continue;
    kept.push(r);
    chars += line.length + 1;
    if (titleKey) pickedTitles.add(titleKey);
  }

  kept.sort((a, b) => a.i - b.i);
  return kept.map(r => r.c);
}

/**
 * The top `limit` candidates for this question, in the order they were given (so the prompt still
 * reads as sections rather than a ranking). Returns members of `candidates` and nothing else.
 */
export function retrieve(candidates: Candidate[], question: string, opts: RetrieveOptions = {}): Candidate[] {
  const limit = opts.limit ?? MAX_LINES;
  const maxChars = opts.maxChars ?? MAX_CONTEXT_CHARS;
  const now = opts.now ?? Date.now();
  const pinned = new Set(opts.pinned || []);
  const dateWindow = opts.dateWindow ?? null;
  const narrowDateType = opts.narrowDateType ?? false;
  const compactAfter = opts.compactAfter ?? 8;
  if (!candidates.length) return [];

  const ts = terms(question);
  const qNorm = question.toLowerCase();
  const hints = typeHints(question);
  const urgentAsk = URGENT_ASK.test(qNorm);

  let pool = candidates;
  if (dateWindow && narrowDateType && hints.size === 1) {
    const only = [...hints][0];
    pool = candidates.filter(c =>
      pinned.has(c.id)
      || c.type !== only
      || inDateWindow(c.at, dateWindow)
      || (c.title && qNorm.includes(c.title.toLowerCase())),
    );
    if (!pool.length) pool = candidates;
  }

  const df = new Map<string, number>();
  for (const c of pool) {
    const hay = `${c.title || ''} ${c.body || ''}`.toLowerCase();
    for (const t of ts) if (hay.includes(t)) df.set(t, (df.get(t) || 0) + 1);
  }

  const ranked = pool
    .map((c, i) => ({
      c, i,
      // A pinned item was cited in the answer the user is following up on. It goes in whatever it
      // scores, or "add that one to my tasks" has nothing to point at.
      score: pinned.has(c.id) ? 1e6 : scoreCandidate(
        c, ts, df, pool.length, hints, urgentAsk, qNorm, now, dateWindow, narrowDateType,
      ),
    }))
    .sort((a, b) => b.score - a.score || (b.c.at || 0) - (a.c.at || 0) || a.i - b.i);

  return mmrPick(ranked, limit, maxChars, compactAfter, pinned);
}
