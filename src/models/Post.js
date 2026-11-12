import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    excerpt: { type: String, required: true, trim: true },
    content: { type: String, required: true }, // plain text / markdown-ish, rendered as paragraphs
    category: { type: String, default: "Engineering" },
    author: { type: String, default: "CosmoBit Labs" },
    coverVariant: { type: String, default: "blue" }, // used to pick a gradient/illustration client-side
    published: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
    seoTitle: { type: String, trim: true, maxlength: 70 },
    seoDescription: { type: String, trim: true, maxlength: 170 },
  },
  { timestamps: true },
);

export default mongoose.model("Post", postSchema);
