'use server';

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import connectToDatabase from "@/lib/mongodb";
import Task from "@/lib/models/Task";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

export async function getTasks() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const tasks = await Task.find({ userId: session.user.id }).sort({ createdAt: -1 });
    return { success: true, tasks: JSON.parse(JSON.stringify(tasks)) };
  } catch (error) {
    console.error('Failed to get tasks:', error);
    return { success: false, error: 'Failed to fetch tasks' };
  }
}

export async function createTask(title: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const task = await Task.create({
      title,
      userId: session.user.id
    });

    revalidatePath('/tasks');
    return { success: true, task: JSON.parse(JSON.stringify(task)) };
  } catch (error) {
    console.error('Failed to create task:', error);
    return { success: false, error: 'Failed to create task' };
  }
}

export async function toggleTask(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const task = await Task.findOne({ _id: id, userId: session.user.id });
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

    await Task.findOneAndDelete({ _id: id, userId: session.user.id });

    revalidatePath('/tasks');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: 'Failed to delete task' };
  }
}
