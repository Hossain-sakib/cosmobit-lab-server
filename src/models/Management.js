import mongoose from 'mongoose';
import { projectFields, specialOrderFields, pageFields, revisionFields, productFields, leadFields, sampleFields, departmentFields, employeeFields, taskFields, salesActivityFields, distributionFields, allocationFields, applicationFields } from '../lib/managementFields.js';
import { projectCalculated, specialCalculated } from '../lib/management.js';
function schemaFields(definitions) {
  return Object.fromEntries(Object.entries(definitions).map(([key, spec]) => [key, { type: spec.type === 'boolean' ? Boolean : spec.type === 'string-list' ? [String] : spec.type === 'id' ? mongoose.Schema.Types.ObjectId : spec.type === 'number' ? Number : String, required: !!spec.required, ...(spec.type === 'boolean' ? {default:false} : spec.type === 'string-list' ? { default: [] } : spec.type === 'id' ? { default: null } : spec.type === 'number' ? { min: spec.min, max: spec.max, default: 0 } : { maxlength: spec.max || 2000, default: '', ...(spec.values ? { enum: spec.values } : {}) }) }]));
}
const sourceSchema = new mongoose.Schema({ fileName: {type:String,maxlength:300}, sheetName: {type:String,maxlength:200}, rowNumber:Number, batchId:String }, {_id:false});
const common = {
  sourceReference: {type:sourceSchema,default:undefined},
  importKey: { type: String, unique: true, sparse: true, select: false },
  archived: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  history: [{ _id: false, at: Date, actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, action: String, fields: [String] }],
};
const options = { timestamps: true, toJSON: { transform(doc, ret) { ret.version = ret.__v; delete ret.resumeFilename; delete ret.submissionKey; return ret; } } };
const projectSchema = new mongoose.Schema({ ...schemaFields(projectFields), ...common,
  sourceDealId: { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true },
  sourceProposalId: { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true },
  salesAllocations: [new mongoose.Schema(schemaFields(allocationFields), { _id: false })],
  operationsAllocations: [new mongoose.Schema(schemaFields(allocationFields), { _id: false })],
  memberUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pages: [new mongoose.Schema(schemaFields(pageFields), { _id: false })],
  revisions: [new mongoose.Schema(schemaFields(revisionFields), { _id: false })],
}, options);
projectSchema.path('feePercent').default(20);
projectSchema.path('status').default('new');
projectSchema.path('platform').default('Fiverr');
projectSchema.path('priority').default('normal');
projectSchema.set('toJSON', { transform(doc, ret) { ret.version = ret.__v; Object.assign(ret, projectCalculated(ret)); return ret; } });
projectSchema.index({ archived: 1, createdAt: -1 });
const specialSchema = new mongoose.Schema({ ...schemaFields(specialOrderFields), ...common }, options);
specialSchema.path('paymentStatus').default('unpaid');
specialSchema.path('orderStatus').default('new');
specialSchema.set('toJSON', { transform(doc, ret) { ret.version = ret.__v; Object.assign(ret, specialCalculated(ret)); return ret; } });
specialSchema.index({ archived: 1, createdAt: -1 });
export const ManagedProject = mongoose.model('ManagedProject', projectSchema);
export const SpecialOrder = mongoose.model('SpecialOrder', specialSchema);

export function createModel(name, definitions, defaults = {}, extra = {}) {
  const schema = new mongoose.Schema({ ...schemaFields(definitions), ...common, ...extra }, options);
  for (const [key, value] of Object.entries(defaults)) schema.path(key).default(value);
  schema.index({ archived: 1, createdAt: -1 });
  return mongoose.model(name, schema);
}
export const Product = createModel('Product', productFields, { status: 'active', currency: 'USD' });
export const ProductLead = createModel('ProductLead', leadFields, { status: 'new' }, { productId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, index: true }, dedupeKey: String });
ProductLead.schema.index({ productId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
export const WorkSample = createModel('WorkSample', sampleFields, { medium: 'website', collectionType: 'work-sample', useStatus: 'unused' });
export const Department = createModel('Department', departmentFields);
export const Employee = createModel('Employee', employeeFields, { status: 'active' });
Employee.schema.index({ accountUserId: 1 }, { unique: true, partialFilterExpression: { accountUserId: { $type: 'objectId' }, archived: false, status: 'active' } });
export const TeamTask = createModel('TeamTask', taskFields, { status: 'todo', priority: 'normal' });
export const SalesActivity = createModel('SalesActivity', salesActivityFields, { platform: 'Fiverr' });
SalesActivity.schema.index({ platform: 1, profile: 1, date: 1 }, { unique: true });
export const DistributionHistory = createModel('DistributionHistory', distributionFields, { platform: 'Fiverr', division: 'sales' });
DistributionHistory.schema.index({ month: 1, person: 1, division: 1, platform: 1 }, { unique: true });
export const CareerApplication = createModel('CareerApplication', applicationFields, { status: 'new' }, { resumeFilename: { type: String, select: false }, resumeFileId: { type: mongoose.Schema.Types.ObjectId, select: false }, resumeAvailable: { type: Boolean, default: false }, submissionKey: { type: String, unique: true, sparse: true, select: false }, jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' } });

CareerApplication.schema.path('createdBy').required(false);
CareerApplication.schema.path('updatedBy').required(false);
