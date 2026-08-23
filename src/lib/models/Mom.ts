import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';

// Minutes-of-meeting recording. Pipeline state is inferred from field presence:
// audioUrl only → uploaded; +transcript → transcribed; +summary/candidates → ready
// for review; tasksConfirmed → done.
export interface IMom extends MongooseDocument {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  audioUrl: string;
  transcript?: string;
  summary?: string;
  candidates: { title: string; assigneeEmail?: string }[];
  tasksConfirmed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MomSchema = new Schema<IMom>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  audioUrl: { type: String, required: true },
  transcript: { type: String },
  summary: { type: String },
  candidates: [{ title: String, assigneeEmail: String }],
  tasksConfirmed: { type: Boolean, default: false },
}, { timestamps: true });

MomSchema.index({ projectId: 1, createdAt: -1 });

export const Mom: Model<IMom> = mongoose.models.Mom || mongoose.model<IMom>('Mom', MomSchema);
