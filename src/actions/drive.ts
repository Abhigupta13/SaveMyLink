'use server';

/**
 * The two things a user can do to their own Drive connection from inside the app: see it, and end
 * it. Connecting itself is a redirect, so it lives in /api/drive/connect — a server action cannot
 * send a browser to Google's consent screen.
 *
 * Two rules the code has to keep, both the same shape as src/actions/sarvamKey.ts:
 *   1. The sealed refresh token never leaves the server. `driveStatus` selects display fields by
 *      name; there is no path where `drive.box` reaches a component, a prop, or a payload.
 *   2. There is no userId argument. The session IS the identity, so there is nothing to tamper
 *      with — nobody can read or sever somebody else's connection by guessing an id.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { open } from '@/lib/secretBox';
import { driveAccessToken, forgetDriveToken } from '@/lib/driveAuth';
import { about } from '@/lib/drive';

async function me() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  await connectToDatabase();
  return session.user.id;
}

export type DriveStatus = {
  connected: boolean;
  email: string;
  revoked: boolean;
  quota?: { limit?: number; usage?: number };
};

export async function driveStatus() {
  try {
    const userId = await me();
    if (!userId) return { success: false as const, error: 'Unauthorized' };

    // Named fields, never the whole subdocument: `drive.box` is a live credential and this result
    // is on its way to a browser.
    const user = await User.findById(userId)
      .select('drive.email drive.revokedAt drive.connectedAt')
      .lean<{ drive?: { email?: string; revokedAt?: Date | null; connectedAt?: Date } } | null>();

    const revoked = !!user?.drive?.revokedAt;
    const connected = !!user?.drive?.connectedAt && !revoked;
    const status: DriveStatus = { connected, email: user?.drive?.email || '', revoked };

    // How full their Drive is, best-effort. Worth one call because "upload failed" is a mystery
    // and "your Drive is full" is an instruction, and this is where they will come to look.
    if (connected) {
      const token = await driveAccessToken(userId);
      if (token) {
        try {
          const info = await about(token);
          status.quota = { limit: info.limit, usage: info.usage };
        } catch { /* quota is decoration; a failed call must not read as disconnected */ }
      } else {
        // The refresh just failed. driveAccessToken stamps revokedAt on invalid_grant, so re-read
        // rather than guess — a network blip is not a revoked connection.
        const now = await User.findById(userId).select('drive.revokedAt')
          .lean<{ drive?: { revokedAt?: Date | null } } | null>();
        if (now?.drive?.revokedAt) { status.connected = false; status.revoked = true; }
      }
    }

    return { success: true as const, ...status };
  } catch (error) {
    console.error('Failed to read Drive status:', error);
    return { success: false as const, error: 'Could not check your Drive connection' };
  }
}

/**
 * End the connection. Google is told first so the refresh token is dead even if it were somehow
 * recovered afterwards, then the whole `drive` field goes.
 *
 * Files already in Drive are NOT touched — they are in the user's own account, we only ever had
 * permission to add to it, and deleting someone's documents because they unplugged an integration
 * would be indefensible. The confirm copy in DriveCard says exactly that, and must keep saying it.
 */
export async function disconnectDrive() {
  try {
    const userId = await me();
    if (!userId) return { success: false as const, error: 'Unauthorized' };

    const user = await User.findById(userId).select('drive.box').lean<{ drive?: { box?: string } } | null>();
    const refreshToken = open(user?.drive?.box);

    if (refreshToken) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        });
      } catch (error) {
        // Best-effort: an already-revoked token answers 400, and Google being unreachable must not
        // trap the user in a connection they have asked to leave.
        console.error('Drive revoke call failed (continuing to disconnect):', error);
      }
    }

    await User.updateOne({ _id: userId }, { $unset: { drive: 1 } });
    forgetDriveToken(userId);   // otherwise a cached access token keeps working for up to an hour
    return { success: true as const };
  } catch (error) {
    console.error('Failed to disconnect Drive:', error);
    return { success: false as const, error: 'Could not disconnect your Drive' };
  }
}
