'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { Mom } from '@/lib/models/Mom';
import { Link } from '@/lib/models/Link';
import { Note } from '@/lib/models/Note';
import { Project } from '@/lib/models/Project';
import Task from '@/lib/models/Task';
import { introProgress, isIntroStep } from '@/lib/intro';

/** The checklist, computed from what the account actually contains. null = hidden. */
export async function introStatus() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const userId = session.user.id;
  await connectToDatabase();
  const user = await User.findById(userId).select('introDone introDismissed')
    .lean<{ introDone?: string[]; introDismissed?: boolean } | null>();
  if (user?.introDismissed) return null;

  const [meetings, links, notes, groups, dueTasks, privateLinks] = await Promise.all([
    Mom.countDocuments({ userId }),
    Link.countDocuments({ userId }),
    Note.countDocuments({ userId }),
    Project.countDocuments({ ownerId: userId, 'memberEmails.0': { $exists: true } }),
    Task.countDocuments({ userId, dueAt: { $ne: null } }),
    Link.countDocuments({ userId, isPrivate: true }),
  ]);
  const progress = introProgress({ meetings, links, notes, groups, dueTasks, privateLinks }, user?.introDone);
  return progress.remaining === 0 ? null : progress;
}

export async function markIntro(step: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isIntroStep(step)) return { success: false };
  await connectToDatabase();
  await User.updateOne({ _id: session.user.id }, { $addToSet: { introDone: step } });
  revalidatePath('/');
  return { success: true };
}

export async function dismissIntro() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false };
  await connectToDatabase();
  await User.updateOne({ _id: session.user.id }, { $set: { introDismissed: true } });
  revalidatePath('/');
  return { success: true };
}
