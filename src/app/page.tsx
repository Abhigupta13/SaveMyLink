import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import LandingPage from '@/components/LandingPage';
import HomeTiles from '@/components/HomeTiles';
import Wordmark from '@/components/brand/Wordmark';
import GettingStarted from '@/components/GettingStarted';
import { introStatus } from '@/actions/intro';
import { weeklyDigest } from '@/lib/digest';
import { NeedsAttention, SavedThisWeek } from '@/components/DigestSections';

/** Enough to be worth the scroll, few enough that Home is still a glance. */
const HOME_LIMIT = 4;

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) return <LandingPage />;
  const user = session.user as { id: string; name?: string | null };
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
        <Wordmark className="home-wordmark" size={20} />
        <h1>Hi, {user.name?.split(' ')[0] || 'there'}</h1>
        <p>What&apos;s on your mind?</p>
      </header>

      {intro && <GettingStarted progress={intro} />}

      <HomeTiles />

      {/* Below the vault, in the order the day actually runs: what is chasing you, then what you
          put in this week. Capped and linked through to /digest rather than reprinted in full. */}
      <div className="home-digest">
        <NeedsAttention tasks={digest.tasks} limit={HOME_LIMIT} href="/digest" />
        <SavedThisWeek links={digest.links} limit={HOME_LIMIT} href="/digest" />
      </div>
    </main>
  );
}
