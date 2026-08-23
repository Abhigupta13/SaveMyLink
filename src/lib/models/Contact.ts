import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';

export interface IContact extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  note?: string;
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
}, { timestamps: true });

ContactSchema.index({ userId: 1, name: 1 });

export const Contact: Model<IContact> = mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema);
