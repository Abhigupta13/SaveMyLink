'use server';

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { Category } from '@/lib/models/Category';
import { Link } from '@/lib/models/Link';
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { escapeRegex } from '@/lib/regex';
import { hasSafe } from '@/lib/safeCookie';

export async function getCategories(privateSafe: boolean = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return [];

  await connectToDatabase();
  const userId = (session.user as any).id;
  if (privateSafe && !(await hasSafe(userId))) privateSafe = false;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  /* This user's categories in this mode, and nobody else's.
     There used to be an `{ userId: { $exists: false } }` branch here for a pre-ownership
     migration, followed by a loop that stamped whatever it matched with the CURRENT user's id.
     Neither half was scoped to anyone: every account saw every ownerless category, and the first
     account to open a page took permanent ownership of them. A read leak you can fix by reverting
     the code; this one wrote as it read.
     Checked against the live database before removing it — 14 categories, 0 ownerless, and every
     category's links belong to its own owner — so the branch was protecting nothing and leaking
     to everyone. If a row ever does arrive without an owner it should be attributed from the
     owner of the links pointing at it, by a migration, not by whoever loads a page first.
     userId is a required ObjectId on the schema, so mongoose casts the string form for us and the
     old "just in case" string branch was the same query written twice. */
  const categories = await Category.find({
    userId: userObjectId,
    isPrivate: privateSafe === true ? true : { $ne: true }
  }).lean();

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
      name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
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

export async function addCategoryDomain(categoryId: string, domain: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const res = await Category.findOneAndUpdate(
      { _id: categoryId, userId },
      { $addToSet: { domains: domain.toLowerCase() } }
    );
    if (!res) return { error: 'Category not found or unauthorized' };
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { error: error.message };
  }
}
