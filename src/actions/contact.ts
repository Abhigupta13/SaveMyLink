'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Contact } from "@/lib/models/Contact";
import { Project } from "@/lib/models/Project";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

export interface ContactInput { name: string; phone?: string; email?: string; company?: string; note?: string }

export async function getContacts() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const myEmail = (session.user.email || '').toLowerCase();

    const [contacts, projects] = await Promise.all([
      Contact.find({ userId: session.user.id }).sort({ name: 1 }).lean(),
      Project.find({ $or: [{ ownerId: session.user.id }, { memberEmails: myEmail }] })
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
    return { success: true, contact: JSON.parse(JSON.stringify(contact)) };
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
    return { success: true, contact: JSON.parse(JSON.stringify(res)) };
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
