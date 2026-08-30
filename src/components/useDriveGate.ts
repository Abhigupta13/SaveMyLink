'use client';

import { useCallback } from 'react';
import { driveStatus } from '@/actions/drive';
import { useFeedback } from '@/components/ui/Feedback';
import { goConnectDrive } from '@/lib/driveConnect';

/**
 * Ask before the file picker, not after the upload.
 *
 * Files live in the user's own Google Drive, so an upload with no Drive connected cannot work. The
 * old order — pick a file, wait, fail, explain — spends someone's time before telling them, and on
 * a phone that means watching a spinner over a 4MB photo for nothing. This asks first, and if they
 * say yes it takes them to Google and brings them back to the page they were on.
 *
 * Returns true when the caller may proceed to open the picker. False means either they declined, or
 * they are already on their way to Google — either way there is nothing more for the caller to do.
 *
 * The server checks again at upload time regardless; this only stops offering what would fail.
 */
export function useDriveGate() {
  const { confirm } = useFeedback();

  return useCallback(async (returnTo?: string): Promise<boolean> => {
    let status: { connected: boolean; revoked: boolean };
    try {
      // driveStatus returns a success/error union; a failed read is "not connected", not a crash.
      const r = await driveStatus() as { connected?: boolean; revoked?: boolean };
      status = { connected: !!r?.connected, revoked: !!r?.revoked };
    } catch {
      // The check itself failing is not a reason to block an upload — let them try, and let the
      // server give the real answer.
      return true;
    }
    if (status.connected && !status.revoked) return true;

    const ok = await confirm({
      title: status.revoked ? 'Reconnect Google Drive?' : 'Connect Google Drive?',
      message: status.revoked
        ? 'Google is no longer letting us add files to your Drive. Reconnect to upload again — nothing already saved has been lost.'
        : 'Your files are saved to your own Google Drive, in a folder called ALL-YOU-NEED, so uploading needs it connected. We will bring you straight back here.',
      confirmLabel: status.revoked ? 'Reconnect' : 'Connect Drive',
    });
    if (ok) goConnectDrive(returnTo);
    return false;
  }, [confirm]);
}
