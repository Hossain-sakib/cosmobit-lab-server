import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import Message from '../models/Message.js';
import { text, email } from '../lib/validation.js';
const router = Router();
router.post('/', rateLimit({ windowMs: 3600000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many submissions. Please try again later.' } }), async (req, res) => {
  const name = text(req.body?.name, 'Name', { max: 100 });
  const address = email(req.body?.email);
  const message = text(req.body?.message, 'Message', { max: 10000 });
  const budget = text(req.body?.budget ?? '', 'Budget', { min: 0, max: 100 });
  await Message.create({ name, email: address, message, budget });
  res.json({ message: 'Message received.' });
});
export default router;
