import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canWorkOn, canSignOff, whyCannotWorkOn, needsOwner, assigneeEmailsOf } from '@/lib/taskAccess';

/**
 * WHO MAY TICK A TASK OFF — every combination, and what the person is told when refused.
 *
 * Why this file exists. "I'm not able to mark them complete" was reported on a task sitting on
 * screen, and canWorkOn was NOT wrong: it has ~20 assertions in scripts/self-check.mjs and every
 * one passes. The rule was right and the app was still broken, in the two layers either side of it:
 *
 *   1. The SERVER answered 'Task not found' about a row the person could see, because it reused
 *      the vague message meant for probing strangers.
 *   2. The CLIENT threw that string away and silently re-ticked the box, so nothing was shown at
 *      all — indistinguishable from a broken checkbox.
 *
 * Neither is reachable by testing canWorkOn, which is why a green suite sat over a real bug. The
 * gap was never "is the predicate right" but "what does a refused person end up seeing". So this
 * covers the truth table AND the message, and the two source-greps at the bottom hold the wiring
 * that unit tests structurally cannot.
 */

const ME = 'u-me', OTHER = 'u-them', THIRD = 'u-third';
const MY_EMAIL = 'me@x.com', THEIR_EMAIL = 'them@x.com';

/** Every axis that feeds canWorkOn, so a case reads as a row of a table. */
const task = (o: Partial<{
  projectId: string | null; userId: string; assigneeId: string | null;
  assigneeIds: string[]; assigneeEmail: string | null; assigneeEmails: string[]; completed: boolean;
}> = {}) => ({ projectId: 'p1', userId: OTHER, ...o });

describe('canWorkOn — the whole truth table', () => {
  /* Each row: who you are relative to the task, whether you own the group, and the answer.
     Written as data rather than as prose so a missing combination is visible as a missing row. */
  /* Typed against canWorkOn's own parameter rather than the local helper's return, so a row can
     legitimately omit projectId — "no project id at all" is one of the cases under test. */
  const rows: [string, Parameters<typeof canWorkOn>[0], boolean, boolean][] = [
    // description                              task                                                 isOwner  may tick
    ['creator, not assignee, not owner',        task({ userId: ME }),                                false,   true],
    ['creator AND owner',                       task({ userId: ME }),                                true,    true],
    ['assignee by id',                          task({ assigneeId: ME }),                            false,   true],
    ['co-assignee by id',                       task({ assigneeIds: [OTHER, ME] }),                  false,   true],
    ['assignee by email, never claimed',        task({ assigneeEmail: MY_EMAIL }),                   false,   true],
    ['co-assignee by email, never claimed',     task({ assigneeEmails: [THEIR_EMAIL, MY_EMAIL] }),   false,   true],
    ['owner, neither creator nor assignee',     task({ assigneeId: OTHER }),                         true,    true],

    // The refusals. These are the rows the bug report lived in.
    ['member: assigned to someone else',        task({ assigneeId: OTHER }),                         false,   false],
    ['member: assigned to nobody at all',       task(),                                              false,   false],
    ['member: assigned to a third party',       task({ assigneeIds: [OTHER, THIRD] }),               false,   false],
    ['stranger to the task, by email',          task({ assigneeEmail: THEIR_EMAIL }),                false,   false],

    // Owner rights exist only inside a group — a personal task has no owner to inherit them.
    ['owner flag on a PERSONAL task',           task({ projectId: null, assigneeId: OTHER }),        true,    false],
    ['owner flag, no project id at all',        { userId: OTHER, assigneeId: OTHER },                true,    false],
  ];

  for (const [label, t, isOwner, expected] of rows) {
    test(`${expected ? 'may' : 'may NOT'} tick — ${label}`, () => {
      expect(canWorkOn(t, ME, MY_EMAIL, isOwner)).toBe(expected);
    });
  }

  test('a blank identity matches a blank field rather than opening the gate', () => {
    expect(canWorkOn(task({ assigneeEmail: '' }), ME, '', false)).toBe(false);
    expect(canWorkOn(task({ assigneeEmails: [] }), ME, '', false)).toBe(false);
    expect(canWorkOn(task({ assigneeIds: [] }), ME, MY_EMAIL, false)).toBe(false);
  });

  test('email matching is case-insensitive, because addresses are', () => {
    expect(canWorkOn(task({ assigneeEmail: 'ME@X.COM' }), ME, 'me@x.com', false)).toBe(true);
    expect(canWorkOn(task({ assigneeEmails: ['Me@X.Com'] }), ME, 'me@x.com', false)).toBe(true);
  });

  /* A populated {_id,email} and a raw id are the same person. Naive String() gives
     '[object Object]' for BOTH, which would open the gate for the wrong one. */
  test('a populated assignee is the same person as their raw id', () => {
    expect(canWorkOn(task({ assigneeId: { _id: ME, email: MY_EMAIL } as never }), ME, 'zz@x.com', false)).toBe(true);
    expect(canWorkOn(task({ assigneeId: { _id: OTHER, email: THEIR_EMAIL } as never }), ME, 'zz@x.com', false)).toBe(false);
  });
});

describe('whyCannotWorkOn — what the refused person is told', () => {
  /* The half no predicate test could reach: the string. It replaced 'Task not found', which was
     said about a task the person was looking at. */
  test('never says "not found" about something on their screen', () => {
    for (const t of [task(), task({ assigneeId: OTHER }), task({ assigneeEmail: THEIR_EMAIL })]) {
      expect(whyCannotWorkOn(t).toLowerCase()).not.toContain('not found');
    }
  });

  test('someone else holds it — says who may act, so the reader knows who to ask', () => {
    const said = whyCannotWorkOn(task({ assigneeEmail: THEIR_EMAIL }));
    expect(said).toMatch(/assigned to/i);
    expect(said).toMatch(/owner/i);
  });

  /* Distinct on purpose: "nobody is on this" is not a permission to argue with, it is a task
     waiting to be picked up, and the action the reader needs is different. */
  test('nobody holds it — says to assign it, not that they lack permission', () => {
    const said = whyCannotWorkOn(task());
    expect(said).toMatch(/assign/i);
    expect(said).not.toMatch(/owner/i);
  });

  test('the two cases never produce the same sentence', () => {
    expect(whyCannotWorkOn(task())).not.toBe(whyCannotWorkOn(task({ assigneeEmail: THEIR_EMAIL })));
  });

  test('every refusal says something, whatever shape the row is in', () => {
    for (const t of [task(), task({ assigneeEmails: [] }), task({ assigneeEmail: null }), { userId: OTHER }]) {
      expect(whyCannotWorkOn(t).trim().length).toBeGreaterThan(10);
    }
  });

  /* The message is chosen by whether anyone is assigned, so it has to agree with the function that
     answers that — or an assigned task could be told to assign itself. */
  test('the branch agrees with assigneeEmailsOf', () => {
    for (const t of [task(), task({ assigneeEmail: THEIR_EMAIL }), task({ assigneeEmails: [THEIR_EMAIL, MY_EMAIL] })]) {
      const assigned = assigneeEmailsOf(t).length > 0;
      expect(/assigned to/i.test(whyCannotWorkOn(t))).toBe(assigned);
    }
  });
});

describe('canSignOff stays the owner’s act, not the assignee’s', () => {
  test('owner signs off finished group work only', () => {
    expect(canSignOff({ projectId: 'p1', userId: OTHER, completed: true }, true)).toBe(true);
    expect(canSignOff({ projectId: 'p1', userId: OTHER, completed: false }, true)).toBe(false);
    expect(canSignOff({ projectId: 'p1', userId: OTHER, completed: true }, false)).toBe(false);
    expect(canSignOff({ userId: OTHER, completed: true }, true)).toBe(false);
  });
});

describe('needsOwner — the band an unassigned task falls into', () => {
  const MEMBERS = ['me@x.com', 'them@x.com'];
  test('open work nobody in the group holds', () => {
    expect(needsOwner(task(), MEMBERS)).toBe(true);
    expect(needsOwner(task({ assigneeEmail: 'gone@x.com' }), MEMBERS)).toBe(true);
    expect(needsOwner(task({ assigneeEmail: THEIR_EMAIL }), MEMBERS)).toBe(false);
    expect(needsOwner(task({ assigneeEmail: 'gone@x.com', completed: true }), MEMBERS)).toBe(false);
  });
});

/**
 * The two layers a pure test cannot reach, held by reading the source. This is the actual gap the
 * bug fell through, so it is the part most worth pinning: a rule can be perfect and the person can
 * still be shown nothing.
 */
describe('the refusal actually reaches the user', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

  test('the server sends the reason, not the vague "not found"', () => {
    const src = read('src', 'actions', 'task.ts');
    const gates = src.match(/if \(!canWorkOn\([^)]*\)\) \{\s*return \{ success: false, error: ([^}]+)\}/g) || [];
    expect(gates.length).toBeGreaterThanOrEqual(2);   // toggleTask and updateTask
    for (const g of gates) expect(g).toContain('whyCannotWorkOn');
  });

  /* The bug exactly: an optimistic tick, a refusal, a refetch that puts the box back — and the
     error string dropped. Both task screens have to SAY something on that path. */
  for (const [label, ...p] of [
    ['the tasks page', 'src', 'app', 'tasks', 'page.tsx'],
    ['the project workspace', 'src', 'app', 'projects', '[id]', 'page.tsx'],
  ] as [string, ...string[]][]) {
    test(`${label} tells the user when a toggle is refused`, () => {
      const src = read(...p);
      const handler = src.slice(src.indexOf('const handleToggle'), src.indexOf('const handleToggle') + 700);
      expect(handler).toContain('toggleTask');
      expect(handler).toMatch(/toast\(/);
    });
  }
});
