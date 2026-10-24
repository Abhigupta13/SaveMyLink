'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

type NavIntent = {
  effectivePath: string;
  markNav: (href: string) => void;
};

const Ctx = createContext<NavIntent | null>(null);

/** Highlights the destination tab on tap, before the next screen paints. */
export function NavIntentProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navTarget, setNavTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!navTarget) return;
    const landed = navTarget === '/'
      ? pathname === '/'
      : pathname === navTarget || pathname.startsWith(`${navTarget}/`);
    if (landed) setNavTarget(null);
  }, [pathname, navTarget]);

  const effectivePath = navTarget ?? pathname;
  const markNav = (href: string) => setNavTarget(href);

  return (
    <Ctx.Provider value={{ effectivePath, markNav }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNavIntent(): NavIntent {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useNavIntent must be used within NavIntentProvider');
  }
  return ctx;
}
