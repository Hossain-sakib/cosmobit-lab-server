import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit.js';
import { firebaseAuth } from '../lib/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { text, fail } from '../lib/validation.js';
const router = Router();
router.use(rateLimit({ windowMs: 900000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many requests. Please try again later.' } }, 'auth'));
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user.toPublicJSON() }));
router.post('/register', requireAuth, async (req, res) => {
  const username = text(req.body?.username, 'Username', { min: 3, max: 20 }).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(username)) fail('Username may contain letters, numbers, and underscores.');
  req.user.username = username;
  req.user.displayName = text(req.body?.displayName, 'Display name', { max: 100 });
  await req.user.save();
  res.json({ user: req.user.toPublicJSON() });
});
const sessionOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/' });
router.post('/session', requireAuth, async (req,res) => {
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token || !req.firebaseIdentity.auth_time || Date.now()/1000 - req.firebaseIdentity.auth_time > 300) fail('Sign in again to start a secure session.',401);
  const expiresIn = 5 * 86400000;
  const cookie = await firebaseAuth().createSessionCookie(token,{ expiresIn });
  res.cookie('cb_session',cookie,{...sessionOptions(),maxAge:expiresIn});
  res.json({ message: 'Secure session created.' });
});
router.post('/logout', (req,res) => { res.clearCookie('cb_session',sessionOptions()); res.json({message:'Signed out.'}); });
router.post('/logout-all', requireAuth, async (req,res) => {
  await firebaseAuth().revokeRefreshTokens(req.user.firebaseUid);
  res.clearCookie('cb_session',sessionOptions());res.json({message:'All sessions revoked.'});
});
export default router;
