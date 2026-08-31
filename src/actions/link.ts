'use server'

import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { Link } from '@/lib/models/Link';
import { Category } from '@/lib/models/Category';
import { revalidatePath } from 'next/cache';
import { scrapeMetadata } from '@/lib/metadata';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { escapeRegex } from '@/lib/regex';
import { normalizeUrl, youtubeId } from '@/lib/url';
import { hasSafe } from '@/lib/safeCookie';

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

  // Server-side gate: private mode requires a verified-PIN cookie, not just client state
  if (privateSafe && !(await hasSafe(userId))) privateSafe = false;

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
    const searchRegex = new RegExp(escapeRegex(search), 'i');
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

/* Removed: migrateExistingLinksToPrivate(). A one-off migration from when the Private Safe first
   shipped, with no callers left anywhere and no UI that could reach it. It was session-gated, so it
   could only ever affect the caller's own library — but its whole body was
   `Link.updateMany({ userId }, { isPrivate: true })`, i.e. one call to an endpoint no screen
   exposes swept every link the caller owns behind the PIN, with no confirmation and no undo.
   Dead destructive code on a live RPC surface is worth less than nothing; toggleLinkPrivacy below
   is the supported way to move a single link. */

export async function toggleLinkPrivacy(linkId: string, isPrivate: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  await connectToDatabase();
  try {
    const res = await Link.findOneAndUpdate({ _id: linkId, userId }, { isPrivate });
    if (!res) return { error: 'Link not found or unauthorized' };
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
              name: { $regex: new RegExp(`^${escapeRegex(categoryName)}$`, 'i') },
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

// Duplicate detection for the capture sheet: match by YouTube video id when
// possible (share URLs carry unique ?si= params), else exact/normalized URL.
export async function findLinkByUrl(url: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { link: null };
  const userId = (session.user as any).id;

  await connectToDatabase();
  const ytId = youtubeId(url);
  const query: any = ytId
    ? { userId, url: { $regex: escapeRegex(ytId) } }
    : { userId, url: { $in: [url, normalizeUrl(url)] } };
  const link = await Link.findOne(query).select('_id title createdAt').lean();
  return { link: link ? JSON.parse(JSON.stringify(link)) : null };
}
