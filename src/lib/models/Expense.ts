import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';
import { defineModel } from './registry';

export type ExpenseCategory = 'food' | 'grocery' | 'health' | 'gym' | 'travel' | 'shopping' | 'bills' | 'maintenance' | 'entertainment' | 'other' | (string & {});
export type ExpenseClassification = 'expense' | 'investment' | 'waste';

export interface IExpense extends MongooseDocument {
  title: string;
  amount: number;
  currency: string;
  date: Date;
  category: ExpenseCategory;
  classification: ExpenseClassification;
  merchant?: string;
  notes?: string;
  userId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  isPrivate?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>({
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  date: { type: Date, default: Date.now, required: true },
  category: { 
    type: String, 
    default: 'other',
    required: true
  },
  classification: {
    type: String,
    enum: ['expense', 'investment', 'waste'],
    default: 'expense',
    required: true
  },
  merchant: { type: String },
  notes: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
  isPrivate: { type: Boolean, default: false }
}, {
  timestamps: true
});

ExpenseSchema.index({ userId: 1, date: -1 });
ExpenseSchema.index({ userId: 1, category: 1 });
ExpenseSchema.index({ userId: 1, classification: 1 });
ExpenseSchema.index({ userId: 1, isPrivate: 1, date: -1 });

export default defineModel<IExpense>('Expense', ExpenseSchema);
