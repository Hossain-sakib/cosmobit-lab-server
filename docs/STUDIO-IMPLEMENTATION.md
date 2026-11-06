# Cosmobit Studio implementation audit and architecture

The existing application uses React 18/Vite, Tailwind, Express 5, Firebase Authentication, and MongoDB/Mongoose. It has a public site, community, CMS, basic CRM, and Netlify deployment files. Reuse this stack and existing brand assets. The backend is adapted to Netlify Functions while retaining Express and the existing cloud environment configuration.

The uploaded operating-system brief is the expanded product specification. Workbook requirements remain explicit: legitimate Special Orders are distinct from real Projects; product leads are scoped to individual products; work samples have Used/Unused state; tasks belong to employees/departments; marketplace activity includes three shifts; revenue distribution is separate from activity counts; career applications remain private. Workbooks may contain credentials and personal data: previews exclude hosting passwords, no real customer/applicant rows are committed as fixtures, and imports require confirmation.

## Data and API plan

Retain existing User, Job, Post and CRM collections. Add referenced collections for managed projects, special orders, products/product leads, sample collections, employees/departments/tasks, daily marketplace activity, historical distribution, and job applications. Use dedicated routes and models; Special Orders never enter project progress or revenue distribution automatically. Shared metadata drives validated forms, CRUD and imports, with module-specific business logic. Revisions, page tasks and revenue allocations are bounded project subdocuments.

All records use stable MongoDB IDs, timestamps, actor IDs, optimistic update versions, archive state and activity history. Production deployment stays pending explicit access/configuration; local test validation is not evidence of a live website.

## Authentication and permissions

Retain Firebase as explicitly requested by the user. Do not introduce a parallel local password database. Current clients send verified Firebase ID tokens; email/password and password reset are provided by Firebase. Cookie-session support, email verification and session revocation enhancements are tracked separately in the expanded brief.

Fixed default roles map to individual module view/edit permissions; admins may grant/revoke individual permissions and broaden explicit module scopes. Super-admin alone can grant the super-admin role. Assigned scopes are enforced in database queries, not only navigation. Developers/designers receive assigned project/task data, sales staff assigned lead data, finance staff authorized financial records, and HR authorized applicants/employees. Project monetary fields are redacted for users without finance access.

## Business rules

- Project net revenue uses integer cents, default 20% fee, separately rounded order/bonus net, and a documented fee rate per project.
- Page-task completion determines computed project progress when tasks exist; manually entered progress is only the fallback for projects without page tasks.
- Dates/countdowns use Asia/Dhaka business dates. Completed/cancelled work is excluded from overdue totals.
- Sales activity counts inquiries, quotes, orders and query passes for morning/evening/night, separately by date/profile/platform.
- Sales/operations distribution groups real, non-cancelled projects by order month. Explicit allocation percentages may total at most 100%; rounding is reconciled in cents and unassigned amounts remain visible. Sales and operations are separate attribution views, not two sets of payouts. Imported historical totals are shown separately to avoid double counting.
- Product lead imports preserve worksheet owner names and deduplicate email/phone within a product. No automated outreach is sent.
- Collection usage defaults to Unused only where the source has no state.
- Imported original status labels are retained alongside normalized operational statuses where needed.

## Delivery checklist

- [x] Inspect existing code and workbook structures.
- [x] Document module boundaries, data relationships and role matrix approach.
- [ ] Verify shared authorization and assigned-record scopes.
- [ ] Complete and test workbook-driven project and Special Order modules.
- [ ] Complete products, per-product leads, collections and import previews.
- [ ] Complete employee/department tasks and scoped employee access.
- [ ] Complete marketplace activity and automated distribution reports.
- [ ] Complete public career applications and authorized recruitment review.
- [ ] Integrate grouped Studio navigation and truthful database-backed metrics.
- [ ] Expand leads/deals, proposals/contracts, finance, HR, support, CMS and automations from the operating-system brief in verified phases.
- [ ] Verify integration/security tests, desktop/mobile workflows, builds, and dependency audits.
- [ ] Document exact completed features and unresolved requirements; do not mark incomplete modules as delivered.

Preferred UI libraries in the brief are optional technology choices. Avoid replacing working forms/data-fetching code only to add dependencies. SMTP/cloud storage and external platform integrations must be explicitly configured and verified; never label an unconfigured integration operational.
