import { Types } from 'mongoose';
import Task from '@/lib/models/Task';
import { User } from '@/lib/models/User';
import { assigneesAfterLeaving } from '@/lib/taskAccess';
import { recordEvent } from '@/lib/models/Event';

/**
 * Leaving a group takes your claim on its work with you.
 *
 * Every way out of a group routes through here — an owner removing someone, the same thing asked
 * of Jarvis, and a person deleting their account — because the alternative is one path fixed and
 * three still leaking. Being an assignee is read access: `getMyOpenTasks`, `searchAll`, the Jarvis
 * context and the phone reminders all match on these fields, so a name left on a task after the
 * group dropped it keeps feeding that task's title and description to somebody outside the group.
 * Writes were already refused; the reads were not.
 *
 * What goes is only the claim. The task, its due date, its author and its history all stay with
 * the group — losing work because a person left is the failure this is careful not to trade for.
 *
 * `actorId` null records nothing, for account deletion: `Event.deleteMany({ actorId })` runs
 * moments later in the same erase, so the only trail we could write would be deleted behind us.
 *
 * Returns how many tasks changed hands, for the caller's own logging.
 */
export async function dropAssignee(
  projectId: Types.ObjectId | string | null | undefined,
  email: string,
  actorId: string | null,
): Promise<number> {
  const gone = String(email ?? '').trim().toLowerCase();
  if (!projectId || !gone) return 0;

  // The email is the claim and the id is only its resolution, but match on both: a stale
  // assigneeId whose email was rewritten would otherwise survive the removal and keep reading.
  const leaver = await User.findOne({ email: gone }).select('_id').lean<{ _id: Types.ObjectId } | null>();
  const held = await Task.find({
    projectId,
    $or: [
      { assigneeEmail: gone }, { assigneeEmails: gone },
      ...(leaver ? [{ assigneeId: leaver._id }, { assigneeIds: leaver._id }] : []),
    ],
  });
  if (!held.length) return 0;

  // One lookup for everyone still standing on any of these tasks. Same shape as the assignee
  // write in actions/task.ts: whoever has no account yet stays an email and claims their id on
  // their first read, so a promotion to primary works for an invitee who has not signed up.
  const staying = [...new Set(held.flatMap(t => assigneesAfterLeaving(t, gone)))];
  const users = staying.length
    ? await User.find({ email: { $in: staying } }).select('_id email').lean<{ _id: Types.ObjectId; email: string }[]>()
    : [];
  const byEmail = new Map(users.map(u => [String(u.email).toLowerCase(), u._id]));

  for (const task of held) {
    const emails = assigneesAfterLeaving(task, gone);
    task.set({
      assigneeId: emails[0] ? byEmail.get(emails[0]) : undefined,
      assigneeEmail: emails[0],
      assigneeIds: emails.map(e => byEmail.get(e)).filter((v): v is Types.ObjectId => !!v),
      assigneeEmails: emails,
    });
    await task.save();
    // The same verb and the same phrasing updateTask uses when a name comes off a task, because
    // this is that event — recordEvent truncates the subject and never throws.
    if (actorId) await recordEvent({ projectId, actorId, verb: 'task_reassigned', subject: `${task.title} off ${gone}` });
  }
  return held.length;
}
