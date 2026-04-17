'use client';
import { useState, useRef, useEffect } from 'react';
import { useUser } from './UserContext';
import { setPrivatePin, resetPrivatePin } from '@/actions/pin';

export default function PinModal() {
  const { isPinModalOpen, setPinModalOpen, setPrivateSafe, verifyPin, hasPin, refreshPinStatus } = useUser();
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isPinModalOpen) {
      setPin(['', '', '', '']);
      setError('');
      setIsResetting(false);
      setPassword('');
      setIsSettingUp(!hasPin);
      setTimeout(() => inputs.current[0]?.focus(), 100);
    }
  }, [isPinModalOpen, hasPin]);

  // Auto-submit logic
  useEffect(() => {
    const pinString = pin.join('');
    if (pinString.length === 4 && !loading && !isResetting) {
      handleSubmit();
    }
  }, [pin]);

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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const pinString = pin.join('');
    if (pinString.length < 4) return;

    setLoading(true);
    setError('');

    try {
      if (isSettingUp) {
        const res = await setPrivatePin(pinString);
        if (res.success) {
          await refreshPinStatus();
          setPrivateSafe(true);
          setPinModalOpen(false);
        } else {
          setError(res.error || 'Failed to set PIN');
          setPin(['', '', '', '']);
          inputs.current[0]?.focus();
        }
      } else if (isResetting) {
        if (!password) {
          setError('Please enter your account password');
          setLoading(false);
          return;
        }
        const res = await resetPrivatePin(password, pinString);
        if (res.success) {
          await refreshPinStatus();
          setError('PIN reset successful! You can now unlock.');
          setIsResetting(false);
          setPin(['', '', '', '']);
          setPassword('');
        } else {
          setError(res.error || 'Reset failed. Check password.');
        }
      } else {
        const isValid = await verifyPin(pinString);
        if (isValid) {
          setPrivateSafe(true);
          setPinModalOpen(false);
        } else {
          setError('Incorrect PIN. Please try again.');
          setPin(['', '', '', '']);
          inputs.current[0]?.focus();
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) setPinModalOpen(false);
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content pin-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isSettingUp ? 'Set Private Safe PIN' : isResetting ? 'Reset Private PIN' : 'Enter Private Safe PIN'}
          </h2>
          <button className="modal-close" onClick={handleClose} disabled={loading}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="pin-form">
          {isResetting && (
            <div className="input-group" style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Verify Account Password
              </label>
              <div className="password-input-wrapper" style={{ position: 'relative' }}>
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="Enter your login password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', padding: '12px', paddingRight: '45px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  required
                />
                <button 
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '1.1rem',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="pin-hint" style={{ textAlign: 'center', marginBottom: '15px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {isResetting ? 'Enter a new 4-digit PIN' : isSettingUp ? 'Choose a 4-digit PIN to secure your safe' : 'Confirm your identity'}
          </div>

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
                className={`pin-input ${error && !isResetting ? 'error' : ''}`}
                autoComplete="off"
                disabled={loading}
              />
            ))}
          </div>

          {error && (
            <p className={`pin-error ${error.includes('successful') ? 'success' : ''}`} style={{ textAlign: 'center', marginTop: '15px', color: error.includes('successful') ? '#10b981' : '#f43f5e', fontSize: '0.9rem' }}>
              {error}
            </p>
          )}

          {isResetting ? (
            <div style={{ marginTop: '20px' }}>
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: '100%', marginBottom: '10px' }}
                disabled={loading || pin.join('').length < 4}
              >
                {loading ? 'Processing...' : 'Verify & Set New PIN'}
              </button>
              <button 
                type="button" 
                className="btn-ghost" 
                style={{ width: '100%', fontSize: '0.8rem' }}
                onClick={() => setIsResetting(false)}
                disabled={loading}
              >
                Back to Login
              </button>
            </div>
          ) : !isSettingUp && (
            <button 
              type="button" 
              className="reset-pin-btn"
              onClick={() => { setIsResetting(true); setError(''); }}
              style={{ display: 'block', margin: '20px auto 0', background: 'none', border: 'none', color: 'var(--accent-color)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Forgot PIN? Reset with password
            </button>
          )}

          {isSettingUp && (
             <button 
             type="submit" 
             className="btn-primary" 
             style={{ width: '100%', marginTop: '20px' }}
             disabled={loading || pin.join('').length < 4}
           >
             {loading ? 'Saving...' : 'Set PIN & Unlock'}
           </button>
          )}
        </form>
      </div>
    </div>
  );
}
