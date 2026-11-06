# CosmoBit Labs API and CRM

Node.js 22+ (validated on Node 24), Express 5, MongoDB, and Firebase Authentication. The frontend lives in `Hossain-sakib/cosmobit-lab-client`.

## Local development

```sh
npm ci
cp .env.example .env
npm run dev
```

Set `MONGODB_URI`, `FIREBASE_PROJECT_ID`, and Firebase Admin authentication before starting. Do not overwrite an existing `.env` file. The service listens on port 4000; `GET /api/health` reports database readiness.

For local MongoDB:

```sh
docker run -d --name cosmobit-mongo -p 127.0.0.1:27017:27017 -v cosmobit-mongo-data:/data/db mongo:8 --bind_ip_all
```

Restart an existing container with `docker start cosmobit-mongo`; do not create another with the same name. The local database is unauthenticated and must remain bound to loopback. Use authenticated MongoDB/Atlas for deployment.

## Firebase setup

1. Create/select your Firebase project. Enable Authentication → Email/Password and add your frontend hostname to Authorized domains. Configure an appropriate password policy and email enumeration protection in Firebase.
2. Add a Web app and give the frontend its public web configuration (see the client README). Firebase Auth handles passwords, refresh tokens, and password reset emails; the API never stores passwords.
3. Set `FIREBASE_PROJECT_ID` to the same project ID. For production Firebase Admin access, use an identity authorized for this Firebase project through Application Default Credentials, or securely mount a Firebase service-account JSON outside the checkout and set `GOOGLE_APPLICATION_CREDENTIALS` to its path. Never commit credentials or place a private key in frontend variables.
4. The frontend sends a Firebase ID token as `Authorization: Bearer ...`. The API verifies the token, checks revocation/disabled users, and loads roles from MongoDB for each request. Public registration cannot grant admin access.
5. Sign in once, copy your UID from the Firebase console, and grant administrator access from a trusted backend terminal:

```sh
npm run admin -- YOUR_FIREBASE_UID
```

There are no default administrator accounts or built-in passwords. Profile username conflicts can be corrected by retrying registration with a different username while signed in.

## MongoDB requirements

Use a connection string for a dedicated database, for example `mongodb+srv://<user>:<password>@<cluster>/cosmobit-labs`. Supply it securely as `MONGODB_URI`. The user needs `readWrite` for that database, including creating collections and indexes. Configure Atlas Network Access for the backend deployment's actual outbound address; keep TLS verification enabled. Do not use an unrestricted network rule as a shortcut. Back up the database and the uploads directory.

## CRM

All `/api/crm` routes require an authenticated administrator. The shared studio workspace stores:

- Clients/companies and contacts
- Leads with new/contacted/qualified/won/lost stages
- Projects with planned/active/on-hold/completed/cancelled states
- Tasks with todo/in-progress/blocked/done states
- Notes, descriptions, priorities, due dates, assignee text, monetary values/currencies, and related clients/projects

`GET /api/crm/summary` returns status counts and overdue work. `GET /api/crm/records` supports `kind`, `status`, `search`, `archived`, and `page`; pages contain 25 records. `GET /api/crm/options` searches client/project names. Create records with `POST /api/crm/records`, retrieve one with `GET /api/crm/records/:id`, and update with `PATCH /api/crm/records/:id`. Set `archived` to archive/restore. The last 100 changes record actor, timestamp, and changed fields. This is activity history, not a complete compliance audit trail. CRM records are shared among administrators; staff-specific permissions, invoice/payment processing, and CRM attachments are not implemented.

The CMS additionally manages blog posts, jobs, contact messages, newsletter subscribers, and community content. Contact/newsletter submissions are stored in MongoDB for admin management; they do not send campaign or notification email. Firebase password reset emails are handled separately by Firebase.

## Tests

Tests require MongoDB on `127.0.0.1:27017` and the Firebase Auth emulator on `127.0.0.1:9099`. They create/drop a uniquely named test database and delete only their own emulator accounts.

```sh
# Terminal 1
npx --yes firebase-tools@15.35.0 emulators:start --only auth --project demo-cosmobit
# Terminal 2
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm test
```

`firebase.json` restricts the emulator to loopback. With no running emulator, `npm run test:emulator` starts it, runs the tests, and stops it. The emulator uses a `demo-` project and must never be enabled in production. `npm run seed` optionally adds sample blog posts and jobs; it does not create users or modify roles.

## Deployment

Set `NODE_ENV=production`, real MongoDB/Firebase configuration, and `CLIENT_URL` to the allowed frontend origin(s), comma-separated. Keep the Firebase emulator variable unset. Use HTTPS. Set `TRUST_PROXY` only to known proxy addresses/CIDRs when deploying behind a reverse proxy; never trust arbitrary forwarded headers. Uploads must use persistent storage mounted at `uploads/`. Images are limited to 5 MB and 20 megapixels, decoded and re-encoded as WebP with metadata removed. Other request bodies are limited to 128 KB. Rate limiting is in-process; a multi-instance deployment needs a shared limiter store. Firebase API, token verification, and MongoDB network destinations must be reachable through the hosting environment's supported network configuration.

The server handles SIGINT/SIGTERM and closes database connections. The current validation uses local emulators, not production credentials. Package overrides update vulnerable transitive dependencies; re-run integration tests and `npm audit` when refreshing dependencies.

## Container deployment

Build from this repository with `docker build -t cosmobit-api .`. In managed cloud environments, supply the session CA with `--secret id=proxy_ca,src="$CODEX_PROXY_CERT"` and keep the platform proxy settings. The image installs only production dependencies and runs as a non-root user. No `.env` files, uploaded files, or credential files are copied into it.

Provide `MONGODB_URI`, `FIREBASE_PROJECT_ID`, and `CLIENT_URL` as deployment environment configuration and use a supported runtime identity or securely mounted Firebase Admin credentials. The image accepts the platform's `PORT`. It refuses Firebase Auth emulation in production.

The current image stores community uploads under `/app/uploads`. Mount persistent storage there on hosts that support persistent disks. Before using an ephemeral host such as Cloud Run, configure durable object storage or a supported persistent mount; deploying without it would lose uploaded images on restart. Deployment identity, billing/hosting selection, production database network access, and Firebase web configuration must be supplied before a production deployment can be verified.

## Render

Use `render.yaml` as a Blueprint for `Hossain-sakib/cosmobit-lab-server`. It defines a Docker web service, `/api/health` readiness, and a 1 GB persistent upload disk. The `starter` service and disk incur Render charges; review the current price before creating the service. Automatic deployment is disabled until production configuration is verified.

Supply these settings securely:

- `MONGODB_URI`: Atlas URI for database user `mskib567_db_user`, with its password and the selected database name. The cluster hostname and database name still need to be supplied. Give the user `readWrite` only for that application database and allow the Render service's outbound addresses in Atlas Network Access.
- `CLIENT_URL`: final Netlify HTTPS origin.
- `FIREBASE_PROJECT_ID`: `cosmobit-lab` (already set by the Blueprint).
- A Render Secret File named `firebase-admin.json`, containing Firebase Admin credentials authorized for that project. The Blueprint points `GOOGLE_APPLICATION_CREDENTIALS` to `/etc/secrets/firebase-admin.json`. This file must be created securely in Render and must never be committed or placed in frontend variables.

After the backend is healthy, configure the frontend's `VITE_API_URL` with its Render origin and deploy the Netlify build. Verify real sign-in, admin access, and upload persistence before calling the production deployment ready. API deployment requires authorized Render access; frontend deployment requires authorized Netlify access. Project IDs and MongoDB usernames alone do not grant that access.
