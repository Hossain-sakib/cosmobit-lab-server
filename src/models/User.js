import mongoose from 'mongoose';
import { ROLE_PERMISSIONS, ALL_PERMISSIONS, MODULES, permissionsFor } from '../lib/permissions.js';
const userSchema = new mongoose.Schema({
  founderBootstrapAt: { type: Date, select: false },
  firebaseUid: { type: String, required: true, unique: true, immutable: true },
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 40 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  studioSuspended: { type: Boolean, default: false },
  notificationEmails: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  role: { type: String, enum: Object.keys(ROLE_PERMISSIONS), default: 'user' },
  grantedPermissions: [{ type: String, enum: ALL_PERMISSIONS }],
  deniedPermissions: [{ type: String, enum: ALL_PERMISSIONS }],
  allScopes: [{ type: String, enum: MODULES }],
}, { timestamps: true });
userSchema.methods.toPublicJSON = function () {
  return { id: this._id, username: this.username, displayName: this.displayName, email: this.email, emailVerified: this.emailVerified, role: this.role, permissions: permissionsFor(this) };
};
export default mongoose.model('User', userSchema);
