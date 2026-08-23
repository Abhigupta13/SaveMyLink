import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';

export interface IProject extends MongooseDocument {
  name: string;
  ownerId: mongoose.Types.ObjectId;
  memberEmails: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  memberEmails: [{ type: String, lowercase: true }],
  notes: { type: String, default: '' },
}, { timestamps: true });

export const Project: Model<IProject> = mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);
