import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

export interface IProject extends MongooseDocument {
  name: string;
  ownerId: mongoose.Types.ObjectId;
  ownerEmails: string[];
  memberEmails: string[];
  viewerEmails: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },   // the creator: permanent, never demotable
  // Promoted co-owners. They stay in memberEmails too, so every read path keeps working and
  // ownership is an extra capability rather than a separate class of access. Absent on every
  // project that predates this, which reads as [] — exactly the old single-owner behaviour.
  ownerEmails: [{ type: String, lowercase: true }],
  memberEmails: [{ type: String, lowercase: true }],
  // Clients and stakeholders: they read the group and change nothing. Kept OUT of memberEmails,
  // unlike co-owners, because this is the one role that is less than a member rather than more —
  // and every write gate answers "am I in memberEmails" rather than "am I on the project".
  // Absent on every project that predates this, which reads as [] — the old two-role behaviour.
  viewerEmails: [{ type: String, lowercase: true }],
  notes: { type: String, default: '' },
}, { timestamps: true });

export const Project: Model<IProject> = defineModel<IProject>('Project', ProjectSchema);
