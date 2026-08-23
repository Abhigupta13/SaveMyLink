'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getPinStatus, verifyPrivatePin, getSafeStatus } from '@/actions/pin';

interface UserContextType {
  privateSafe: boolean;
  isSidebarOpen: boolean;
  isPinModalOpen: boolean;
  hasPin: boolean;
  setPrivateSafe: (value: boolean) => void;
  setSidebarOpen: (value: boolean) => void;
  setPinModalOpen: (value: boolean) => void;
  verifyPin: (pin: string) => Promise<boolean>;
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

  // Persistence (Sync with Cookie & URL)
  useEffect(() => {
    const getCookie = (name: string) => {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? match[2] : null;
    };
    
    const searchParams = new URLSearchParams(window.location.search);
    const inUrl = searchParams.get('private') === 'true';
    const inCookie = getCookie('privateSafe') === 'true';
    
    if (inUrl || inCookie) {
      // Cookie/URL is only a hint — the server-side PIN grant decides
      getSafeStatus().then(({ safe }) => {
        if (safe) {
          setPrivateSafeState(true);
          if (inUrl && !inCookie) {
            document.cookie = `privateSafe=true; path=/; max-age=${30 * 24 * 60 * 60}`;
          }
        } else {
          document.cookie = 'privateSafe=false; path=/; max-age=0';
        }
      });
    }
  }, []);

  const setPrivateSafe = (value: boolean) => {
    setPrivateSafeState(value);
    document.cookie = `privateSafe=${value}; path=/; max-age=${30 * 24 * 60 * 60}`;
    setSidebarOpen(false);
    router.refresh();
  };

  const verifyPin = async (pin: string) => {
    const res = await verifyPrivatePin(pin);
    return res.success === true;
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
