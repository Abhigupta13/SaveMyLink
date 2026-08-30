'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getServerSession } from "next-auth";
import { isAdmin } from "@/lib/isAdmin";
import { escapeRegex } from "@/lib/regex";
import { envAllowlisted } from "@/lib/sarvam";
import { isValidObjectId } from "mongoose";
import { DEFAULT_TZ } from "@/lib/time";
import { resolveRange, type RangeInput } from "@/lib/adminRange";
import { eraseAccount } from "@/actions/account";
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


/** Whether to show the Admin row in Profile. A convenience only — getAdminStats is the real gate. */
export async function amIAdmin() {
  const session = await getServerSession(authOptions);
  return { admin: isAdmin(session?.user?.email) };
}

/**
 * The one people list behind "Manage users".
 *
 * This is the ONE place in /admin that names individual users, and it is a deliberate exception to
 * the counts-only rule above: you cannot grant, suspend or delete a person without seeing which
 * person. It returns an address, a name and the states an admin can change — never anything they
 * have written.
 *
 * One list rather than one per action, because for the admin they are one question about one
 * person. Split across two cards, the same account had to be searched for twice and the two cards
 * could disagree about it.
 *
 * `admin` is computed per row so the card can draw an admin as untouchable, but that is a label,
 * not the gate: both destructive writers re-check it server-side.
 *
 * ponytail: a regex scan over users, capped at 50. There is no index for it and there should not
 * be one yet — this is two founders searching a few hundred rows. Add a text index when the
 * count makes it hurt.
 */
export async function listUsersForManage(q?: string, page?: number) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false as const, error: 'Not found' };
    await connectToDatabase();

    const term = String(q || '').trim();
    const filter: Record<string, unknown> = term
      ? { $or: [{ email: new RegExp(escapeRegex(term), 'i') }, { name: new RegExp(escapeRegex(term), 'i') }] }
      : {};
    // A deleted account is a name/email stub in retention, not a person you can act on. It has
    // already had the final answer, and offering any of these three on one is offering a no-op.
    filter.deletedAt = null;

    /* A page at a time, and the window is the query rather than a slice of one. The old 50-row cap
       was a silent truncation: past fifty accounts the list simply stopped, and nothing on the page
       said so. `total` comes back so the card can say which slice of what you are looking at.

       Clamped here, not trusted: the page number arrives from the client. */
    const size = 10;
    const want = Math.max(1, Math.floor(Number(page) || 1));
    const total = await User.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / size));
    // Deleting the last row of the last page would otherwise leave the admin on an empty page.
    const current = Math.min(want, pages);

    const users = await User.find(filter)
      .select('email name sarvamKey.last4 sarvamAccess sarvamAccessBy suspendedAt suspendedBy createdAt')
      // The two states worth noticing float up, so a long list cannot bury somebody who is locked
      // out or spending money on page nine. `_id` breaks ties: without a total order, Mongo may
      // return the same document on two pages and skip another entirely.
      .sort({ suspendedAt: -1, sarvamAccess: -1, createdAt: -1, _id: -1 })
      .skip((current - 1) * size).limit(size).lean();

    return {
      success: true as const,
      total, page: current, pages, size,
      users: users.map(u => ({
        id: String(u._id),
        email: u.email,
        name: u.name || '',
        ownKey: !!u.sarvamKey?.last4,
        access: !!u.sarvamAccess,
        envListed: envAllowlisted(u.email),
        grantedBy: u.sarvamAccessBy || '',
        suspended: !!u.suspendedAt,
        suspendedAt: u.suspendedAt ? new Date(u.suspendedAt).toISOString() : '',
        suspendedBy: u.suspendedBy || '',
        admin: isAdmin(u.email),
      })),
    };
  } catch (error) {
    console.error('Failed to list users for management:', error);
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

    // The granter comes back with the answer. The grid draws "by <whoever>" from the row it
    // already holds, and without this it kept showing whoever touched the account LAST TIME —
    // a stale name on the one card whose whole job is recording who spent the money.
    return { success: true as const, access: on, by: session.user.email || '' };
  } catch (error) {
    console.error('Failed to set Sarvam access:', error);
    return { success: false as const, error: 'Could not change that' };
  }
}

/**
 * Lock an account out, or let it back in.
 *
 * An admin may not suspend another admin. The list is ADMIN_EMAILS, which is an env var — so this
 * is not a privilege ladder to climb, it is a footgun to remove: two founders both hold this
 * button, and one bad tap should not be able to lock the other out of the page that holds the
 * button. Whoever needs the list changed changes the env var.
 */
export async function setUserSuspended(userId: string, on: boolean) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false as const, error: 'Not found' };
    await connectToDatabase();
    if (!isValidObjectId(userId)) return { success: false as const, error: 'Unknown account' };

    const target = await User.findById(userId).select('email deletedAt')
      .lean<{ email?: string; deletedAt?: Date | null } | null>();
    if (!target || target.deletedAt) return { success: false as const, error: 'Unknown account' };
    if (isAdmin(target.email)) {
      return { success: false as const, error: 'That account is an admin — admins cannot be suspended here' };
    }

    await User.updateOne({ _id: userId }, on
      ? { $set: { suspendedAt: new Date(), suspendedBy: (session.user.email || '').toLowerCase() } }
      // Cleared, not stamped: `suspendedBy` describes a suspension that no longer exists, and
      // leaving the last admin's name on a restored account reads as if they are still locked out.
      : { $set: { suspendedAt: null }, $unset: { suspendedBy: 1 } });

    return { success: true as const, suspended: on, by: (session.user.email || '').toLowerCase(), email: target.email || '' };
  } catch (error) {
    console.error('Failed to set suspension:', error);
    return { success: false as const, error: 'Could not change that' };
  }
}

/**
 * The final answer: erase the account and everything personal in it.
 *
 * Runs `eraseAccount` — the exact path a user's own "delete my account" takes, which is why that
 * function was split out from its session-bound wrapper. Groups they created hand over to the
 * oldest survivor, their personal content and uploads go, and the row is reduced to the
 * name/email/role stub that /terms promises for 90 days before purge.
 *
 * No undo. Same admin guard as suspension, for the stronger version of the same reason.
 */
export async function deleteUserAsAdmin(userId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false as const, error: 'Not found' };
    await connectToDatabase();
    if (!isValidObjectId(userId)) return { success: false as const, error: 'Unknown account' };

    const target = await User.findById(userId).select('email role deletedAt')
      .lean<{ email?: string; role?: string; deletedAt?: Date | null } | null>();
    if (!target?.email) return { success: false as const, error: 'Unknown account' };
    if (target.deletedAt) return { success: true as const, already: true, email: target.email };
    if (isAdmin(target.email)) {
      return { success: false as const, error: 'That account is an admin — admins cannot be deleted here' };
    }
    // Deleting yourself from the admin page would be a strange way to do it, and the guard above
    // already covers it for any real admin. This is the belt for a deploy with an empty list.
    if (String(session.user.id) === String(userId)) {
      return { success: false as const, error: 'Use Profile to delete your own account' };
    }

    await eraseAccount(userId, target.email, target.role || '');
    return { success: true as const, already: false, email: target.email };
  } catch (error) {
    console.error('Failed to delete user as admin:', error);
    return { success: false as const, error: 'Could not delete that account' };
  }
}

export async function getAdminStats(range?: RangeInput) {
  try {
    const session = await getServerSession(authOptions);
    // Same answer for signed-out and non-admin: the dashboard does not advertise that it exists
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false, error: 'Not found' };
    await connectToDatabase();

    const now = Date.now();
    // The admin picks the window; resolveRange validates and clamps it and hands back the chart's
    // bucket plan. Time-based metrics use [from, to]; the all-time totals stay all-time and carry
    // an in-range companion so both are visible.
    const { from, to, buckets } = resolveRange(range, now);
    const inRange = { createdAt: { $gte: from, $lte: to } };
    // A deleted account is retained as a name/email/role stub for 90 days but is no longer a user
    // of the product, so it must not inflate any people count. `{ deletedAt: null }` also matches
    // the field's absence, so every live account still counts. Only the User counts filter on it;
    // their content is already gone, so the usage collections need no such clause.
    const live = { deletedAt: null };
    const liveInRange = { ...inRange, ...live };

    const [
      users, verified, newInRange, signupsByBucket,
      links, notes, tasks, moms, docs, projects, contacts,
      linksIn, notesIn, tasksIn, momsIn, docsIn, projectsIn, contactsIn,
      extracted, fromMoms, fromMomsDone, fromMomsSigned,
      suggestions, suggestionsInRange, byKind,
      recentLinkUsers, recentNoteUsers, recentTaskUsers, recentMomUsers,
    ] = await Promise.all([
      User.countDocuments(live),
      User.countDocuments({ emailVerified: { $ne: null }, ...live }),
      User.countDocuments(liveInRange),
      User.aggregate([
        { $match: liveInRange },
        { $group: { _id: { $dateToString: { format: buckets.format, date: '$createdAt', timezone: DEFAULT_TZ } }, n: { $sum: 1 } } },
      ]),

      Link.countDocuments(), Note.countDocuments(), Task.countDocuments(),
      Mom.countDocuments(), Doc.countDocuments(), Project.countDocuments(), Contact.countDocuments(),

      // The same collections, but only what was created inside the chosen window
      Link.countDocuments(inRange), Note.countDocuments(inRange), Task.countDocuments(inRange),
      Mom.countDocuments(inRange), Doc.countDocuments(inRange), Project.countDocuments(inRange), Contact.countDocuments(inRange),

      // Every action item the extractor ever proposed, confirmed or not
      Mom.aggregate([{ $group: { _id: null, n: { $sum: { $size: { $ifNull: ['$candidates', []] } } } } }]),
      Task.countDocuments({ momId: { $exists: true, $ne: null } }),
      Task.countDocuments({ momId: { $exists: true, $ne: null }, completed: true }),
      // Completed and signed off are two different facts and the number stops meaning anything
      // if they are one column: the assignee saying "done" is not the owner agreeing it is.
      Task.countDocuments({ momId: { $exists: true, $ne: null }, signedOffAt: { $ne: null } }),

      Suggestion.countDocuments(),
      Suggestion.countDocuments(inRange),
      Suggestion.aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),

      // There is no lastSeenAt on User, and updatedAt only moves on a password or PIN change, so
      // there is no honest "active users" figure to report. This is people who CREATED something
      // in the window, and the dashboard labels it as exactly that rather than as activity.
      Link.distinct('userId', inRange),
      Note.distinct('userId', inRange),
      Task.distinct('userId', inRange),
      Mom.distinct('userId', inRange),
    ]);

    const creators = new Set<string>();
    for (const list of [recentLinkUsers, recentNoteUsers, recentTaskUsers, recentMomUsers]) {
      for (const id of list) creators.add(String(id));
    }

    // Dense series: a bucket with no signups has to render as a zero-height bar, not vanish
    const counts = new Map<string, number>(signupsByBucket.map((d: { _id: string; n: number }) => [d._id, d.n]));
    const signups = buckets.keys.map((day) => ({ day, n: counts.get(day) || 0 }));

    const kinds = Object.fromEntries(byKind.map((k: { _id: string; n: number }) => [k._id || 'other', k.n]));

    return {
      success: true as const,
      range: { from: from.toISOString(), to: to.toISOString(), unit: buckets.unit },
      people: {
        total: users,
        verified,
        newInRange,
        createdSomethingInRange: creators.size,
        signups,
      },
      usage: {
        links, notes, tasks, moms, docs, projects, contacts,
        inRange: { links: linksIn, notes: notesIn, tasks: tasksIn, moms: momsIn, docs: docsIn, projects: projectsIn, contacts: contactsIn },
      },
      loop: {
        meetings: moms,
        extracted: extracted[0]?.n || 0,
        confirmed: fromMoms,
        completed: fromMomsDone,
        signedOff: fromMomsSigned,
      },
      feedback: {
        total: suggestions,
        inRange: suggestionsInRange,
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
