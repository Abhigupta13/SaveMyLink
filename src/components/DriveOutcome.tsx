'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFeedback } from '@/components/ui/Feedback';
import { DRIVE_OUTCOME_MESSAGE, type DriveOutcome } from '@/lib/driveConnect';

/**
 * Say what happened when somebody comes back from Google.
 *
 * The connect flow can land you back on any page — the locker, a note, the profile — so this is
 * mounted once in the layout rather than repeated on each of them. Without it a refused or
 * half-granted consent returns silently and the next upload fails for no visible reason, which is
 * the worst version of this: the person did the thing they were asked to do and nothing said no.
 *
 * The parameter is stripped afterwards so a refresh, or the Android back gesture, does not replay a
 * message about something that happened five minutes ago.
 */
export default function DriveOutcome() {
  const params = useSearchParams();
  const { toast } = useFeedback();
  const said = useRef<string | null>(null);

  useEffect(() => {
    const outcome = params.get('drive') as DriveOutcome | null;
    if (!outcome || said.current === outcome) return;
    const message = DRIVE_OUTCOME_MESSAGE[outcome];
    if (!message) return;
    said.current = outcome;
    toast(message.text, message.kind);

    // history.replaceState, not router.replace: this is a cosmetic tidy-up of the address bar and
    // must not re-render the page somebody has just landed on.
    const url = new URL(window.location.href);
    url.searchParams.delete('drive');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [params, toast]);

  return null;
}
