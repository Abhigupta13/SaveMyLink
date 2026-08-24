'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Contact } from "@/lib/models/Contact";
import { Project } from "@/lib/models/Project";
import { User } from "@/lib/models/User";
import { sendMail, inviteEmail } from "@/lib/mailer";
import { myProjectFilter } from "@/lib/projectAccess";
import { appUrl } from "@/lib/url";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

export interface ContactInput { name: string; phone?: string; email?: string; company?: string; note?: string }

/**
 * Saving someone who has no account is the one moment the app knows a real person is worth
 * inviting. It only ever *offers* — an app that quietly emails your address book is an app that
 * gets marked as spam, and it would be the user's name on the message, not ours.
 */
async function invitable(email?: string) {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) return undefined;
  return (await User.exists({ email: normalized })) ? undefined : normalized;
}

export async function getContacts() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const myEmail = (session.user.email || '').toLowerCase();

    const [contacts, projects] = await Promise.all([
      Contact.find({ userId: session.user.id }).sort({ name: 1 }).lean(),
      Project.find(await myProjectFilter(session.user.id, myEmail))
        .populate('ownerId', 'email name').lean(),
    ]);

    // People from my projects (not yet saved as contacts)
    const saved = new Set<string>(contacts.map(c => c.email).filter(Boolean) as string[]);
    const team = new Map<string, { email: string; name?: string; projects: string[] }>();
    for (const p of projects as any[]) {
      const people = [{ email: p.ownerId?.email, name: p.ownerId?.name }, ...(p.memberEmails || []).map((e: string) => ({ email: e }))];
      for (const { email, name } of people) {
        if (!email || email === myEmail || saved.has(email)) continue;
        const entry = team.get(email) || { email, name, projects: [] as string[] };
        entry.projects.push(p.name);
        team.set(email, entry);
      }
    }

    return {
      success: true,
      contacts: JSON.parse(JSON.stringify(contacts)),
      team: [...team.values()],
    };
  } catch (error) {
    console.error('Failed to get contacts:', error);
    return { success: false, error: 'Failed to fetch contacts' };
  }
}

export async function createContact(data: ContactInput) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    if (!data.name?.trim()) return { success: false, error: 'Name required' };
    const contact = await Contact.create({ ...data, name: data.name.trim(), userId: session.user.id });
    revalidatePath('/contacts');
    return { success: true, contact: JSON.parse(JSON.stringify(contact)), inviteAvailable: await invitable(data.email) };
  } catch (error) {
    console.error('Failed to create contact:', error);
    return { success: false, error: 'Failed to save contact' };
  }
}

export async function updateContact(id: string, data: ContactInput) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const res = await Contact.findOneAndUpdate({ _id: id, userId: session.user.id }, data, { new: true });
    if (!res) return { success: false, error: 'Contact not found' };
    revalidatePath('/contacts');
    return { success: true, contact: JSON.parse(JSON.stringify(res)), inviteAvailable: await invitable(data.email) };
  } catch (error) {
    console.error('Failed to update contact:', error);
    return { success: false, error: 'Failed to update contact' };
  }
}

export async function deleteContact(id: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    await Contact.findOneAndDelete({ _id: id, userId: session.user.id });
    revalidatePath('/contacts');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete contact:', error);
    return { success: false, error: 'Failed to delete contact' };
  }
}

/**
 * Sends the projectless invite, and only ever to an address the caller already has saved as their
 * own contact — otherwise this action is an open relay for sending mail in the app's name.
 */
export async function inviteContact(email: string) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const normalized = (email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return { success: false, error: 'Invalid email' };
    if (normalized === (session.user.email || '').toLowerCase()) return { success: false, error: "That's your own address" };

    const contact = await Contact.findOne({ userId: session.user.id, email: normalized }).select('name').lean<{ name?: string } | null>();
    if (!contact) return { success: false, error: 'Save them as a contact first' };
    if (await User.exists({ email: normalized })) return { success: false, error: 'They already have an account' };

    const base = appUrl();
    const mail = inviteEmail({
      inviterName: session.user.name || session.user.email || 'A friend',
      link: `${base}/auth/signup?email=${encodeURIComponent(normalized)}`,
      hasAccount: false,
      name: contact.name,
    });
    const sent = await sendMail({ to: normalized, ...mail })
      .catch(error => { console.error('Contact invite failed:', normalized, error); return { delivered: false as const }; });

    return sent.delivered
      ? { success: true, invited: normalized }
      : { success: false, error: 'Email is not configured, so the invite could not be sent.' };
  } catch (error) {
    console.error('Failed to invite contact:', error);
    return { success: false, error: 'Could not send the invite' };
  }
}
