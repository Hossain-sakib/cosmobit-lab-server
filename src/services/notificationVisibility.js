import { ManagedProject, TeamTask, ProductLead } from "../models/Management.js";
import { businessModels, businessModules } from "../lib/businessModules.js";
import { can } from "../lib/permissions.js";
import { recordScope } from "../lib/managementScope.js";

/** Recheck current record access before exposing titles from older notifications. */
export async function visibleNotifications(user, records) {
  const groups = new Map(),
    allowed = new Set();
  for (const record of records) {
    // Chat alerts contain no sender name, message preview or record details.
    if (
      record.link === "/chat" &&
      record.eventKey?.startsWith("chat-message:")
    ) {
      if (!user.studioSuspended) allowed.add(String(record._id));
      continue;
    }
    const parts = (record.link || "").split("/").filter(Boolean);
    if (parts[0] !== "studio") continue;
    let module = parts[1],
      id = parts[2],
      Model,
      permission;
    if (module === "products" && parts[3] === "leads") {
      module = "product-leads";
      id = parts[4];
      Model = ProductLead;
      permission = "leads";
    } else if (module === "projects") {
      Model = ManagedProject;
      permission = "projects";
    } else if (module === "team-tasks") {
      Model = TeamTask;
      permission = "tasks";
    } else if (businessModules[module]) {
      Model = businessModels[module];
      permission = businessModules[module].permission;
    }
    if (
      !Model ||
      !/^[a-f0-9]{24}$/i.test(id || "") ||
      !can(user, `${permission}:view`)
    )
      continue;
    if (!groups.has(module))
      groups.set(module, { Model, permission, records: [] });
    groups.get(module).records.push({ record, id });
  }
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const ids = [...new Set(group.records.map(({ id }) => id))];
      const visible = await group.Model.find({
        $and: [
          { _id: { $in: ids }, archived: false },
          await recordScope(user, group.permission),
        ],
      })
        .select("_id")
        .lean();
      const available = new Set(visible.map((record) => String(record._id)));
      for (const { record, id } of group.records)
        if (available.has(id)) allowed.add(String(record._id));
    }),
  );
  return records.filter((record) => allowed.has(String(record._id)));
}
