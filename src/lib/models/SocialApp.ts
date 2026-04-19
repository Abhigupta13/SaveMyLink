import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISocialApp extends Document {
  user: mongoose.Types.ObjectId;
  name: string;
  url: string;
  icon: string;
  color: string;
  isPinned: boolean;
  order: number;
}

const SocialAppSchema: Schema<ISocialApp> = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  url: { type: String, required: true },
  icon: { type: String, required: true },
  color: { type: String, required: true },
  isPinned: { type: Boolean, default: false },
  order: { type: Number, default: 0 }
}, { timestamps: true });

if (mongoose.models.SocialApp) {
  delete mongoose.models.SocialApp;
}
export const SocialApp: Model<ISocialApp> = mongoose.model<ISocialApp>('SocialApp', SocialAppSchema);
