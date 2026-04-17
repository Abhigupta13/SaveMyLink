import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  color?: string;
  userId: mongoose.Types.ObjectId;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema: Schema<ICategory> = new Schema({
  name: { type: String, required: true },
  color: { type: String, default: '#4ade80' },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isPrivate: { type: Boolean, default: false }
}, { timestamps: true });

CategorySchema.index({ userId: 1, isPrivate: 1, name: 1 }, { unique: true });

export const Category: Model<ICategory> = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);
