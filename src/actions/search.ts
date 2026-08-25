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
  const includePrivate = await hasSafe(userId);

  const linkQuery: any = {
    userId,
    $or: [{ title: regex }, { url: regex }, { tags: { $in: [regex] } }],
  };
  if (!includePrivate) linkQuery.isPrivate = { $ne: true };

  const myProjects = await Project.find(await myProjectFilter(userId, email))
    .select('_id name notes').lean();
  const projectIds = myProjects.map(p => p._id);

  const [links, tasks, moms, notes] = await Promise.all([
    Link.find(linkQuery).populate('category', 'name color').sort({ createdAt: -1 }).limit(20).lean(),
    Task.find({
      $and: [
        { $or: [{ userId }, { assigneeId: userId }, { projectId: { $in: projectIds } }] },
        { $or: [{ title: regex }, { description: regex }] },
      ],
    }).sort({ completed: 1, createdAt: -1 }).limit(20).lean(),
    Mom.find({
      $and: [
        { $or: [{ projectId: { $in: projectIds } }, { userId }] },  // personal meetings have no project
        { $or: [{ title: regex }, { summary: regex }, { transcript: regex }] },
      ],
    }).select('_id title summary projectId createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    Note.find({
      $and: [
        { $or: [{ userId }, { projectId: { $in: projectIds } }] },
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
