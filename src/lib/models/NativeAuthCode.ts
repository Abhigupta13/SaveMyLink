import mongoose, { Schema, Document as MongooseDocument, Model } from 'mongoose';
import { defineModel } from './registry';

/**
 * One row per in-flight native sign-in: the bridge between a Custom Tab that has just finished
 * Google OAuth and the app WebView that still has no session. See lib/nativeAuth.ts for why the
 * handoff has to exist at all and why the challenge is part of it.
 *
 * Stored rather than signed, because this code must be single-use. A stateless signed token is
 * replayable for as long as it is valid, and what it buys is a session — the one thing where
 * "valid twice" is worth a collection.
 *
 * Neither secret is stored in the clear: `codeHash` is sha256 of the code that travelled through
 * the deep link, `challenge` is sha256 of the verifier that never left the WebView. A dump of this
 * collection is a list of hashes that cannot be spent.
 */
export interface INativeAuthCode extends MongooseDocument {
  codeHash: string;
  challenge: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NativeAuthCodeSchema = new Schema<INativeAuthCode>({
  codeHash: { type: String, required: true, unique: true },
  challenge: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  // Stamped instead of deleted, so a code presented twice is distinguishable from one that never
  // existed. The second attempt is worth a log line: it means either a retry or an interception.
  usedAt: { type: Date, default: null },
}, { timestamps: true });

// Mongo drops the row once expiresAt passes, so spent and abandoned codes clean themselves up and
// nothing here needs a sweeper. expireAfterSeconds: 0 means "at the time in this field".
NativeAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const NativeAuthCode: Model<INativeAuthCode> =
  defineModel<INativeAuthCode>('NativeAuthCode', NativeAuthCodeSchema);
