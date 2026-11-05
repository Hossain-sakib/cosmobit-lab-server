import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { text, fail } from '../lib/validation.js';
const router = Router();
router.use(rateLimit({ windowMs: 900000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many requests. Please try again later.' } }));
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user.toPublicJSON() }));
router.post('/register', requireAuth, async (req, res) => {
  const username = text(req.body?.username, 'Username', { min: 3, max: 20 }).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(username)) fail('Username may contain letters, numbers, and underscores.');
  req.user.username = username;
  req.user.displayName = text(req.body?.displayName, 'Display name', { max: 100 });
  await req.user.save();
  res.json({ user: req.user.toPublicJSON() });
});
export default router;
