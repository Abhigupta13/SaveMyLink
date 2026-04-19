import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import LandingPage from '@/components/LandingPage';
import Link from 'next/link';

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return <LandingPage />;
  }

  const user = session.user as any;

  return (
    <main className="container dashboard-container">
      <div className="dashboard-welcome">
        <div className="user-profile-header">
          <div className="user-avatar-large">
            {user.name ? user.name[0].toUpperCase() : (user.email ? user.email[0].toUpperCase() : 'U')}
          </div>
          <div className="user-info-text">
            <h1>Welcome back, {user.name || 'User'}!</h1>
            <p>{user.email}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <Link href="/links" className="dash-card primary">
          <div className="dash-card-icon">🔗</div>
          <div className="dash-card-info">
            <h3>My Links</h3>
            <p>Organize, search and manage your link collections.</p>
          </div>
          <div className="dash-card-arrow">→</div>
        </Link>

        <Link href="/social" className="dash-card secondary">
          <div className="dash-card-icon">🌐</div>
          <div className="dash-card-info">
            <h3>Social Hub</h3>
            <p>Your centralized view for all social networks.</p>
          </div>
          <div className="dash-card-arrow">→</div>
        </Link>

        <div className="dash-card tertiary accent">
          <div className="dash-card-icon">👥</div>
          <div className="dash-card-info">
            <h3>Contacts</h3>
            <p>Manage your professional and social connections.</p>
          </div>
          <span className="dash-status">COMING SOON</span>
        </div>

        <div className="dash-card info-card">
          <div className="dash-card-icon">🔐</div>
          <div className="dash-card-info">
            <h3>Private Safe</h3>
            <p>End-to-end encryption for your sensitive data.</p>
          </div>
          <span className="dash-status">SECURE</span>
        </div>
      </div>
      
      <section className="dashboard-promo">
        <div className="promo-content">
          <h2>Getting Started</h2>
          <p>SaveMyLink is built for speed. Use the <strong>Search</strong> button in the Links tab to quickly find what you need on the go.</p>
          <Link href="/links" className="btn-explore">Go to Links</Link>
        </div>
      </section>
    </main>
  );
}
