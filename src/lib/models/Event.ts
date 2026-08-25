import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';
import type { Verb } from '@/lib/activity';

/**
 * What changed in a shared group, and who changed it.
 *
 * History cannot be backfilled, which is the entire reason this lands before the view-only role:
 * once a round starts rewriting who may do what, a mistake shows up as an event nobody expected
 * instead of a silent change.
 *
 * `subject` is denormalised on purpose — the task's title, the member's address, captured at write
 * time. An event that resolved its subject by lookup would go blank the moment the task was
 * deleted, which is precisely when the trail matters most.
 */
export interface IEvent extends MongooseDocument {
  projectId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  verb: Verb;
  subject?: string;
  at: Date;
}

const EventSchema = new Schema<IEvent>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  verb: { type: String, required: true },
  subject: { type: String },
  at: { type: Date, default: Date.now },
}, { timestamps: false });   // `at` is the only date this has, and two would eventually disagree

// The only query the trail makes, and the only one it should ever make.
EventSchema.index({ projectId: 1, at: -1 });

export const Event: Model<IEvent> = defineModel<IEvent>('Event', EventSchema);

/**
 * Append one event. Never throws and never fails its caller: the trail is a record OF the work,
 * and losing the record must not roll the work back. Same reasoning addMember uses for invite
 * mail — SMTP being down does not un-invite anybody.
 *
 * Personal records are skipped. With no group there is nobody to show a trail to.
 */
export async function recordEvent(e: {
  projectId?: mongoose.Types.ObjectId | string | null;
  actorId: string;
  verb: Verb;
  subject?: string | null;
}): Promise<void> {
  try {
    if (!e.projectId) return;
    await Event.create({
      projectId: String(e.projectId),
      actorId: e.actorId,
      verb: e.verb,
      // A meeting title or a pasted task can be long; the trail is a glance, not a transcript.
      subject: String(e.subject ?? '').trim().slice(0, 140) || undefined,
      at: new Date(),
    });
  } catch (error) {
    console.error('Event not recorded:', e.verb, error);
  }
}
