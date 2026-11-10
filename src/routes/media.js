import { Router } from "express";
import multer from "multer";
import { businessModels } from "../lib/businessModules.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../lib/permissions.js";
import {
  uploadImage,
  deleteImage,
  storageStatus,
} from "../services/imageStorage.js";
import { fail, text } from "../lib/validation.js";
const router = Router();
router.use(requireAuth, requirePermission("cms:view"));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
});
router.get("/status", async (req, res) => {
  const last = await businessModels.media
    .findOne({ imageStorage: "cloudinary" })
    .sort({ createdAt: -1 })
    .select("createdAt");
  res.json({
    ...storageStatus(),
    lastSuccessfulCloudinaryUpload: last?.createdAt || null,
  });
});
router.post(
  "/images",
  requirePermission("cms:edit"),
  (req, res, next) =>
    upload.single("image")(req, res, (err) =>
      err ? res.status(400).json({ message: err.message }) : next(),
    ),
  async (req, res) => {
    if (!req.file) fail("Choose an image.");
    const alt = text(req.body?.alt || "", "Alternative text", {
      min: 0,
      max: 500,
    });
    const image = await uploadImage(req.file.buffer, { folder: "cms" });
    try {
      const record = await businessModels.media.create({
        name: req.file.originalname.slice(0, 200),
        url: image.imageUrl,
        alt,
        mimeType: "image/webp",
        width: image.width,
        height: image.height,
        imageStorage: image.imageStorage,
        imagePublicId: image.imagePublicId,
        createdBy: req.user.id,
        updatedBy: req.user.id,
        history: [
          {
            at: new Date(),
            actor: req.user.id,
            action: "public image uploaded",
            fields: ["url"],
          },
        ],
      });
      res.status(201).json({ record });
    } catch (err) {
      await deleteImage(image).catch(() => {});
      throw err;
    }
  },
);
export default router;
