import { Notification } from "../models/Automation.js";
import { can } from "../lib/permissions.js";
import { Router } from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import { ChatThread, ChatMessage } from "../models/Chat.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { fail, text } from "../lib/validation.js";

const salesRoles = [
  "super_admin",
  "admin",
  "general_manager",
  "sales_manager",
  "sales_executive",
  "business_development_manager",
  "business_development_executive",
];
const isStaff = (user) => !["user", "viewer"].includes(user.role);
const active = { studioSuspended: false, emailVerified: true };
const router = Router();
router.use(requireAuth, (req, res, next) => {
  if (req.user.studioSuspended)
    return res.status(403).json({ message: "Chat access is suspended." });
  if (!req.firebaseIdentity.email_verified)
    return res
      .status(403)
      .json({ message: "Verify your email before using chat." });
  next();
});
function validId(id) {
  if (!mongoose.isObjectIdOrHexString(id)) fail("Invalid conversation ID.");
}
function permittedPartner(user, other) {
  return (
    other &&
    !other.studioSuspended &&
    other.emailVerified &&
    (isStaff(user) || salesRoles.includes(other.role))
  );
}
async function access(req) {
  validId(req.params.id);
  const thread = await ChatThread.findOne({
    _id: req.params.id,
    participants: req.user._id,
  });
  if (!thread) fail("Conversation not found.", 404);
  const other = await User.findById(
    thread.participants.find((id) => String(id) !== req.user.id),
  ).select("displayName role avatarUrl studioSuspended emailVerified");
  if (
    !permittedPartner(req.user, other) ||
    (!isStaff(req.user) && thread.kind !== "client")
  )
    fail("Conversation access is no longer available.", 403);
  return thread;
}
router.get("/people", async (req, res) => {
  const users = await User.find({
    ...active,
    _id: { $ne: req.user._id },
    role: isStaff(req.user)
      ? { $nin: ["user", "viewer"] }
      : { $in: salesRoles },
  })
    .select("displayName role avatarUrl")
    .sort({ displayName: 1 })
    .limit(150);
  res.json({ people: users, staff: isStaff(req.user) });
});
router.get("/threads", async (req, res) => {
  const threads = await ChatThread.find({ participants: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(100)
    .populate(
      "participants",
      "displayName role avatarUrl studioSuspended emailVerified",
    );
  const records = threads
    .filter(
      (t) =>
        permittedPartner(
          req.user,
          t.participants.find((p) => p && String(p._id) !== req.user.id),
        ) &&
        (isStaff(req.user) || t.kind === "client"),
    )
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt,
      readAt: t.readAt.get(req.user.id),
      peerReadAt: t.readAt.get(
        t.participants.find((person) => person.id !== req.user.id)?.id,
      ),
      people: t.participants.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        role: p.role,
        avatarUrl: p.avatarUrl,
      })),
    }));
  res.json({ threads: records });
});
router.post("/threads", async (req, res) => {
  validId(req.body.userId);
  if (req.body.userId === req.user.id) fail("Choose another person.");
  const other = await User.findOne({ _id: req.body.userId, ...active });
  // Clients can start conversations only with sales or management; staff directory excludes clients.
  if (
    !other ||
    !(isStaff(req.user) ? isStaff(other) : salesRoles.includes(other.role))
  )
    fail("This contact is not available.", 403);
  const pair = [req.user.id, other.id].sort(),
    directKey = pair.join(":");
  const thread = await ChatThread.findOneAndUpdate(
    { directKey },
    {
      $setOnInsert: {
        directKey,
        participants: pair,
        kind: isStaff(req.user) && isStaff(other) ? "internal" : "client",
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
  res.json({ id: thread.id });
});
router.get("/threads/:id/messages", async (req, res) => {
  const thread = await access(req);
  const filter = { threadId: thread._id };
  if (req.query.before) {
    validId(req.query.before);
    const before = await ChatMessage.findOne({
      _id: req.query.before,
      threadId: thread._id,
    });
    if (!before) fail("Message not found.", 404);
    filter.$or = [
      { createdAt: { $lt: before.createdAt } },
      { createdAt: before.createdAt, _id: { $lt: before._id } },
    ];
  }
  const records = await ChatMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .select("senderId text createdAt");
  res.json({
    messages: records.reverse(),
    hasMore: records.length === 50,
    peerReadAt:
      thread.readAt.get(
        String(thread.participants.find((id) => String(id) !== req.user.id)),
      ) || null,
  });
});
router.post("/threads/:id/read", async (req, res) => {
  const thread = await access(req);
  await ChatThread.updateOne(
    { _id: thread._id },
    { $set: { [`readAt.${req.user.id}`]: new Date() } },
    { timestamps: false },
  );
  res.status(204).end();
});
router.post(
  "/threads/:id/messages",
  rateLimit(
    {
      windowMs: 60000,
      limit: 40,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Please slow down before sending more messages." },
    },
    "chat-send",
  ),
  async (req, res) => {
    const thread = await access(req);
    const body = text(req.body.text, "Message", { min: 1, max: 4000 });
    if (
      typeof req.body.clientMessageId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(req.body.clientMessageId)
    )
      fail("A valid message submission ID is required.");
    let message;
    try {
      message = await ChatMessage.create({
        threadId: thread._id,
        senderId: req.user._id,
        text: body,
        clientMessageId: req.body.clientMessageId,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      message = await ChatMessage.findOne({
        threadId: thread._id,
        senderId: req.user._id,
        clientMessageId: req.body.clientMessageId,
      });
    }
    await ChatThread.updateOne(
      {
        _id: thread._id,
        $or: [
          { lastMessageAt: { $lte: message.createdAt } },
          { lastMessageAt: { $exists: false } },
        ],
      },
      {
        $set: {
          lastMessage: message.text.slice(0, 180),
          lastMessageAt: message.createdAt,
          [`readAt.${req.user.id}`]: new Date(),
        },
      },
    );
    const recipient = await User.findById(
      thread.participants.find((id) => String(id) !== req.user.id),
    );
    if (recipient && can(recipient, "notifications:view"))
      await Notification.updateOne(
        { userId: recipient._id, eventKey: `chat-message:${message._id}` },
        {
          $setOnInsert: {
            title: "New chat message",
            message:
              "You have a new private message. Open conversations to reply.",
            link: "/chat",
          },
        },
        { upsert: true },
      );
    res.json({
      message: {
        _id: message._id,
        senderId: message.senderId,
        text: message.text,
        createdAt: message.createdAt,
      },
    });
  },
);
export default router;
