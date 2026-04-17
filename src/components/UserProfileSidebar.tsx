import { useUser } from './UserContext';
import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import BulkImportModal from './BulkImportModal';

export default function UserProfileSidebar() {
  const { isSidebarOpen, setSidebarOpen, privateSafe, setPrivateSafe, setPinModalOpen } = useUser();
  const { data: session } = useSession();
  const [isBulkModalOpen, setBulkModalOpen] = useState(false);

  if (!isSidebarOpen) return null;

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      signOut();
    }
  };

  const handleTogglePrivate = () => {
    if (!privateSafe) {
      setPinModalOpen(true);
    } else {
      setPrivateSafe(false);
    }
  };

  return (
    <>
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}>
        <div className="sidebar-content" onClick={e => e.stopPropagation()}>
          <div className="sidebar-header">
            <div className="user-avatar-large">
              {session?.user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="user-info">
              <h3 className="user-name">{session?.user?.name || 'Guest User'}</h3>
              <p className="user-email">{session?.user?.email || 'Sign in to sync your links'}</p>
            </div>
            <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>&times;</button>
          </div>

          <div className="sidebar-menu">
            {!session && (
              <div className="auth-menu-items" style={{ padding: '0 24px 20px' }}>
                <Link href="/auth/signin" className="btn-primary" style={{ width: '100%', marginBottom: '8px' }} onClick={() => setSidebarOpen(false)}>
                  Sign In
                </Link>
                <Link href="/auth/signup" style={{ display: 'block', textAlign: 'center', fontSize: '0.9rem', color: 'var(--accent-color)' }} onClick={() => setSidebarOpen(false)}>
                  Create an account
                </Link>
              </div>
            )}

            <div className="menu-item toggle-item">
              <div className="menu-item-info">
                <span className="menu-item-icon">🔒</span>
                <div className="menu-text">
                  <span className="menu-label">Private Safe</span>
                  <span className="menu-sublabel">Secure your private links</span>
                </div>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={privateSafe} 
                  onChange={handleTogglePrivate}
                />
                <span className="slider round"></span>
              </label>
            </div>

            <button 
              className="menu-item" 
              onClick={() => { setBulkModalOpen(true); }}
              style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left', padding: '16px 24px' }}
            >
              <span className="menu-item-icon">📤</span>
              <div className="menu-text">
                <span className="menu-label">Bulk Import Links</span>
                <span className="menu-sublabel">Paste links or upload CSV</span>
              </div>
            </button>

            <div className="menu-item">
              <span className="menu-item-icon">⭐</span>
              <div className="menu-text">
                <span className="menu-label">Pro Account</span>
                <span className="menu-sublabel">Join the premium club</span>
              </div>
            </div>
            
            <div className="menu-item">
              <span className="menu-item-icon">⚙️</span>
              <div className="menu-text">
                <span className="menu-label">Settings</span>
              </div>
            </div>
          </div>

          <div className="sidebar-footer">
            {session ? (
              <button className="btn-logout" onClick={handleLogout}>Log Out</button>
            ) : (
              <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                SaveMyLink v1.0
              </p>
            )}
          </div>
        </div>
      </div>

      <BulkImportModal 
        isOpen={isBulkModalOpen} 
        onClose={() => setBulkModalOpen(false)} 
      />
    </>
  );
}
