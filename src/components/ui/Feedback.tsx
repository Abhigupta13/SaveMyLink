'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }
interface ConfirmOpts { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

/** In-app toasts + confirm dialog — replaces the browser's alert()/confirm(). */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { id: number }) | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts(t => [...t, { id, kind, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>(resolve => {
    resolver.current = resolve;
    setDialog({ ...opts, id: nextId.current++ });
  }), []);

  const settle = (value: boolean) => { resolver.current?.(value); resolver.current = null; setDialog(null); };

  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info }[toasts[0]?.kind || 'info'];

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => {
          const I = { success: CheckCircle2, error: AlertCircle, info: Info }[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <I size={17} style={{ flexShrink: 0 }} />
              <span>{t.message}</span>
              <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
            </div>
          );
        })}
      </div>

      {dialog && (
        <div className="confirm-overlay" onClick={() => settle(false)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className={`confirm-icon ${dialog.danger ? 'danger' : ''}`}>
              <AlertTriangle size={20} />
            </div>
            <h3>{dialog.title}</h3>
            {dialog.message && <p>{dialog.message}</p>}
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => settle(false)} autoFocus>
                {dialog.cancelLabel || 'Cancel'}
              </button>
              <button className={`confirm-ok ${dialog.danger ? 'danger' : ''}`} onClick={() => settle(true)}>
                {dialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(Ctx);
  // Safe fallback if a component renders outside the provider
  if (!ctx) return { toast: (m) => console.warn('[toast]', m), confirm: async () => true };
  return ctx;
}
