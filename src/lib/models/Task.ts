import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';
import { defineModel } from './registry';

export interface ITask extends MongooseDocument {
  title: string;
  description?: string;
  completed: boolean;
  dueAt?: Date;
  userId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  assigneeEmail?: string;
  momId?: mongoose.Types.ObjectId;
  linkId?: mongoose.Types.ObjectId;
  signedOffBy?: mongoose.Types.ObjectId;
  signedOffAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
  title: { type: String, required: true },
  description: { type: String },
  completed: { type: Boolean, default: false },
  dueAt: { type: Date },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
  assigneeEmail: { type: String, lowercase: true }, // kept so assignments to not-yet-registered emails survive; claimed on their first read
  momId: { type: Schema.Types.ObjectId, ref: 'Mom' },
  linkId: { type: Schema.Types.ObjectId, ref: 'Link' },
  // Completion and sign-off are two states, not one: the assignee ticks their own work, an owner
  // answers for the outcome. Absent on every task that predates this, which reads as "not signed
  // off" — the honest answer for work nobody has approved.
  // ponytail: no index. Only queried by _id and by one countDocuments on the admin funnel; add a
  // sparse index on signedOffAt if that ever shows up in profiling.
  signedOffBy: { type: Schema.Types.ObjectId, ref: 'User' },
  signedOffAt: { type: Date },
}, {
  timestamps: true
});

TaskSchema.index({ userId: 1 });
TaskSchema.index({ projectId: 1 });
TaskSchema.index({ assigneeId: 1 });

export default defineModel<ITask>('Task', TaskSchema);
