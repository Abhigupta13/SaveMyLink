'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/isAdmin";
import { escapeRegex } from "@/lib/regex";
import { envAllowlisted } from "@/lib/sarvam";
import { isValidObjectId } from "mongoose";
import { DEFAULT_TZ } from "@/lib/time";
import { User } from "@/lib/models/User";
import { Link } from "@/lib/models/Link";
import { Note } from "@/lib/models/Note";
import Task from "@/lib/models/Task";
import { Mom } from "@/lib/models/Mom";
import { Project } from "@/lib/models/Project";
import { Contact } from "@/lib/models/Contact";
import { Document as Doc } from "@/lib/models/Document";
import { Suggestion } from "@/lib/models/Suggestion";

/**
 * Numbers for /admin.
 *
 * COUNTS ONLY, on purpose. /terms tells users "we do not read your content", and this is the exact
 * surface where that stops being true if nobody holds the line. Everything worth knowing at this
 * stage — is anyone coming back, which features are dead, does the meeting-to-task loop actually
 * close — is answerable from counts, so the constraint costs nothing. Adding a per-user table or
 * anything showing a title, note body or transcript means changing that page too.
 */

const DAY = 86_400_000;
const TREND_DAYS = 14;

/** Whether to show the Admin row in Profile. A convenience only — getAdminStats is the real gate. */
export async function amIAdmin() {
  const session = await getServerSession(authOptions);
  return { admin: isAdmin(session?.user?.email) };
}

/**
 * Who may spend the founder's Sarvam balance.
 *
 * This is the ONE place in /admin that names individual users, and it is a deliberate exception
 * to the counts-only rule above: you cannot grant a person access without seeing which person.
 * It returns an address, a name and two booleans — never anything they have written.
 *
 * ponytail: a regex scan over users, capped at 50. There is no index for it and there should not
 * be one yet — this is two founders searching a few hundred rows. Add a text index when the
 * count makes it hurt.
 */
export async function listUsersForSarvam(q?: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false as const, error: 'Not found' };
    await connectToDatabase();

    const term = String(q || '').trim();
    const filter = term
      ? { $or: [{ email: new RegExp(escapeRegex(term), 'i') }, { name: new RegExp(escapeRegex(term), 'i') }] }
      : {};

    const users = await User.find(filter)
      .select('email name sarvamKey.last4 sarvamAccess sarvamAccessBy sarvamAccessAt')
      // Everyone who already has access first — the list is for checking as much as granting
      .sort({ sarvamAccess: -1, createdAt: -1 }).limit(50).lean();

    return {
      success: true as const,
      users: users.map(u => ({
        id: String(u._id),
        email: u.email,
        name: u.name || '',
        ownKey: !!u.sarvamKey?.last4,
        access: !!u.sarvamAccess,
        envListed: envAllowlisted(u.email),
        grantedBy: u.sarvamAccessBy || '',
      })),
    };
  } catch (error) {
    console.error('Failed to list users for Sarvam:', error);
    return { success: false as const, error: 'Could not load the list' };
  }
}

/**
 * Grant or revoke. Admin-gated server-side — the /admin page not drawing the card for anyone else
 * is convenience, this is the actual gate.
 */
export async function setSarvamAccess(userId: string, on: boolean) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false as const, error: 'Not found' };
    await connectToDatabase();
    if (!isValidObjectId(userId)) return { success: false as const, error: 'Unknown account' };

    const res = await User.updateOne({ _id: userId }, on
      ? { $set: { sarvamAccess: true, sarvamAccessBy: session.user.email, sarvamAccessAt: new Date() } }
      : { $set: { sarvamAccess: false, sarvamAccessBy: session.user.email, sarvamAccessAt: new Date() } });
    if (!res.matchedCount) return { success: false as const, error: 'Unknown account' };

    return { success: true as const, access: on };
  } catch (error) {
    console.error('Failed to set Sarvam access:', error);
    return { success: false as const, error: 'Could not change that' };
  }
}

export async function getAdminStats() {
  try {
    const session = await getServerSession(authOptions);
    // Same answer for signed-out and non-admin: the dashboard does not advertise that it exists
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false, error: 'Not found' };
    await connectToDatabase();

    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY);
    const trendFrom = new Date(now - (TREND_DAYS - 1) * DAY);

    const [
      users, verified, newThisWeek, signupsByDay,
      links, notes, tasks, moms, docs, projects, contacts,
      extracted, fromMoms, fromMomsDone, fromMomsSigned,
      suggestions, suggestionsThisWeek, byKind,
      recentLinkUsers, recentNoteUsers, recentTaskUsers, recentMomUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ emailVerified: { $ne: null } }),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      User.aggregate([
        { $match: { createdAt: { $gte: trendFrom } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: DEFAULT_TZ } }, n: { $sum: 1 } } },
      ]),

      Link.countDocuments(), Note.countDocuments(), Task.countDocuments(),
      Mom.countDocuments(), Doc.countDocuments(), Project.countDocuments(), Contact.countDocuments(),

      // Every action item the extractor ever proposed, confirmed or not
      Mom.aggregate([{ $group: { _id: null, n: { $sum: { $size: { $ifNull: ['$candidates', []] } } } } }]),
      Task.countDocuments({ momId: { $exists: true, $ne: null } }),
      Task.countDocuments({ momId: { $exists: true, $ne: null }, completed: true }),
      // Completed and signed off are two different facts and the number stops meaning anything
      // if they are one column: the assignee saying "done" is not the owner agreeing it is.
      Task.countDocuments({ momId: { $exists: true, $ne: null }, signedOffAt: { $ne: null } }),

      Suggestion.countDocuments(),
      Suggestion.countDocuments({ createdAt: { $gte: weekAgo } }),
      Suggestion.aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),

      // There is no lastSeenAt on User, and updatedAt only moves on a password or PIN change, so
      // there is no honest "active users" figure to report. This is people who CREATED something,
      // and the dashboard labels it as exactly that rather than dressing it up as activity.
      Link.distinct('userId', { createdAt: { $gte: weekAgo } }),
      Note.distinct('userId', { createdAt: { $gte: weekAgo } }),
      Task.distinct('userId', { createdAt: { $gte: weekAgo } }),
      Mom.distinct('userId', { createdAt: { $gte: weekAgo } }),
    ]);

    const creators = new Set<string>();
    for (const list of [recentLinkUsers, recentNoteUsers, recentTaskUsers, recentMomUsers]) {
      for (const id of list) creators.add(String(id));
    }

    // Dense series: a day with no signups has to render as a zero-height bar, not vanish
    const counts = new Map<string, number>(signupsByDay.map((d: { _id: string; n: number }) => [d._id, d.n]));
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ });   // en-CA gives YYYY-MM-DD
    const signups = Array.from({ length: TREND_DAYS }, (_, i) => {
      const day = fmt.format(new Date(now - (TREND_DAYS - 1 - i) * DAY));
      return { day, n: counts.get(day) || 0 };
    });

    const kinds = Object.fromEntries(byKind.map((k: { _id: string; n: number }) => [k._id || 'other', k.n]));

    return {
      success: true as const,
      people: {
        total: users,
        verified,
        newThisWeek,
        createdSomethingThisWeek: creators.size,
        signups,
      },
      usage: { links, notes, tasks, moms, docs, projects, contacts },
      loop: {
        meetings: moms,
        extracted: extracted[0]?.n || 0,
        confirmed: fromMoms,
        completed: fromMomsDone,
        signedOff: fromMomsSigned,
      },
      feedback: {
        total: suggestions,
        thisWeek: suggestionsThisWeek,
        bug: kinds.bug || 0,
        idea: kinds.idea || 0,
        other: kinds.other || 0,
      },
    };
  } catch (error) {
    console.error('Failed to build admin stats:', error);
    return { success: false, error: 'Could not load the numbers' };
  }
}
