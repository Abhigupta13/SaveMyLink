'use client';

import { useUser } from './UserContext';
import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import BulkImportModal from './BulkImportModal';
import { refreshAllMetadata } from '@/actions/link';

export default function UserProfileSidebar() {
  const { isSidebarOpen, setSidebarOpen, privateSafe, setPrivateSafe, setPinModalOpen } = useUser();
  const { data: session } = useSession();
  const [isBulkModalOpen, setBulkModalOpen] = useState(false);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [metadataRefreshResult, setMetadataRefreshResult] = useState<string | null>(null);

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

  const handleReloadAllPreviews = async () => {
    setIsRefreshingMetadata(true);
    setMetadataRefreshResult(null);
    const res: any = await refreshAllMetadata(privateSafe);
    if (res?.success) {
      setMetadataRefreshResult(
        `Updated ${res.successCount}/${res.total} links${res.failedCount ? ` (${res.failedCount} failed)` : ''}.`
      );
    } else {
      setMetadataRefreshResult(res?.error || 'Failed to refresh metadata.');
    }
    setIsRefreshingMetadata(false);
  };

  return (
    <>
      <div className={`sidebar-panel-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}>
        <div className="sidebar-panel" onClick={e => e.stopPropagation()}>
          <div className="sidebar-header" style={{ padding: '40px 24px 32px', position: 'relative', background: 'linear-gradient(to bottom, var(--bg-secondary), var(--bg-color))' }}>
            <button 
              className="sidebar-close" 
              onClick={() => setSidebarOpen(false)} 
              style={{ position: 'absolute', top: '24px', left: '20px', fontSize: '1.5rem', opacity: 0.6 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginTop: '20px' }}>
              <div className="user-avatar-large" style={{ 
                width: '80px', height: '80px', fontSize: '2rem', marginBottom: '16px', 
                boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)', border: '4px solid var(--bg-color)'
              }}>
                {session?.user?.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="user-info">
                <h3 className="user-name" style={{ fontSize: '1.5rem', marginBottom: '4px' }}>{session?.user?.name || 'Guest User'}</h3>
                <p className="user-email" style={{ fontSize: '0.9rem', opacity: 0.7 }}>{session?.user?.email || 'Your digital companion'}</p>
              </div>
            </div>
          </div>

          <div className="sidebar-menu" style={{ overflowY: 'auto', padding: '12px' }}>
            {!session && (
              <div style={{ padding: '0 12px 24px' }}>
                <Link href="/auth/signin" className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '52px', borderRadius: '16px', fontWeight: 800 }} onClick={() => setSidebarOpen(false)}>
                  Sign In
                </Link>
              </div>
            )}

            <div className="menu-group-label" style={{ padding: '24px 16px 8px', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Security & Tools</div>

            <div className="menu-item" onClick={handleTogglePrivate} style={{ 
              justifyContent: 'space-between', padding: '16px', borderRadius: '18px', margin: '4px 0' 
            }}>
              <div className="menu-item-info" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: privateSafe ? 'var(--accent-soft)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.2rem' }}>{privateSafe ? '🔓' : '🔒'}</span>
                </div>
                <div className="menu-text">
                  <span className="menu-label" style={{ fontWeight: 700 }}>Private Safe</span>
                  <span className="menu-sublabel" style={{ fontSize: '0.75rem', opacity: 0.6 }}>Encryption enabled</span>
                </div>
              </div>
              <div
                className="switch"
                role="switch"
                aria-checked={privateSafe}
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePrivate();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleTogglePrivate();
                  }
                }}
              >
                <input 
                  type="checkbox" 
                  checked={privateSafe} 
                  readOnly
                  aria-hidden="true"
                />
                <span className="slider round"></span>
              </div>
            </div>

            <button 
              className="menu-item" 
              onClick={() => { setBulkModalOpen(true); }}
              style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left', padding: '16px', borderRadius: '18px', margin: '4px 0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.2rem' }}>📤</span>
                </div>
                <div className="menu-text">
                  <span className="menu-label" style={{ fontWeight: 700 }}>Bulk Import</span>
                  <span className="menu-sublabel" style={{ fontSize: '0.75rem', opacity: 0.6 }}>Paste list or CSV</span>
                </div>
              </div>
            </button>

            <button
              className="menu-item"
              onClick={handleReloadAllPreviews}
              disabled={isRefreshingMetadata}
              style={{
                width: '100%',
                border: 'none',
                background: 'none',
                textAlign: 'left',
                padding: '16px',
                borderRadius: '18px',
                margin: '4px 0',
                opacity: isRefreshingMetadata ? 0.7 : 1
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.2rem' }}>↻</span>
                </div>
                <div className="menu-text">
                  <span className="menu-label" style={{ fontWeight: 700 }}>
                    {isRefreshingMetadata ? 'Reloading...' : 'Reload previews & names'}
                  </span>
                  <span className="menu-sublabel" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                    Refresh all {privateSafe ? 'private' : 'visible'} links
                  </span>
                </div>
              </div>
            </button>

            {metadataRefreshResult && (
              <div style={{ padding: '0 16px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {metadataRefreshResult}
              </div>
            )}

            <div className="menu-group-label" style={{ padding: '24px 16px 8px', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Preference</div>

            <div className="menu-item" style={{ padding: '16px', borderRadius: '18px', margin: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.2rem' }}>⭐</span>
                </div>
                <div className="menu-text" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="menu-label" style={{ fontWeight: 700 }}>Pro Content</span>
                    <span style={{ background: 'var(--accent-color)', color: 'white', fontSize: '0.6rem', padding: '2px 6px', borderRadius: '6px', fontWeight: 800 }}>PRO</span>
                  </div>
                  <span className="menu-sublabel" style={{ fontSize: '0.75rem', opacity: 0.6 }}>Unlock everything</span>
                </div>
              </div>
            </div>
            
            <div className="menu-item" style={{ padding: '16px', borderRadius: '18px', margin: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.2rem' }}>⚙️</span>
                </div>
                <div className="menu-text">
                  <span className="menu-label" style={{ fontWeight: 700 }}>App Settings</span>
                  <span className="menu-sublabel" style={{ fontSize: '0.75rem', opacity: 0.6 }}>Themes & Layout</span>
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar-footer" style={{ padding: '24px', marginTop: 'auto', borderTop: '1px solid var(--border-color)' }}>
            {session ? (
              <button 
                className="btn-logout" 
                onClick={handleLogout}
                style={{ 
                  width: '100%', height: '52px', borderRadius: '16px', background: 'rgba(239, 68, 68, 0.1)', 
                  color: '#ef4444', fontWeight: 800, border: '1px solid rgba(239, 68, 68, 0.2)',
                  transition: 'var(--transition)'
                }}
              >
                Log Out
              </button>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 800 }}>
                  ALL YOU NEED v1.0 • ✨
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <BulkImportModal 
        isOpen={isBulkModalOpen} 
        onClose={() => setBulkModalOpen(false)} 
      />

      <style jsx>{`
        .menu-item:hover {
          background: var(--bg-secondary) !important;
          transform: translateX(4px);
        }
        .btn-logout:hover {
          background: #ef4444 !important;
          color: white !important;
        }
      `}</style>
    </>
  );
}
