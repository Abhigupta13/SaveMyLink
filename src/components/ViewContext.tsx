'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

const ViewContext = createContext<{
  columns: number;
  toggleColumns: () => void;
}>({ columns: 1, toggleColumns: () => {} });

export function ViewProvider({ children }: { children: ReactNode }) {
  const [columns, setColumns] = useState(1);
  const toggleColumns = () => setColumns(prev => (prev === 1 ? 2 : 1));

  return (
    <ViewContext.Provider value={{ columns, toggleColumns }}>
      {children}
    </ViewContext.Provider>
  );
}

export function useView() {
  return useContext(ViewContext);
}
