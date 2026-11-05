import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
export function firebaseAuth() {
  if (!getApps().length) {
    if (!process.env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is required.');
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.FIREBASE_PROJECT_ID.startsWith('demo-')) throw new Error('The authentication emulator requires a demo- project ID.');
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID, ...(process.env.FIREBASE_AUTH_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  }
  return getAuth();
}
