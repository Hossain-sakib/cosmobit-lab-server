import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorUsername: { type: String, required: true },
    authorDisplayName: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const communityPostSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorUsername: { type: String, required: true },
    authorDisplayName: { type: String, required: true },
    content: { type: String, trim: true, maxlength: 2000, default: "" },
    isDemo: { type: Boolean, default: false },
    demoKey: { type: String, unique: true, sparse: true },
    imageStorage: {
      type: String,
      enum: ["local", "cloudinary"],
      default: "local",
    },
    imagePublicId: { type: String, default: "" },
    imageUrl: { type: String, default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    comments: [commentSchema],
    shareCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("CommunityPost", communityPostSchema);
