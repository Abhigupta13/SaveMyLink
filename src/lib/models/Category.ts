import mongoose, { Schema, Document, Model } from 'mongoose';
import { defineModel } from './registry';

export interface ICategory extends Document {
  name: string;
  color?: string;
  userId: mongoose.Types.ObjectId;
  isPrivate: boolean;
  domains?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema: Schema<ICategory> = new Schema({
  name: { type: String, required: true },
  color: { type: String, default: '#4ade80' },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isPrivate: { type: Boolean, default: false },
  domains: [{ type: String }] // hostnames auto-filed into this category on capture
}, { timestamps: true });

CategorySchema.index({ userId: 1, isPrivate: 1, name: 1 }, { unique: true });

export const Category: Model<ICategory> = defineModel<ICategory>('Category', CategorySchema);
