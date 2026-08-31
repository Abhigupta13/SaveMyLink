'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Link } from "@/lib/models/Link";
import Task from "@/lib/models/Task";
import { Project } from "@/lib/models/Project";
import { Mom } from "@/lib/models/Mom";
import { Note } from "@/lib/models/Note";
import { escapeRegex } from "@/lib/regex";
import { hasSafe } from "@/lib/safeCookie";
import { privateFilter } from "@/lib/privacy";
import { getServerSession } from "next-auth";
import { myProjectFilter } from "@/lib/projectAccess";
import { projectNameMap, sharedLabel } from "@/lib/visibility";

// One search across links, tasks, projects (name+notes), and MOM transcripts
export async function searchAll(q: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;
  const email = (session.user.email || '').toLowerCase();
  if (!q.trim()) return { success: true, links: [], notes: [], tasks: [], projects: [], moms: [] };

  await connectToDatabase();
  const regex = new RegExp(escapeRegex(q.trim()), 'i');
  /* Search is a list like any other, so it swaps rather than adds: locked it finds what is not
     private, unlocked it finds what is. It used to ADD for links alone, which meant the one place
     that searches across everything disagreed with every page it links to — a link that /links
     was hiding was still findable from the bar above it. Jarvis is the single exception in this
     app and says so where it happens.

     Personal branches only. A group's rows are the group's and are found in both states, which is
     also why they can never be private (lib/privacy). */
  const personal = privateFilter(await hasSafe(userId));

  const linkQuery: any = {
    userId,
    ...personal,
    $or: [{ title: regex }, { url: regex }, { tags: { $in: [regex] } }],
  };

  const myProjects = await Project.find(await myProjectFilter(userId, email))
    .select('_id name notes').lean();
  const projectIds = myProjects.map(p => p._id);
  // Where an assignee branch may look: my own personal work, or a group I can actually open.
  const reachable = [{ projectId: null }, { projectId: { $in: projectIds } }];

  const [links, tasks, moms, notes] = await Promise.all([
    Link.find(linkQuery).populate('category', 'name color').sort({ createdAt: -1 }).limit(20).lean(),
    Task.find({
      $and: [
        /* A task handed to you out of a group is the group's record, so the assignee branches
           stay open in both states — only the plain personal branch swaps.
           That comment was about the Private Safe, and it was the only thing the assignee branches
           had ever been reasoned about: they carried no project scope at all, so a task in a group
           you are NOT on was findable here. Search would return it, and then no screen could open
           it — the task list's personal view filters projectId null, and the group's own tab needs
           a membership you do not have. Same fix as lib/digest and getMyOpenTasks. */
        { $or: [
          { userId, ...personal },
          { assigneeId: userId, $or: reachable },
          { assigneeIds: userId, $or: reachable },
          { projectId: { $in: projectIds } },
        ] },
        { $or: [{ title: regex }, { description: regex }] },
      ],
    }).sort({ completed: 1, createdAt: -1 }).limit(20).lean(),
    Mom.find({
      $and: [
        { $or: [{ projectId: { $in: projectIds } }, { userId, ...personal }] },  // personal meetings have no project
        { $or: [{ title: regex }, { summary: regex }, { transcript: regex }] },
      ],
    }).select('_id title summary projectId createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    Note.find({
      $and: [
        { $or: [{ userId, ...personal }, { projectId: { $in: projectIds } }] },
        { $or: [{ title: regex }, { body: regex }] },
      ],
    }).sort({ updatedAt: -1 }).limit(20).lean(),
  ]);

  const projects = myProjects.filter(p => regex.test(p.name) || regex.test(p.notes || ''));
  const projectNames = projectNameMap(myProjects);
  // A shared row says which group can see it — silently mixing personal and shared is the bug
  const tag = (r: any) => ({ ...r, projectName: sharedLabel(r, projectNames) });

  return {
    success: true,
    links: JSON.parse(JSON.stringify(links)),
    notes: JSON.parse(JSON.stringify(notes.map(tag))),
    tasks: JSON.parse(JSON.stringify(tasks.map(tag))),
    projects: JSON.parse(JSON.stringify(projects)),
    moms: JSON.parse(JSON.stringify(moms.map(tag))),
  };
}
