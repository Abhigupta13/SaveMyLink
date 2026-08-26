/**
 * The three Jarvis powers that are not "answer from your data": save a link, open a page, and
 * explain how the app itself works.
 *
 * The third one is the reason this file exists. A manual big enough to be useful is big enough to
 * be a waste on every turn that is not a how-to question — and inflating every prompt with it is
 * the exact opposite of the retrieval work that just landed. So it is loaded only when a cheap
 * local check says the question looks like a how-to. No AI call decides this; a regex does.
 *
 * Pure and import-free so scripts/self-check.mjs can run it under plain node.
 */

/**
 * "How do I…", "where is…", "kaise…", "can Jarvis…" — asking about the APP rather than about what
 * is in it. Deliberately tuned to be slightly generous: a false positive costs a few hundred
 * tokens on one turn, a false negative means the assistant cannot explain its own product.
 */
const HOW_TO = [
  /\bhow (do|can|would) (i|you|we)\b/,
  /\bhow (does|do) (this|the|it|jarvis|the app)\b/,
  /\bhow to\b/,
  /\bwhere (is|are|do|can) /,
  /\bwhat (is|are) (this|the) (app|page|section|feature)/,
  /\b(can|could) (i|you|jarvis|this app|the app)\b.*\?/,
  /\b(explain|show me how|teach me|walk me through|guide)\b/,
  /\b(kaise|kaha|kahan)\b/,                       // Hinglish: how / where
  // No \b here: JavaScript word boundaries are ASCII-only, so \bकहाँ\b never matches anything.
  /कैसे|कहाँ|कहां|कैसा/,                              // Devanagari: how / where
  /\b(what can you do|who are you|what do you do)\b/,
];

export function isHowTo(question: string): boolean {
  const q = (question || '').toLowerCase();
  return HOW_TO.some(re => re.test(q));
}

/** Pages the assistant may open that are not sections in lib/nav. */
export const EXTRA_PAGES: { href: string; title: string; what: string }[] = [
  { href: '/', title: 'Home', what: 'the grid of every section, and the getting-started checklist' },
  { href: '/search', title: 'Search', what: 'search across everything saved' },
  { href: '/profile', title: 'Profile', what: 'account, theme, Private Safe, the Sarvam key, share the app, delete the account' },
  { href: '/your-data', title: 'Who can see my data', what: 'every group and exactly what has been shared into it' },
  { href: '/download', title: 'Download the app', what: 'the Android APK, the QR code and the install warnings' },
  { href: '/terms', title: 'Terms', what: 'what is stored and who can read it' },
];

/**
 * How the app works, in the assistant's own voice. Kept short on purpose: this is what a person
 * wants said out loud, not a documentation site. The per-section "why" comes from lib/nav's hints,
 * which the empty states already show — so there is exactly one copy of that text.
 */
export const HOW_IT_WORKS = `HOW THE APP WORKS (the user is asking about the app itself, so answer from this):
- Sharing: a PROJECT (a "group") is the only thing that shares. Anything filed under a group — tasks, notes, meetings, documents — is visible to everyone in it. Links are the exception: a link is always private and is never shared. Personal items have no group. "Who can see my data" (/your-data) shows all of it.
- Groups: whoever creates one is an owner and can add more owners. Members create and edit; a view-only person can read but change nothing. Only the creator can delete a group.
- Tasks: give one a due time and the phone chases it — a day before, an hour before, at the deadline, then every morning until it is done. The person assigned ticks it off; an owner signs it off.
- MOM: record a meeting, the app transcribes it, writes the summary, pulls out the action items and offers them as tasks to confirm. Hindi and Hinglish work.
- Private Safe: a PIN hides private links. It is a lock on the screen, not encryption — say so if asked.
- Jarvis (you): you answer from what the user has saved, you can create and change tasks, notes, contacts and projects, you can save a link, and you can open a page. You cannot delete anything.
- Android: install from /download. The share sheet saves a link into the vault from any app.`;
