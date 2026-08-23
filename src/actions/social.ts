'use server'

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { SocialApp } from '@/lib/models/SocialApp';
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

const DEFAULT_SOCIAL_APPS = [
  { name: 'LinkedIn', url: 'https://www.linkedin.com', icon: '💼', color: '#0077b5', isPinned: true },
  { name: 'Twitter', url: 'https://x.com', icon: '𝕏', color: '#000000', isPinned: true },
  { name: 'Facebook', url: 'https://www.facebook.com', icon: '👥', color: '#1877f2', isPinned: true },
  { name: 'Instagram', url: 'https://www.instagram.com', icon: '📸', color: '#e4405f', isPinned: true },
];

export async function getSocialApps() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { apps: [] };
  const userId = (session.user as any).id;

  try {
    await connectToDatabase();
    
    let apps = await SocialApp.find({ user: userId }).sort({ isPinned: -1, createdAt: -1 }).lean();
    
    // Seed default apps if none exist for the user
    if (apps.length === 0) {
      const defaultApps = DEFAULT_SOCIAL_APPS.map((app, index) => ({
        ...app,
        user: new mongoose.Types.ObjectId(userId),
        order: index
      }));
      await SocialApp.insertMany(defaultApps);
      apps = await SocialApp.find({ user: userId }).sort({ isPinned: -1, createdAt: -1 }).lean();
    }

    return {
      apps: JSON.parse(JSON.stringify(apps))
    };
  } catch (error: any) {
    console.error('Error fetching social apps:', error);
    return { apps: [], error: error.message };
  }
}

export async function addSocialApp(data: { name: string, url: string, icon: string, color: string }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const newApp = await SocialApp.create({
      ...data,
      user: userId,
      order: Date.now()
    });
    revalidatePath('/social');
    return { success: true, app: JSON.parse(JSON.stringify(newApp)) };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function deleteSocialApp(appId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const res = await SocialApp.findOneAndDelete({ _id: appId, user: userId });
    if (!res) return { error: 'Unauthorized or not found' };
    revalidatePath('/social');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function togglePinSocialApp(appId: string, isPinned: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const res = await SocialApp.findOneAndUpdate({ _id: appId, user: userId }, { isPinned });
    if (!res) return { error: 'Unauthorized or not found' };
    revalidatePath('/social');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}
