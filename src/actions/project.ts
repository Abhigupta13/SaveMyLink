'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Project } from "@/lib/models/Project";
import Task from "@/lib/models/Task";
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
