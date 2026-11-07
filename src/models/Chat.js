import mongoose from "mongoose";
const threadSchema = new mongoose.Schema(
  {
    directKey: { type: String, required: true, unique: true },
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    kind: { type: String, enum: ["client", "internal"], required: true },
    lastMessage: { type: String, default: "", maxlength: 180 },
    lastMessageAt: Date,
    readAt: { type: Map, of: Date, default: {} },
  },
  { timestamps: true },
);
threadSchema.index({ participants: 1, updatedAt: -1 });
export const ChatThread = mongoose.model("ChatThread", threadSchema);
const messageSchema = new mongoose.Schema(
  {
    threadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatThread",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, required: true, maxlength: 4000 },
    clientMessageId: { type: String, required: true, maxlength: 36 },
  },
  { timestamps: true },
);
messageSchema.index({ threadId: 1, createdAt: -1, _id: -1 });
messageSchema.index(
  { threadId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true },
);
export const ChatMessage = mongoose.model("ChatMessage", messageSchema);
