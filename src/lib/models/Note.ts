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
  momId?: mongoose.Types.ObjectId | null;       // the meeting it came out of, mirroring Task
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
  // Task has carried this since MOM shipped; Note never did, so a note out of a meeting was
  // indistinguishable from a typed one — untraceable back to what was said, and invisible to
  // anything asking what a meeting actually produced.
  // Notes that predate this stay plain notes: the link cannot be reconstructed, and a wrong
  // guess about which meeting a note came from is worse than no guess.
  momId: { type: Schema.Types.ObjectId, ref: 'Mom' },
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
// The group workspace reads one project's notes in the list's own sort order. Without this the
// project branch of the read scope — which has always been there, inside the $or — is a scan.
NoteSchema.index({ projectId: 1, pinned: -1, updatedAt: -1 });

export const Note: Model<INote> = defineModel<INote>('Note', NoteSchema);
