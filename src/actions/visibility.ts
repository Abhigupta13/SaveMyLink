'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';

/** Which groups the first-share sheet has been shown for. '*' means "Don't show this again". */
export async function shareNoticeState() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { seen: [] as string[] };
  await connectToDatabase();
  const user = await User.findById(session.user.id).select('shareNoticeSeen').lean<{ shareNoticeSeen?: string[] } | null>();
  return { seen: user?.shareNoticeSeen || [] };
}

export async function markShareNoticeSeen(key: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false };
  // Only a project id or the wildcard — anything else the client sends is dropped, not stored
  if (key !== '*' && !/^[a-f0-9]{24}$/i.test(key)) return { success: false };
  await connectToDatabase();
  await User.updateOne({ _id: session.user.id }, { $addToSet: { shareNoticeSeen: key } });
  return { success: true };
}
