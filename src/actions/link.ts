'use server'

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { Link } from '@/lib/models/Link';
import { revalidatePath } from 'next/cache';
import { scrapeMetadata } from '@/lib/metadata';

export async function getLinks(categoryId?: string, page: number = 1, limit: number = 50, search?: string) {
  await connectToDatabase();
  
  let query: any = {};
  if (categoryId && categoryId !== 'all') {
    query.category = categoryId;
  }
  
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { title: searchRegex },
      { url: searchRegex },
      { tags: { $in: [searchRegex] } }
    ];
  }

  const skip = (page - 1) * limit;

  const [links, totalCount] = await Promise.all([
    Link.find(query)
      .populate('category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Link.countDocuments(query)
  ]);

  return {
    links: JSON.parse(JSON.stringify(links)),
    totalCount
  };
}

export async function createLink(url: string, categoryId: string, tags: string[] = []) {
  await connectToDatabase();
  try {
    // Scrape open graph data
    const metadata = await scrapeMetadata(url);
    
    const newLink = await Link.create({
      url,
      category: new mongoose.Types.ObjectId(categoryId) as any,
      title: metadata.title || url,
      previewImageUrl: metadata.image || '',
      duration: metadata.duration || '',
      quality: metadata.quality || '',
      tags
    });
    
    revalidatePath('/');
    return { success: true, link: JSON.parse(JSON.stringify(newLink)) };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function updateLink(linkId: string, categoryId: string, tagsInput: string) {
  await connectToDatabase();
  try {
    const tagsArray = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    await Link.findByIdAndUpdate(linkId, {
      category: new mongoose.Types.ObjectId(categoryId) as any,
      tags: tagsArray
    });
    
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}
