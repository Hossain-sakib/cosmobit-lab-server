import multer from "multer";
import User from "../models/User.js";
import { uploadImage, deleteImage } from "../services/imageStorage.js";
import { Router } from "express";
import { rateLimit } from "../lib/rateLimit.js";
import { firebaseAuth } from "../lib/firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { text, fail } from "../lib/validation.js";
const router = Router();
router.use(
  rateLimit(
    {
      windowMs: 900000,
      limit: 100,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many requests. Please try again later." },
    },
    "auth",
  ),
);
router.get("/me", requireAuth, (req, res) =>
  res.json({ user: req.user.toPublicJSON() }),
);
router.post("/register", requireAuth, async (req, res) => {
  const username = text(req.body?.username, "Username", {
    min: 3,
    max: 20,
  }).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(username))
    fail("Username may contain letters, numbers, and underscores.");
  req.user.username = username;
  req.user.displayName = text(req.body?.displayName, "Display name", {
    max: 100,
  });
  await req.user.save();
  res.json({ user: req.user.toPublicJSON() });
});
const sessionOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
});
router.post("/session", requireAuth, async (req, res) => {
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || "")?.[1];
  if (
    !token ||
    !req.firebaseIdentity.auth_time ||
    Date.now() / 1000 - req.firebaseIdentity.auth_time > 300
  )
    fail("Sign in again to start a secure session.", 401);
  const expiresIn = 5 * 86400000;
  const cookie = await firebaseAuth().createSessionCookie(token, { expiresIn });
  res.cookie("cb_session", cookie, { ...sessionOptions(), maxAge: expiresIn });
  res.json({ message: "Secure session created." });
});
router.post("/logout", (req, res) => {
  res.clearCookie("cb_session", sessionOptions());
  res.json({ message: "Signed out." });
});
router.post("/logout-all", requireAuth, async (req, res) => {
  await firebaseAuth().revokeRefreshTokens(req.user.firebaseUid);
  res.clearCookie("cb_session", sessionOptions());
  res.json({ message: "All sessions revoked." });
});

router.patch("/profile", requireAuth, async (req, res) => {
  const allowed = ["displayName", "username", "phone", "jobTitle", "bio"];
  if (Object.keys(req.body || {}).some((key) => !allowed.includes(key)))
    fail("Only your profile details can be changed here.");
  const update = {};
  for (const key of allowed)
    if (key in req.body)
      update[key] = text(req.body[key], key, {
        min: ["displayName", "username"].includes(key)
          ? key === "username"
            ? 3
            : 1
          : 0,
        max: {
          displayName: 100,
          username: 40,
          phone: 40,
          jobTitle: 100,
          bio: 1000,
        }[key],
      });
  if (update.username) {
    update.username = update.username.toLowerCase();
    if (!/^[a-z0-9_]{3,40}$/.test(update.username))
      fail("Username must be 3–40 letters, numbers or underscores.");
  }
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: update },
    { new: true, runValidators: true },
  );
  res.json({ user: user.toPublicJSON() });
});
const avatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 },
});
router.post(
  "/avatar",
  requireAuth,
  (req, res, next) =>
    avatar.single("image")(req, res, (error) =>
      error
        ? res
            .status(400)
            .json({ message: "Choose one valid image up to 4 MB." })
        : next(),
    ),
  async (req, res) => {
    if (!req.file) fail("Choose an image up to 4 MB.");
    const old = await User.findById(req.user._id).select(
      "+avatarPublicId +avatarStorage",
    );
    const image = await uploadImage(req.file.buffer, { folder: "community" });
    let user;
    try {
      user = await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            avatarUrl: image.imageUrl,
            avatarPublicId: image.imagePublicId,
            avatarStorage: image.imageStorage,
          },
        },
        { new: true },
      );
    } catch (error) {
      await deleteImage(image).catch(() => {});
      throw error;
    }
    if (old.avatarPublicId)
      await deleteImage({
        imagePublicId: old.avatarPublicId,
        imageStorage: old.avatarStorage,
        imageUrl: old.avatarUrl,
      }).catch(() => console.error("Old avatar cleanup pending."));
    res.json({ user: user.toPublicJSON() });
  },
);

export default router;
