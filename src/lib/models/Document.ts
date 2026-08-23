import mongoose from 'mongoose';
import { defineModel } from './registry';

const DocumentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  // A folder is just a label on the document — no separate collection, so there is nothing
  // to keep in sync and no orphans to clean up. The folder list is a distinct() over these.
  folder: {
    type: String,
    default: 'Personal',
    trim: true
  },
  type: {
    type: String, // 'file' or 'link'
    enum: ['file', 'link'],
    required: true
  },
  url: {
    type: String, // Path to file or external link
    required: true
  },
  mimeType: {
    type: String
  },
  size: {
    type: Number
  },
  // Plain text pulled out at upload so Jarvis can answer from what is inside the file.
  // undefined = never attempted, '' = attempted and there was nothing to read (image, video…).
  text: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

DocumentSchema.index({ user: 1, folder: 1, createdAt: -1 });

export const Document = defineModel<any>('Document', DocumentSchema as any);
