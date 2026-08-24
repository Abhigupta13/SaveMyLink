'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Task from "@/lib/models/Task";
import { User } from "@/lib/models/User";
import { projectForMember, canDelete } from "@/lib/projectAccess";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

async function claimAssignments(userId: string, email?: string | null) {
  if (!email) return;
  await Task.updateMany(
    { assigneeEmail: email.toLowerCase(), assigneeId: null },
    { $set: { assigneeId: userId } }
  );
}

export async function getTasks(projectId?: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    // Claim tasks assigned to my email before I had an account
    await claimAssignments(session.user.id, session.user.email);

    let query: any;
    if (projectId) {
      const project = await projectForMember(projectId, session.user.id, session.user.email);
      if (!project) return { success: false, error: 'Not a member of this project' };
      query = { projectId };
    } else {
      query = { userId: session.user.id, projectId: null }; // personal tasks
    }

    const tasks = await Task.find(query)
      .populate('assigneeId', 'email name')
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

    const tasks = await Task.find({
      completed: false,
      $or: [{ userId: session.user.id, projectId: null }, { assigneeId: session.user.id }],
    }).select('_id title dueAt completed projectId').lean(); // projectId drives the per-scope counts on /tasks
    return { success: true, tasks: JSON.parse(JSON.stringify(tasks)) };
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
  momId?: string;
  linkId?: string;
}

export async function createTask(title: string, opts: TaskOpts = {}) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    let assigneeId;
    if (opts.projectId) {
      const project = await projectForMember(opts.projectId, session.user.id, session.user.email);
      if (!project) return { success: false, error: 'Not a member of this project' };
      if (opts.assigneeEmail) {
        const assignee = await User.findOne({ email: opts.assigneeEmail.toLowerCase() }).select('_id');
        assigneeId = assignee?._id; // unresolved email → kept as assigneeEmail, claimed when they sign up
      }
    }

    const task = await Task.create({
      title,
      description: opts.description,
      dueAt: opts.dueAt ? new Date(opts.dueAt) : undefined,
      userId: session.user.id,
      projectId: opts.projectId || undefined,
      assigneeId,
      assigneeEmail: opts.projectId ? opts.assigneeEmail?.toLowerCase() : undefined,
      momId: opts.momId || undefined,
      linkId: opts.linkId || undefined,
    });

    revalidatePath('/tasks');
    return { success: true, task: JSON.parse(JSON.stringify(task)) };
  } catch (error) {
    console.error('Failed to create task:', error);
    return { success: false, error: 'Failed to create task' };
  }
}

export async function updateTask(id: string, data: { title?: string; description?: string; dueAt?: string | null; assigneeEmail?: string | null; projectId?: string | null }) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const task = await Task.findOne({
      _id: id,
      $or: [{ userId: session.user.id }, { assigneeId: session.user.id }],
    });
    if (!task) return { success: false, error: 'Task not found' };

    if (data.title !== undefined) task.title = data.title;
    if (data.description !== undefined) task.description = data.description;
    if (data.dueAt !== undefined) task.dueAt = data.dueAt ? new Date(data.dueAt) : undefined;
    if (data.projectId !== undefined) {
      if (data.projectId) {
        const project = await projectForMember(data.projectId, session.user.id, session.user.email);
        if (!project) return { success: false, error: 'Not a member of that project' };
        task.projectId = project._id as any;
      } else {
        task.projectId = undefined;
        task.assigneeId = undefined;
        task.assigneeEmail = undefined; // personal tasks have no assignee
      }
    }
    if (data.assigneeEmail !== undefined) {
      if (data.assigneeEmail) {
        const assignee = await User.findOne({ email: data.assigneeEmail.toLowerCase() }).select('_id');
        task.assigneeId = assignee?._id;
        task.assigneeEmail = data.assigneeEmail.toLowerCase();
      } else {
        task.assigneeId = undefined;
        task.assigneeEmail = undefined;
      }
    }
    await task.save();

    revalidatePath('/tasks');
    return { success: true, task: JSON.parse(JSON.stringify(task)) };
  } catch (error) {
    console.error('Failed to update task:', error);
    return { success: false, error: 'Failed to update task' };
  }
}

export async function toggleTask(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const task = await Task.findOne({
      _id: id,
      $or: [{ userId: session.user.id }, { assigneeId: session.user.id }],
    });
    if (!task) return { success: false, error: 'Task not found' };

    task.completed = !task.completed;
    await task.save();

    revalidatePath('/tasks');
    return { success: true, task: JSON.parse(JSON.stringify(task)) };
  } catch (error) {
    console.error('Failed to toggle task:', error);
    return { success: false, error: 'Failed to update task' };
  }
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
