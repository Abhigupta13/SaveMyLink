'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

const PreviewContext = createContext<{
  showPreview: boolean;
  togglePreview: () => void;
}>({ showPreview: false, togglePreview: () => {} });

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [showPreview, setShowPreview] = useState(false);
  const togglePreview = () => setShowPreview(p => !p);

  return (
    <PreviewContext.Provider value={{ showPreview, togglePreview }}>
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview() {
  return useContext(PreviewContext);
}
