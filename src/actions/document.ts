'use server'

import connectToDatabase from '@/lib/mongodb';
import { Document } from '@/lib/models/Document';
import { revalidatePath } from 'next/cache';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import fs from 'fs';
import path from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';

export async function getDocuments() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { docs: [] };
  const userId = (session.user as any).id;

  try {
    await connectToDatabase();
    const docs = await Document.find({ user: userId }).sort({ createdAt: -1 }).lean();
    return { docs: JSON.parse(JSON.stringify(docs)) };
  } catch (error: any) {
    console.error('Error fetching documents:', error);
    return { docs: [], error: error.message };
  }
}

export async function addDocument(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  const name = formData.get('name') as string;
  const type = formData.get('type') as 'file' | 'link';
  const externalLink = formData.get('externalLink') as string;
  const file = formData.get('file') as File | null;

  try {
    await connectToDatabase();

    let url = '';
    let mimeType = '';
    let size = 0;

    if (type === 'file' && file) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      // Secure file name
      const fileExt = path.extname(file.name);
      const safeName = file.name.substring(0, file.name.lastIndexOf('.')).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const fileName = `${Date.now()}-${safeName}${fileExt}`;
      const filePath = path.join(uploadDir, fileName);
      await writeFile(filePath, buffer);

      url = `/uploads/${fileName}`;
      mimeType = file.type;
      size = file.size;
    } else if (type === 'link') {
      url = externalLink;
      mimeType = 'text/html';
    }

    const doc = await Document.create({
      user: userId,
      name,
      type,
      url,
      mimeType,
      size
    });

    revalidatePath('/d-locker');
    return { success: true, doc: JSON.parse(JSON.stringify(doc)) };
  } catch (error: any) {
    console.error('Error adding document:', error);
    return { error: error.message };
  }
}

export async function deleteDocument(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Not authenticated' };
  const userId = (session.user as any).id;

  try {
    await connectToDatabase();
    const doc = await Document.findOne({ _id: id, user: userId });
    if (!doc) return { error: 'Document not found' };

    if (doc.type === 'file') {
      const filePath = path.join(process.cwd(), 'public', doc.url);
      if (fs.existsSync(filePath)) {
        await unlink(filePath);
      }
    }

    await Document.deleteOne({ _id: id });
    revalidatePath('/d-locker');
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return { error: error.message };
  }
}
