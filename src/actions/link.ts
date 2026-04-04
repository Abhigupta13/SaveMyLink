'use server'

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { Link } from '@/lib/models/Link';
import { revalidatePath } from 'next/cache';
import { scrapeMetadata } from '@/lib/metadata';

export async function getLinks(categoryId?: string, page: number = 1, limit: number = 50, search?: string, privateSafe: boolean = false) {
  await connectToDatabase();
  
  let query: any = {};
  
  // Filtering by Private Safe state
  if (!privateSafe) {
    query.isPrivate = { $ne: true }; // Only show public links
  }
  
  if (categoryId && categoryId !== 'all') {
    if (categoryId === 'favorites') {
      query.isFavorite = true;
    } else {
      query.category = categoryId;
    }
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

export async function createLink(url: string, categoryId: string, tags: string[] = [], isPrivate: boolean = false) {
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
      tags,
      isPrivate
    });
    
    revalidatePath('/');
    return { success: true, link: JSON.parse(JSON.stringify(newLink)) };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function updateLink(linkId: string, data: { categoryId?: string, tagsInput?: string, title?: string, url?: string, isFavorite?: boolean }) {
  await connectToDatabase();
  try {
    const updateData: any = {};
    if (data.categoryId) {
      updateData.category = new mongoose.Types.ObjectId(data.categoryId) as any;
    }
    if (data.tagsInput !== undefined) {
      updateData.tags = data.tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (data.title !== undefined) {
      updateData.title = data.title;
    }
    if (data.url !== undefined) {
      updateData.url = data.url;
    }
    if (data.isFavorite !== undefined) {
      updateData.isFavorite = data.isFavorite;
    }

    await Link.findByIdAndUpdate(linkId, updateData);
    
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function toggleFavorite(linkId: string, isFavorite: boolean) {
  await connectToDatabase();
  try {
    await Link.findByIdAndUpdate(linkId, { isFavorite });
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function deleteLink(linkId: string) {
  await connectToDatabase();
  try {
    await Link.findByIdAndDelete(linkId);
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function refreshMetadata(linkId: string) {
  await connectToDatabase();
  try {
    const link = await Link.findById(linkId);
    if (!link) {
      return { error: 'Link not found' };
    }

    const metadata = await scrapeMetadata(link.url);
    
    const updateData: any = {
      title: metadata.title || link.title || link.url,
      previewImageUrl: metadata.image || '',
    };
    
    if (metadata.duration) updateData.duration = metadata.duration;
    if (metadata.quality) updateData.quality = metadata.quality;

    await Link.findByIdAndUpdate(linkId, updateData);
    
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function migrateExistingLinksToPrivate() {
  await connectToDatabase();
  try {
    const result = await Link.updateMany({}, { isPrivate: true });
    revalidatePath('/');
    return { success: true, modifiedCount: result.modifiedCount };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function toggleLinkPrivacy(linkId: string, isPrivate: boolean) {
  await connectToDatabase();
  try {
    await Link.findByIdAndUpdate(linkId, { isPrivate });
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}
