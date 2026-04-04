'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface UserContextType {
  privateSafe: boolean;
  isSidebarOpen: boolean;
  isPinModalOpen: boolean;
  setPrivateSafe: (value: boolean) => void;
  setSidebarOpen: (value: boolean) => void;
  setPinModalOpen: (value: boolean) => void;
  verifyPin: (pin: string) => boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [privateSafe, setPrivateSafeState] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isPinModalOpen, setPinModalOpen] = useState(false);
  const router = useRouter();

  // Persistence (Sync with Cookie)
  useEffect(() => {
    const getCookie = (name: string) => {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? match[2] : null;
    };
    
    const saved = getCookie('privateSafe');
    if (saved === 'true') {
      setPrivateSafeState(true);
    }
  }, []);

  const setPrivateSafe = (value: boolean) => {
    setPrivateSafeState(value);
    // Set cookie (valid for 30 days)
    document.cookie = `privateSafe=${value}; path=/; max-age=${30 * 24 * 60 * 60}`;
    router.refresh(); // Refresh to trigger server-side filtering
  };

  const verifyPin = (pin: string) => {
    // Default PIN for now
    return pin === '1234';
  };

  return (
    <UserContext.Provider value={{ 
      privateSafe, 
      isSidebarOpen, 
      isPinModalOpen,
      setPrivateSafe, 
      setSidebarOpen, 
      setPinModalOpen,
      verifyPin 
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
