import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  name?: string;
  email: string;
  password?: string;
  resetToken?: string;
  resetTokenExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
  privatePin?: string;
}

const UserSchema: Schema<IUser> = new Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  privatePin: { type: String }
}, { timestamps: true });

if (mongoose.models.User) {
  delete mongoose.models.User;
}
export const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
