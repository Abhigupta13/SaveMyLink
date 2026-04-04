'use client';
import { useUser } from './UserContext';
import { migrateExistingLinksToPrivate } from '@/actions/link';
import { useState } from 'react';

export default function UserProfileSidebar() {
  const { isSidebarOpen, setSidebarOpen, privateSafe, setPrivateSafe, setPinModalOpen } = useUser();
  const [isMigrating, setIsMigrating] = useState(false);

  if (!isSidebarOpen) return null;

  const handleMigration = async () => {
    if (!confirm('Mark all existing links as Private?')) return;
    setIsMigrating(true);
    const res = await migrateExistingLinksToPrivate();
    if (res.success) {
      alert(`Migrated ${res.modifiedCount} links to Private Safe.`);
    } else {
      alert('Migration failed: ' + res.error);
    }
    setIsMigrating(false);
  };

  const handleTogglePrivate = () => {
    if (!privateSafe) {
      // Turning ON: Ask for PIN
      setPinModalOpen(true);
    } else {
      // Turning OFF: Just turn off
      setPrivateSafe(false);
    }
  };

  return (
    <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}>
      <div className="sidebar-content" onClick={e => e.stopPropagation()}>
        <div className="sidebar-header">
          <div className="user-avatar-large">U</div>
          <div className="user-info">
            <h3 className="user-name">Abhishek Gupta</h3>
            <p className="user-email">abhishek@example.com</p>
          </div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>&times;</button>
        </div>

        <div className="sidebar-menu">
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

          <div className="menu-item" onClick={handleMigration}>
            <span className="menu-item-icon">🔄</span>
            <div className="menu-text">
              <span className="menu-label">{isMigrating ? 'Migrating...' : 'Migrate All to Private'}</span>
              <span className="menu-sublabel">One-time action for existing links</span>
            </div>
          </div>

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
          <button className="btn-logout">Log Out</button>
        </div>
      </div>
    </div>
  );
}
