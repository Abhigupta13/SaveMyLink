import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';
import { defineModel } from './registry';
import { REMINDER_VALUES, type ReminderChoice } from '../reminderRule';

export interface ITask extends MongooseDocument {
  title: string;
  description?: string;
  completed: boolean;
  dueAt?: Date;
  userId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  assigneeEmail?: string;
  assigneeIds: mongoose.Types.ObjectId[];
  assigneeEmails: string[];
  momId?: mongoose.Types.ObjectId;
  linkId?: mongoose.Types.ObjectId;
  signedOffBy?: mongoose.Types.ObjectId;
  signedOffAt?: Date;
  reminder?: ReminderChoice;
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
  // One shared task can be given to several people, and any of them ticks it for everybody.
  // assigneeId/assigneeEmail stay the PRIMARY, with the invariant assigneeEmail === assigneeEmails[0],
  // so every row written before this — and every LLM path that still assigns one person — reads
  // correctly with no migration: lib/taskAccess falls back to [assigneeEmail] when the list is empty.
  assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  assigneeEmails: [{ type: String, lowercase: true }],
  momId: { type: Schema.Types.ObjectId, ref: 'Mom' },
  linkId: { type: Schema.Types.ObjectId, ref: 'Link' },
  // Completion and sign-off are two states, not one: the assignee ticks their own work, an owner
  // answers for the outcome. Absent on every task that predates this, which reads as "not signed
  // off" — the honest answer for work nobody has approved.
  // ponytail: no index. Only queried by _id and by one countDocuments on the admin funnel; add a
  // sparse index on signedOffAt if that ever shows up in profiling.
  signedOffBy: { type: Schema.Types.ObjectId, ref: 'User' },
  signedOffAt: { type: Date },
  // When this task's reminder fires — see lib/reminderRule, which owns the maths. Absent on every
  // row written before the setting existed, and that absence is the fallback: the user's profile
  // default, then the 85% schedule. No index: nothing ever filters on it, it is read only on rows
  // already fetched by _id or by the "my open tasks" query.
  reminder: { type: String, enum: REMINDER_VALUES },
}, {
  timestamps: true
});

TaskSchema.index({ userId: 1 });
TaskSchema.index({ projectId: 1 });
TaskSchema.index({ assigneeId: 1 });
// Every "my tasks" surface now ORs assigneeIds alongside assigneeId. Mongo indexes each branch of
// an $or separately, so without this multikey index the co-assignee branch is a collection scan.
TaskSchema.index({ assigneeIds: 1 });
// claimAssignments matches on the email on EVERY task read, not just at signup — one query per
// field. Neither was indexed, so both were full scans that only stayed cheap while the collection
// was small. The array one is new; the scalar one was already there and is fixed while we are here.
TaskSchema.index({ assigneeEmail: 1 });
TaskSchema.index({ assigneeEmails: 1 });

export default defineModel<ITask>('Task', TaskSchema);
