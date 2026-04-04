'use client';
import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/actions/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setIsLoading(true);

    const res = await forgotPassword(email);
    if (res.success) {
      setMessage(res.message || 'Reset link sent!');
    } else {
      setError(res.error || 'Failed to send reset link');
    }
    setIsLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2 className="auth-title">Reset Password</h2>
        <p className="auth-subtitle">We'll send you a link to your email</p>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-success" style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '8px', fontSize: '0.9rem', marginBottom: '16px' }}>{message}</div>}
          
          <div className="input-group">
            <label>Email Address</label>
            <input 
              type="email" 
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Sending Link...' : 'Send Reset Link'}
          </button>
        </form>

        <p className="auth-footer">
          Suddenly remembered? <Link href="/auth/signin">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
