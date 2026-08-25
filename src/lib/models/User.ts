import mongoose, { Schema, Document, Model } from 'mongoose';
import { defineModel } from './registry';

export interface IUser extends Document {
  name?: string;
  email: string;
  password?: string;
  resetToken?: string;
  resetTokenExpiry?: Date;
  resetAttempts?: number;
  emailVerified?: Date | null;
  verifyToken?: string;
  verifyTokenExpiry?: Date;
  verifyAttempts?: number;
  createdAt: Date;
  updatedAt: Date;
  privatePin?: string;
  image?: string;
  contactsSeeded?: string[];
  shareNoticeSeen?: string[];
  introDone?: string[];
  introDismissed?: boolean;
}

const UserSchema: Schema<IUser> = new Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  resetAttempts: { type: Number, default: 0 },
  // Absent on every row that existed before verification shipped, which reads as unverified.
  // Deliberate: projectAccess withholds shared data until it is stamped, so old accounts keep
  // their own vault and verify only when they actually reach for someone else's project.
  emailVerified: { type: Date, default: null },
  verifyToken: { type: String },
  verifyTokenExpiry: { type: Date },
  verifyAttempts: { type: Number, default: 0 },
  privatePin: { type: String },
  image: { type: String },
  // Addresses already turned into a Contact from a project's people. Without this the seeding in
  // getContacts would re-create anyone you deleted on the very next page load, and there would be
  // no way to remove them from the UI at all.
  contactsSeeded: [{ type: String, lowercase: true }],
  // Groups the "everyone in X will see this" sheet has already been shown for; '*' = never again
  shareNoticeSeen: [{ type: String }],
  // Getting-started steps that leave no record of their own (jarvis, android, sample), and Hide
  introDone: [{ type: String }],
  introDismissed: { type: Boolean, default: false },
}, { timestamps: true });

export const User: Model<IUser> = defineModel<IUser>('User', UserSchema);
