export const MODULES = [
  "dashboard",
  "projects",
  "special-orders",
  "products",
  "leads",
  "samples",
  "team",
  "departments",
  "tasks",
  "sales-activity",
  "distribution-history",
  "applications",
  "reports",
  "finance",
  "users",
  "settings",
  "crm",
  "marketplace",
  "outreach",
  "clients",
  "proposals",
  "contracts",
  "invoices",
  "payments",
  "expenses",
  "payroll",
  "attendance",
  "leave",
  "support",
  "cms",
  "notifications",
  "jobs",
  "time",
];
export const ALL_PERMISSIONS = [
  ...MODULES.flatMap((m) => [`${m}:view`, `${m}:edit`]),
  "proposals:approve",
  "expenses:approve",
  "payroll:approve",
  "leave:approve",
  "payments:record",
  "documents:send",
];
const v = (...modules) => modules.map((m) => `${m}:view`);
const rw = (...modules) => modules.flatMap((m) => [`${m}:view`, `${m}:edit`]);
export const ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  sales_manager: [
    ...v("dashboard", "reports", "samples"),
    ...rw(
      "products",
      "leads",
      "marketplace",
      "outreach",
      "clients",
      "proposals",
      "contracts",
      "sales-activity",
    ),
    "proposals:approve",
    "documents:send",
  ],
  sales_executive: [
    ...v("dashboard", "products", "samples"),
    ...rw("leads", "outreach", "clients", "proposals", "sales-activity"),
    "documents:send",
  ],
  project_manager: [
    ...v("dashboard", "team", "departments", "samples"),
    ...rw("projects", "tasks", "support", "time"),
  ],
  developer: [
    ...v("dashboard", "projects", "tasks", "samples"),
    ...rw("attendance", "leave", "time"),
  ],
  designer: [
    ...v("dashboard", "projects", "tasks", "samples"),
    ...rw("attendance", "leave", "time"),
  ],
  finance_manager: [
    ...v("dashboard", "reports", "projects", "clients", "team", "proposals"),
    ...rw(
      "finance",
      "invoices",
      "payments",
      "expenses",
      "payroll",
      "distribution-history",
    ),
    "expenses:approve",
    "payroll:approve",
    "payments:record",
    "documents:send",
  ],
  support_agent: [...v("dashboard", "projects", "clients"), ...rw("support")],
  hr_manager: [
    ...v("dashboard", "tasks", "departments"),
    ...rw("team", "applications", "attendance", "leave", "jobs"),
    "leave:approve",
  ],
  employee: [
    ...v("dashboard", "projects", "tasks"),
    ...rw("attendance", "leave", "time"),
  ],
  viewer: v("dashboard", "products", "samples"),
  user: [],
};
// Job titles share capability profiles; record assignment remains a separate check.
const roleProfiles = {
  general_manager: [
    ...v("dashboard", "reports", "team", "departments"),
    ...rw(
      "projects",
      "tasks",
      "products",
      "leads",
      "clients",
      "marketplace",
      "outreach",
      "proposals",
      "contracts",
      "sales-activity",
      "special-orders",
      "samples",
      "support",
      "time",
    ),
    "proposals:approve",
    "documents:send",
  ],
  business_development_manager: ROLE_PERMISSIONS.sales_manager,
  business_development_executive: ROLE_PERMISSIONS.sales_executive,
  operations_manager: [
    ...ROLE_PERMISSIONS.project_manager,
    ...rw("samples"),
    ...v("reports"),
  ],
  web_developer: ROLE_PERMISSIONS.developer,
  software_developer: ROLE_PERMISSIONS.developer,
  graphics_designer: ROLE_PERMISSIONS.designer,
  ui_ux_designer: ROLE_PERMISSIONS.designer,
  qa_engineer: ROLE_PERMISSIONS.developer,
  devops_engineer: ROLE_PERMISSIONS.developer,
  hr: ROLE_PERMISSIONS.hr_manager,
  accountant: ROLE_PERMISSIONS.finance_manager,
  content_manager: [...v("dashboard", "samples"), ...rw("cms")],
  intern: ROLE_PERMISSIONS.employee,
};
Object.assign(ROLE_PERMISSIONS, roleProfiles);
export const ROLE_LABELS = {
  super_admin: "Founder & CEO / Superadmin",
  admin: "Administrator",
  general_manager: "General Manager",
  project_manager: "Project Manager",
  business_development_manager: "Business Development Manager",
  business_development_executive: "Business Development Executive",
  sales_manager: "Sales Manager",
  sales_executive: "Sales Executive",
  operations_manager: "Operations Manager",
  web_developer: "Web Developer",
  software_developer: "Software Developer",
  graphics_designer: "Graphics Designer",
  ui_ux_designer: "UI/UX Designer",
  qa_engineer: "QA Engineer",
  devops_engineer: "DevOps Engineer",
  hr: "HR",
  hr_manager: "HR Manager",
  accountant: "Accountant",
  finance_manager: "Finance Manager",
  content_manager: "Content Manager",
  support_agent: "Support Agent",
  developer: "Developer",
  designer: "Designer",
  employee: "Employee",
  intern: "Intern",
  viewer: "Viewer",
  user: "Public account — no CRM access",
};
const scopeProfiles = {
  general_manager: [
    "projects",
    "tasks",
    "products",
    "leads",
    "clients",
    "marketplace",
    "outreach",
    "proposals",
    "contracts",
    "sales-activity",
    "special-orders",
    "samples",
    "support",
    "team",
    "departments",
    "time",
  ],
  operations_manager: ["projects", "tasks", "support", "time"],
  business_development_manager: [
    "products",
    "leads",
    "clients",
    "outreach",
    "proposals",
    "contracts",
    "marketplace",
    "sales-activity",
  ],
  hr: ["team", "applications", "attendance", "leave", "departments", "jobs"],
  accountant: [
    "projects",
    "finance",
    "reports",
    "distribution-history",
    "clients",
    "invoices",
    "payments",
    "expenses",
    "payroll",
    "team",
    "time",
  ],
};
for (const role of Object.keys(ROLE_PERMISSIONS)) {
  if (role !== "user" && !ROLE_PERMISSIONS[role].includes("notifications:view"))
    ROLE_PERMISSIONS[role] = [
      ...ROLE_PERMISSIONS[role],
      "notifications:view",
      "notifications:edit",
    ];
}
export function permissionsFor(user) {
  if (user.studioSuspended) return [];
  if (user.role === "super_admin") return ALL_PERMISSIONS;
  const denied = new Set(user.deniedPermissions || []);
  return [
    ...new Set([
      ...(ROLE_PERMISSIONS[user.role] || []),
      ...(user.grantedPermissions || []),
    ]),
  ].filter((p) => ALL_PERMISSIONS.includes(p) && !denied.has(p));
}
export function can(user, permission) {
  return !!user && permissionsFor(user).includes(permission);
}
export function hasAllScope(user, module) {
  if (user.studioSuspended) return false;
  if (["super_admin", "admin"].includes(user.role)) return true;
  if (scopeProfiles[user.role]?.includes(module)) return true;
  if (user.allScopes?.includes(module)) return true;
  if (
    user.role === "sales_manager" &&
    [
      "products",
      "leads",
      "clients",
      "outreach",
      "proposals",
      "contracts",
      "marketplace",
      "sales-activity",
    ].includes(module)
  )
    return true;
  if (
    user.role === "finance_manager" &&
    [
      "projects",
      "finance",
      "reports",
      "distribution-history",
      "clients",
      "invoices",
      "payments",
      "expenses",
      "payroll",
      "team",
      "time",
    ].includes(module)
  )
    return true;
  if (
    user.role === "hr_manager" &&
    [
      "team",
      "applications",
      "attendance",
      "leave",
      "departments",
      "jobs",
    ].includes(module)
  )
    return true;
  return ["samples", "products", "departments", "cms"].includes(module);
}
export function requirePermission(permission) {
  return (req, res, next) =>
    can(req.user, permission)
      ? next()
      : res
          .status(403)
          .json({ message: "You do not have permission for this action." });
}
