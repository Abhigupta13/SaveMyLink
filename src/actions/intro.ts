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
import { SAMPLE_TRANSCRIPT } from '@/lib/sampleTranscript';
import { extractMomTasks } from '@/actions/mom';

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
  if (progress.remaining === 0) return null;
  // The sample is offered only while the account has no meeting of its own, and only once
  return { ...progress, offerSample: meetings === 0 && !(user?.introDone || []).includes('sample') };
}

/**
 * A meeting to try the loop on without recording one: a private group, a bundled transcript, and
 * the REAL extractor — so the confirm screen the user lands on is the genuine MOM flow. Never
 * forced, once per account, and deleting the group takes it all away again.
 */
export async function createSampleMeeting(timeZone = '') {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false as const, error: 'Unauthorized' };
  const userId = session.user.id;
  await connectToDatabase();
  // $addToSet returns matchedCount 0 when 'sample' is already there, so a double click cannot
  // create two groups (and spend two extraction calls)
  const claimed = await User.updateOne({ _id: userId, introDone: { $ne: 'sample' } }, { $addToSet: { introDone: 'sample' } });
  if (!claimed.modifiedCount) return { success: false as const, error: 'The sample meeting was already created' };

  const project = await Project.create({ name: 'Sample: product launch', ownerId: userId, memberEmails: [] });
  const mom = await Mom.create({ userId, projectId: project._id, title: 'Sample: launch planning', transcript: SAMPLE_TRANSCRIPT });
  const ex = await extractMomTasks(String(mom._id), timeZone);
  revalidatePath('/');
  // The meeting exists either way; the page's "Extract again" covers a failed AI call
  return { success: true as const, projectId: String(project._id), extracted: ex.success, error: ex.success ? undefined : ex.error };
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
