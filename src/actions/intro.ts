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

  let project, mom;
  try {
    project = await Project.create({ name: 'Sample: product launch', ownerId: userId, memberEmails: [] });
    mom = await Mom.create({ userId, projectId: project._id, title: 'Sample: launch planning', transcript: SAMPLE_TRANSCRIPT });
  } catch (error) {
    // Nothing to land on yet, so hand the claim back — otherwise one failed insert means no retry, ever
    console.error('Sample meeting failed:', error);
    await User.updateOne({ _id: userId }, { $pull: { introDone: 'sample' } });
    if (project) await Project.deleteOne({ _id: project._id });
    return { success: false as const, error: 'Could not create the sample meeting — try again' };
  }
  const ex = await extractMomTasks(String(mom._id), timeZone);
  revalidatePath('/');
  // The meeting exists either way; the page's "Extract again" covers a failed AI call
  return { success: true as const, projectId: String(project._id), extracted: ex.success, error: ex.success ? undefined : ex.error };
}

/**
 * The spotlight tour's state. `autoStart` is true only for a brand-new account (nothing created
 * yet) that has not seen the tour — so it runs once on first login, and never re-triggers itself.
 * Replaying it from the Home or Profile launcher goes through the same component with a manual start.
 */
export async function tourStatus() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { done: true, autoStart: false };
  const userId = session.user.id;
  await connectToDatabase();
  const user = await User.findById(userId).select('tourDone').lean<{ tourDone?: boolean } | null>();
  if (user?.tourDone) return { done: true, autoStart: false };
  // Only auto-run on a truly empty account; a returning user replays it from a button instead.
  const [m, l, n, t, p] = await Promise.all([
    Mom.countDocuments({ userId }, { limit: 1 }),
    Link.countDocuments({ userId }, { limit: 1 }),
    Note.countDocuments({ userId }, { limit: 1 }),
    Task.countDocuments({ userId }, { limit: 1 }),
    Project.countDocuments({ ownerId: userId }, { limit: 1 }),
  ]);
  return { done: false, autoStart: !(m || l || n || t || p) };
}

export async function markTourDone() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false };
  await connectToDatabase();
  await User.updateOne({ _id: session.user.id }, { $set: { tourDone: true } });
  return { success: true };
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
