import { Router } from "express";
import { randomUUID } from "node:crypto";
import Post from "../models/Post.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { fields, postFields } from "../lib/validation.js";
const router = Router();
function slugify(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "post"
  );
}
async function uniqueSlug(title, id) {
  const slug = slugify(title);
  return (await Post.exists({ slug, ...(id ? { _id: { $ne: id } } : {}) }))
    ? `${slug}-${randomUUID()}`
    : slug;
}
router.get("/", async (req, res) =>
  res.json({
    posts: await Post.find({ published: true }).sort({ createdAt: -1 }),
  }),
);
router.get("/:slug", async (req, res) => {
  const post = await Post.findOne({ slug: req.params.slug, published: true });
  if (!post) return res.status(404).json({ message: "Post not found." });
  res.json({ post });
});
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const data = fields(req.body, postFields);
  const post = await Post.create({
    ...data,
    slug: await uniqueSlug(data.title),
  });
  res.status(201).json({ post });
});
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const data = fields(req.body, postFields, true);
  if (data.title) data.slug = await uniqueSlug(data.title, req.params.id);
  const post = await Post.findByIdAndUpdate(
    req.params.id,
    { $set: data },
    { new: true, runValidators: true },
  );
  if (!post) return res.status(404).json({ message: "Post not found." });
  res.json({ post });
});
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  if (!(await Post.findByIdAndDelete(req.params.id)))
    return res.status(404).json({ message: "Post not found." });
  res.json({ message: "Post deleted." });
});
export default router;
