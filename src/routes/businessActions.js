import { Router } from "express";
import mongoose from "mongoose";
import { businessModels, businessModules } from "../lib/businessModules.js";
import { ManagedProject } from "../models/Management.js";
import { requireAuth } from "../middleware/auth.js";
import { can, requirePermission } from "../lib/permissions.js";
import { recordScope, visibleRecord } from "../lib/managementScope.js";
import { parseFields, todayInDhaka } from "../lib/management.js";
import { invoiceTotals } from "../lib/finance.js";
import { nextNumber } from "../lib/businessWorkflows.js";
import { fail } from "../lib/validation.js";
const router = Router();
router.use(requireAuth);
async function findAuthorized(Model, id, user, module) {
  if (!mongoose.isObjectIdOrHexString(id)) fail("Invalid record ID.");
  const record = await Model.findOne({
    $and: [{ _id: id, archived: false }, await recordScope(user, module)],
  });
  if (!record) fail("Record not found.", 404);
  return record;
}
router.post(
  "/invoices/:id/payments",
  requirePermission("payments:edit"),
  requirePermission("payments:record"),
  requirePermission("invoices:view"),
  async (req, res) => {
    const invoice = await findAuthorized(
      businessModels.invoices,
      req.params.id,
      req.user,
      "invoices",
    );
    const data = parseFields(req.body, {
      amount: {
        type: "number",
        min: 0.01,
        max: 1e10,
        decimals: 2,
        required: true,
      },
      date: { type: "date", required: true },
      method: { type: "text", max: 100 },
      reference: { type: "text", max: 300 },
      notes: { type: "text", max: 5000 },
    });
    const key = req.headers["idempotency-key"] || req.body.idempotencyKey;
    if (typeof key !== "string" || !/^[a-f0-9-]{36}$/i.test(key))
      fail("A unique payment submission ID is required.");
    const cents = Math.round(data.amount * 100),
      existing = invoice.payments.find(
        (payment) => payment.idempotencyKey === key,
      );
    if (existing) {
      if (existing.amountCents !== cents)
        fail("This payment ID was already used with another amount.", 409);
      return res.json({
        record: { ...invoice.toJSON(), ...invoiceTotals(invoice) },
      });
    }
    if (["draft", "cancelled"].includes(invoice.status))
      fail("Only a sent invoice can receive payments.");
    if (data.date > todayInDhaka())
      fail("Payment date cannot be in the future.");
    if (
      cents >
      invoiceTotals(invoice).totalCents - invoiceTotals(invoice).paidCents
    )
      fail("Payment exceeds the outstanding balance.");
    if (req.body.currency && req.body.currency !== invoice.currency)
      fail("Record the payment in the invoice currency.");
    if (
      !Number.isSafeInteger(req.body.version) ||
      req.body.version !== invoice.__v
    )
      fail("Reload the invoice before recording this payment.", 409);
    const updated = await businessModels.invoices.findOneAndUpdate(
      {
        _id: invoice._id,
        __v: invoice.__v,
        "payments.idempotencyKey": { $ne: key },
      },
      {
        $push: {
          payments: {
            idempotencyKey: key,
            amountCents: cents,
            date: data.date,
            method: data.method || "manual",
            reference: data.reference || "",
            notes: data.notes || "",
            actor: req.user._id,
            recordedAt: new Date(),
          },
          history: {
            at: new Date(),
            actor: req.user._id,
            action: "payment recorded",
            fields: ["payments"],
          },
        },
        $inc: { __v: 1 },
        $set: { updatedBy: req.user._id },
      },
      { new: true, runValidators: true },
    );
    if (!updated) fail("The invoice changed. Reload before retrying.", 409);
    res
      .status(201)
      .json({ record: { ...updated.toJSON(), ...invoiceTotals(updated) } });
  },
);
router.get(
  "/payments",
  requirePermission("payments:view"),
  async (req, res) => {
    const records = await businessModels.invoices
      .find({
        $and: [
          { archived: false, "payments.0": { $exists: true } },
          await recordScope(req.user, "invoices"),
        ],
      })
      .sort({ updatedAt: -1 })
      .limit(500);
    const payments = records.flatMap((invoice) =>
      invoice.payments.map((payment) => ({
        id: payment._id,
        invoiceId: invoice._id,
        invoiceNumber: invoice.number,
        currency: invoice.currency,
        date: payment.date,
        amount: payment.amountCents / 100,
        method: payment.method,
        reference: payment.reference,
      })),
    );
    res.json({ payments });
  },
);
router.post(
  "/deals/:id/project",
  requirePermission("leads:view"),
  requirePermission("projects:edit"),
  async (req, res) => {
    const deal = await findAuthorized(
      businessModels.deals,
      req.params.id,
      req.user,
      "leads",
    );
    if (deal.status !== "won")
      fail("Mark the deal won before creating a delivery project.");
    if (deal.currency !== "USD")
      fail(
        "The workbook-based project revenue fields are USD. Create the project manually and keep non-USD financial commitments on the linked deal/invoice.",
      );
    const project = await ManagedProject.findOneAndUpdate(
      { sourceDealId: deal._id },
      {
        $setOnInsert: {
          projectName: deal.title,
          clientId: deal.clientId,
          dealId: deal._id,
          proposalId: deal.proposalId,
          status: "new",
          orderAmount: deal.value,
          orderDate: todayInDhaka(),
          memberUserIds: [req.user._id],
          createdBy: req.user._id,
          updatedBy: req.user._id,
          history: [
            {
              at: new Date(),
              actor: req.user._id,
              action: "created from won deal",
              fields: ["dealId"],
            },
          ],
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    res.json({
      record: visibleRecord(project, req.user, "projects"),
      path: `/studio/projects/${project._id}`,
    });
  },
);
router.post(
  "/proposals/:id/project",
  requirePermission("proposals:view"),
  requirePermission("projects:edit"),
  async (req, res) => {
    const proposal = await findAuthorized(
      businessModels.proposals,
      req.params.id,
      req.user,
      "proposals",
    );
    if (proposal.status !== "accepted")
      fail("The proposal must be accepted first.");
    if (proposal.currency !== "USD")
      fail(
        "Keep non-USD amounts on the proposal/invoice; create the USD workbook project manually.",
      );
    const project = await ManagedProject.findOneAndUpdate(
      { sourceProposalId: proposal._id },
      {
        $setOnInsert: {
          projectName: proposal.title,
          clientId: proposal.clientId,
          proposalId: proposal._id,
          dealId: proposal.dealId,
          scopeOfWork: proposal.scope,
          projectInstructions: proposal.deliverables,
          projectType: proposal.technologyStack,
          status: "new",
          orderAmount: invoiceTotals(proposal).total,
          orderDate: todayInDhaka(),
          memberUserIds: [req.user._id],
          createdBy: req.user._id,
          updatedBy: req.user._id,
          history: [
            {
              at: new Date(),
              actor: req.user._id,
              action: "created from accepted proposal",
              fields: ["proposalId"],
            },
          ],
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    res.json({
      record: visibleRecord(project, req.user, "projects"),
      path: `/studio/projects/${project._id}`,
    });
  },
);
router.post(
  "/proposals/:id/invoice",
  requirePermission("proposals:view"),
  requirePermission("invoices:edit"),
  async (req, res) => {
    const proposal = await findAuthorized(
      businessModels.proposals,
      req.params.id,
      req.user,
      "proposals",
    );
    if (proposal.status !== "accepted")
      fail("The proposal must be accepted first.");
    if (!proposal.clientId) fail("Link a client to the proposal first.");
    let invoice = await businessModels.invoices.findOne({
      sourceActionKey: `proposal:${proposal._id}:first-invoice`,
    });
    if (!invoice)
      try {
        invoice = await businessModels.invoices.create({
          title: proposal.title,
          number: await nextNumber("INV"),
          clientId: proposal.clientId,
          proposalId: proposal._id,
          currency: proposal.currency,
          items: proposal.items.toObject(),
          paymentTerms: proposal.paymentTerms,
          issueDate: todayInDhaka(),
          status: "draft",
          sourceActionKey: `proposal:${proposal._id}:first-invoice`,
          createdBy: req.user._id,
          updatedBy: req.user._id,
          history: [
            {
              at: new Date(),
              actor: req.user._id,
              action: "created from accepted proposal",
              fields: ["proposalId"],
            },
          ],
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
        invoice = await businessModels.invoices.findOne({
          sourceActionKey: `proposal:${proposal._id}:first-invoice`,
        });
        if (!invoice) throw err;
      }
    res.json({
      record: { ...invoice.toJSON(), ...invoiceTotals(invoice) },
      path: `/studio/invoices/${invoice._id}`,
    });
  },
);
router.get(
  "/clients/:id/overview",
  requirePermission("clients:view"),
  async (req, res) => {
    const client = await findAuthorized(
      businessModels.clients,
      req.params.id,
      req.user,
      "clients",
    );
    const related = {};
    for (const module of [
      "contacts",
      "deals",
      "proposals",
      "contracts",
      "invoices",
      "support-tickets",
      "maintenance",
    ]) {
      const config = businessModules[module];
      if (!can(req.user, `${config.permission}:view`)) continue;
      const records = await config.Model.find({
        $and: [
          { clientId: client._id, archived: false },
          await recordScope(req.user, config.permission),
        ],
      })
        .sort({ createdAt: -1 })
        .limit(50);
      related[module] = records.map((r) => ({
        id: r._id,
        title: r[config.title],
        status: r.status,
        number: r.number,
      }));
    }
    if (can(req.user, "projects:view")) {
      const projects = await ManagedProject.find({
        $and: [
          { clientId: client._id, archived: false },
          await recordScope(req.user, "projects"),
        ],
      }).limit(50);
      related.projects = projects.map((r) => ({
        id: r._id,
        title: r.projectName,
        status: r.status,
      }));
    }
    res.json({ client: client.toJSON(), related });
  },
);
export default router;
