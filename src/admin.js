import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./config/db.js";
import { firebaseAuth } from "./lib/firebase.js";
import User from "./models/User.js";
const uid = process.argv[2];
if (!uid) throw new Error("Usage: npm run admin -- FIREBASE_UID");
try {
  const identity = await firebaseAuth().getUser(uid);
  if (!identity.email || identity.disabled)
    throw new Error("An active Firebase user with email is required.");
  await connectDB();
  const user = await User.findOneAndUpdate(
    { firebaseUid: uid },
    {
      $set: {
        role: process.argv.includes("--super") ? "super_admin" : "admin",
      },
    },
    { new: true },
  );
  if (!user)
    throw new Error("Sign in to the application once before granting admin.");
  console.log("Admin access granted.");
} finally {
  await mongoose.disconnect();
}
