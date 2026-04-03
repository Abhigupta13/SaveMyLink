'use server'

import connectToDatabase from '@/lib/mongodb';
import { Category } from '@/lib/models/Category';
import { Link } from '@/lib/models/Link';
import { revalidatePath } from 'next/cache';

export async function getCategories() {
  await connectToDatabase();
  const categories = await Category.find({}).lean();
  
  // Aggregate link counts per category
  const linkCounts = await Link.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } }
  ]);
  
  const countMap = new Map();
  linkCounts.forEach((lc) => countMap.set(lc._id.toString(), lc.count));
  
  const enriched = categories.map((cat: any) => ({
    ...cat,
    count: countMap.get(cat._id.toString()) || 0
  }));
  
  // Sort by count descending, then alphabetically
  enriched.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
  
  return JSON.parse(JSON.stringify(enriched));
}

export async function createCategory(name: string, color?: string) {
  await connectToDatabase();
  try {
    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existing) return { error: 'Category already exists' };

    const category = await Category.create({ name, color });
    revalidatePath('/');
    return { success: true, category: JSON.parse(JSON.stringify(category)) };
  } catch (error: any) {
    return { error: error.message };
  }
}
