import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import LandingPage from '@/components/LandingPage';
import HomeTiles from '@/components/HomeTiles';

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) return <LandingPage />;
  const user = session.user as any;

  return (
    <main className="page">
      <header className="home-greeting">
        <span className="home-wordmark">ALL <span>YOU NEED</span></span>
        <h1>Hi, {user.name?.split(' ')[0] || 'there'}</h1>
        <p>What&apos;s on your mind?</p>
      </header>

      <HomeTiles />
    </main>
  );
}
