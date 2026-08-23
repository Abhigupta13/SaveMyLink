import mongoose from 'mongoose';
import { defineModel } from './registry';

const DocumentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Filing a document under a project shares it with that project's members. Absent = my
  // own locker only. Orthogonal to `folder`, which stays a personal filing label.
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
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
    type: String, // /api/files/<key> for uploads, or the external link
    required: true
  },
  // Storage key for uploads. Absent on external links, and on files saved before the move
  // off public/uploads — those keep serving from their old /uploads/... url.
  key: {
    type: String
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
DocumentSchema.index({ projectId: 1, createdAt: -1 });

export const Document = defineModel<any>('Document', DocumentSchema as any);
