import mongoose from 'mongoose';

let connection;
export async function serverlessDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  connection ||= mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  }).catch(error => { connection = undefined; throw error; });
  await connection;
  await mongoose.connection.db.collection('studioRateLimits').createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 });
}
