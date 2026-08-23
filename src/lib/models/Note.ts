import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

export interface INoteAttachment {
  name: string;
  key: string;       // storage key — /api/files/<key> resolves it behind auth
  url: string;
  mimeType?: string;
  size?: number;
  text?: string;     // extracted at upload so Jarvis can answer from inside the file
}

export interface INote extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId | null;   // set when the note came out of a project meeting
  title?: string;
  body: string;
  pinned: boolean;
  attachments: INoteAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  title: { type: String },
  body: { type: String, default: '' },
  pinned: { type: Boolean, default: false },
  // Owned by the note: deleted with it, and never shown in the Digi Locker
  attachments: {
    type: [{ _id: false, name: String, key: String, url: String, mimeType: String, size: Number, text: String }],
    default: [],
  },
}, { timestamps: true });

NoteSchema.index({ userId: 1, pinned: -1, updatedAt: -1 });

export const Note: Model<INote> = defineModel<INote>('Note', NoteSchema);
