import {
  initializeApp,
  getApps,
  applicationDefault,
  cert,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { HttpsProxyAgent } from "https-proxy-agent";
export function firebaseAuth() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_PROJECT_ID)
      throw new Error("FIREBASE_PROJECT_ID is required.");
    if (
      process.env.FIREBASE_AUTH_EMULATOR_HOST &&
      !process.env.FIREBASE_PROJECT_ID.startsWith("demo-")
    )
      throw new Error(
        "The authentication emulator requires a demo- project ID.",
      );
    if (
      process.env.NODE_ENV === "production" &&
      process.env.FIREBASE_AUTH_EMULATOR_HOST
    )
      throw new Error("Firebase emulation is forbidden in production.");
    const agent =
      !process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.HTTPS_PROXY
        ? new HttpsProxyAgent(process.env.HTTPS_PROXY)
        : undefined;
    let credential;
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON), agent)
        : applicationDefault(agent);
    }
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      ...(agent ? { httpAgent: agent } : {}),
      ...(process.env.FIREBASE_AUTH_EMULATOR_HOST ? {} : { credential }),
    });
  }
  return getAuth();
}
