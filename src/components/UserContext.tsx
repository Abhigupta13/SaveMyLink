'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getPinStatus, verifyPrivatePin, getSafeStatus, lockPrivateSafe } from '@/actions/pin';
import { invalidatePersonalDataCaches } from '@/lib/appDataCache';

interface UserContextType {
  privateSafe: boolean;
  isSidebarOpen: boolean;
  isPinModalOpen: boolean;
  hasPin: boolean;
  setPrivateSafe: (value: boolean) => void;
  setSidebarOpen: (value: boolean) => void;
  setPinModalOpen: (value: boolean) => void;
  verifyPin: (pin: string) => Promise<{ ok: boolean; error: string }>;
  refreshPinStatus: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [privateSafe, setPrivateSafeState] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isPinModalOpen, setPinModalOpen] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const router = useRouter();
  const { data: session, status } = useSession();

  const refreshPinStatus = async () => {
    try {
      const res = await getPinStatus();
      if (res.success) {
        setHasPin(res.hasPin || false);
      }
    } catch (err) {
      console.error('Failed to refresh PIN status:', err);
    }
  };

  // Sync PIN status when session changes
  useEffect(() => {
    if (status === 'authenticated') {
      refreshPinStatus();
    } else if (status === 'unauthenticated') {
      setHasPin(false);
      setPrivateSafeState(false);
    }
  }, [status, session]);

  // Persistence: cookie is a hint — the server-side PIN grant decides.
  useEffect(() => {
    const getCookie = (name: string) => {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? match[2] : null;
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get('private') === 'true') {
      params.delete('private');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }

    if (getCookie('privateSafe') === 'true') {
      getSafeStatus().then(({ safe }) => {
        if (safe) {
          setPrivateSafeState(true);
        } else {
          document.cookie = 'privateSafe=false; path=/; max-age=0';
        }
      });
    }
  }, []);

  const setPrivateSafe = (value: boolean) => {
    setPrivateSafeState(value);
    if (!value) lockPrivateSafe();   // destroy the server-side grant too
    document.cookie = `privateSafe=${value}; path=/; max-age=${30 * 24 * 60 * 60}`;
    setSidebarOpen(false);
    if (!value && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('private')) {
        params.delete('private');
        const qs = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      }
    }
    // Personal lists swap with the safe — drop client caches so the next view refetches once.
    invalidatePersonalDataCaches();
    router.refresh();
  };

  /* Returns the server's reason, not just a boolean. The safe now locks after repeated wrong
     guesses, and a caller that could only see true/false would keep showing "Incorrect PIN" to
     someone who is locked out — which reads as the app being broken rather than as the lockout
     working. */
  const verifyPin = async (pin: string) => {
    const res = await verifyPrivatePin(pin);
    return { ok: res.success === true, error: res.success ? '' : (res.error || 'Incorrect PIN. Please try again.') };
  };

  return (
    <UserContext.Provider value={{ 
      privateSafe, 
      isSidebarOpen, 
      isPinModalOpen,
      hasPin,
      setPrivateSafe, 
      setSidebarOpen, 
      setPinModalOpen,
      verifyPin,
      refreshPinStatus
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
