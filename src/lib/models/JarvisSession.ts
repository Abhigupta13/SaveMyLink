import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

export interface IJarvisSession extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  title: string;
  messages: { role: 'user' | 'assistant'; content: string; items?: unknown[] }[];
  createdAt: Date;
  updatedAt: Date;
}

const JarvisSessionSchema = new Schema<IJarvisSession>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New chat' },
  // Cited items are rendered back as-is; nothing queries inside them, so Mixed is enough.
  messages: { type: [{ _id: false, role: String, content: String, items: Schema.Types.Mixed }], default: [] },
}, { timestamps: true });

JarvisSessionSchema.index({ userId: 1, updatedAt: -1 });

export const JarvisSession: Model<IJarvisSession> = defineModel<IJarvisSession>('JarvisSession', JarvisSessionSchema);
