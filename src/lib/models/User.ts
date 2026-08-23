import mongoose, { Schema, Document, Model } from 'mongoose';
import { defineModel } from './registry';

export interface IUser extends Document {
  name?: string;
  email: string;
  password?: string;
  resetToken?: string;
  resetTokenExpiry?: Date;
  resetAttempts?: number;
  createdAt: Date;
  updatedAt: Date;
  privatePin?: string;
  image?: string;
}

const UserSchema: Schema<IUser> = new Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  resetAttempts: { type: Number, default: 0 },
  privatePin: { type: String },
  image: { type: String }
}, { timestamps: true });

export const User: Model<IUser> = defineModel<IUser>('User', UserSchema);
