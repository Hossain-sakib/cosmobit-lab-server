import { fail } from "./validation.js";
import mongoose from "mongoose";
export function todayInDhaka(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((x) => x.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function countdown(date, now = new Date()) {
  return date
    ? Math.round((Date.parse(date) - Date.parse(todayInDhaka(now))) / 86400000)
    : null;
}
export function netAmount(amount = 0, fee = 20) {
  const cents = Math.round(amount * 100);
  return Math.round((cents * (10000 - Math.round(fee * 100))) / 10000) / 100;
}
export function projectCalculated(record, now) {
  const afterFiverr = netAmount(record.orderAmount, record.feePercent);
  const bonusAfterFiverr = netAmount(record.bonusAmount, record.feePercent);
  const pages = record.pages || [];
  const completed = pages.filter((x) =>
    ["done", "completed", "transferred", "transfarred"].includes(
      x.status?.toLowerCase().trim(),
    ),
  ).length;
  return {
    afterFiverr,
    bonusAfterFiverr,
    totalAfterFiverr: Math.round((afterFiverr + bonusAfterFiverr) * 100) / 100,
    countdown: countdown(record.deliveryLastDate, now),
    pageProgress: pages.length
      ? Math.round((completed / pages.length) * 100)
      : null,
  };
}
export function specialCalculated(record, now) {
  let deliveryDate = record.deliveryDate;
  if (!deliveryDate && record.orderStartDate) {
    const date = new Date(record.orderStartDate);
    date.setUTCDate(date.getUTCDate() + (record.timelineDays || 0));
    deliveryDate = date.toISOString().slice(0, 10);
  }
  return {
    effectiveDeliveryDate: deliveryDate || "",
    conversationCountdown: countdown(record.conversationStartDate, now),
    deliveryCountdown: countdown(deliveryDate, now),
  };
}
export function parseFields(body, definitions, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("A JSON object is required.");
  const result = {};
  for (const [key, spec] of Object.entries(definitions)) {
    let value = body[key];
    if (value === undefined) {
      if (!partial && spec.required) fail(`${key} is required.`);
      continue;
    }
    if (spec.type === "boolean") {
      if (typeof value !== "boolean") fail(`Invalid ${key}.`);
    } else if (spec.type === "string-list") {
      if (
        !Array.isArray(value) ||
        value.length > 50 ||
        value.some((item) => typeof item !== "string" || item.length > 200)
      )
        fail(`Invalid ${key}.`);
      value = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
    } else if (spec.type === "id") {
      if (value === "" || value === null) value = null;
      else if (
        typeof value !== "string" ||
        !mongoose.isObjectIdOrHexString(value)
      )
        fail(`Invalid ${key}.`);
    } else if (spec.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < spec.min ||
        value > spec.max ||
        Math.abs(
          value * 10 ** spec.decimals - Math.round(value * 10 ** spec.decimals),
        ) > 0.00001
      )
        fail(`Invalid ${key}.`);
    } else {
      if (typeof value !== "string") fail(`${key} must be text.`);
      value = value.trim();
      if ((spec.required && !value) || value.length > (spec.max || 2000))
        fail(`Invalid ${key}.`);
      if (
        spec.type === "email" &&
        value &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      )
        fail(`Invalid ${key}.`);
      if (spec.type === "email") value = value.toLowerCase();
      if (
        spec.type === "date" &&
        value &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        fail(`Invalid date: ${key}.`);
      if (spec.type === "enum" && !spec.values.includes(value))
        fail(`Invalid ${key}.`);
      if (["url", "asset-url"].includes(spec.type) && value) {
        if (
          spec.type === "asset-url" &&
          /^\/uploads\/[a-f0-9-]{36}\.webp$/.test(value)
        ) {
          result[key] = value;
          continue;
        }
        let parsed;
        try {
          parsed = new URL(value);
        } catch {
          fail(`${key} must be a valid HTTP or HTTPS URL.`);
        }
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          fail(
            `${key} must be an HTTP/HTTPS URL without embedded credentials.`,
          );
      }
    }
    result[key] = value;
  }
  return result;
}
export function allocateAmount(amount, allocations, fallback) {
  const cents = Math.round(amount * 100);
  const rows = allocations?.length
    ? allocations
    : [{ person: fallback || "Unassigned", percent: 100 }];
  const result = rows.map((row) => {
    const exact = (cents * row.percent) / 100;
    return {
      person: row.person,
      cents: Math.floor(exact),
      fraction: exact - Math.floor(exact),
    };
  });
  const totalPercent = rows.reduce((n, row) => n + row.percent, 0);
  let remaining = cents - result.reduce((n, row) => n + row.cents, 0);
  if (Math.abs(totalPercent - 100) < 0.00001) {
    for (const row of [...result].sort((a, b) => b.fraction - a.fraction)) {
      if (!remaining) break;
      row.cents++;
      remaining--;
    }
  }
  if (remaining) result.push({ person: "Unassigned", cents: remaining });
  return result.map((row) => ({ person: row.person, amount: row.cents / 100 }));
}
