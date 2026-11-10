import { businessModels } from "../lib/businessModules.js";
import { todayInDhaka } from "../lib/management.js";
import { notifySales } from "./automation.js";
export async function captureInquiry(message, source = "website-inquiry") {
  const email = message.email.toLowerCase().trim();
  const lead = await businessModels["business-leads"].findOneAndUpdate(
    { dedupeKey: `email:${email}` },
    {
      $setOnInsert: {
        fullName: message.name,
        email,
        description: message.message,
        source,
        currency: "USD",
        status: "new",
        priority: "normal",
      },
      $set: { lastContactDate: todayInDhaka() },
      $addToSet: { sourceMessageIds: message._id },
    },
    { upsert: true, new: true, runValidators: true },
  );
  await notifySales({
    key: `website-inquiry:${message._id}`,
    title: "New website inquiry",
    message: `${message.name} sent a ${source.replaceAll("-", " ")}.`,
    link: `/studio/business-leads/${lead._id}`,
  });
  return lead;
}
