import mongoose from 'mongoose';
export const WORK_STATUSES = {
  client: ['active', 'inactive'],
  lead: ['new', 'contacted', 'qualified', 'won', 'lost'],
  project: ['planned', 'active', 'on-hold', 'completed', 'cancelled'],
  task: ['todo', 'in-progress', 'blocked', 'done'],
  note: ['active', 'archived'],
};
const schema = new mongoose.Schema({
  kind: { type: String, enum: Object.keys(WORK_STATUSES), required: true, immutable: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 20000 },
  status: { type: String, required: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  company: { type: String, default: '', maxlength: 200 },
  email: { type: String, default: '', maxlength: 254 },
  phone: { type: String, default: '', maxlength: 50 },
  value: { type: Number, default: 0, min: 0, max: 1000000000000 },
  currency: { type: String, default: 'USD', match: /^[A-Z]{3}$/ },
  dueDate: { type: Date, default: null },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkItem', default: null },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkItem', default: null },
  assignee: { type: String, default: '', maxlength: 200 },
  archived: { type: Boolean, default: false, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  history: [{ _id: false, at: Date, actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, action: String, fields: [String] }],
}, { timestamps: true });
schema.index({ kind: 1, archived: 1, createdAt: -1 });
export default mongoose.model('WorkItem', schema);
