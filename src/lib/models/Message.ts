import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

/**
 * One message in a project's chat.
 *
 * Shaped after Event — projectId + actor + time, read newest-first off a single index — because a
 * chat and a trail ask the database the same question. It is a separate collection rather than
 * another Event verb for three reasons: `verb` is a closed vocabulary with no phrasing for free
 * text, `subject` is truncated at 140 characters, and `recordEvent` swallows its own failures on
 * purpose. Losing a trail row is survivable; losing a message the sender watched leave is not.
 *
 * `refs` is denormalised exactly the way Event.subject is. The label is captured at write time, so
 * a message that pointed at a task still reads correctly after that task is deleted — which is
 * precisely when somebody goes looking for what was said about it.
 */

export type MessageRefKind = 'task' | 'mom' | 'note' | 'user';

/**
 * A task, meeting or note is referenced by id. A PERSON is referenced by email, for the same
 * reason task assignment is: `memberEmails` may hold an address that has not signed up yet, so a
 * user id would be unmentionable for exactly the teammate most likely to need chasing.
 */
export interface IMessageRef {
  kind: MessageRefKind;
  id?: mongoose.Types.ObjectId | null;
  email?: string | null;
  label: string;
}

export interface IMessageAttachment {
  name: string;
  key: string;       // storage key — /api/files/<key> resolves it behind auth
  url: string;
  mimeType?: string;
  size?: number;
  text?: string;     // extracted at upload so Jarvis can answer from inside the file
}

export interface IMessage extends MongooseDocument {
  projectId: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  body: string;
  attachments: IMessageAttachment[];
  refs: IMessageRef[];
  editedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Long enough for a paragraph of context, short enough that the poll stays cheap. */
export const MAX_MESSAGE_CHARS = 4000;

const MessageSchema = new Schema<IMessage>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, default: '', trim: true },
  // Owned by the message: deleted with it, and never shown in the Digi Locker — same rule as a
  // note's attachments, and the same sub-document shape so /api/files can treat them alike.
  attachments: {
    type: [{ _id: false, name: String, key: String, url: String, mimeType: String, size: Number, text: String }],
    default: [],
  },
  refs: {
    type: [{ _id: false, kind: String, id: Schema.Types.ObjectId, email: { type: String, lowercase: true }, label: String }],
    default: [],
  },
  editedAt: { type: Date, default: null },
  // A tombstone, not a delete. The row stays so the thread keeps its shape and the messages around
  // it still read as a conversation; the action that sets this clears the body and the files.
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

// The only query the panel makes: one project's messages, newest first, paged on createdAt.
MessageSchema.index({ projectId: 1, createdAt: -1 });

export const Message: Model<IMessage> = defineModel<IMessage>('Message', MessageSchema);
