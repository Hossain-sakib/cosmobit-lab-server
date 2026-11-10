import { Employee } from "../models/Management.js";
import { can, hasAllScope } from "./permissions.js";
export async function recordScope(user, module) {
  if (
    ["finance_manager", "accountant"].includes(user.role) &&
    module === "proposals"
  )
    return { status: { $in: ["approved", "sent", "accepted"] } };
  if (hasAllScope(user, module)) return {};
  if (module === "projects")
    return {
      $or: [
        { createdBy: user._id },
        { memberUserIds: user._id },
        { "pages.assigneeUserId": user._id },
      ],
    };
  if (["tasks", "attendance", "leave", "time"].includes(module)) {
    const employee = await Employee.findOne({
      accountUserId: user._id,
      status: "active",
      archived: false,
    });
    const conditions = [
      {
        createdBy: user._id,
        employeeId: null,
        ...(module === "tasks" ? { departmentId: null } : {}),
      },
    ];
    if (employee) {
      conditions.push({ employeeId: employee._id });
      if (module === "tasks" && employee.departmentId)
        conditions.push({
          departmentId: employee.departmentId,
          employeeId: null,
        });
    }
    return { $or: conditions };
  }
  if (module === "leads")
    return {
      $or: [
        { ownerUserId: user._id },
        { ownerUserId: null, createdBy: user._id },
      ],
    };
  return {
    $or: [
      { createdBy: user._id },
      { ownerUserId: user._id },
      { managerUserId: user._id },
    ],
  };
}
export function visibleRecord(record, user, module) {
  const data = record.toJSON ? record.toJSON() : { ...record };
  if (module === "projects" && !can(user, "finance:view")) {
    if (data.sourceReference) delete data.sourceReference.fileName;
    data.projectName = data.projectName?.replace(/_?\$[\d,.]+(?:$|_)/g, "");
    for (const key of [
      "orderAmount",
      "bonusAmount",
      "feePercent",
      "afterFiverr",
      "bonusAfterFiverr",
      "totalAfterFiverr",
      "salesAllocations",
      "operationsAllocations",
    ])
      delete data[key];
  }
  if (module === "team" && !can(user, "payroll:view")) {
    delete data.salary;
    delete data.salaryCurrency;
  }
  if (
    module === "proposals" &&
    ["finance_manager", "accountant"].includes(user.role)
  )
    delete data.internalNotes;
  if (module === "time" && !can(user, "finance:view")) {
    delete data.hourlyCost;
    delete data.currency;
  }
  return data;
}
