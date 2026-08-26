import mongoose, { Schema, Document, Model } from 'mongoose';
import { defineModel } from './registry';

export interface IUser extends Document {
  name?: string;
  email: string;
  password?: string;
  resetToken?: string;
  resetTokenExpiry?: Date;
  resetAttempts?: number;
  emailVerified?: Date | null;
  verifyToken?: string;
  verifyTokenExpiry?: Date;
  verifyAttempts?: number;
  createdAt: Date;
  updatedAt: Date;
  privatePin?: string;
  image?: string;
  contactsSeeded?: string[];
  shareNoticeSeen?: string[];
  introDone?: string[];
  introDismissed?: boolean;
  tourDone?: boolean;
  // The user's own Sarvam API key, sealed by lib/secretBox. `last4` is the only part that is
  // ever allowed back out to a browser — enough to recognise which key is stored, useless alone.
  sarvamKey?: { box: string; last4: string };
  // Granted by an admin to someone who paid the founder directly — spends the founder's env key.
  // `By`/`At` are the audit: with two admins, "who let them in" is the half worth keeping, and
  // the Event trail cannot hold this because every event belongs to a project and this has none.
  sarvamAccess?: boolean;
  sarvamAccessBy?: string;
  sarvamAccessAt?: Date;
  // Account deletion with disclosed retention. Once set the account is gone: it cannot sign in
  // (auth.ts refuses), it is excluded from admin totals, and everything but name/email/role has
  // been nulled. The row itself lingers up to 90 days (purgeDeletedAccounts) so the disclosed
  // retention promise in /terms is one we actually keep, then it is removed for good.
  deletedAt?: Date | null;
  // Jarvis's per-user daily allowance. The pair is the whole mechanism: a count, and the day in
  // the user's own zone it belongs to. A count stamped with any other day reads as zero, so there
  // is no reset job to run and no midnight cron to get wrong.
  jarvisCount?: number;
  jarvisCountDate?: string;
  // Their role-in-company, captured once on the delete screen — the only new profile field, and
  // the only content kept alongside name and email during retention.
  role?: string;
}

const UserSchema: Schema<IUser> = new Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  resetAttempts: { type: Number, default: 0 },
  // Absent on every row that existed before verification shipped, which reads as unverified.
  // Deliberate: projectAccess withholds shared data until it is stamped, so old accounts keep
  // their own vault and verify only when they actually reach for someone else's project.
  emailVerified: { type: Date, default: null },
  verifyToken: { type: String },
  verifyTokenExpiry: { type: Date },
  verifyAttempts: { type: Number, default: 0 },
  privatePin: { type: String },
  image: { type: String },
  // Addresses already turned into a Contact from a project's people. Without this the seeding in
  // getContacts would re-create anyone you deleted on the very next page load, and there would be
  // no way to remove them from the UI at all.
  contactsSeeded: [{ type: String, lowercase: true }],
  // Groups the "everyone in X will see this" sheet has already been shown for; '*' = never again
  shareNoticeSeen: [{ type: String }],
  // Getting-started steps that leave no record of their own (jarvis, android, sample), and Hide
  introDone: [{ type: String }],
  introDismissed: { type: Boolean, default: false },
  // The spotlight tour: set once it is finished or dismissed, so it never auto-runs twice.
  tourDone: { type: Boolean, default: false },
  // _id: false — this is one value, not a subdocument anyone needs to address
  sarvamKey: { type: { box: String, last4: String }, _id: false },
  sarvamAccess: { type: Boolean },
  sarvamAccessBy: { type: String },
  sarvamAccessAt: { type: Date },
  jarvisCount: { type: Number, default: 0 },
  jarvisCountDate: { type: String, default: '' },
  // Absent on every live account, which reads as "not deleted" — the honest default.
  deletedAt: { type: Date, default: null },
  role: { type: String },
}, { timestamps: true });

export const User: Model<IUser> = defineModel<IUser>('User', UserSchema);
