# Staff roles

Founder & CEO uses `super_admin`, with every module and action available. Public sign-up always creates a `user` account with no CRM permissions. Never infer founder access from a name or email domain.

| Role | Default access |
| --- | --- |
| General Manager | All operational records, projects, sales, support and teams; no payroll, financial controls or account administration |
| Project Manager | Assigned projects, tasks, support and time; team directory |
| Operations Manager | All projects, tasks, support and time; sample management |
| Business Development / Sales Manager | All sales records, products, leads, proposals and activity; proposal approval |
| Business Development / Sales Executive | Assigned sales records and own activity; no proposal approval |
| Web / Software Developer, Graphics / UI/UX Designer, QA, DevOps | Assigned projects and tasks, own attendance, leave and time; project finances hidden |
| HR / HR Manager | Recruitment, staff, jobs, attendance and leave; no salary or payroll by default |
| Accountant / Finance Manager | Finance, invoices, payments, expenses and payroll; approved proposal visibility |
| Support Agent | Assigned support records and related assigned projects / clients |
| Content Manager | Public CMS and samples directory |
| Employee / Intern | Assigned work, own attendance, leave and time |
| Viewer | Dashboard, products and samples |
| Public account | No CRM access |

Role permissions and record scopes are separate. Managers' wider scopes apply only to modules they can view. Individual grants, denials and all-record scope overrides are controlled in Roles & Permissions. Assignment scopes apply in backend queries, dashboard counts and reports. Suspended accounts have no CRM permissions. Salary and project financial fields are also filtered before returning records.

Legacy `admin`, `developer` and `designer` roles remain supported for existing accounts. New role titles are returned by the API for the account management screen. An account role is distinct from an employee job title or department.

To bootstrap the confirmed founder account, sign in once, verify the exact Firebase UID, then run `npm run admin -- FIREBASE_UID --super` with the intended backend database and Firebase credentials. Do not run this for a guessed account. The founder's sign-in email is still needed to identify the correct UID.

Transactional email stays disabled. These changes do not deploy or publish the environment.
