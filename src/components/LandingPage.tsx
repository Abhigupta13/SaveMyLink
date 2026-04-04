'use client';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="landing-page">
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">Securely Save & Organize <br/><span className="gradient-text">Your Digital Treasure</span></h1>
          <p className="hero-subtitle">
            A premium link manager with a built-in Private Safe. 
            Keep your favorites organized and your secrets locked away.
          </p>
          <div className="hero-actions">
            <Link href="/auth/signup" className="btn-primary hero-btn">Get Started for Free</Link>
            <Link href="/auth/signin" className="btn-secondary hero-btn">Sign In to Your Vault</Link>
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
        <p>&copy; 2026 SaveMyLink. Build your personal vault today.</p>
      </footer>
    </div>
  );
}
