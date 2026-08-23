'use client';

import { useRouter } from 'next/navigation';
import { Lock, Unlock } from 'lucide-react';
import { useUser } from './UserContext';

// Home tile for the Private Safe: unlock via PIN, or jump into it if already open
export default function SafeTile() {
  const { privateSafe, setPinModalOpen } = useUser();
  const router = useRouter();
  const Icon = privateSafe ? Unlock : Lock;
  return (
    <button
      className="dash-card hub-card"
      style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
      onClick={() => privateSafe ? router.push('/links?private=true') : setPinModalOpen(true)}
    >
      <div className="dash-card-icon"><Icon size={26} strokeWidth={2.2} /></div>
      <div className="dash-card-info">
        <h3>Private Safe</h3>
        <p>{privateSafe ? 'Unlocked · open private links' : 'PIN-locked private links'}</p>
      </div>
    </button>
  );
}
