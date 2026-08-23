import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

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
}, {
  timestamps: true
});

TaskSchema.index({ userId: 1 });
TaskSchema.index({ projectId: 1 });
TaskSchema.index({ assigneeId: 1 });

export default mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema);
