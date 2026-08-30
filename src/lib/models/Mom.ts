import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

// Minutes-of-meeting recording. Pipeline state is inferred from field presence:
// audioUrl only → uploaded; +transcript → transcribed; +summary/candidates → ready
// for review; tasksConfirmed → done.
export interface IMom extends MongooseDocument {
  projectId?: mongoose.Types.ObjectId | null;   // absent = a personal meeting, routed by the transcript alone
  userId: mongoose.Types.ObjectId;
  title: string;
  /** Nobody has named this meeting, so the transcript may. Cleared the moment a person edits it. */
  autoTitle?: boolean;
  audioUrl?: string;
  // Sarvam batch job, paid path only. A job id with no transcript means still transcribing.
  sarvamJobId?: string;
  // Which engine produced the transcript. Absent on everything recorded before r4 — those are
  // all Whisper, but they are not claimed as anything, so the card says nothing about them.
  engine?: 'gemini' | 'whisper' | 'sarvam';
  transcriptionError?: string;
  transcript?: string;
  summary?: string;
  candidates: {
    kind: 'task' | 'note' | 'brief';   // brief = append to the project's About text
    title: string;
    detail?: string;
    dueAt?: Date | null;
    assigneeEmail?: string;
    projectId?: mongoose.Types.ObjectId | null;
    missing?: string[];   // fields the transcript didn't specify — user is asked to fill these
  }[];
  tasksConfirmed: boolean;
  /** Behind the Private Safe. Only ever true on a personal record — see lib/privacy. */
  isPrivate?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MomSchema = new Schema<IMom>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  // Absent on everything recorded before titles were extracted. Those keep their date name, which
  // is right: re-titling somebody's old meetings out from under them is not a migration.
  autoTitle: { type: Boolean, default: false },
  audioUrl: { type: String },   // legacy: audio is transcribed on upload and never stored now
  sarvamJobId: { type: String },
  engine: { type: String, enum: ['gemini', 'whisper', 'sarvam'] },
  transcriptionError: { type: String },
  transcript: { type: String },
  summary: { type: String },
  candidates: [{
    kind: { type: String, enum: ['task', 'note', 'brief'], default: 'task' },
    title: String,
    detail: String,
    dueAt: Date,
    assigneeEmail: String,
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    missing: [String],
  }],
  tasksConfirmed: { type: Boolean, default: false },
  // Private is personal-only: a record filed under a group belongs to that group, so
  // privacyOnWrite (lib/privacy) drops this flag the moment a projectId is set.
  isPrivate: { type: Boolean, default: false },
}, { timestamps: true });

MomSchema.index({ projectId: 1, createdAt: -1 });
MomSchema.index({ userId: 1, createdAt: -1 });   // personal meetings have no project to index on

// The Private Safe swaps the personal list, so isPrivate is part of that read, not a scan.
MomSchema.index({ userId: 1, isPrivate: 1, createdAt: -1 });
export const Mom: Model<IMom> = defineModel<IMom>('Mom', MomSchema);
