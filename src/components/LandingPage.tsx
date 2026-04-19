'use client';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="landing-page">
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">ALL <span className="logo-light" style={{ color: 'inherit', fontWeight: 'inherit', opacity: 1, background: 'none', WebkitTextFillColor: 'initial' }}>you need</span> <br/><span className="gradient-text">In One Sanctuary</span></h1>
          <p className="hero-subtitle">
            Your personal digital companion. 
            Organize links, store documents, and access social hubs all in one secure place.
          </p>
          <div className="hero-actions">
            <Link href="/auth/signup" className="btn-primary hero-btn">Explore Your Sanctuary</Link>
            <Link href="/auth/signin" className="btn-secondary hero-btn">Sign In</Link>
          </div>
        </div>
        <div className="hero-visual">
          <div className="vault-illustration">
            <span className="vault-icon">🛡️</span>
            <div className="vault-glow"></div>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <span className="feature-icon">🔒</span>
          <h3>Private Safe</h3>
          <p>Encrypt your sensitive links with a 4-digit PIN. Only you can see what's inside.</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">📁</span>
          <h3>Category Magic</h3>
          <p>Organize anything from recipes to research into clean, searchable categories.</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">✨</span>
          <h3>Auto Previews</h3>
          <p>We automatically fetch titles and images for your links so they look beautiful.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <p>&copy; 2026 MYVOULT. Build your personal vault today.</p>
      </footer>
    </div>
  );
}
