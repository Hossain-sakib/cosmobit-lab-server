import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true, immutable: true },
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 40 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
}, { timestamps: true });
userSchema.methods.toPublicJSON = function () {
  return { id: this._id, username: this.username, displayName: this.displayName, email: this.email, role: this.role };
};
export default mongoose.model('User', userSchema);
