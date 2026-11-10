import mongoose from "mongoose";
import { businessModels } from "./businessModules.js";
import { invoiceTotals, validateFinanceRecord } from "./finance.js";
import { fail } from "./validation.js";
import { can, hasAllScope } from "./permissions.js";
import { Employee } from "../models/Management.js";
const counterSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: { type: Number, default: 0 },
});
const Counter =
  mongoose.models.StudioCounter ||
  mongoose.model("StudioCounter", counterSchema);
export async function nextNumber(prefix) {
  const year = new Date().getUTCFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `${prefix}-${year}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true },
  );
  return `${prefix}-${year}-${String(counter.value).padStart(5, "0")}`;
}
export async function prepareBusinessRecord(data, config, req, previous) {
  if (!config.displayTitle) return;
  validateFinanceRecord(data, previous, config);
  if (
    config.fields.slug &&
    data.slug &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)
  )
    fail("Slugs must use lowercase letters, numbers and hyphens.");
  if (config.numberPrefix && !previous)
    data.number = await nextNumber(config.numberPrefix);
  if (config.displayTitle === "Proposals & Quotations") {
    if (
      ["approved", "accepted", "rejected"].includes(data.status) &&
      !can(req.user, "proposals:approve")
    )
      fail("Proposal approval permission is required.", 403);
    if (
      data.status === "sent" &&
      !["approved", "sent", "accepted"].includes(previous?.status)
    )
      fail("Approve the proposal before sending it.");
  }
  if (
    config.displayTitle === "Expenses" &&
    ["approved", "rejected"].includes(data.status) &&
    !can(req.user, "expenses:approve")
  )
    fail("Expense approval permission required.", 403);
  if (
    config.displayTitle === "Payroll" &&
    ["approved", "paid"].includes(data.status) &&
    !can(req.user, "payroll:approve")
  )
    fail("Payroll approval permission required.", 403);
  if (
    config.permission === "leave" &&
    ["approved", "rejected"].includes(data.status) &&
    !can(req.user, "leave:approve")
  )
    fail("Leave approval permission required.", 403);
  if (
    config.permission === "leave" &&
    !hasAllScope(req.user, "leave") &&
    data.status &&
    data.status !== "pending"
  )
    fail("Only an authorized manager may approve leave.", 403);
  if (data.employeeId && !hasAllScope(req.user, config.permission)) {
    if (
      !(await Employee.exists({
        _id: data.employeeId,
        accountUserId: req.user.id,
        archived: false,
        status: "active",
      }))
    )
      fail("You may only record your own employee activity.", 403);
  }
  if (config.displayTitle === "Business Settings" && data.timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone }).format(
        new Date(),
      );
    } catch {
      fail("Invalid business time zone.");
    }
  }
  if (
    ["Clients", "Lead Management"].includes(config.displayTitle) &&
    data.email
  )
    data.dedupeKey = `email:${data.email}`;
  if (config.displayTitle === "Sales Pipeline") {
    if (data.status === "lost" && !data.lostReason && !previous?.lostReason)
      fail("Record a reason before marking a deal lost.");
    if (data.status === "won" && !previous?.clientId && !data.clientId) {
      const leadId = data.leadId || previous?.leadId;
      const lead = leadId
        ? await businessModels["business-leads"].findById(leadId)
        : null;
      if (!lead) fail("Link a lead or client before marking a deal won.");
      if (!lead.email)
        fail(
          "Choose an existing client or add the lead email before conversion.",
        );
      const client = await businessModels.clients.findOneAndUpdate(
        { dedupeKey: `email:${lead.email}` },
        {
          $setOnInsert: {
            name: lead.fullName,
            email: lead.email,
            companyName: lead.companyName,
            phone: lead.phone,
            source: lead.source,
            clientType: lead.companyName ? "company" : "individual",
            ownerUserId: lead.ownerUserId,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            status: "onboarding",
          },
        },
        { upsert: true, new: true, runValidators: true },
      );
      if (client.archived)
        fail(
          "The matching client is archived. Restore it or choose another client.",
        );
      data.clientId = client._id;
    }
    if (!previous)
      data.stageHistory = [
        { stage: data.status || "new", at: new Date(), actor: req.user._id },
      ];
  }
}
export async function afterBusinessSave(record, config, req, previous) {
  if (
    config.displayTitle === "Sales Pipeline" &&
    record.status === "won" &&
    record.leadId
  ) {
    await businessModels["business-leads"].updateOne(
      { _id: record.leadId, status: { $ne: "won" } },
      {
        $set: { status: "won", updatedBy: req.user.id },
        $inc: { __v: 1 },
        $push: {
          history: {
            at: new Date(),
            actor: req.user.id,
            action: "deal won",
            fields: ["status"],
          },
        },
      },
    );
  }
}
export function calculatedBusiness(record, config) {
  const data = record.toJSON ? record.toJSON() : { ...record };
  if (["Invoices", "Proposals & Quotations"].includes(config.displayTitle)) {
    Object.assign(data, invoiceTotals(data));
    if (config.displayTitle === "Invoices")
      data.paymentStatus =
        data.status === "cancelled"
          ? "cancelled"
          : data.balance === 0 && data.total > 0
            ? "paid"
            : data.paid > 0
              ? "partially-paid"
              : data.dueDate &&
                  data.dueDate < new Date().toISOString().slice(0, 10) &&
                  data.status !== "draft"
                ? "overdue"
                : data.status;
  }
  if (config.displayTitle === "Sales Pipeline")
    data.weightedValue =
      Math.round((data.value || 0) * (data.probability || 0)) / 100;
  if (config.displayTitle === "Payroll")
    data.netPay =
      Math.round(
        ((data.salary || 0) + (data.bonus || 0) - (data.deductions || 0)) * 100,
      ) / 100;
  if (config.displayTitle === "Attendance" && data.clockIn && data.clockOut) {
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    data.hours =
      Math.round(
        ((minutes(data.clockOut) - minutes(data.clockIn)) / 60) * 100,
      ) / 100;
  }
  delete data.dedupeKey;
  return data;
}
