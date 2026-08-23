'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Project } from "@/lib/models/Project";
import Task from "@/lib/models/Task";
import { Mom } from "@/lib/models/Mom";
import { projectForMember } from "@/lib/projectAccess";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

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
    }).populate('ownerId', 'email').sort({ createdAt: 1 }).lean();

    return { success: true, projects: JSON.parse(JSON.stringify(projects)) };
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

    // Owner only
    const res = await Project.findOneAndUpdate(
      { _id: projectId, ownerId: session.user.id },
      { $addToSet: { memberEmails: normalized } }
    );
    if (!res) return { success: false, error: 'Project not found or not owner' };

    revalidatePath('/tasks');
    return { success: true };
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
