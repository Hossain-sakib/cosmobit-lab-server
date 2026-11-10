import { Router } from "express";
import Message from "../models/Message.js";
import Subscriber from "../models/Subscriber.js";
import Post from "../models/Post.js";
import Job from "../models/Job.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireAdmin);

// Full post/job listings for the dashboard (includes drafts/inactive ones
// that the public site intentionally hides).
router.get("/posts", async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 });
  res.json({ posts });
});

router.get("/jobs", async (req, res) => {
  const jobs = await Job.find().sort({ createdAt: -1 });
  res.json({ jobs });
});

// Contact messages
router.get("/messages", async (req, res) => {
  const messages = await Message.find().sort({ createdAt: -1 });
  res.json({ messages });
});

router.patch("/messages/:id/read", async (req, res) => {
  const message = await Message.findByIdAndUpdate(
    req.params.id,
    { read: true },
    { new: true },
  );
  if (!message) return res.status(404).json({ message: "Message not found." });
  res.json({ message });
});

router.delete("/messages/:id", async (req, res) => {
  const message = await Message.findByIdAndDelete(req.params.id);
  if (!message) return res.status(404).json({ message: "Message not found." });
  res.json({ message: "Deleted." });
});

// Newsletter subscribers
router.get("/subscribers", async (req, res) => {
  const subscribers = await Subscriber.find().sort({ createdAt: -1 });
  res.json({ subscribers });
});

router.delete("/subscribers/:id", async (req, res) => {
  const subscriber = await Subscriber.findByIdAndDelete(req.params.id);
  if (!subscriber)
    return res.status(404).json({ message: "Subscriber not found." });
  res.json({ message: "Deleted." });
});

// Dashboard summary counts
router.get("/stats", async (req, res) => {
  const [posts, jobs, messages, unreadMessages, subscribers] =
    await Promise.all([
      Post.countDocuments(),
      Job.countDocuments({ active: true }),
      Message.countDocuments(),
      Message.countDocuments({ read: false }),
      Subscriber.countDocuments(),
    ]);
  res.json({ posts, jobs, messages, unreadMessages, subscribers });
});

export default router;
