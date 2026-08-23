import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

export interface INote extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  title?: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String },
  body: { type: String, default: '' },
  pinned: { type: Boolean, default: false },
}, { timestamps: true });

NoteSchema.index({ userId: 1, pinned: -1, updatedAt: -1 });

export const Note: Model<INote> = defineModel<INote>('Note', NoteSchema);
