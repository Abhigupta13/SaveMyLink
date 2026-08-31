'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Task from "@/lib/models/Task";
import { User } from "@/lib/models/User";
import { projectForMember, projectForWriter, canDelete, amProjectOwner, canWriteProject, projectPeople, isVerified, myProjectIds } from "@/lib/projectAccess";
import { canWorkOn, canSignOff, assigneeEmailsOf } from "@/lib/taskAccess";
import { allowedAssignees } from "@/lib/validation";
import { privateFilter, privacyOnWrite } from "@/lib/privacy";
import { hasSafe } from "@/lib/safeCookie";
import { asChoice, type ReminderChoice } from "@/lib/reminderRule";
import { recordEvent } from "@/lib/models/Event";
import { getServerSession } from "next-auth";
import { Types } from "mongoose";
import { revalidatePath } from "next/cache";

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** The profile default, read straight off the session's own user. Never a client-supplied id. */
async function myReminderDefault(userId: string): Promise<ReminderChoice | undefined> {
  const me = await User.findById(userId).select('reminderDefault').lean<{ reminderDefault?: string } | null>();
  return asChoice(me?.reminderDefault);
}

/**
 * The primary claim stays 1:1 — assigneeEmail is one address and assigneeId is that person.
 * The second pass is the co-assignee half: a shared task lists everyone's address from the day it
 * was written, and each of them attaches their id here on their first read. $addToSet rather than
 * $push so a repeated read cannot list somebody twice, and the $ne narrows it to rows that would
 * actually change.
 *
 * Gated on email verification, for the same reason projectScope is. Assignment is granted by raw
 * address, so until a signup proves the account owns that address the match is only a claim — and
 * this function converts a claim into a durable id on the row. Without the gate: a task is shared
 * to boss@theirclient.com before they have an account, someone else registers that address, never
 * opens the inbox, signs in (authorize checks deletedAt and suspendedAt, not emailVerified) and
 * loads /tasks. Their id is stamped on, and getMyOpenTasks and searchAll both match assigneeId
 * with no project scope and no verification check of their own — so the title, description, due
 * date and group of somebody else's work is theirs to read. Writes were always refused
 * (writerScope with verified=false); this closes the read half.
 */
async function claimAssignments(userId: string, email?: string | null) {
  if (!email) return;
  if (!(await isVerified(userId))) return;
  const at = email.toLowerCase();
  await Task.updateMany(
    { assigneeEmail: at, assigneeId: null },
    { $set: { assigneeId: userId } }
  );
  await Task.updateMany(
    { assigneeEmails: at, assigneeIds: { $ne: userId } },
    { $addToSet: { assigneeIds: userId } }
  );
}

/**
 * The assignee list a write should store: whatever the caller sent, narrowed to real addresses
 * belonging to people who are actually in the group. The rule itself is `allowedAssignees` in
 * lib/validation, where scripts/self-check.mjs can hold it to account without a database.
 */
const assigneeList = async (projectId: unknown, primary?: string | null, list?: (string | null | undefined)[] | null) =>
  allowedAssignees(primary, list, await projectPeople(projectId));

/**
 * Which of those addresses already have accounts. Returned as a map rather than a list because
 * the primary has to be looked up by name: a list filtered of its misses would silently promote
 * the second person's id into assigneeId whenever the first has not signed up yet.
 */
async function resolveAssignees(emails: string[]) {
  if (!emails.length) return new Map<string, Types.ObjectId>();
  const users = await User.find({ email: { $in: emails } }).select('_id email').lean();
  return new Map(users.map(u => [lower(u.email), u._id]));
}

/** The ids of whoever in the list has an account. The rest stay email-only until they claim. */
const idsFor = (emails: string[], byEmail: Map<string, Types.ObjectId>) =>
  emails.map(e => byEmail.get(e)).filter((v): v is Types.ObjectId => !!v);

export async function getTasks(projectId?: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();
    // Claim tasks assigned to my email before I had an account
    await claimAssignments(session.user.id, session.user.email);

    let query: any;
    if (projectId) {
      const project = await projectForMember(projectId, session.user.id, session.user.email);
      if (!project) return { success: false, error: 'Not a member of this project' };
      query = { projectId };
    } else {
      // Personal tasks, and the only half the Private Safe touches: locked shows what is not
      // private, unlocked shows what is. A project list is the group's and never swaps.
      query = { userId: session.user.id, projectId: null, ...privateFilter(await hasSafe(session.user.id)) };
    }

    const tasks = await Task.find(query)
      .populate('assigneeId', 'email name')
      .populate('signedOffBy', 'email name')   // so the chip can name who approved it, not just that someone did
      .sort({ completed: 1, dueAt: 1, createdAt: -1 });
    return { success: true, tasks: JSON.parse(JSON.stringify(tasks)) };
  } catch (error) {
    console.error('Failed to get tasks:', error);
    return { success: false, error: 'Failed to fetch tasks' };
  }
}

// All my open tasks (personal + assigned to me anywhere) — used by the
// client to reconcile on-device reminder notifications.
export async function getMyOpenTasks() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await claimAssignments(session.user.id, session.user.email);

    /* Where the assignee branches may look: my own personal work, or a group I can actually open.
       Being assigned something used to be enough on its own, with no project scope at all — so a
       task in a group I am not on still reached Home, cross-entity search, the Jarvis prompt and
       my phone reminders. Two problems with that, and they are the same problem seen from each end:

         · As a leak: it is the channel a task injected into a stranger's queue arrives through.
           confirmMomTasks used to assign to any address with no roster check (now fixed), and this
           is where the title and description surfaced afterwards.
         · As a bug: Home showed work that NO screen could open. getTasks' personal view filters
           projectId: null so it never matched, and the group's own tab needs a membership I do not
           have — so it sat on the home page, overdue, with nowhere to go and no way to close it.

       Scoping it here makes Home agree with /tasks: what you are shown is what you can reach. */
    const reachable = [
      { projectId: null },
      { projectId: { $in: await myProjectIds(session.user.id, session.user.email) } },
    ];

    const tasks = await Task.find({
      completed: false,
      // assigneeIds as well as assigneeId, or a co-assignee's shared work would be missing from
      // My Tasks — and from the phone reminders, which each device schedules off this list.
      // The safe swaps the personal branch only: work handed to you out of a group is the group's
      // and stays visible either way, which is also why it can never have been private.
      $or: [
        { userId: session.user.id, projectId: null, ...privateFilter(await hasSafe(session.user.id)) },
        { assigneeId: session.user.id, $or: reachable },
        { assigneeIds: session.user.id, $or: reachable },
      ],
      // createdAt + reminder because the phone computes its own fire times off them; projectId
      // drives the per-scope counts on /tasks.
    }).select('_id title dueAt completed projectId createdAt reminder').lean();
    return {
      success: true,
      tasks: JSON.parse(JSON.stringify(tasks)),
      // What a row with no reminder of its own falls back to. Sent once for the whole list rather
      // than resolved per task, so an old row and a new one answer to the same setting.
      reminderDefault: await myReminderDefault(session.user.id),
    };
  } catch (error) {
    console.error('Failed to get open tasks:', error);
    return { success: false, error: 'Failed to fetch tasks' };
  }
}

interface TaskOpts {
  description?: string;
  dueAt?: string; // ISO string from client
  projectId?: string;
  assigneeEmail?: string;
  assigneeEmails?: string[];   // several people, one shared task — any of them ticks it
  momId?: string;
  linkId?: string;
  reminder?: string;   // one of REMINDER_VALUES; anything else falls back to the profile default
  isPrivate?: boolean;  // a request, not the answer — privacyOnWrite decides, and a group wins
}

export async function createTask(title: string, opts: TaskOpts = {}) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    // Assignment only exists inside a group — a personal task has nobody to hand it to.
    let emails: string[] = [];
    let byEmail = new Map<string, Types.ObjectId>();
    if (opts.projectId) {
      const project = await projectForWriter(opts.projectId, session.user.id, session.user.email);
      if (!project) return { success: false, error: 'You cannot add work to this group' };
      emails = await assigneeList(project._id, opts.assigneeEmail, opts.assigneeEmails);
      byEmail = await resolveAssignees(emails);   // unresolved → kept as email, claimed when they sign up
    }

    const isPrivate = privacyOnWrite(opts.isPrivate, opts.projectId);

    const task = await Task.create({
      title,
      description: opts.description,
      dueAt: opts.dueAt ? new Date(opts.dueAt) : undefined,
      userId: session.user.id,
      projectId: opts.projectId || undefined,
      assigneeId: byEmail.get(emails[0]),
      assigneeEmail: emails[0],
      assigneeIds: idsFor(emails, byEmail),
      assigneeEmails: emails,
      momId: opts.momId || undefined,
      linkId: opts.linkId || undefined,
      // Resolved once, here, and stored — so the schedule a task was given is the schedule it
      // keeps. Changing the profile default later re-aims the next task, not every old one.
      // A caller that never asks (Jarvis) simply inherits the default.
      reminder: asChoice(opts.reminder) ?? await myReminderDefault(session.user.id),
      // Assignment and privacy are opposites: a task with a group has people who must read it.
      isPrivate,
    });

    await recordEvent({ projectId: task.projectId, actorId: session.user.id, verb: 'task_created', subject: task.title });

    revalidatePath('/tasks');
    return {
      success: true,
      task: JSON.parse(JSON.stringify(task)),
      privacyDropped: opts.isPrivate === true && !isPrivate,
    };
  } catch (error) {
    console.error('Failed to create task:', error);
    return { success: false, error: 'Failed to create task' };
  }
}

export async function updateTask(id: string, data: { title?: string; description?: string; dueAt?: string | null; assigneeEmail?: string | null; assigneeEmails?: string[] | null; projectId?: string | null; reminder?: string | null; isPrivate?: boolean }) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    // Same shape and same rule as toggleTask. The old scoped findOne matched userId or
    // assigneeId only, so an owner who neither wrote the task nor was given it could not edit
    // it in their own group — the identical lockout, on the editing path.
    const task = await Task.findById(id);
    if (!task) return { success: false, error: 'Task not found' };
    if (!await canWriteProject(task.projectId, session.user.id, session.user.email)) {
      return { success: false, error: 'View-only access — you cannot change this' };
    }
    const isOwner = await amProjectOwner(task.projectId, session.user.id, session.user.email);
    if (!canWorkOn(task, session.user.id, session.user.email, isOwner)) {
      return { success: false, error: 'Task not found' };
    }
    const wasAssigned = assigneeEmailsOf(task);

    if (data.title !== undefined) task.title = data.title;
    if (data.description !== undefined) task.description = data.description;
    if (data.dueAt !== undefined) task.dueAt = data.dueAt ? new Date(data.dueAt) : undefined;
    // Moving the due date does NOT re-anchor the 85% point — reminderRule measures it from
    // createdAt, which no edit touches. Only the choice itself changes here.
    if (data.reminder !== undefined) task.reminder = asChoice(data.reminder);
    // WHERE the task ends up is settled first, because it decides who may be on it. The other
    // order shipped: the move-to-personal branch cleared the assignees and the assignee block ran
    // after and put them straight back from client input. A member who was an assignee could take
    // the owner's task out of the group, keep write on it through the assignee branch of
    // canWorkOn, and leave the owner unable to see or delete it.
    if (data.projectId !== undefined) {
      if (data.projectId) {
        const project = await projectForWriter(data.projectId, session.user.id, session.user.email);
        if (!project) return { success: false, error: 'You cannot move work into that group' };
        task.projectId = project._id as any;
      } else {
        task.projectId = undefined;
      }
    }
    // Same place and the same reason as the assignee block: WHERE the task ended up decides this,
    // so it is settled after the move and never from the id the client sent. Moving private work
    // into a group drops the padlock rather than leaving one every member can open.
    const wantPrivate = data.isPrivate !== undefined ? data.isPrivate : !!task.isPrivate;
    task.isPrivate = privacyOnWrite(wantPrivate, task.projectId);
    if (!task.projectId) {
      // Personal tasks have no assignee, and no assignee input survives the move out.
      task.set({ assigneeId: undefined, assigneeEmail: undefined, assigneeIds: [], assigneeEmails: [] });
    } else if (data.assigneeEmail !== undefined || data.assigneeEmails !== undefined) {
      const emails = await assigneeList(task.projectId, data.assigneeEmail, data.assigneeEmails);
      const byEmail = await resolveAssignees(emails);
      task.set({
        assigneeId: byEmail.get(emails[0]),
        assigneeEmail: emails[0],
        assigneeIds: idsFor(emails, byEmail),
        assigneeEmails: emails,
      });
    }
    // Only a change of hands is worth a line in the trail. Retitling and re-dating happen
    // constantly while someone is thinking, and a trail that logs thinking is not read.
    //
    // A set difference, not a scalar compare: with several people on one task, "added Priya" and
    // "took Ravi off" are separate facts, and comparing only the primary would log a reassignment
    // every time the list was re-ordered and none at all when a third person was added.
    const nowAssigned = assigneeEmailsOf(task);
    const added = nowAssigned.filter(e => !wasAssigned.includes(e));
    const removed = wasAssigned.filter(e => !nowAssigned.includes(e));
    await task.save();
    if (added.length || removed.length) {
      const said = [added.length && `to ${added.join(', ')}`, removed.length && `off ${removed.join(', ')}`]
        .filter(Boolean).join(' · ');
      await recordEvent({
        projectId: task.projectId, actorId: session.user.id, verb: 'task_reassigned',
        subject: `${task.title} ${said || 'to nobody'}`,
      });
    }

    revalidatePath('/tasks');
    return {
      success: true,
      task: JSON.parse(JSON.stringify(task)),
      privacyDropped: wantPrivate === true && !task.isPrivate,
    };
  } catch (error) {
    console.error('Failed to update task:', error);
    return { success: false, error: 'Failed to update task' };
  }
}

/**
 * Ticking the box. The scoped findOne this used to be locked out an owner who was neither the
 * task's creator nor its assignee — they could see the task in their own group and not close it.
 * Same shape as deleteTask now: fetch, then ask the rule, then save. Refusal answers "not found"
 * so the gate never confirms the existence of a task you cannot reach.
 *
 * canComplete lives in lib/taskAccess so scripts/self-check.mjs can hold it to account.
 */
export async function toggleTask(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const task = await Task.findById(id);
    if (!task) return { success: false, error: 'Task not found' };

    // A view-only client can be given work and still may not close it — the assigneeEmail
    // branch below would otherwise open the one gate a viewer can reach.
    if (!await canWriteProject(task.projectId, session.user.id, session.user.email)) {
      return { success: false, error: 'View-only access — you cannot change this' };
    }
    const isOwner = await amProjectOwner(task.projectId, session.user.id, session.user.email);
    if (!canWorkOn(task, session.user.id, session.user.email, isOwner)) {
      return { success: false, error: 'Task not found' };
    }

    task.completed = !task.completed;
    // Re-opening drops the sign-off. A stale approval on work that is no longer done would be
    // counted by the admin funnel as signed-off work that does not exist.
    if (!task.completed) task.set({ signedOffBy: undefined, signedOffAt: undefined });
    await task.save();
    await recordEvent({
      projectId: task.projectId, actorId: session.user.id,
      verb: task.completed ? 'task_completed' : 'task_reopened', subject: task.title,
    });

    revalidatePath('/tasks');
    return { success: true, task: JSON.parse(JSON.stringify(task)) };
  } catch (error) {
    console.error('Failed to toggle task:', error);
    return { success: false, error: 'Failed to update task' };
  }
}

/**
 * The other half of RACI: the assignee ticks their own work, an owner answers for the outcome.
 * Owner-only, group-only, and only over work that is actually done — approving an unfinished
 * task is the one state that would make "signed off" stop being a subset of "completed" on the
 * funnel that measures whether this product works at all.
 *
 * A toggle, so a mis-stamp is recoverable without a second action.
 */
export async function signOffTask(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const task = await Task.findById(id);
    if (!task) return { success: false, error: 'Task not found' };

    const isOwner = await amProjectOwner(task.projectId, session.user.id, session.user.email);
    if (!canSignOff(task, isOwner)) {
      return { success: false, error: task.completed ? 'Only a project owner can sign this off' : 'Finish it first, then sign it off' };
    }

    // set() rather than assignment so mongoose does the id cast — the session carries a string
    if (task.signedOffAt) task.set({ signedOffBy: undefined, signedOffAt: undefined });
    else task.set({ signedOffBy: session.user.id, signedOffAt: new Date() });
    await task.save();
    if (task.signedOffAt) {
      await recordEvent({ projectId: task.projectId, actorId: session.user.id, verb: 'task_signed_off', subject: task.title });
    }

    revalidatePath('/tasks');
    return { success: true, task: JSON.parse(JSON.stringify(task)) };
  } catch (error) {
    console.error('Failed to sign off task:', error);
    return { success: false, error: 'Failed to sign off' };
  }
}

/**
 * The profile default, for the pickers to pre-fill from. The session IS the identity — there is
 * no userId argument on either of these, so neither can be pointed at somebody else's row.
 */
export async function getReminderDefault() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { choice: undefined as ReminderChoice | undefined };
  await connectToDatabase();
  return { choice: await myReminderDefault(session.user.id) };
}

export async function setReminderDefault(choice: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false };
  const clean = asChoice(choice);
  if (!clean) return { success: false };
  await connectToDatabase();
  await User.updateOne({ _id: session.user.id }, { reminderDefault: clean });
  return { success: true };
}

export async function deleteTask(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    // In a project only the owner may delete; outside one, only the person it belongs to.
    const task = await Task.findById(id);
    if (!task) return { success: false, error: 'Task not found' };
    if (!await canDelete(task, session.user.id, session.user.email)) {
      return { success: false, error: 'Only a project owner can delete this task' };
    }
    await task.deleteOne();

    revalidatePath('/tasks');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: 'Failed to delete task' };
  }
}
