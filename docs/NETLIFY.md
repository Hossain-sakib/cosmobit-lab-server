# Netlify deployment

The frontend and Express API run on the same Netlify site. Firebase Authentication, MongoDB Atlas, and Cloudinary remain the identity, database, and media services. No Render service is required.

The client repository pins a backend commit in `backend-revision.txt`. Its build script fetches that revision into the ignored `.netlify-api` directory, installs backend production dependencies, builds Vite, and lets Netlify bundle the functions. Update the pin whenever releasing backend changes. The backend repository is public; no GitHub token is needed during the build.

Functions:
- `api`: Express through serverless-http, reached at `/api/*`; MongoDB connections are reused within each warm function instance, with a bounded pool.
- `automations`: scheduled every 15 minutes on the production site. It creates reminders and recurring invoice drafts. Email remains disabled. This schedule is UTC and does not change the Dhaka business-date calculations.

Set site environment variables using Netlify's default scope if the plan does not support selecting individual scopes:
- `MONGODB_URI` (Atlas database URI)
- `FIREBASE_PROJECT_ID=cosmobit-lab`
- `FIREBASE_SERVICE_ACCOUNT_JSON` (complete service-account JSON; never VITE-prefixed)
- `CLIENT_URL=https://cosmobit-labs-studio.netlify.app`
- `NODE_ENV=production`
- `IMAGE_STORAGE=cloudinary`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `NOTIFICATION_EMAILS_ENABLED=false`
- public `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
- leave `VITE_API_URL` empty for same-origin `/api`
- do not configure authentication emulator variables.

Never expose server variables through Vite's environment prefix. Allow the Netlify domain in Firebase Authentication. Atlas must permit the function runtime's network access; standard Netlify Functions do not promise a fixed outbound IP. Use the database/network controls appropriate to the selected Netlify plan rather than copying an old Render IP rule.

CVs are stored in the private `privateResumes` GridFS bucket in MongoDB, streamed only after authentication and recruitment authorization. Images are stored in Cloudinary. No production upload depends on the function filesystem. Legacy local CV files remain readable on a traditional server; migrate them to GridFS before removing an existing server with local files. The new Netlify deployment has no legacy local production files.

Netlify imposes request, execution-time, function-size and plan limits. Keep imports within the existing workbook bounds. Function request envelopes may impose a lower practical upload ceiling than the application's 5 MB validation. Do not use the function filesystem as a backup. Back up MongoDB/Cloudinary independently. Deploying the frontend alone does not deploy these functions: use a full Netlify build or CLI deployment with the function directory.
