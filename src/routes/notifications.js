import { Router } from "express";
import mongoose from "mongoose";
import { Notification, EmailJob } from "../models/Automation.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../lib/permissions.js";
import { fail } from "../lib/validation.js";
import User from "../models/User.js";
import { smtpReady } from "../services/automation.js";
const router = Router();
router.use(requireAuth);
router.get("/", requirePermission("notifications:view"), async (req, res) => {
  const [records, unread] = await Promise.all([
    Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100),
    Notification.countDocuments({ userId: req.user.id, readAt: null }),
  ]);
  res.json({ records, unread, emailEnabled: !!req.user.notificationEmails });
});
router.patch(
  "/:id/read",
  requirePermission("notifications:edit"),
  async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      fail("Invalid notification.");
    const record = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!record) fail("Notification not found.", 404);
    res.json({ record });
  },
);
router.post(
  "/read-all",
  requirePermission("notifications:edit"),
  async (req, res) => {
    await Notification.updateMany(
      { userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ message: "Notifications marked read." });
  },
);
router.post(
  "/preferences",
  requirePermission("notifications:edit"),
  async (req, res) => {
    if (typeof req.body.emailEnabled !== "boolean")
      fail("Choose an email notification preference.");
    await User.updateOne(
      { _id: req.user.id },
      { $set: { notificationEmails: req.body.emailEnabled } },
    );
    res.json({
      emailEnabled: req.body.emailEnabled,
      smtpConfigured: smtpReady(),
    });
  },
);
router.get(
  "/email-jobs",
  requirePermission("settings:view"),
  async (req, res) => {
    const records = await EmailJob.find()
      .select("-text")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ records, smtpConfigured: smtpReady() });
  },
);
export default router;
