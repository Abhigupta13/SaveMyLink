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

    const projects = await Project.find({
      $or: [
        { ownerId: session.user.id },
        { memberEmails: (session.user.email || '').toLowerCase() },
      ],
    }).populate('ownerId', 'email name').sort({ createdAt: 1 }).lean();

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

    // Owner only
    const res = await Project.findOneAndUpdate(
      { _id: projectId, ownerId: session.user.id },
      { $addToSet: { memberEmails: normalized } }
    );
    if (!res) return { success: false, error: 'Project not found or not owner' };

    // Tell them. Adding an email silently was the whole reason invites never worked: a typo
    // looked identical to success, and someone without an account was never asked to make one.
    const invitee = await User.findOne({ email: normalized }).select('name').lean() as any;
    const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
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
    // Owner only — and the owner cannot remove themselves out of their own project
    if (normalized === (session.user.email || '').toLowerCase()) return { success: false, error: "You can't remove yourself" };

    const res = await Project.findOneAndUpdate(
      { _id: projectId, ownerId: session.user.id },
      { $pull: { memberEmails: normalized } }
    );
    if (!res) return { success: false, error: 'Project not found or not owner' };

    // Their assignments stay, but nobody is holding them any more
    await Task.updateMany({ projectId, assigneeEmail: normalized }, { $unset: { assigneeId: '', assigneeEmail: '' } });

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

    const projects = await Project.find({
      $or: [{ ownerId: session.user.id }, { memberEmails: (session.user.email || '').toLowerCase() }],
    }).select('_id').lean();
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
    const res = await Project.findOneAndUpdate({ _id: projectId, ownerId: session.user.id }, { name: name.trim() }, { new: true });
    if (!res) return { success: false, error: 'Only the project owner can rename it' };
    revalidatePath('/tasks');
    return { success: true, project: JSON.parse(JSON.stringify(res)) };
  } catch (error) {
    console.error('Failed to rename project:', error);
    return { success: false, error: 'Failed to rename project' };
  }
}
