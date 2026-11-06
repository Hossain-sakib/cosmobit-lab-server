import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { startAutomations, stopAutomations } from './services/automation.js';
import { createApp } from './app.js';
if (!process.env.MONGODB_URI || !process.env.FIREBASE_PROJECT_ID) {
  console.error('Set MONGODB_URI and FIREBASE_PROJECT_ID.'); process.exit(1);
}
if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Authentication emulator is forbidden in production.'); process.exit(1);
}
await connectDB();
startAutomations();
const server = createApp().listen(process.env.PORT || 4000, '0.0.0.0', () => console.log('CosmoBit Labs API listening on port', process.env.PORT || 4000));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopAutomations();
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => { await mongoose.disconnect(); clearTimeout(timeout); process.exit(0); });
});
