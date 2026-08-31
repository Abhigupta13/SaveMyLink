import connectToDatabase from '@/lib/mongodb';
import { Link } from '@/lib/models/Link';
import Task from '@/lib/models/Task';
import { Project } from '@/lib/models/Project';
import { projectNameMap, sharedLabel } from '@/lib/visibility';
import { myProjectFilter, myProjectIds } from '@/lib/projectAccess';
import { privateFilter } from '@/lib/privacy';

/**
 * What the weekly digest is made of: what needs you in the next seven days, and what you saved in
 * the last seven.
 *
 * Lifted out of /digest so the home page can show the same thing without a second, slightly
 * different query drifting away from it. One shape, one set of gates, two screens — the same
 * reasoning that put the whole group workspace behind getProjectWorkspace.
 *
 * Private records are withheld here rather than at the caller. The digest is a glance surface —
 * a home-page panel, and an email that lands in an inbox — so it is always the LOCKED view, of
 * links and of tasks alike. There is no safe to unlock on a cron run, and privateFilter(false) is
 * how that gets said in the same words the rest of the app uses.
 */

export interface DigestTask {
  _id: string;
  title: string;
  dueAt: string;
  /** Decided here, once, on the server. A component asking `Date.now()` mid-render is impure and
   *  can disagree with itself between two renders of the same list. */
  overdue: boolean;
  projectName?: string | null;
}

export interface DigestLink {
  _id: string;
  url?: string;
  title?: string;
  previewImageUrl?: string;
  category?: { name?: string } | null;
}

export async function weeklyDigest(userId: string, email: string): Promise<{ tasks: DigestTask[]; links: DigestLink[] }> {
  await connectToDatabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600e3);
  const weekAhead = new Date(Date.now() + 7 * 24 * 3600e3);

  /* Where an assignee branch may look: my own work, or a group I can actually open.
     Being assigned something used to be enough on its own, with no project scope, so a task in a
     group I am not on still reached Home and the weekly email. It showed as an overdue row with a
     BLANK project chip and nowhere to go: the task list's personal view filters projectId null so
     it never matched there, and the group's own tab needs a membership I do not have.
     The blank chip was the tell. The name lookup below already runs through myProjectFilter, so
     this function has always known it could not name that project — it just showed the task
     anyway. Now both halves ask the same question. */
  const reachable = [
    { projectId: null },
    { projectId: { $in: await myProjectIds(userId, email) } },
  ];

  const [savedLinks, dueTasks] = await Promise.all([
    Link.find({ userId, ...privateFilter(false), createdAt: { $gte: weekAgo } })
      .populate('category', 'name').sort({ createdAt: -1 }).limit(30).lean(),
    Task.find({
      completed: false,
      dueAt: { $lte: weekAhead },
      // The personal branch was the half still missing: a task in the safe was being written into
      // a weekly email. The assignee branches are group work and can never have been private.
      $or: [
        { userId, ...privateFilter(false) },
        { assigneeId: userId, $or: reachable },
        { assigneeIds: userId, $or: reachable },
      ],
    }).sort({ dueAt: 1 }).limit(30).lean(),
  ]);

  // A task assigned to me out of a group is visible to that group, and the row should say so.
  // Resolved through the verified read gate: an ex-member or an unverified assignee gets no name.
  const projectIds = [...new Set(dueTasks.map(t => t.projectId).filter(Boolean).map(String))];
  const names = projectNameMap(projectIds.length
    ? await Project.find({ _id: { $in: projectIds }, ...(await myProjectFilter(userId, email)) }).select('name').lean()
    : []);

  const now = Date.now();
  return {
    tasks: JSON.parse(JSON.stringify(dueTasks.map(t => ({
      ...t,
      projectName: sharedLabel(t, names),
      overdue: !!t.dueAt && new Date(t.dueAt).getTime() < now,
    })))),
    links: JSON.parse(JSON.stringify(savedLinks)),
  };
}
