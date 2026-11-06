import { rateLimit as limiter } from 'express-rate-limit';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';

// A shared counter survives Netlify cold starts and parallel function instances.
export class MongoRateLimitStore {
  localKeys = false;
  constructor(prefix) { this.prefix = prefix; }
  init(options) { this.windowMs = options.windowMs; }
  key(value) { return `${this.prefix}:${createHash('sha256').update(value).digest('hex')}`; }
  collection() { return mongoose.connection.db.collection('studioRateLimits'); }
  async increment(key) {
    const now = new Date();
    const active = { $gt: ['$resetTime', now] };
    const record = await this.collection().findOneAndUpdate({ _id: this.key(key) }, [{ $set: {
      totalHits: { $cond: [active, { $add: [{ $ifNull: ['$totalHits', 0] }, 1] }, 1] },
      resetTime: { $cond: [active, '$resetTime', new Date(now.getTime() + this.windowMs)] },
    } }], { upsert: true, returnDocument: 'after' });
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }
  async decrement(key) { await this.collection().updateOne({ _id: this.key(key) }, { $inc: { totalHits: -1 } }); }
  async resetKey(key) { await this.collection().deleteOne({ _id: this.key(key) }); }
}
export function rateLimit(options, namespace) {
  return limiter({ ...options, ...(process.env.NETLIFY === 'true' ? { store: new MongoRateLimitStore(namespace) } : {}) });
}
