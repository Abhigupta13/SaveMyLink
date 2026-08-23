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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const Document = defineModel<any>('Document', DocumentSchema as any);
