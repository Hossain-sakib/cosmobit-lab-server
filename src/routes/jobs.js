import { Router } from "express";
import Job from "../models/Job.js";
import { requirePermission } from "../lib/permissions.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { fields, jobFields } from "../lib/validation.js";
const router = Router();
router.get("/", async (req, res) =>
  res.json({
    jobs: await Job.find({ active: true, archived: { $ne: true } }).sort({
      createdAt: -1,
    }),
  }),
);
router.post(
  "/",
  requireAuth,
  requirePermission("jobs:edit"),
  async (req, res) => {
    res
      .status(201)
      .json({ job: await Job.create(fields(req.body, jobFields)) });
  },
);
router.put(
  "/:id",
  requireAuth,
  requirePermission("jobs:edit"),
  async (req, res) => {
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { $set: fields(req.body, jobFields, true) },
      { new: true, runValidators: true },
    );
    if (!job) return res.status(404).json({ message: "Job not found." });
    res.json({ job });
  },
);
router.delete(
  "/:id",
  requireAuth,
  requirePermission("jobs:edit"),
  async (req, res) => {
    if (!(await Job.findByIdAndDelete(req.params.id)))
      return res.status(404).json({ message: "Job not found." });
    res.json({ message: "Job deleted." });
  },
);
export default router;
