import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

/**
 * What someone typed into "Help us improve". A log to read and act on, not a ticket system —
 * no status, no assignee, no replies. Add those the day reading the log stops being enough.
 */
export interface ISuggestion extends MongooseDocument {
  userId: mongoose.Types.ObjectId;
  email: string;
  kind: 'bug' | 'idea' | 'other';
  message: string;
  page?: string;
  userAgent?: string;
  shot?: { key: string; url: string; mimeType?: string; size?: number };
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
}, { timestamps: true });

SuggestionSchema.index({ createdAt: -1 });

export const Suggestion: Model<ISuggestion> = defineModel<ISuggestion>('Suggestion', SuggestionSchema);
