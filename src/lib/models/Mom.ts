import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

// Minutes-of-meeting recording. Pipeline state is inferred from field presence:
// audioUrl only → uploaded; +transcript → transcribed; +summary/candidates → ready
// for review; tasksConfirmed → done.
export interface IMom extends MongooseDocument {
  projectId?: mongoose.Types.ObjectId | null;   // absent = a personal meeting, routed by the transcript alone
  userId: mongoose.Types.ObjectId;
  title: string;
  audioUrl?: string;
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
  createdAt: Date;
  updatedAt: Date;
}

const MomSchema = new Schema<IMom>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  audioUrl: { type: String },   // legacy: audio is transcribed on upload and never stored now
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
}, { timestamps: true });

MomSchema.index({ projectId: 1, createdAt: -1 });
MomSchema.index({ userId: 1, createdAt: -1 });   // personal meetings have no project to index on

export const Mom: Model<IMom> = defineModel<IMom>('Mom', MomSchema);
