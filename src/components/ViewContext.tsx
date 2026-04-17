'use client';
import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

const ViewContext = createContext<{
  columns: number;
  toggleColumns: () => void;
}>({ columns: 2, toggleColumns: () => {} });

export function ViewProvider({ children, initialColumns = 2 }: { children: ReactNode, initialColumns?: number }) {
  const [columns, setColumns] = useState(initialColumns);
  
  useEffect(() => {
    // Sync with cookie for server-side knowledge
    document.cookie = `columns=${columns}; path=/; max-age=31536000; SameSite=Lax`;
  }, [columns]);

  const toggleColumns = () => setColumns(prev => {
    if (prev === 1) return 2;
    if (prev === 2) return 4;
    return 1;
  });

  return (
    <ViewContext.Provider value={{ columns, toggleColumns }}>
      {children}
    </ViewContext.Provider>
  );
}

export function useView() {
  return useContext(ViewContext);
}
