'use server';

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { Category } from '@/lib/models/Category';
import { Link } from '@/lib/models/Link';
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function getCategories(privateSafe: boolean = false) {
  await connectToDatabase();
  const session = await getServerSession(authOptions);

  if (!session?.user) return [];
  const userId = (session.user as any).id;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // Find categories belonging to this user in this mode
  // Also include "ownerless" categories temporarily (for migration)
  const categories = await Category.find({ 
    $or: [
      { userId: userObjectId }, 
      { userId: { $exists: false } },
      { userId: userId } // Handle string IDs just in case
    ],
    isPrivate: privateSafe === true ? true : { $ne: true }
  }).lean();
  
  // Tag "ownerless" categories with current user if found, preserving their privacy state
  const ownerless = categories.filter(c => !c.userId);
  if (ownerless.length > 0) {
    for (const cat of ownerless) {
      await Category.updateOne(
        { _id: cat._id },
        { $set: { userId: userObjectId, isPrivate: cat.isPrivate || false } }
      );
    }
  }

  // Build link query for aggregation based on mode
  const linkQuery: any = { userId: userObjectId };
  if (!privateSafe) {
    linkQuery.isPrivate = { $ne: true }; 
  } else {
    linkQuery.isPrivate = true; 
  }

  // Aggregate link counts per category based on privacy filter
  const linkCounts = await Link.aggregate([
    { $match: linkQuery },
    { $group: { _id: '$category', count: { $sum: 1 } } }
  ]);
  
  const countMap = new Map<string, number>();
  linkCounts.forEach((lc: { _id: unknown; count: number }) => {
    if (!lc?._id) return;
    countMap.set(String(lc._id), lc.count ?? 0);
  });
  
  // Enrich categories (WE REMOVE THE FILTER cat.count > 0 as requested)
  const enriched = categories
    .map((cat: any) => ({
      ...cat,
      count: cat?._id ? countMap.get(String(cat._id)) || 0 : 0
    }));
  
  // Sort by count descending, then alphabetically
  enriched.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
  
  return JSON.parse(JSON.stringify(enriched));
}

export async function createCategory(name: string, isPrivate: boolean = false, color?: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const existing = await Category.findOne({ 
      userId,
      isPrivate,
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });
    
    if (existing) {
      // Instead of error, return the existing category
      return { success: true, category: JSON.parse(JSON.stringify(existing)) };
    }

    const category = await Category.create({ 
      name, 
      color, 
      userId, 
      isPrivate 
    });
    
    revalidatePath('/');
    return { success: true, category: JSON.parse(JSON.stringify(category)) };
  } catch (error: any) {
    return { error: error.message };
  }
}
