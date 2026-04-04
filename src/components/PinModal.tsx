'use client';
import { useState, useRef, useEffect } from 'react';
import { useUser } from './UserContext';

export default function PinModal() {
  const { isPinModalOpen, setPinModalOpen, setPrivateSafe, verifyPin } = useUser();
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isPinModalOpen) {
      setPin(['', '', '', '']);
      setError(false);
      setTimeout(() => inputs.current[0]?.focus(), 100);
    }
  }, [isPinModalOpen]);

  if (!isPinModalOpen) return null;

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);

    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pinString = pin.join('');
    if (verifyPin(pinString)) {
      setPrivateSafe(true);
      setPinModalOpen(false);
    } else {
      setError(true);
      setPin(['', '', '', '']);
      inputs.current[0]?.focus();
    }
  };

  const handleClose = () => {
    setPinModalOpen(false);
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content pin-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Enter Private Safe PIN</h2>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="pin-form">
          <div className="pin-inputs">
            {pin.map((digit, i) => (
              <input
                key={i}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                ref={el => { inputs.current[i] = el; }}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                className={`pin-input ${error ? 'error' : ''}`}
                autoComplete="off"
              />
            ))}
          </div>
          {error && <p className="pin-error">Incorrect PIN. Please try again.</p>}
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '12px' }}>
            Hint: Default PIN is 1234
          </p>
          <div className="modal-footer" style={{ justifyContent: 'center', marginTop: '20px' }}>
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>
              Unlock Private Safe
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
