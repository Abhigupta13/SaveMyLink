'use client';

import { Compass } from 'lucide-react';

/**
 * The tour spotlights real controls on real pages, so it cannot run on the page that describes it.
 * `tour:start` is the launcher Tour.tsx already listens for — it walks to Home itself as step one,
 * which is why this does not push a route of its own. Same event GettingStarted uses.
 */
export default function StartTourButton() {
  return (
    <button className="g-cta" onClick={() => window.dispatchEvent(new Event('tour:start'))}>
      <Compass size={18} strokeWidth={2.2} /> Start the tour
    </button>
  );
}
