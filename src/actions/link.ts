'use server'

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { Link } from '@/lib/models/Link';
import { Category } from '@/lib/models/Category';
import { revalidatePath } from 'next/cache';
import { scrapeMetadata } from '@/lib/metadata';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function getLinkMetadata(url: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  
  try {
    const metadata = await scrapeMetadata(url);
    return { success: true, metadata };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getLinks(categoryId?: string, page: number = 1, limit: number = 50, search?: string, privateSafe: boolean = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { links: [], totalCount: 0 };
  const userId = (session.user as any).id;

  await connectToDatabase();
  
  let query: any = { userId };
  
  // Strict Filtering by Private Safe state
  if (!privateSafe) {
    query.isPrivate = { $ne: true }; // Only show public links in general mode
  } else {
    query.isPrivate = true; // ONLY show private links in private safe mode
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

export async function createLink(url: string, categoryId: string, tags: string[] = [], isPrivate: boolean = false, prefetchedMetadata?: { title?: string, image?: string }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    // Only scrape if metadata not provided
    const metadata = prefetchedMetadata ? { 
      title: prefetchedMetadata.title, 
      image: prefetchedMetadata.image,
      duration: '',
      quality: ''
    } : await scrapeMetadata(url);
    
    const newLink = await Link.create({
      url,
      category: categoryId ? new mongoose.Types.ObjectId(categoryId) : undefined,
      title: metadata.title || url,
      previewImageUrl: metadata.image || '',
      duration: metadata.duration || '',
      quality: metadata.quality || '',
      tags,
      isPrivate,
      userId
    });
    
    revalidatePath('/');
    return { success: true, link: JSON.parse(JSON.stringify(newLink)) };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function updateLink(linkId: string, data: { categoryId?: string, tagsInput?: string, title?: string, url?: string, isFavorite?: boolean, isPrivate?: boolean }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const link = await Link.findOne({ _id: linkId, userId });
    if (!link) return { error: 'Link not found or unauthorized' };

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
    if (data.isPrivate !== undefined) {
      updateData.isPrivate = data.isPrivate;
    }

    await Link.findByIdAndUpdate(linkId, updateData);
    
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function toggleFavorite(linkId: string, isFavorite: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const res = await Link.findOneAndUpdate({ _id: linkId, userId }, { isFavorite });
    if (!res) return { error: 'Unauthorized' };
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function deleteLink(linkId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const res = await Link.findOneAndDelete({ _id: linkId, userId });
    if (!res) return { error: 'Unauthorized' };
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function refreshMetadata(linkId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const link = await Link.findOne({ _id: linkId, userId });
    if (!link) {
      return { error: 'Link not found or unauthorized' };
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

export async function refreshAllMetadata(privateSafe?: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const query: any = { userId };
    if (privateSafe === true) {
      query.isPrivate = true;
    } else if (privateSafe === false) {
      query.isPrivate = { $ne: true };
    }

    const links = await Link.find(query)
      .select('_id url title')
      .lean();

    let successCount = 0;
    let failedCount = 0;
    const batchSize = 5;

    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (link: any) => {
          const metadata = await scrapeMetadata(link.url);
          const updateData: any = {
            title: metadata.title || link.title || link.url,
            previewImageUrl: metadata.image || '',
          };
          if (metadata.duration) updateData.duration = metadata.duration;
          if (metadata.quality) updateData.quality = metadata.quality;
          await Link.findByIdAndUpdate(link._id, updateData);
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          failedCount++;
        }
      }
    }

    revalidatePath('/links');
    revalidatePath('/');
    return { success: true, total: links.length, successCount, failedCount };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function migrateExistingLinksToPrivate() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const result = await Link.updateMany({ userId }, { isPrivate: true });
    revalidatePath('/');
    return { success: true, modifiedCount: result.modifiedCount };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function toggleLinkPrivacy(linkId: string, isPrivate: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function bulkCreateLinks(
  links: { url: string; isPrivate?: boolean; category?: string; tags?: string[] }[]
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  
  const results = {
    successCount: 0,
    failed: 0,
    errors: [] as string[]
  };

  const categoryCache = new Map<string, string>();

  for (const item of links) {
    try {
      if (!item.url || !item.url.startsWith('http')) {
        results.failed++;
        continue;
      }

      const resolvedIsPrivate = item.isPrivate ?? false;
      const normalizedTags = Array.isArray(item.tags)
        ? item.tags.map((tag) => tag.trim()).filter(Boolean)
        : [];
      let categoryId: mongoose.Types.ObjectId | undefined;

      const categoryName = item.category?.trim();
      if (categoryName) {
        const cacheKey = `${resolvedIsPrivate}:${categoryName.toLowerCase()}`;
        const cachedId = categoryCache.get(cacheKey);

        if (cachedId) {
          categoryId = new mongoose.Types.ObjectId(cachedId);
        } else {
          const categoryDoc = await Category.findOneAndUpdate(
            {
              userId,
              isPrivate: resolvedIsPrivate,
              name: { $regex: new RegExp(`^${categoryName}$`, 'i') },
            },
            { $setOnInsert: { name: categoryName, userId, isPrivate: resolvedIsPrivate } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
          );

          if (categoryDoc?._id) {
            categoryId = categoryDoc._id;
            categoryCache.set(cacheKey, categoryDoc._id.toString());
          }
        }
      }

      const metadata = await scrapeMetadata(item.url).catch(() => ({ title: item.url, image: '', duration: '', quality: '' }));
      
      await Link.create({
        url: item.url,
        category: categoryId,
        title: metadata.title || item.url,
        previewImageUrl: metadata.image || '',
        duration: metadata.duration || '',
        quality: metadata.quality || '',
        tags: normalizedTags,
        isPrivate: resolvedIsPrivate,
        userId
      });
      results.successCount++;
    } catch (err: any) {
      results.failed++;
      results.errors.push(`${item.url}: ${err.message}`);
    }
  }

  revalidatePath('/');
  return { success: true, ...results };
}
