import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  Auth,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFirebaseEnvConfig } from './envConfig';

export const EXPECTED_FIREBASE_PROJECT_ID = 'campusresolveai';
export const EXPECTED_FIREBASE_PROJECT_NUMBER = '671221539968';

let firebaseAppInstance: FirebaseApp | null = null;
let firebaseAuthInstance: Auth | null = null;

/**
 * Initializes Firebase strictly for Google Authentication against
 * the existing Firebase project (`campusresolveai`, project number `671221539968`).
 */
export function getFirebaseAuthClient(): {
  app: FirebaseApp;
  auth: Auth;
  googleProvider: GoogleAuthProvider;
} | null {
  const config = getFirebaseEnvConfig();
  if (!config.isConfigured) {
    return null;
  }

  if (!firebaseAppInstance) {
    const existingApps = getApps();
    firebaseAppInstance =
      existingApps.length > 0
        ? existingApps[0]
        : initializeApp({
            apiKey: config.apiKey,
            authDomain: config.authDomain,
            projectId: config.projectId,
            storageBucket: config.storageBucket,
            messagingSenderId: config.messagingSenderId,
            appId: config.appId,
          });
  }

  if (!firebaseAuthInstance) {
    firebaseAuthInstance = getAuth(firebaseAppInstance);
  }

  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: 'select_account',
  });

  return {
    app: firebaseAppInstance,
    auth: firebaseAuthInstance,
    googleProvider,
  };
}

export interface FirebaseClaimEnsureResult {
  hasAuthenticatedRoleClaim: boolean;
  warningMessage?: string;
}

/**
 * Ensures the signed-in Firebase user carries the `role: "authenticated"` custom claim
 * required by Supabase Third-Party Auth so PostgreSQL Row Level Security runs under
 * the `authenticated` role.
 *
 * 1. Inspects the current ID token claims. If `role === "authenticated"` is already present
 *    (e.g., via Firebase Blocking Function or a previous login), returns immediately.
 * 2. Otherwise, calls `/api/auth/firebase-claim` (server-side Firebase Admin SDK) which
 *    works on the Firebase free Spark plan without requiring GCIP blocking functions,
 *    and forces an ID token refresh (`getIdToken(true)`).
 */
export async function ensureFirebaseAuthenticatedClaim(
  user: FirebaseUser
): Promise<FirebaseClaimEnsureResult> {
  try {
    const tokenResult = await user.getIdTokenResult(false);
    if (tokenResult.claims.role === 'authenticated') {
      return { hasAuthenticatedRoleClaim: true };
    }

    const rawIdToken = tokenResult.token;
    const response = await fetch('/api/auth/firebase-claim', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rawIdToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.ok) {
      if (data.requiresTokenRefresh) {
        await user.getIdToken(true);
      }
      const refreshedResult = await user.getIdTokenResult(false);
      return {
        hasAuthenticatedRoleClaim: refreshedResult.claims.role === 'authenticated',
      };
    }

    return {
      hasAuthenticatedRoleClaim: false,
      warningMessage:
        data?.message ||
        'Firebase ID token does not yet contain role="authenticated". Configure Firebase Admin credentials or the Supabase Third-Party Auth role claim for RLS access.',
    };
  } catch (error) {
    return {
      hasAuthenticatedRoleClaim: false,
      warningMessage:
        error instanceof Error
          ? error.message
          : 'Unable to verify Firebase custom role claim.',
    };
  }
}
