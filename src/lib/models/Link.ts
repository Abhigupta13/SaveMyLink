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
  tags: [{ type: String }]
}, { timestamps: true });

export const Link: Model<ILink> = mongoose.models.Link || mongoose.model<ILink>('Link', LinkSchema);
