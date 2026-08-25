/**
 * Who may tick a task off, who may sign it off, and which tasks nobody is holding.
 *
 * RACI, which every project tool encodes: *Responsible* does the work and ticks their own box;
 * *Accountable* approves and answers for the outcome. Two people, two acts — which is why
 * completion and sign-off are two states here and not one locked checkbox.
 *
 * Mongoose-free on purpose, exactly like scope.ts, so scripts/self-check.mjs can assert these
 * without a database. The rules are worth a test: the completion gate is what stops a stranger
 * closing your work, and needsOwner is the whole point of the "Needs an owner" band.
 */

type Id = unknown;

/**
 * The one genuinely dangerous line in this file. `assigneeId` arrives as a raw ObjectId from
 * findById and as a populated `{ _id, email, name }` from `.populate('assigneeId')`. Naive
 * String() on the populated shape gives '[object Object]' — so two *different* people would
 * compare equal and the gate would open for the wrong one.
 */
const idOf = (v: Id): string => {
  if (!v) return '';
  if (typeof v === 'object') {
    const inner = (v as { _id?: unknown })._id;
    return inner ? String(inner) : '';
  }
  return String(v);
};

const same = (a: Id, b: Id) => {
  const x = idOf(a), y = idOf(b);
  return !!x && x === y;
};

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

export interface TaskLike {
  userId?: Id;
  assigneeId?: Id;
  assigneeEmail?: string | null;
  projectId?: Id;
  completed?: boolean;
}

/**
 * The address a task is currently pointed at. `assigneeId` is populated to `{ email }` on every
 * read path, and `assigneeEmail` is what survives when the person has no account yet — the app
 * spells this `t.assigneeId?.email || t.assigneeEmail` in five places already. Once, here.
 */
export function assigneeEmailOf(task: TaskLike): string {
  const populated = task.assigneeId as { email?: string | null } | null | undefined;
  const fromId = populated && typeof populated === 'object' ? lower(populated.email) : '';
  return fromId || lower(task.assigneeEmail);
}

/**
 * Four ways in, each for a reason:
 *  - you wrote the task down;
 *  - you are the assignee (RACI Responsible — you tick your own work);
 *  - your email is on it but nothing has claimed it yet. A task assigned to someone who has not
 *    signed up has no assigneeId at all, and without this branch the assignee cannot tick their
 *    own task until some unrelated read happens to claim it;
 *  - you own the group it lives in. Today an owner who is neither creator nor assignee is locked
 *    out of a task in their own project, which is the bug this round exists to fix.
 *
 * `isOwner` is answered by the caller (amProjectOwner) — this stays pure.
 */
export function canComplete(task: TaskLike, myUserId: Id, myEmail: string | null | undefined, isOwner: boolean): boolean {
  if (same(task.userId, myUserId)) return true;
  if (same(task.assigneeId, myUserId)) return true;
  const assigned = lower(task.assigneeEmail);
  if (assigned && assigned === lower(myEmail)) return true;
  return !!task.projectId && isOwner;
}

/**
 * Sign-off is the Accountable half, and it only exists inside a group: a personal task has no
 * owner and no second party, so there is nobody for the stamp to mean anything to.
 *
 * It also requires the work to actually be done. Approving unfinished work is the one state that
 * makes the admin funnel lie — "signed off" would stop being a subset of "completed" and the
 * meeting-to-task number, the most important fact about this product, would overcount.
 */
export function canSignOff(task: TaskLike, isOwner: boolean): boolean {
  return !!task.projectId && !!task.completed && isOwner;
}

/**
 * A task nobody is holding: open, and either never assigned or assigned to someone who is no
 * longer in the group.
 *
 * Both cases deliberately. Rows orphaned by the old $unset-on-removal behaviour, and meeting
 * tasks the extractor could not attribute to anyone, are exactly the work that gets dropped —
 * and hiding them because they predate the fix is how the band would launch already lying.
 */
export function needsOwner(task: TaskLike, memberEmails: (string | null | undefined)[]): boolean {
  if (task.completed) return false;
  const assigned = assigneeEmailOf(task);
  if (!assigned) return true;
  return !memberEmails.some(e => lower(e) === assigned);
}
