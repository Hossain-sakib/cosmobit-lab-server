import { Router } from "express";
import mongoose from "mongoose";
import WorkItem, { WORK_STATUSES } from "../models/WorkItem.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { fields, email, fail } from "../lib/validation.js";
const router = Router();
router.use(requireAuth, requireAdmin);
const specs = {
  title: { max: 200 },
  description: { min: 0, max: 20000, optional: true },
  status: { max: 30, optional: true },
  priority: { values: ["low", "normal", "high", "urgent"], optional: true },
  company: { min: 0, max: 200, optional: true },
  phone: { min: 0, max: 50, optional: true },
  assignee: { min: 0, max: 200, optional: true },
  currency: { max: 3, min: 3, optional: true },
  archived: { boolean: true, optional: true },
};
async function validated(body, kind, partial) {
  const data = fields(body, specs, partial, true);
  if (data.status && !WORK_STATUSES[kind].includes(data.status))
    fail("Invalid status for this record type.");
  if (data.currency && !/^[A-Z]{3}$/.test(data.currency))
    fail("Currency must be a three-letter uppercase code.");
  if ("email" in body) data.email = body.email === "" ? "" : email(body.email);
  if ("value" in body) {
    if (
      typeof body.value !== "number" ||
      !Number.isFinite(body.value) ||
      body.value < 0 ||
      body.value > 1e12
    )
      fail("Value must be a nonnegative number up to one trillion.");
    data.value = body.value;
  }
  if ("dueDate" in body) {
    if (
      body.dueDate !== null &&
      (typeof body.dueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ||
        Number.isNaN(Date.parse(body.dueDate)) ||
        new Date(body.dueDate).toISOString().slice(0, 10) !== body.dueDate)
    )
      fail("Due date must be a valid YYYY-MM-DD date or null.");
    data.dueDate = body.dueDate;
  }
  for (const [key, target] of [
    ["clientId", "client"],
    ["projectId", "project"],
  ]) {
    if (!(key in body)) continue;
    data[key] = body[key];
    if (body[key] === null) continue;
    if (
      typeof body[key] !== "string" ||
      !mongoose.isObjectIdOrHexString(body[key])
    )
      fail(`Invalid ${key}.`);
    if (
      !(await WorkItem.exists({
        _id: body[key],
        kind: target,
        archived: false,
      }))
    )
      fail(`${target} not found or archived.`);
  }
  return data;
}
router.get("/summary", async (req, res) => {
  const counts = await WorkItem.aggregate([
    { $match: { archived: false } },
    {
      $group: { _id: { kind: "$kind", status: "$status" }, count: { $sum: 1 } },
    },
  ]);
  const overdue = await WorkItem.countDocuments({
    archived: false,
    kind: { $in: ["task", "project"] },
    status: { $nin: ["done", "completed", "cancelled"] },
    dueDate: { $lt: new Date(new Date().toISOString().slice(0, 10)) },
  });
  res.json({ counts, overdue, statuses: WORK_STATUSES });
});
router.get("/options", async (req, res) => {
  const kind = req.query.kind;
  if (!["client", "project"].includes(kind)) fail("Invalid relationship type.");
  const search = req.query.search || "";
  if (typeof search !== "string" || search.length > 100)
    fail("Search must be at most 100 characters.");
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const records = await WorkItem.find({
    kind,
    archived: false,
    ...(search ? { title: { $regex: escaped, $options: "i" } } : {}),
  })
    .select("title")
    .sort({ title: 1 })
    .limit(20);
  res.json({ records });
});
router.get("/records", async (req, res) => {
  const query = { archived: req.query.archived === "true" };
  if (req.query.kind) {
    if (!Object.hasOwn(WORK_STATUSES, req.query.kind))
      fail("Unknown record type.");
    query.kind = req.query.kind;
  }
  if (req.query.status) {
    if (typeof req.query.status !== "string" || req.query.status.length > 30)
      fail("Invalid status.");
    query.status = req.query.status;
  }
  if (req.query.search) {
    if (typeof req.query.search !== "string" || req.query.search.length > 100)
      fail("Search must be at most 100 characters.");
    query.title = {
      $regex: req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    fail("Invalid page.");
  const [records, total] = await Promise.all([
    WorkItem.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 25)
      .limit(25),
    WorkItem.countDocuments(query),
  ]);
  res.json({ records, total, page, pageSize: 25 });
});
router.post("/records", async (req, res) => {
  const kind = req.body?.kind;
  if (typeof kind !== "string" || !Object.hasOwn(WORK_STATUSES, kind))
    fail("Unknown record type.");
  const data = await validated(req.body, kind, false);
  const record = await WorkItem.create({
    ...data,
    kind,
    status: data.status || WORK_STATUSES[kind][0],
    createdBy: req.user.id,
    updatedBy: req.user.id,
    history: [
      {
        at: new Date(),
        actor: req.user.id,
        action: "created",
        fields: Object.keys(data),
      },
    ],
  });
  res.status(201).json({ record });
});
router.get("/records/:id", async (req, res) => {
  const record = await WorkItem.findById(req.params.id);
  if (!record) fail("Record not found.", 404);
  res.json({ record });
});
router.patch("/records/:id", async (req, res) => {
  const existing = await WorkItem.findById(req.params.id);
  if (!existing) fail("Record not found.", 404);
  const data = await validated(req.body, existing.kind, true);
  if (!Object.keys(data).length) fail("No supported update fields supplied.");
  if (
    String(data.projectId) === req.params.id ||
    String(data.clientId) === req.params.id
  )
    fail("A record cannot reference itself.");
  const record = await WorkItem.findByIdAndUpdate(
    req.params.id,
    {
      $set: { ...data, updatedBy: req.user.id },
      $push: {
        history: {
          $each: [
            {
              at: new Date(),
              actor: req.user.id,
              action: "updated",
              fields: Object.keys(data),
            },
          ],
          $slice: -100,
        },
      },
    },
    { new: true, runValidators: true },
  );
  res.json({ record });
});
export default router;
