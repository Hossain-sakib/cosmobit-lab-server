import { createHash } from 'node:crypto';
import { firebaseAuth } from '../lib/firebase.js';
import User from '../models/User.js';
export async function requireAuth(req, res, next) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ message: 'Not authenticated.' });
  let identity;
  try { identity = await firebaseAuth().verifyIdToken(match[1], true); }
  catch (err) {
    if (!err.code?.startsWith('auth/')) return next(err);
    return res.status(401).json({ message: 'Invalid or expired Firebase session.' });
  }
  if (!identity.email) return res.status(403).json({ message: 'An email address is required.' });
  const suffix = createHash('sha256').update(identity.uid).digest('hex').slice(0, 24);
  const username = `user_${suffix}`;
  const update = { $set: { email: identity.email.toLowerCase() }, $setOnInsert: { firebaseUid: identity.uid, username, displayName: (identity.name || identity.email.split('@')[0]).slice(0, 100), role: 'user' } };
  try {
    req.user = await User.findOneAndUpdate({ firebaseUid: identity.uid }, update, { upsert: true, new: true, runValidators: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
    req.user = await User.findOne({ firebaseUid: identity.uid });
    if (!req.user) throw err;
  }
  req.firebaseIdentity = identity;
  next();
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' });
  next();
}
