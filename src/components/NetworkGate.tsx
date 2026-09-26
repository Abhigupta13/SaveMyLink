'use client';

import { useCallback, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * When the app is already open and the device loses connectivity, server actions and navigations
 * fail in confusing ways. A full-screen gate matches what native shells show and what users expect
 * from banking and travel apps — not an empty list that looks like data loss.
 */
export default function NetworkGate() {
  const [offline, setOffline] = useState(false);

  const sync = useCallback(() => {
    setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener('offline', sync);
    window.addEventListener('online', sync);
    return () => {
      window.removeEventListener('offline', sync);
      window.removeEventListener('online', sync);
    };
  }, [sync]);

  if (!offline) return null;

  return (
    <div className="network-offline-gate" role="alert">
      <div className="network-offline-card">
        <div className="network-offline-icon" aria-hidden>
          <WifiOff size={28} />
        </div>
        <p className="network-offline-title">No connection</p>
        <p className="network-offline-hint">
          Wi‑Fi or mobile data isn&apos;t reachable. Your notes and files are still safe — reconnect and try again.
        </p>
        <button
          type="button"
          className="btn-primary network-offline-retry"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
