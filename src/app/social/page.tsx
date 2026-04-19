'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getSocialApps, addSocialApp, deleteSocialApp, togglePinSocialApp } from '@/actions/social';

interface SocialAppType {
  _id: string;
  name: string;
  url: string;
  icon: string;
  color: string;
  isPinned: boolean;
}

export default function SocialPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [apps, setApps] = useState<SocialAppType[]>([]);
  const [selectedApp, setSelectedApp] = useState<SocialAppType | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [isIframeLoading, setIsIframeLoading] = useState(false);
  const [isAddingApp, setIsAddingApp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);

  // New App Form State
  const [newApp, setNewApp] = useState({ name: '', url: '', icon: '🌐', color: '#6366f1' });

  const fetchApps = useCallback(async () => {
    setIsLoading(true);
    const res = await getSocialApps();
    if (res.apps) {
      setApps(res.apps);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    } else if (status === 'authenticated') {
      fetchApps();
    }
  }, [status, router, fetchApps]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (selectedApp) {
      setIsIframeLoading(true);
      setShowFallback(false);
      timer = setTimeout(() => {
        setIsIframeLoading(false);
        setShowFallback(true);
      }, 4000);
    }
    return () => clearTimeout(timer);
  }, [selectedApp]);

  if (status === 'loading' || isLoading) {
    return (
      <div className="social-loading">
        <div className="loading-spinner"></div>
        <p>Loading your Social Hub...</p>
      </div>
    );
  }

  const handleAppClick = (app: SocialAppType) => {
    if (isEditMode) return; // Prevent opening apps in edit mode
    setSelectedApp(app);
  };

  const openInNewTab = () => {
    if (selectedApp) {
      window.open(selectedApp.url, '_blank');
      setShowFallback(false);
    }
  };

  const handleAddApp = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addSocialApp(newApp);
    if (res.success) {
      setIsAddingApp(false);
      setNewApp({ name: '', url: '', icon: '🌐', color: '#6366f1' });
      fetchApps();
    } else {
      alert(res.error || 'Failed to add app');
    }
  };

  const handleDeleteApp = async (e: React.MouseEvent, appId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('Are you sure you want to remove this platform?')) {
      const res = await deleteSocialApp(appId);
      if (res.success) {
        if (selectedApp?._id === appId) setSelectedApp(null);
        fetchApps();
      }
    }
  };

  const handleTogglePin = async (e: React.MouseEvent, app: SocialAppType) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await togglePinSocialApp(app._id, !app.isPinned);
    if (res.success) {
      fetchApps();
    }
  };

  return (
    <div className={`social-page-container ${selectedApp ? 'browser-view' : 'grid-view'}`}>
      {!selectedApp ? (
        <div className="social-grid-wrapper">
          <div className="social-grid-header">
            <div className="header-text">
              <h1 className="social-grid-title">Social Hub</h1>
              <p className="social-grid-subtitle">Your personalized social media dashboard</p>
            </div>
            <button 
              className={`edit-mode-toggle ${isEditMode ? 'active' : ''}`}
              onClick={() => setIsEditMode(!isEditMode)}
            >
              {isEditMode ? 'Done' : 'Edit'}
            </button>
          </div>
          
          <div className={`social-grid ${isEditMode ? 'editing' : ''}`}>
            {apps.map((app) => (
              <div 
                key={app._id} 
                className={`social-grid-item app-icon-box ${app.isPinned ? 'pinned' : ''} ${isEditMode ? 'jiggle' : ''}`}
                style={{ '--app-color': app.color } as any}
                onClick={() => handleAppClick(app)}
              >
                {isEditMode && (
                  <div className="social-item-actions">
                    <button 
                      className={`action-btn pin-btn ${app.isPinned ? 'active' : ''}`} 
                      onClick={(e) => handleTogglePin(e, app)}
                      title={app.isPinned ? 'Unpin' : 'Pin to top'}
                    >
                      📌
                    </button>
                    <button 
                      className="action-btn delete-btn" 
                      onClick={(e) => handleDeleteApp(e, app._id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="app-icon-squircle">
                  <div className="social-icon-box">{app.icon}</div>
                </div>
                <span className="social-label">{app.name}</span>
              </div>
            ))}
            
            {isEditMode && (
              <button className="social-grid-item add-btn" onClick={() => setIsAddingApp(true)}>
                <div className="app-icon-squircle dashed">
                  <div className="social-icon-box">+</div>
                </div>
                <span className="social-label">Add Platform</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="social-browser-layout">
          <aside className="social-sidebar">
            <button className="sidebar-back-btn" onClick={() => setSelectedApp(null)} title="Back to Hub">
              ←
            </button>
            <div className="sidebar-icons">
              {apps.map((app) => (
                <div key={app._id} className="sidebar-icon-wrapper">
                  <button 
                    className={`sidebar-icon-btn ${selectedApp._id === app._id ? 'active' : ''}`}
                    style={{ '--app-color': app.color } as any}
                    onClick={() => handleAppClick(app)}
                    title={app.name}
                  >
                    {app.icon}
                  </button>
                </div>
              ))}
              <button className="sidebar-icon-btn add-sidebar-btn" onClick={() => { setSelectedApp(null); setIsEditMode(true); setIsAddingApp(true); }}>+</button>
            </div>
          </aside>
          
          <main className="social-browser-main">
            <header className="browser-header">
              <div className="browser-info">
                <span className="browser-status-dot"></span>
                <span className="browser-app-name">{selectedApp.name}</span>
              </div>
              <div className="browser-actions">
                <button className="btn-open-pin" onClick={(e) => handleTogglePin(e, selectedApp)}>
                  {selectedApp.isPinned ? 'Unpin 📌' : 'Pin 📍'}
                </button>
                <button className="btn-open-new" onClick={openInNewTab}>
                  Open in New Tab ↗
                </button>
              </div>
            </header>
            
            <div className="iframe-content-area">
              {isIframeLoading && (
                <div className="iframe-loader">
                  <div className="loading-spinner"></div>
                  <p>Connecting to {selectedApp.name}...</p>
                </div>
              )}
              <iframe 
                key={selectedApp._id}
                src={selectedApp.url} 
                className="social-iframe" 
                title={selectedApp.name}
                onLoad={() => setIsIframeLoading(false)}
              />
              
              {showFallback && (
                <div className="fallback-modal-overlay">
                  <div className="fallback-modal">
                    <div className="fallback-icon">⚠️</div>
                    <h3>Connection Restricted</h3>
                    <p><strong>{selectedApp.name}</strong> has security policies that prevent it from loading inside other applications.</p>
                    <div className="fallback-actions">
                      <button className="btn-primary-large" onClick={openInNewTab}>Open in New Tab</button>
                      <button className="btn-ghost" onClick={() => setShowFallback(false)}>Wait Anyway</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* Add App Modal */}
      {isAddingApp && (
        <div className="modal-overlay" onClick={() => setIsAddingApp(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Social Platform</h2>
              <button className="close-btn" onClick={() => setIsAddingApp(false)}>×</button>
            </div>
            <form onSubmit={handleAddApp} className="add-app-form">
              <div className="form-group">
                <label>Platform Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Threads, Mastodon" 
                  value={newApp.name}
                  onChange={(e) => setNewApp({...newApp, name: e.target.value})}
                  required 
                />
              </div>
              <div className="form-group">
                <label>Website URL</label>
                <input 
                  type="url" 
                  placeholder="https://example.com" 
                  value={newApp.url}
                  onChange={(e) => setNewApp({...newApp, url: e.target.value})}
                  required 
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Icon (Emoji)</label>
                  <input 
                    type="text" 
                    value={newApp.icon}
                    onChange={(e) => setNewApp({...newApp, icon: e.target.value})}
                    style={{ fontSize: '1.5rem', textAlign: 'center' }}
                    maxLength={10}
                  />
                </div>
                <div className="form-group">
                  <label>Theme Color</label>
                  <div className="color-picker-wrap">
                    <input 
                      type="color" 
                      value={newApp.color}
                      onChange={(e) => setNewApp({...newApp, color: e.target.value})}
                    />
                    <span className="color-hex">{newApp.color}</span>
                  </div>
                </div>
              </div>
              <button type="submit" className="submit-btn">Add to Hub</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
