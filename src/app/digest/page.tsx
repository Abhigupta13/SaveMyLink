import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { weeklyDigest } from '@/lib/digest';
import { safeZone, TZ_COOKIE } from '@/lib/time';
import { NeedsAttention, SavedThisWeek } from '@/components/DigestSections';

export default async function DigestPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/signin');
  const userId = (session.user as { id: string }).id;
  const email = (session.user.email || '').toLowerCase();

  const { tasks, links } = await weeklyDigest(userId, email);
  // The viewer's own zone, published by components/TimeZoneCookie. safeZone because this arrives
  // from a cookie a client wrote, and an unknown zone string must not throw the page.
  const timeZone = safeZone((await cookies()).get(TZ_COOKIE)?.value);

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <h1 className="dg-title">Weekly digest</h1>
      <p className="dg-lede">Saved this week · due in the next 7 days</p>

      <NeedsAttention tasks={tasks} timeZone={timeZone} />
      <SavedThisWeek links={links} />
    </div>
  );
}
