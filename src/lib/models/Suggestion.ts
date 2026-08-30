import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

/**
 * What someone typed into "Help us improve". A log to read and act on, not a ticket system —
 * no assignee, no threads. It now carries one piece of state: an admin can close a report, which
 * thanks the reporter by email and moves it out of the default view.
 *
 * Resolving is a record, not a delete. "Did we ever answer this person?" is the question an inbox
 * that tidies itself away can never answer, so who closed it and when both stay on the row.
 */
export interface ISuggestion extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  email: string;
  kind: 'bug' | 'idea' | 'other';
  message: string;
  page?: string;
  userAgent?: string;
  shot?: { key: string; url: string; mimeType?: string; size?: number };
  resolvedAt?: Date | null;
  resolvedBy?: string;
  resolveNote?: string;
  /** 'pending' = closed, and the thank-you is being sent after the response rather than during it. */
  resolveMail?: 'sent' | 'failed' | 'none' | 'pending' | 'already';
  /** When the reporter was actually written to. Survives a reopen — see below. */
  thankedAt?: Date | null;
  reopenedAt?: Date | null;
  reopenedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SuggestionSchema = new Schema<ISuggestion>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Denormalised: the inbox is a flat list and should not populate a user per row
  email: { type: String, default: '' },
  kind: { type: String, enum: ['bug', 'idea', 'other'], default: 'other' },
  message: { type: String, required: true },
  page: { type: String },        // where they were when they hit the button — the "where" of a bug
  userAgent: { type: String },   // a bug report with no browser or OS is half a report
  shot: { type: { _id: false, key: String, url: String, mimeType: String, size: Number } },
  // `null`, not absent, is the open state — it is what the atomic claim in resolveSuggestion
  // matches on, and in Mongo a null equality matches a missing field too, so every report
  // written before this existed already reads as open with no migration.
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String },   // the SESSION email of the admin who closed it, never a client value
  resolveNote: { type: String },  // what the admin chose to tell them, if anything
  // Whether the thank-you actually left the building. The resolution is committed before the send
  // is attempted, so this is the only thing that distinguishes "answered" from "closed in silence"
  // once the page is reloaded and the action's return value is gone.
  resolveMail: { type: String, enum: ['sent', 'failed', 'none', 'pending', 'already'] },
  /* The one fact a reopen must NOT forget. resolvedBy/resolveNote/resolveMail all describe a
     particular closing and are cleared when that closing is undone; this describes the reporter's
     inbox, which does not un-receive a mail because an admin changed their mind. Closing a report
     that carries this thanks nobody a second time — the "exactly once" the atomic claim buys
     within one closing, held across reopen-and-close-again too. */
  thankedAt: { type: Date, default: null },
  reopenedAt: { type: Date, default: null },   // the row says it came back, not just that it is open
  reopenedBy: { type: String },
}, { timestamps: true });

SuggestionSchema.index({ createdAt: -1 });
// The inbox now asks two questions instead of one: open by newest written, resolved by newest
// closed. One compound index serves both — an equality on null then createdAt for the first, and
// the resolvedAt prefix alone for the second.
SuggestionSchema.index({ resolvedAt: -1, createdAt: -1 });

export const Suggestion: Model<ISuggestion> = defineModel<ISuggestion>('Suggestion', SuggestionSchema);
