import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  Auth,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFirebaseEnvConfig } from './envConfig';
import type { AppProfile } from '../services/identityService';

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

export interface FirebaseClaimProvisionOptions {
  displayName?: string;
  department?: string;
  officeOrCohort?: string | null;
  requestedRoleNote?: string | null;
}

export interface FirebaseClaimEnsureResult {
  ok: boolean;
  hasAuthenticatedRoleClaim: boolean;
  profile?: AppProfile;
  isNewProfile?: boolean;
  errorCode?: string;
  warningMessage?: string;
}

/**
 * Verifies the signed-in Firebase user's ID token on the server (`/api/auth/firebase-claim`),
 * assigns the `role: "authenticated"` custom claim when Firebase Admin credentials are configured,
 * and provisions or resolves the user's `public.app_profiles` record server-side using the
 * verified token identity.
 */
export async function ensureFirebaseAuthenticatedClaim(
  user: FirebaseUser,
  options?: FirebaseClaimProvisionOptions
): Promise<FirebaseClaimEnsureResult> {
  try {
    const tokenResult = await user.getIdTokenResult(false);
    const rawIdToken = tokenResult.token;

    const response = await fetch('/api/auth/firebase-claim', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rawIdToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'provision_profile',
        displayName: options?.displayName,
        department: options?.department,
        officeOrCohort: options?.officeOrCohort,
        requestedRoleNote: options?.requestedRoleNote,
      }),
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.ok) {
      if (data.requiresTokenRefresh) {
        await user.getIdToken(true);
      }
      const refreshedResult = await user.getIdTokenResult(false);
      return {
        ok: true,
        hasAuthenticatedRoleClaim:
          refreshedResult.claims.role === 'authenticated' ||
          Boolean(data.roleClaimAssigned),
        profile: data.profile as AppProfile | undefined,
        isNewProfile:
          typeof data.isNewProfile === 'boolean' ? data.isNewProfile : undefined,
      };
    }

    return {
      ok: false,
      hasAuthenticatedRoleClaim: tokenResult.claims.role === 'authenticated',
      errorCode: data?.code,
      warningMessage:
        data?.message ||
        'We could not complete your Google Sign-In profile setup at this time. Please try again.',
    };
  } catch {
    const fallbackClaims = await user.getIdTokenResult(false).catch(() => null);
    const hasClaim = fallbackClaims?.claims?.role === 'authenticated';
    return {
      ok: hasClaim,
      hasAuthenticatedRoleClaim: hasClaim,
      warningMessage:
        'Unable to reach the authentication service. Please check your connection and try again.',
    };
  }
}

/**
 * Updates editable institutional profile fields for a Firebase Google user via the
 * server-verified `/api/auth/firebase-claim` endpoint.
 */
export async function updateFirebaseProfileServerSide(
  user: FirebaseUser,
  updates: {
    displayName: string;
    department: string;
    officeOrCohort?: string | null;
  }
): Promise<{
  ok: boolean;
  profile?: AppProfile;
  errorCode?: string;
  message?: string;
}> {
  const rawIdToken = await user.getIdToken(false);
  const response = await fetch('/api/auth/firebase-claim', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rawIdToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'update_profile',
      displayName: updates.displayName,
      department: updates.department,
      officeOrCohort: updates.officeOrCohort,
    }),
  });

  const data = await response.json().catch(() => null);
  if (response.ok && data?.ok && data?.profile) {
    return {
      ok: true,
      profile: data.profile as AppProfile,
      message: data.message,
    };
  }

  return {
    ok: false,
    errorCode: data?.code,
    message:
      data?.message ||
      'We could not update your institutional profile attributes right now. Please try again.',
  };
}
