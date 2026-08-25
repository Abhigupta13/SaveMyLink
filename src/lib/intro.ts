/**
 * The getting-started checklist. Pure so scripts/self-check.mjs can assert it; the counts come
 * from src/actions/intro.ts. Steps 1–5 are agreed; 6–8 are candidates — deleting a line here
 * removes the step everywhere.
 *
 * `count` names the number that proves the step was done. Steps with no record of their own
 * (`manual`) are ticked by markIntro(id) from the place it happens.
 */
export const INTRO_STEPS = [
  { id: 'meeting', title: 'Record a meeting', why: 'Talk for an hour, get tasks with names and dates that remind themselves.', href: '/mom', count: 'meetings' },
  { id: 'link', title: 'Save a link', why: 'Anything worth coming back to, from any app, one tap.', href: '/links', count: 'links' },
  { id: 'note', title: 'Write a note', why: 'Thoughts, drafts, a photo of a whiteboard — searchable later.', href: '/notes', count: 'notes' },
  { id: 'group', title: 'Create a group and invite someone', why: 'A group is the only thing that shares. Everything else stays yours.', href: '/projects', count: 'groups' },
  { id: 'jarvis', title: 'Ask Jarvis something', why: 'Answers from your own saved things, by voice, in English or Hindi.', href: '/?jarvis=1', manual: true },
  { id: 'due', title: 'Give a task a due time and get chased', why: 'A day before, an hour before, at the deadline, then every morning until it is done.', href: '/tasks', count: 'dueTasks' },
  { id: 'safe', title: 'Put something in the Private Safe', why: 'Behind your PIN, out of the normal view.', href: '/links', count: 'privateLinks' },
  { id: 'android', title: 'Get the Android app', why: 'Share to it from any app, and reminders reach your phone.', href: '/download', manual: true },
] as const;

export type IntroStepId = (typeof INTRO_STEPS)[number]['id'];
export type IntroCounts = Partial<Record<'meetings' | 'links' | 'notes' | 'groups' | 'dueTasks' | 'privateLinks', number>>;

export function introProgress(counts: IntroCounts, done: readonly string[] | null | undefined) {
  const did = new Set(done || []);
  const steps = INTRO_STEPS.map(s => ({
    ...s,
    done: did.has(s.id) || ('count' in s && (counts[s.count] || 0) > 0),
  }));
  return { steps, remaining: steps.filter(s => !s.done).length };
}

export function isIntroStep(id: unknown): id is IntroStepId {
  return INTRO_STEPS.some(s => s.id === id);
}
