import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { weeklyDigest } from '@/lib/digest';
import { NeedsAttention, SavedThisWeek } from '@/components/DigestSections';

export default async function DigestPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/signin');
  const userId = (session.user as { id: string }).id;
  const email = (session.user.email || '').toLowerCase();

  const { tasks, links } = await weeklyDigest(userId, email);

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <h1 className="dg-title">Weekly digest</h1>
      <p className="dg-lede">Saved this week · due in the next 7 days</p>

      <NeedsAttention tasks={tasks} />
      <SavedThisWeek links={links} />
    </div>
  );
}
