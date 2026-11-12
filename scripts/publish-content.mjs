import "dotenv/config";
import mongoose from "mongoose";
import { publishContentPack } from "../src/services/publishContent.js";
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
await mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 20000,
});
try {
  console.log(
    JSON.stringify(
      await publishContentPack({ apply: process.argv.includes("--apply") }),
    ),
  );
} finally {
  await mongoose.disconnect();
}
