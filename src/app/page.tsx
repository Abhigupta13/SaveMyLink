import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import LandingPage from '@/components/LandingPage';
import HomeTiles from '@/components/HomeTiles';
import Wordmark from '@/components/brand/Wordmark';
import GettingStarted from '@/components/GettingStarted';
import { introStatus } from '@/actions/intro';

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) return <LandingPage />;
  const user = session.user as any;
  const intro = await introStatus();

  return (
    <main className="page">
      <header className="home-greeting">
        <Wordmark className="home-wordmark" size={20} />
        <h1>Hi, {user.name?.split(' ')[0] || 'there'}</h1>
        <p>What&apos;s on your mind?</p>
      </header>

      {intro && <GettingStarted progress={intro} />}

      <HomeTiles />
    </main>
  );
}
