import { createHash } from "node:crypto";
import { firebaseAuth } from "../lib/firebase.js";
import User from "../models/User.js";
export async function requireAuth(req, res, next) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  let session;
  try {
    const entry = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("cb_session="));
    if (entry) session = decodeURIComponent(entry.slice("cb_session=".length));
  } catch {}
  if (!match && !session)
    return res.status(401).json({ message: "Not authenticated." });
  let identity;
  try {
    identity = match
      ? await firebaseAuth().verifyIdToken(match[1], true)
      : await firebaseAuth().verifySessionCookie(session, true);
  } catch (err) {
    if (!err.code?.startsWith("auth/")) return next(err);
    return res
      .status(401)
      .json({ message: "Invalid or expired Firebase session." });
  }
  if (!identity.email)
    return res.status(403).json({ message: "An email address is required." });
  const suffix = createHash("sha256")
    .update(identity.uid)
    .digest("hex")
    .slice(0, 24);
  const username = `user_${suffix}`;
  const update = {
    $set: {
      email: identity.email.toLowerCase(),
      emailVerified: !!identity.email_verified,
    },
    $setOnInsert: {
      firebaseUid: identity.uid,
      username,
      displayName: (identity.name || identity.email.split("@")[0]).slice(
        0,
        100,
      ),
      role: "user",
    },
  };
  try {
    req.user = await User.findOneAndUpdate(
      { firebaseUid: identity.uid },
      update,
      { upsert: true, new: true, runValidators: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    req.user = await User.findOne({ firebaseUid: identity.uid });
    if (!req.user) throw err;
  }
  if (
    process.env.NODE_ENV === "production" &&
    req.user.role !== "user" &&
    !identity.email_verified
  )
    return res
      .status(403)
      .json({ message: "Verify your email address before accessing Studio." });
  req.firebaseIdentity = identity;
  next();
}
export function requireAdmin(req, res, next) {
  if (!["admin", "super_admin"].includes(req.user?.role))
    return res.status(403).json({ message: "Admin access required." });
  next();
}
