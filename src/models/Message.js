import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    budget: { type: String, default: "" },
    message: { type: String, required: true },
    source: { type: String, default: 'contact' },
    submissionKey: { type: String, unique: true, sparse: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);
