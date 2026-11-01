import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const EXPECTED_FIREBASE_PROJECT_ID = 'campusresolveai';

export interface FirebaseClaimRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface FirebaseClaimResponsePayload {
  ok: boolean;
  uid?: string;
  projectId?: string;
  roleClaimAssigned?: boolean;
  alreadyHadRoleClaim?: boolean;
  requiresTokenRefresh?: boolean;
  code?: string;
  message: string;
}

function getFirebaseAdminApp(): App | null {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    EXPECTED_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!clientEmail || !rawPrivateKey || rawPrivateKey.includes('YOUR_PRIVATE_KEY')) {
    return null;
  }

  const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

export async function processFirebaseClaimRequest(
  req: FirebaseClaimRequest
): Promise<{ status: number; body: FirebaseClaimResponsePayload }> {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    return {
      status: 405,
      body: {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST requests are supported for /api/auth/firebase-claim.',
      },
    };
  }

  const authHeaderRaw = req.headers['authorization'] || req.headers['Authorization'];
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      status: 401,
      body: {
        ok: false,
        code: 'MISSING_BEARER_TOKEN',
        message: 'Missing Authorization Bearer Firebase ID token.',
      },
    };
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    return {
      status: 401,
      body: {
        ok: false,
        code: 'EMPTY_BEARER_TOKEN',
        message: 'Provided Authorization Bearer token is empty.',
      },
    };
  }

  const adminApp = getFirebaseAdminApp();
  if (!adminApp) {
    return {
      status: 503,
      body: {
        ok: false,
        code: 'FIREBASE_ADMIN_NOT_CONFIGURED',
        message:
          'Server-side Firebase Admin credentials (FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY) are not configured in this environment. To enable automatic role: "authenticated" custom claim assignment for Supabase RLS on the Firebase free Spark plan, configure those server environment variables.',
      },
    };
  }

  try {
    const adminAuth = getAuth(adminApp);
    const decoded = await adminAuth.verifyIdToken(idToken, true);

    if (decoded.aud !== EXPECTED_FIREBASE_PROJECT_ID) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'INVALID_FIREBASE_PROJECT',
          message: `Firebase token audience (${decoded.aud}) does not match expected project '${EXPECTED_FIREBASE_PROJECT_ID}'.`,
        },
      };
    }

    if (!decoded.email || decoded.email_verified !== true) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'UNVERIFIED_GOOGLE_EMAIL',
          message: 'Firebase Google account must have a verified email address.',
        },
      };
    }

    const currentRoleClaim = (decoded as Record<string, unknown>).role;
    if (currentRoleClaim === 'authenticated') {
      return {
        status: 200,
        body: {
          ok: true,
          uid: decoded.uid,
          projectId: EXPECTED_FIREBASE_PROJECT_ID,
          roleClaimAssigned: true,
          alreadyHadRoleClaim: true,
          requiresTokenRefresh: false,
          message: 'Firebase user already carries custom claim role="authenticated".',
        },
      };
    }

    // Preserve any existing custom claims on the user record while setting role: 'authenticated'
    const userRecord = await adminAuth.getUser(decoded.uid);
    const existingClaims = userRecord.customClaims || {};

    await adminAuth.setCustomUserClaims(decoded.uid, {
      ...existingClaims,
      role: 'authenticated',
    });

    return {
      status: 200,
      body: {
        ok: true,
        uid: decoded.uid,
        projectId: EXPECTED_FIREBASE_PROJECT_ID,
        roleClaimAssigned: true,
        alreadyHadRoleClaim: false,
        requiresTokenRefresh: true,
        message:
          'Assigned custom claim role="authenticated" to Firebase user for Supabase Third-Party Auth RLS.',
      },
    };
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : 'Failed to verify Firebase ID token.';
    return {
      status: 401,
      body: {
        ok: false,
        code: 'TOKEN_VERIFICATION_FAILED',
        message: errMessage,
      },
    };
  }
}

// Vercel Serverless Function Default Handler
export default async function handler(req: any, res: any) {
  const result = await processFirebaseClaimRequest({
    method: req.method,
    headers: req.headers || {},
  });
  res.status(result.status).json(result.body);
}
