import 'server-only';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin (Firestore) initialization — server only.
 *
 * Persistence backend for Clasp. Two ways to configure:
 *  - Production: service-account env vars (FIREBASE_PROJECT_ID / _CLIENT_EMAIL /
 *    _PRIVATE_KEY).
 *  - Local/CI: the Firestore emulator, auto-detected via FIRESTORE_EMULATOR_HOST.
 *
 * When neither is set, the app falls back to the in-memory repository so the UI
 * is fully explorable without any Firebase setup.
 */

let _db: Firestore | null = null;

export function firebaseConfigured(): boolean {
  return !!(
    process.env.FIRESTORE_EMULATOR_HOST ||
    (process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY)
  );
}

export function db(): Firestore {
  if (_db) return _db;
  if (!getApps().length) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      // Emulator needs only a project id; the admin SDK auto-routes to it.
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'clasp-local' });
    } else {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Vercel stores the key with literal \n — normalize to real newlines.
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
  }
  _db = getFirestore();
  _db.settings({ ignoreUndefinedProperties: true });
  return _db;
}
