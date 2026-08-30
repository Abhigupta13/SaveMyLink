import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

/**
 * How far one person has read into one group's chat.
 *
 * Its own collection, one small row per person per group. The alternative — a map of readers on
 * the Project, or of groups on the User — puts every member of a busy group writing to the same
 * document every time anybody opens the chat, and grows a single row without bound. This writes
 * only the reader's own row and reads by a unique index.
 *
 * A timestamp rather than a last-read message id, because the question the card asks is "what
 * arrived after I looked", and a message id stops answering it the moment that message is deleted
 * — which the chat does as a tombstone, leaving the id present but the position meaningless.
 *
 * No row means nobody has opened this chat yet, and everything in it counts as unread. That is
 * also what every account looks like the day this ships: the first open writes the row and the
 * number settles. Deliberately not backfilled — "you have not read this" is true of them.
 */
export interface IChatRead extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  lastReadAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChatReadSchema = new Schema<IChatRead>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  lastReadAt: { type: Date, required: true },
}, { timestamps: true });

// Unique, so the upsert that marks a chat read cannot race itself into two rows for one reader —
// two tabs, or a poll and an open landing together, would otherwise leave the count reading off
// whichever row was found first.
ChatReadSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export const ChatRead: Model<IChatRead> = defineModel<IChatRead>('ChatRead', ChatReadSchema);
