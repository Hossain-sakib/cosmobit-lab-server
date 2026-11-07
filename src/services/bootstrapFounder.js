import User from '../models/User.js';
import { firebaseAuth } from '../lib/firebase.js';

// Opt-in, host-configured bootstrap for an already registered founder account.
// The private database marker makes this one-time: future role changes stay in force.
export async function bootstrapFounder() {
  const uid = process.env.STUDIO_FOUNDER_UID;
  const email = process.env.STUDIO_FOUNDER_EMAIL?.toLowerCase();
  if (!uid && !email) return;
  if (!uid || !email) throw new Error('Both founder bootstrap settings are required.');
  const account = await User.findOne({ firebaseUid: uid, email }).select('+founderBootstrapAt');
  if (!account) throw new Error('The configured founder must already have a matching CRM account.');
  if (account.founderBootstrapAt) return;
  const identity = await firebaseAuth().getUser(uid);
  if (identity.disabled || identity.email?.toLowerCase() !== email) throw new Error('Founder identity verification failed.');
  await User.updateOne({ _id: account._id, founderBootstrapAt: { $exists: false } }, {
    $set: { role: 'super_admin', founderBootstrapAt: new Date() },
  });
  const saved = await User.findById(account._id).select('+founderBootstrapAt');
  if (saved.role !== 'super_admin' || !saved.founderBootstrapAt) throw new Error('Founder role verification failed.');
}
