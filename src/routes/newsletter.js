import { Router } from "express";
import { rateLimit } from "../lib/rateLimit.js";
import Subscriber from "../models/Subscriber.js";
import { email } from "../lib/validation.js";
const router = Router();
router.post(
  "/",
  rateLimit(
    {
      windowMs: 3600000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many submissions. Please try again later." },
    },
    "newsletter",
  ),
  async (req, res) => {
    const address = email(req.body?.email);
    await Subscriber.updateOne(
      { email: address },
      { $setOnInsert: { email: address } },
      { upsert: true, runValidators: true },
    );
    res.json({ message: "Subscribed." });
  },
);
export default router;
