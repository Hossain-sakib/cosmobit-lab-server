import { Router } from "express";
import { TeamTask, ManagedProject } from "../models/Management.js";
import { can } from "../lib/permissions.js";
import { recordScope, visibleRecord } from "../lib/managementScope.js";
import { todayInDhaka } from "../lib/management.js";
const router = Router();
router.get("/", async (req, res) => {
  const result = {};
  const today = todayInDhaka();
  if (can(req.user, "tasks:view")) {
    const filter = {
      $and: [
        { archived: false, status: { $ne: "done" } },
        await recordScope(req.user, "tasks"),
      ],
    };
    const [tasks, open, overdue, blocked] = await Promise.all([
      TeamTask.find(filter)
        .select("title status priority endDate assigneeName")
        .sort({ endDate: 1 })
        .limit(6),
      TeamTask.countDocuments(filter),
      TeamTask.countDocuments({
        $and: [filter, { endDate: { $ne: "", $lt: today } }],
      }),
      TeamTask.countDocuments({ $and: [filter, { status: "blocked" }] }),
    ]);
    result.tasks = tasks;
    result.taskStats = { open, overdue, blocked };
  }
  if (can(req.user, "projects:view")) {
    const projects = await ManagedProject.find({
      $and: [
        {
          archived: false,
          status: { $nin: ["completed", "cancelled", "delivered"] },
        },
        await recordScope(req.user, "projects"),
      ],
    })
      .select("projectName status deliveryLastDate")
      .sort({ deliveryLastDate: 1 })
      .limit(5);
    result.projects = projects.map((project) => {
      const visible = visibleRecord(project, req.user, "projects");
      return {
        _id: visible._id,
        projectName: visible.projectName,
        status: visible.status,
        deliveryLastDate: visible.deliveryLastDate,
      };
    });
  }
  res.json(result);
});
export default router;
