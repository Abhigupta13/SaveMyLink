import { getServerSession } from 'next-auth/next';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import { safeZone, TZ_COOKIE } from '@/lib/time';
import LandingPage from '@/components/LandingPage';
import HomeTiles from '@/components/HomeTiles';
import Wordmark from '@/components/brand/Wordmark';
import GettingStarted from '@/components/GettingStarted';
import UpdateBanner from '@/components/UpdateBanner';
import NotificationsBell from '@/components/NotificationsBell';
import { introStatus } from '@/actions/intro';
import { weeklyDigest } from '@/lib/digest';
import { NeedsAttention, SavedThisWeek } from '@/components/DigestSections';

/** Enough to be worth the scroll, few enough that Home is still a glance. */
const HOME_LIMIT = 4;

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) return <LandingPage />;
  const user = session.user as { id: string; name?: string | null };
  // The viewer's own zone, published by components/TimeZoneCookie. safeZone because this arrives
  // from a cookie a client wrote, and an unknown zone string must not throw the home page.
  const timeZone = safeZone((await cookies()).get(TZ_COOKIE)?.value);
  const [intro, digest] = await Promise.all([
    introStatus(),
    // Home already renders behind the session; a digest failure must not take the whole page with
    // it, because Home is the one screen that has to open.
    weeklyDigest(user.id, (session.user.email || '').toLowerCase())
      .catch(err => { console.error('Home digest failed:', err); return { tasks: [], links: [] }; }),
  ]);

  return (
    <main className="page">
      <header className="home-greeting">
        {/* Home draws its own header, so the bell TopNav adds elsewhere has to be placed here too
            — otherwise the one screen people open most is the one with no way to reach it. */}
        <NotificationsBell className="home-bell" />
        <Wordmark className="home-wordmark" size={20} />
        <h1>Hi, {user.name?.split(' ')[0] || 'there'}</h1>
        <p>What&apos;s on your mind?</p>
      </header>

      {/* Native app only, and only when the installed APK is behind. The web is never out of date,
          so this renders nothing there. */}
      <UpdateBanner />

      {intro && <GettingStarted progress={intro} />}

      <HomeTiles />

      {/* Below the vault, in the order the day actually runs: what is chasing you, then what you
          put in this week. Capped and linked through to /digest rather than reprinted in full. */}
      <div className="home-digest">
        <NeedsAttention tasks={digest.tasks} limit={HOME_LIMIT} href="/digest" timeZone={timeZone} />
        <SavedThisWeek links={digest.links} limit={HOME_LIMIT} href="/digest" />
      </div>
    </main>
  );
}
