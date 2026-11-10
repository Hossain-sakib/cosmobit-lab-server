import { Router } from "express";
import { rateLimit } from "../lib/rateLimit.js";
import multer from "multer";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mongoose from "mongoose";
import { CareerApplication } from "../models/Management.js";
import Job from "../models/Job.js";
import { applicationFields } from "../lib/managementFields.js";
import { parseFields, todayInDhaka } from "../lib/management.js";
import { fail } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";
import { recordScope } from "../lib/managementScope.js";
import { requirePermission } from "../lib/permissions.js";
const router = Router();
const directory = path.resolve(
  process.env.UPLOADS_DIRECTORY || "uploads",
  ".private-applications",
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 15,
    fieldSize: 20000,
    parts: 16,
  },
});
const publicKeys = [
  "fullName",
  "email",
  "phone",
  "dateOfBirth",
  "gender",
  "position",
  "experience",
  "expectedSalary",
  "cvLink",
  "portfolioLink",
];
const publicFields = Object.fromEntries(
  publicKeys.map((key) => [key, applicationFields[key]]),
);
router.post(
  "/",
  rateLimit(
    {
      windowMs: 3600000,
      limit: 5,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many applications. Please try again later." },
    },
    "applications",
  ),
  (req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[a-f0-9-]{36}$/i.test(key))
      return res
        .status(400)
        .json({ message: "A valid application submission ID is required." });
    upload.single("resume")(req, res, (err) =>
      err ? res.status(400).json({ message: err.message }) : next(),
    );
  },
  async (req, res) => {
    const existing = await CareerApplication.exists({
      submissionKey: req.headers["idempotency-key"],
    });
    if (existing) return res.json({ message: "Application received." });
    if (req.body?.consent !== "true")
      fail("Consent to processing this application is required.");
    const data = parseFields(req.body, publicFields);
    if (!data.phone) fail("Phone number is required.");
    if (data.dateOfBirth && data.dateOfBirth > todayInDhaka())
      fail("Date of birth cannot be in the future.");
    let jobId;
    if (req.body.jobId) {
      if (!mongoose.isObjectIdOrHexString(req.body.jobId)) fail("Invalid job.");
      const job = await Job.findOne({
        _id: req.body.jobId,
        active: true,
        archived: { $ne: true },
      });
      if (!job) fail("This opening is no longer accepting applications.", 404);
      jobId = job._id;
      data.position = job.title;
    }
    if (!req.file && !data.cvLink)
      fail("Upload a PDF CV or provide a CV link.");
    let resumeFileId;
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "privateResumes",
    });
    if (req.file) {
      const buffer = req.file.buffer;
      if (
        req.file.mimetype !== "application/pdf" ||
        !buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
        !buffer
          .subarray(Math.max(0, buffer.length - 1024))
          .toString()
          .includes("%%EOF")
      )
        fail("Upload a valid PDF file up to 5 MB.");
      const stream = bucket.openUploadStream("resume.pdf", {
        metadata: { contentType: "application/pdf" },
      });
      resumeFileId = stream.id;
      await new Promise((resolve, reject) => {
        stream.once("finish", resolve);
        stream.once("error", reject);
        stream.end(buffer);
      });
    }
    try {
      await CareerApplication.create({
        ...data,
        jobId,
        resumeFileId,
        resumeAvailable: !!resumeFileId,
        submissionKey: req.headers["idempotency-key"],
        submittedDate: todayInDhaka(),
        status: "new",
        history: [
          {
            at: new Date(),
            action: "application submitted",
            fields: publicKeys,
          },
        ],
      });
      res.status(201).json({ message: "Application received." });
    } catch (err) {
      if (resumeFileId) await bucket.delete(resumeFileId).catch(() => {});
      if (err.code === 11000)
        return res.json({ message: "Application received." });
      throw err;
    }
  },
);
router.get(
  "/:id/resume",
  requireAuth,
  requirePermission("applications:view"),
  async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      fail("Invalid application ID.");
    const application = await CareerApplication.findOne({
      $and: [
        { _id: req.params.id },
        await recordScope(req.user, "applications"),
      ],
    }).select("+resumeFilename +resumeFileId");
    res.set("Cache-Control", "no-store");
    if (application?.resumeFileId) {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: "privateResumes",
      });
      if (!(await bucket.find({ _id: application.resumeFileId }).hasNext()))
        fail("Resume not found.", 404);
      res.type("application/pdf");
      res.set("Content-Disposition", 'attachment; filename="resume.pdf"');
      await pipeline(bucket.openDownloadStream(application.resumeFileId), res);
      return;
    }
    if (
      !application?.resumeFilename ||
      !/^[-a-f0-9]{36}\.pdf$/.test(application.resumeFilename)
    )
      fail("Resume not found.", 404);
    res.set("Cache-Control", "no-store");
    res.download(
      path.join(directory, application.resumeFilename),
      "resume.pdf",
      { dotfiles: "allow" },
      (err) => {
        if (err && !res.headersSent)
          res.status(404).json({ message: "Resume not found." });
      },
    );
  },
);
export default router;
