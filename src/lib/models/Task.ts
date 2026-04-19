import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface ITask extends MongooseDocument {
  title: string;
  completed: boolean;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true
});

export default mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema);
