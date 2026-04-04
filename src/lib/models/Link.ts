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
  createdAt: Date;
  updatedAt: Date;
}

const LinkSchema: Schema<ILink> = new Schema({
  url: { type: String, required: true },
  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  title: { type: String },
  previewImageUrl: { type: String },
  duration: { type: String },
  quality: { type: String },
  tags: [{ type: String }],
  isFavorite: { type: Boolean, default: false },
  isPrivate: { type: Boolean, default: false }
}, { timestamps: true });

if (mongoose.models.Link) {
  delete mongoose.models.Link;
}
export const Link: Model<ILink> = mongoose.model<ILink>('Link', LinkSchema);
