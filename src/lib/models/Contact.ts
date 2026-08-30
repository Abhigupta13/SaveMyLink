import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

export interface IContact extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  note?: string;
  /** Behind the Private Safe. Only ever true on a personal record — see lib/privacy. */
  isPrivate?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  phone: { type: String },
  email: { type: String, lowercase: true },
  company: { type: String },
  note: { type: String },
  // Private is personal-only: a record filed under a group belongs to that group, so
  // privacyOnWrite (lib/privacy) drops this flag the moment a projectId is set.
  isPrivate: { type: Boolean, default: false },
}, { timestamps: true });

ContactSchema.index({ userId: 1, name: 1 });

// The Private Safe swaps the personal list, so isPrivate is part of that read, not a scan.
ContactSchema.index({ userId: 1, isPrivate: 1, name: 1 });
export const Contact: Model<IContact> = defineModel<IContact>('Contact', ContactSchema);
