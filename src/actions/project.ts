'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Project } from "@/lib/models/Project";
import Task from "@/lib/models/Task";
import { Mom } from "@/lib/models/Mom";
import { projectForMember } from "@/lib/projectAccess";
import { User } from "@/lib/models/User";
import { Contact } from "@/lib/models/Contact";
import { sendMail, inviteEmail } from "@/lib/mailer";
import { ownerFilter, myProjectFilter } from "@/lib/projectAccess";
import { appUrl } from "@/lib/url";
import { isProjectCreator, type OwnableProject } from "@/lib/scope";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

/**
 * A readable name for each email, so a project shows people rather than a wall of addresses.
 * Two sources, in order: the User record, which everyone with an account shares and so reads
 * the same for every teammate; then your own Contact, which is private to you — your nickname
 * for someone stays yours. Falls back to the email, which is always better than nothing.
 */
async function displayNames(emails: string[], userId: string) {
  const wanted = [...new Set(emails.filter(Boolean).map(e => e.toLowerCase()))];
  if (!wanted.length) return new Map<string, { name?: string; hasAccount: boolean }>();

  const [users, contacts] = await Promise.all([
    User.find({ email: { $in: wanted } }).select('email name').lean(),
    Contact.find({ userId, email: { $in: wanted } }).select('email name').lean(),
  ]);
  const byContact = new Map(contacts.map((c: any) => [String(c.email).toLowerCase(), c.name]));

  const out = new Map<string, { name?: string; hasAccount: boolean }>();
  for (const email of wanted) out.set(email, { name: byContact.get(email), hasAccount: false });
  for (const u of users as any[]) {
    const email = String(u.email).toLowerCase();
    out.set(email, { name: u.name || byContact.get(email), hasAccount: true });
  }
  return out;
}

export async function getProjects() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const projects = await Project.find(await myProjectFilter(session.user.id, session.user.email))
      .populate('ownerId', 'email name').sort({ createdAt: 1 }).lean();

    // One lookup for every member of every project rather than one per project
    const names = await displayNames(
      (projects as any[]).flatMap(p => [p.ownerId?.email, ...(p.memberEmails || [])]),
      session.user.id,
    );
    const withPeople = (projects as any[]).map(p => ({
      ...p,
      people: [...new Set([String(p.ownerId?.email || '').toLowerCase(), ...(p.memberEmails || [])])]
        .filter(Boolean)
        .map(email => ({ email, ...(names.get(email) || { hasAccount: false }) })),
    }));

    return { success: true, projects: JSON.parse(JSON.stringify(withPeople)) };
  } catch (error) {
    console.error('Failed to get projects:', error);
    return { success: false, error: 'Failed to fetch projects' };
  }
}

export async function createProject(name: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!name.trim()) return { success: false, error: 'Name required' };

    const project = await Project.create({
      name: name.trim(),
      ownerId: session.user.id,
      memberEmails: [],
    });

    revalidatePath('/tasks');
    return { success: true, project: JSON.parse(JSON.stringify(project)) };
  } catch (error) {
    console.error('Failed to create project:', error);
    return { success: false, error: 'Failed to create project' };
  }
}

export async function addMember(projectId: string, email: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return { success: false, error: 'Invalid email' };

    if (normalized === (session.user.email || '').toLowerCase()) {
      return { success: false, error: "You're already on this project" };
    }

    // Any owner — the creator or anyone they promoted
    const res = await Project.findOneAndUpdate(
      { _id: projectId, ...(await ownerFilter(session.user.id, session.user.email)) },
      { $addToSet: { memberEmails: normalized } }
    );
    if (!res) return { success: false, error: 'Project not found or not owner' };

    // Tell them. Adding an email silently was the whole reason invites never worked: a typo
    // looked identical to success, and someone without an account was never asked to make one.
    const invitee = await User.findOne({ email: normalized }).select('name').lean() as any;
    const base = appUrl();
    const link = invitee
      ? `${base}/projects/${projectId}`
      : `${base}/auth/signup?email=${encodeURIComponent(normalized)}`;
    const mail = inviteEmail({
      projectName: res.name,
      inviterName: session.user.name || session.user.email || 'A teammate',
      link,
      hasAccount: !!invitee,
      name: invitee?.name,
    });
    // Never fail the invite over mail: they are on the project either way, and SMTP being
    // down or unconfigured should not roll that back. mailConfigured=false just logs.
    const sent = await sendMail({ to: normalized, ...mail })
      .catch(error => { console.error('Invite email failed:', normalized, error); return { delivered: false as const }; });

    revalidatePath('/tasks');
    revalidatePath('/projects');
    return { success: true, invited: normalized, emailed: sent.delivered };
  } catch (error) {
    console.error('Failed to add member:', error);
    return { success: false, error: 'Failed to add member' };
  }
}

export async function removeMember(projectId: string, email: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const normalized = email.trim().toLowerCase();
    // Any owner — but nobody removes themselves, and nobody removes the creator
    if (normalized === (session.user.email || '').toLowerCase()) return { success: false, error: "You can't remove yourself" };

    const filter = { _id: projectId, ...(await ownerFilter(session.user.id, session.user.email)) };
    const project = await Project.findOne(filter).populate('ownerId', 'email');
    if (!project) return { success: false, error: 'Project not found or not owner' };
    if (isProjectCreator(project as unknown as OwnableProject, normalized)) {
      return { success: false, error: "The project's creator can't be removed" };
    }

    // Owner rights leave with the membership. A co-owner pulled from memberEmails but left in
    // ownerEmails would keep rename and delete powers that no screen shows any more.
    await Project.updateOne(filter, { $pull: { memberEmails: normalized, ownerEmails: normalized } });

    // Their assignments STAY, name and all. Blanking the assignee used to make the work
    // indistinguishable from a task nobody had ever been given — the due date survived but the
    // history of who owed it did not, and it silently sank into the list. The group page now
    // surfaces every one of these under "Needs an owner" instead, where it takes one tap to
    // hand over. Nothing is dropped just because somebody left.

    revalidatePath('/tasks'); revalidatePath('/projects');
    return { success: true };
  } catch (error) {
    console.error('Failed to remove member:', error);
    return { success: false, error: 'Failed to remove member' };
  }
}

// Open-task and meeting counts for the projects grid, in two aggregates rather than N queries.
export async function getProjectStats() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const projects = await Project.find(await myProjectFilter(session.user.id, session.user.email))
      .select('_id').lean();
    const ids = projects.map(p => p._id);

    const [tasks, moms] = await Promise.all([
      Task.aggregate([{ $match: { projectId: { $in: ids } } }, { $group: { _id: { p: '$projectId', done: '$completed' }, n: { $sum: 1 } } }]),
      Mom.aggregate([{ $match: { projectId: { $in: ids } } }, { $group: { _id: '$projectId', n: { $sum: 1 } } }]),
    ]);

    const stats: Record<string, { open: number; done: number; moms: number }> = {};
    const at = (id: any) => (stats[String(id)] ||= { open: 0, done: 0, moms: 0 });
    for (const t of tasks) at(t._id.p)[t._id.done ? 'done' : 'open'] += t.n;
    for (const m of moms) at(m._id).moms += m.n;
    return { success: true, stats };
  } catch (error) {
    console.error('Failed to get project stats:', error);
    return { success: false, error: 'Failed to fetch stats' };
  }
}

export async function updateProjectNotes(projectId: string, notes: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const project = await projectForMember(projectId, session.user.id, session.user.email);
    if (!project) return { success: false, error: 'Not a member' };

    project.notes = notes;
    await project.save();
    return { success: true };
  } catch (error) {
    console.error('Failed to update notes:', error);
    return { success: false, error: 'Failed to update notes' };
  }
}

export async function deleteProject(projectId: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    // Owner only; project tasks go with it
    // Creator only, deliberately narrower than every other owner action: this is the one with no
    // undo, and a co-owner having a bad day should not be able to erase a team's whole history.
    const res = await Project.findOneAndDelete({ _id: projectId, ownerId: session.user.id });
    if (!res) return { success: false, error: 'Project not found or not owner' };
    await Task.deleteMany({ projectId });

    revalidatePath('/tasks');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete project:', error);
    return { success: false, error: 'Failed to delete project' };
  }
}

export async function renameProject(projectId: string, name: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!name.trim()) return { success: false, error: 'Name required' };
    const res = await Project.findOneAndUpdate(
      { _id: projectId, ...(await ownerFilter(session.user.id, session.user.email)) },
      { name: name.trim() }, { new: true });
    if (!res) return { success: false, error: 'Only a project owner can rename it' };
    revalidatePath('/tasks');
    return { success: true, project: JSON.parse(JSON.stringify(res)) };
  } catch (error) {
    console.error('Failed to rename project:', error);
    return { success: false, error: 'Failed to rename project' };
  }
}

/**
 * Promote a member to co-owner. Any owner may do this — trusting someone with ownership includes
 * trusting their judgement about the next one. They must already be a member, so ownership is
 * never granted to a mistyped address.
 */
export async function addOwner(projectId: string, email: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const normalized = (email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return { success: false, error: 'Invalid email' };

    const filter = { _id: projectId, ...(await ownerFilter(session.user.id, session.user.email)) };
    const project = await Project.findOne(filter).select('memberEmails').lean<{ memberEmails?: string[] } | null>();
    if (!project) return { success: false, error: 'Project not found or not owner' };
    if (!(project.memberEmails || []).includes(normalized)) {
      return { success: false, error: 'Add them to the project first, then make them an owner' };
    }

    await Project.updateOne(filter, { $addToSet: { ownerEmails: normalized } });
    revalidatePath('/projects');
    return { success: true, owner: normalized };
  } catch (error) {
    console.error('Failed to add owner:', error);
    return { success: false, error: 'Could not make them an owner' };
  }
}

/** Step someone back down to an ordinary member. The creator is permanent and cannot be demoted. */
export async function removeOwner(projectId: string, email: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const normalized = (email || '').trim().toLowerCase();
    const filter = { _id: projectId, ...(await ownerFilter(session.user.id, session.user.email)) };
    const project = await Project.findOne(filter).populate('ownerId', 'email');
    if (!project) return { success: false, error: 'Project not found or not owner' };
    if (isProjectCreator(project as unknown as OwnableProject, normalized)) {
      return { success: false, error: "The project's creator is always an owner" };
    }

    await Project.updateOne(filter, { $pull: { ownerEmails: normalized } });

    revalidatePath('/projects');
    return { success: true };
  } catch (error) {
    console.error('Failed to remove owner:', error);
    return { success: false, error: 'Could not remove them as an owner' };
  }
}
