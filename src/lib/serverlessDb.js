import { ChatThread, ChatMessage } from "../models/Chat.js";
import mongoose from "mongoose";
import { bootstrapFounder } from "../services/bootstrapFounder.js";

let connection;
let initialization;
export async function serverlessDB() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (mongoose.connection.readyState !== 1) {
    connection ||= mongoose
      .connect(process.env.MONGODB_URI, {
        maxPoolSize: 5,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      })
      .finally(() => {
        // Cache only an in-flight attempt; a settled promise cannot reconnect
        // a later warm invocation after its old connection has closed.
        connection = undefined;
      });
    await connection;
  }
  initialization ||= (async () => {
    await mongoose.connection.db
      .collection("studioRateLimits")
      .createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 });
    await Promise.all([ChatThread.init(), ChatMessage.init()]);
    await bootstrapFounder();
  })().catch((error) => {
    initialization = undefined;
    throw error;
  });
  await initialization;
}
