import mongoose, { Schema, Document, Model } from 'mongoose';
import { ICategory } from './Category';

export interface ILink extends Document {
  url: string;
  category: mongoose.Types.ObjectId | ICategory;
  title?: string;
  previewImageUrl?: string;
  duration?: string;
  quality?: string;
  tags?: string[];
  isFavorite?: boolean;
  isPrivate?: boolean;
  isDead?: boolean;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LinkSchema: Schema<ILink> = new Schema({
  url: { type: String, default: '' }, // empty = text note captured via share

  category: { type: Schema.Types.ObjectId, ref: 'Category', required: false },
  title: { type: String },
  previewImageUrl: { type: String },
  duration: { type: String },
  quality: { type: String },
  tags: [{ type: String }],
  isFavorite: { type: Boolean, default: false },
  isPrivate: { type: Boolean, default: false },
  isDead: { type: Boolean, default: false }, // flagged by scripts/check-dead-links.js
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

LinkSchema.index({ userId: 1, isPrivate: 1, createdAt: -1 });

export const Link: Model<ILink> = mongoose.models.Link || mongoose.model<ILink>('Link', LinkSchema);
