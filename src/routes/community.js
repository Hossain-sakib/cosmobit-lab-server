import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import CommunityPost from '../models/CommunityPost.js';
import { requireAuth } from '../middleware/auth.js';
import { text, fail } from '../lib/validation.js';
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 10000, parts: 2 } });
function handleUpload(req, res, next) {
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
}
router.get('/posts', async (req, res) => res.json({ posts: await CommunityPost.find().sort({ createdAt: -1 }).limit(100) }));
router.post('/posts', requireAuth, handleUpload, async (req, res) => {
  const content = text(req.body?.content ?? '', 'Content', { min: 0, max: 2000 });
  if (!content && !req.file) fail('Add some text or an image to post.');
  let filename;
  if (req.file) {
    let image;
    try {
      const input = sharp(req.file.buffer, { limitInputPixels: 20000000, failOn: 'warning' });
      const metadata = await input.metadata();
      if (!['jpeg', 'png', 'gif', 'webp'].includes(metadata.format)) fail('Unsupported image.');
      image = await input.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch { fail('Upload a valid JPEG, PNG, GIF, or WebP image up to 20 megapixels.'); }
    filename = `${randomUUID()}.webp`;
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, filename), image, { flag: 'wx' });
  }
  try {
    const post = await CommunityPost.create({ authorId: req.user.id, authorUsername: req.user.username, authorDisplayName: req.user.displayName, content, imageUrl: filename ? `/uploads/${filename}` : null });
    res.status(201).json({ post });
  } catch (err) {
    if (filename) await fs.unlink(path.join(uploadsDir, filename)).catch(() => {});
    throw err;
  }
});
router.delete('/posts/:id', requireAuth, async (req, res) => {
  const post = await CommunityPost.findById(req.params.id);
  if (!post) fail('Post not found.', 404);
  if (String(post.authorId) !== req.user.id && req.user.role !== 'admin') fail('You can only delete your own posts.', 403);
  await post.deleteOne();
  if (post.imageUrl?.startsWith('/uploads/')) await fs.unlink(path.join(uploadsDir, path.basename(post.imageUrl))).catch(() => {});
  res.json({ message: 'Post deleted.' });
});
router.post('/posts/:id/like', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const post = await CommunityPost.findByIdAndUpdate(req.params.id, [{ $set: { likes: { $cond: [{ $in: [userId, '$likes'] }, { $setDifference: ['$likes', [userId]] }, { $setUnion: ['$likes', [userId]] }] } } }], { new: true, updatePipeline: true });
  if (!post) fail('Post not found.', 404);
  res.json({ likes: post.likes.length, liked: post.likes.some(id => String(id) === req.user.id) });
});
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  const value = text(req.body?.text, 'Comment', { max: 500 });
  const post = await CommunityPost.findOneAndUpdate({ _id: req.params.id, 'comments.199': { $exists: false } }, { $push: { comments: { authorId: req.user.id, authorUsername: req.user.username, authorDisplayName: req.user.displayName, text: value } } }, { new: true, runValidators: true });
  if (!post) fail('Post not found or comment limit reached.', 404);
  res.status(201).json({ comments: post.comments });
});
router.delete('/posts/:postId/comments/:commentId', requireAuth, async (req, res) => {
  const match = { _id: req.params.commentId, ...(req.user.role !== 'admin' ? { authorId: req.user.id } : {}) };
  const post = await CommunityPost.findOneAndUpdate({ _id: req.params.postId, comments: { $elemMatch: match } }, { $pull: { comments: { _id: req.params.commentId } } }, { new: true });
  if (!post) fail('Comment not found or not authorized.', 404);
  res.json({ comments: post.comments });
});
router.post('/posts/:id/share', async (req, res) => {
  const post = await CommunityPost.findByIdAndUpdate(req.params.id, { $inc: { shareCount: 1 } }, { new: true });
  if (!post) fail('Post not found.', 404);
  res.json({ shareCount: post.shareCount });
});
export default router;
