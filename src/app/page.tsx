import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import LandingPage from '@/components/LandingPage';
import Link from 'next/link';
import { Link as LinkIcon, CheckSquare, Mic, Library, Users, Globe, Search, Newspaper, StickyNote } from 'lucide-react';
import SafeTile from '@/components/SafeTile';

const TILES = [
  { href: '/links', icon: LinkIcon, title: 'Links', desc: 'Saved links & categories' },
  { href: '/notes', icon: StickyNote, title: 'Notes', desc: 'Quick thoughts & long notes' },
  { href: '/tasks', icon: CheckSquare, title: 'Tasks', desc: 'Personal + project tasks with reminders' },
  { href: '/mom', icon: Mic, title: 'MOM', desc: 'Record meetings → summary → tasks' },
  { href: '/d-locker', icon: Library, title: 'D-locker', desc: 'Documents & files' },
  { href: '/contacts', icon: Users, title: 'Contacts', desc: 'People you work with' },
  { href: '/social', icon: Globe, title: 'Apps', desc: 'One-tap launcher for your apps' },
  { href: '/search', icon: Search, title: 'Search', desc: 'Across links, tasks, notes, meetings' },
  { href: '/digest', icon: Newspaper, title: 'Weekly digest', desc: 'Saved this week · due next week' },
];

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) return <LandingPage />;
  const user = session.user as any;

  return (
    <main className="container dashboard-container">
      <header className="home-greeting">
        <span className="home-wordmark">ALL <span>YOU NEED</span></span>
        <h1>Hi, {user.name?.split(' ')[0] || 'there'}</h1>
        <p>What's on your mind?</p>
      </header>

      <div className="dashboard-grid hub-grid">
        {TILES.map(({ href, icon: Icon, title, desc }) => (
          <Link key={href} href={href} className="dash-card hub-card">
            <div className="dash-card-icon"><Icon size={26} strokeWidth={2.2} /></div>
            <div className="dash-card-info">
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          </Link>
        ))}
        <SafeTile />
      </div>
    </main>
  );
}
