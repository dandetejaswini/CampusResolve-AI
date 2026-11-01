import crypto from 'node:crypto';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createClient } from '@supabase/supabase-js';
import {
  AppProfile,
  IdentityResolutionError,
  ProfileRepository,
  createSupabaseProfileRepository,
  resolveOrCreateAppProfile,
  updateOwnAppProfile,
} from '../../src/services/identityService.js';

export const EXPECTED_FIREBASE_PROJECT_ID = 'campusresolveai';
const GOOGLE_SECURETOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface VerifiedFirebaseTokenIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  aud: string;
  iss: string;
  roleClaim?: string;
  verifiedVia: 'firebase_admin' | 'google_securetoken_x509';
}

export interface FirebaseClaimRequestBody {
  action?: 'provision_profile' | 'update_profile' | 'claim_only';
  displayName?: string;
  department?: string;
  officeOrCohort?: string | null;
  requestedRoleNote?: string | null;
  /**
   * Untrusted client fields (if ever sent) are explicitly ignored by the server.
   */
  uid?: unknown;
  email?: unknown;
  actorRole?: unknown;
}

export interface FirebaseClaimRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: FirebaseClaimRequestBody;
}

export interface FirebaseClaimResponsePayload {
  ok: boolean;
  uid?: string;
  projectId?: string;
  roleClaimAssigned?: boolean;
  alreadyHadRoleClaim?: boolean;
  requiresTokenRefresh?: boolean;
  profile?: AppProfile;
  isNewProfile?: boolean;
  code?: string;
  message: string;
}

export interface FirebaseClaimDependencies {
  verifyIdTokenFn?: (idToken: string) => Promise<VerifiedFirebaseTokenIdentity>;
  profileRepo?: ProfileRepository | null;
  fetchFn?: typeof fetch;
}

let cachedGoogleCerts: {
  certs: Record<string, string>;
  expiresAtMs: number;
} | null = null;

function getExpectedProjectId(): string {
  return (
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    EXPECTED_FIREBASE_PROJECT_ID
  ).trim();
}

function getFirebaseAdminApp(): App | null {
  try {
    const existing = getApps();
    if (existing.length > 0) {
      return existing[0];
    }

    const projectId = getExpectedProjectId();
    const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const rawPrivateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '')
      .trim()
      .replace(/^["']|["']$/g, '');

    if (
      !clientEmail ||
      !rawPrivateKey ||
      rawPrivateKey.includes('YOUR_PRIVATE_KEY')
    ) {
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
  } catch {
    return null;
  }
}

function createServerServiceRoleProfileRepository(): ProfileRepository | null {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes('your-project-ref') ||
    serviceRoleKey.includes('your-service-role-key')
  ) {
    return null;
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return createSupabaseProfileRepository(serviceClient);
}

async function fetchGoogleSecureTokenCerts(
  fetchFn: typeof fetch = fetch
): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAtMs > now) {
    return cachedGoogleCerts.certs;
  }

  const response = await fetchFn(GOOGLE_SECURETOKEN_CERTS_URL, {
    method: 'GET',
  });
  if (!response.ok) {
    throw new Error(
      `Unable to retrieve Google SecureToken public certificates (HTTP ${response.status}).`
    );
  }

  const certs = (await response.json()) as Record<string, string>;
  cachedGoogleCerts = {
    certs,
    expiresAtMs: now + 50 * 60 * 1000,
  };
  return certs;
}

/**
 * Cryptographically verifies a Firebase ID token against Google's official
 * SecureToken X.509 RSA-SHA256 public certificates and validates all required
 * JWT claims (`alg`, `kid`, `aud`, `iss`, `sub`, `exp`, `iat`).
 */
export async function verifyFirebaseTokenWithGooglePublicCerts(
  idToken: string,
  expectedProjectId: string = getExpectedProjectId(),
  fetchFn: typeof fetch = fetch
): Promise<VerifiedFirebaseTokenIdentity> {
  const segments = idToken.split('.');
  if (segments.length !== 3) {
    throw new Error('Malformed Firebase ID token structure.');
  }

  const [headerB64, payloadB64, signatureB64] = segments;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      Buffer.from(headerB64, 'base64url').toString('utf8')
    ) as { alg?: string; kid?: string };
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid base64url encoding in Firebase ID token.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase ID token signature algorithm.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iat = typeof payload.iat === 'number' ? payload.iat : 0;

  if (exp <= nowSeconds) {
    throw new Error('Firebase ID token has expired.');
  }
  if (iat > nowSeconds + 300) {
    throw new Error('Firebase ID token issued-at timestamp is invalid.');
  }

  const aud = typeof payload.aud === 'string' ? payload.aud : '';
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  const iss = typeof payload.iss === 'string' ? payload.iss : '';

  if (aud !== expectedProjectId || iss !== expectedIssuer) {
    throw new Error('Firebase ID token audience or issuer does not match project.');
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 128) {
    throw new Error('Firebase ID token is missing a valid subject (sub) claim.');
  }

  const certs = await fetchGoogleSecureTokenCerts(fetchFn);
  const certificatePem = certs[header.kid];
  if (!certificatePem) {
    throw new Error('No matching Google SecureToken public key found for token kid.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureValid = verifier.verify(
    certificatePem,
    Buffer.from(signatureB64, 'base64url')
  );

  if (!signatureValid) {
    throw new Error('Firebase ID token cryptographic signature verification failed.');
  }

  return {
    uid: sub,
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name.trim() : undefined,
    aud,
    iss,
    roleClaim: typeof payload.role === 'string' ? payload.role : undefined,
    verifiedVia: 'google_securetoken_x509',
  };
}

/**
 * Verifies a Firebase ID token on the server using Firebase Admin SDK when configured,
 * with a cryptographic fallback to Google's SecureToken X.509 certificates.
 * Never trusts client-supplied user IDs or email addresses.
 */
export async function verifyFirebaseIdTokenServerSide(
  idToken: string,
  fetchFn: typeof fetch = fetch
): Promise<VerifiedFirebaseTokenIdentity> {
  const expectedProjectId = getExpectedProjectId();
  const adminApp = getFirebaseAdminApp();

  if (adminApp) {
    try {
      const adminAuth = getAuth(adminApp);
      const decoded = await adminAuth.verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: (decoded.email || '').trim().toLowerCase(),
        emailVerified: decoded.email_verified === true,
        name:
          typeof (decoded as Record<string, unknown>).name === 'string'
            ? ((decoded as Record<string, unknown>).name as string).trim()
            : undefined,
        aud: typeof decoded.aud === 'string' ? decoded.aud : expectedProjectId,
        iss:
          typeof decoded.iss === 'string'
            ? decoded.iss
            : `https://securetoken.google.com/${expectedProjectId}`,
        roleClaim:
          typeof (decoded as Record<string, unknown>).role === 'string'
            ? ((decoded as Record<string, unknown>).role as string)
            : undefined,
        verifiedVia: 'firebase_admin',
      };
    } catch (adminErr) {
      // If Firebase Admin failed because of service account credential formatting,
      // fall back to Google SecureToken X.509 cryptographic verification.
      const msg = adminErr instanceof Error ? adminErr.message : '';
      const isTokenInvalidError =
        msg.includes('id-token-expired') ||
        msg.includes('id-token-revoked') ||
        msg.includes('argument-error');
      if (isTokenInvalidError) {
        throw adminErr;
      }
    }
  }

  return verifyFirebaseTokenWithGooglePublicCerts(
    idToken,
    expectedProjectId,
    fetchFn
  );
}

export async function processFirebaseClaimRequest(
  req: FirebaseClaimRequest,
  deps: FirebaseClaimDependencies = {}
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

  const authHeaderRaw =
    req.headers['authorization'] || req.headers['Authorization'];
  const authHeader = Array.isArray(authHeaderRaw)
    ? authHeaderRaw[0]
    : authHeaderRaw;

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

  const expectedProjectId = getExpectedProjectId();
  const adminApp = getFirebaseAdminApp();
  const profileRepo =
    deps.profileRepo !== undefined
      ? deps.profileRepo
      : createServerServiceRoleProfileRepository();

  if (!adminApp && !profileRepo && !deps.verifyIdTokenFn) {
    return {
      status: 503,
      body: {
        ok: false,
        code: 'FIREBASE_ADMIN_NOT_CONFIGURED',
        message:
          'Google Sign-In profile provisioning is temporarily unavailable on the server. Please sign in with your institutional email and password or contact support.',
      },
    };
  }

  let verifiedToken: VerifiedFirebaseTokenIdentity;
  try {
    const verifyFn =
      deps.verifyIdTokenFn ||
      ((token: string) =>
        verifyFirebaseIdTokenServerSide(token, deps.fetchFn || fetch));
    verifiedToken = await verifyFn(idToken);
  } catch {
    return {
      status: 401,
      body: {
        ok: false,
        code: 'TOKEN_VERIFICATION_FAILED',
        message:
          'Your Google authentication session could not be verified. Please sign in again.',
      },
    };
  }

  if (verifiedToken.aud !== expectedProjectId) {
    return {
      status: 403,
      body: {
        ok: false,
        code: 'INVALID_FIREBASE_PROJECT',
        message:
          'Google authentication token does not match this institutional workspace.',
      },
    };
  }

  if (!verifiedToken.email || verifiedToken.emailVerified !== true) {
    return {
      status: 403,
      body: {
        ok: false,
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        message: 'Your Google account must have a verified email address to sign in.',
      },
    };
  }

  // Attempt to assign custom claim `role: 'authenticated'` via Firebase Admin SDK if configured
  let roleClaimAssigned = verifiedToken.roleClaim === 'authenticated';
  let alreadyHadRoleClaim = verifiedToken.roleClaim === 'authenticated';
  let requiresTokenRefresh = false;

  if (!alreadyHadRoleClaim && adminApp && !deps.verifyIdTokenFn) {
    try {
      const adminAuth = getAuth(adminApp);
      const userRecord = await adminAuth.getUser(verifiedToken.uid);
      const existingClaims = userRecord.customClaims || {};
      await adminAuth.setCustomUserClaims(verifiedToken.uid, {
        ...existingClaims,
        role: 'authenticated',
      });
      roleClaimAssigned = true;
      requiresTokenRefresh = true;
    } catch {
      // Non-fatal when server-side profile provisioning via service role is active
      roleClaimAssigned = false;
    }
  }

  const requestedAction = req.body?.action || 'provision_profile';

  // If caller explicitly requested claim_only or no server profileRepo is available
  if (requestedAction === 'claim_only' || !profileRepo) {
    return {
      status: 200,
      body: {
        ok: true,
        uid: verifiedToken.uid,
        projectId: expectedProjectId,
        roleClaimAssigned,
        alreadyHadRoleClaim,
        requiresTokenRefresh,
        message: alreadyHadRoleClaim
          ? 'Firebase user already carries custom claim role="authenticated".'
          : roleClaimAssigned
          ? 'Assigned custom claim role="authenticated" to Firebase user.'
          : 'Verified Firebase Google identity on the server.',
      },
    };
  }

  // Server-side profile provisioning or profile update using verified token identity ONLY
  try {
    if (requestedAction === 'update_profile') {
      const existingProfile = await profileRepo.findByProviderIdentity(
        'firebase_google',
        verifiedToken.uid
      );

      if (!existingProfile) {
        return {
          status: 404,
          body: {
            ok: false,
            code: 'PROFILE_NOT_FOUND',
            message:
              'Could not locate your institutional profile. Please sign in again.',
          },
        };
      }

      if (existingProfile.account_status === 'suspended') {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'ACCOUNT_SUSPENDED',
            message:
              'Your institutional profile is currently suspended. Please contact a Platform Administrator.',
          },
        };
      }

      const updatedProfile = await updateOwnAppProfile(
        existingProfile,
        {
          displayName:
            typeof req.body?.displayName === 'string'
              ? req.body.displayName
              : existingProfile.display_name,
          department:
            typeof req.body?.department === 'string'
              ? req.body.department
              : existingProfile.department,
          officeOrCohort:
            req.body?.officeOrCohort !== undefined
              ? req.body.officeOrCohort
              : existingProfile.office_or_cohort,
        },
        profileRepo
      );

      return {
        status: 200,
        body: {
          ok: true,
          uid: verifiedToken.uid,
          projectId: expectedProjectId,
          roleClaimAssigned,
          alreadyHadRoleClaim,
          requiresTokenRefresh,
          profile: updatedProfile,
          isNewProfile: false,
          message: 'Institutional profile updated successfully.',
        },
      };
    }

    const resolution = await resolveOrCreateAppProfile(
      {
        authProvider: 'firebase_google',
        providerSubject: verifiedToken.uid,
        email: verifiedToken.email,
        emailVerified: true,
        displayName:
          typeof req.body?.displayName === 'string' &&
          req.body.displayName.trim().length > 0
            ? req.body.displayName.trim()
            : verifiedToken.name,
        department:
          typeof req.body?.department === 'string' &&
          req.body.department.trim().length > 0
            ? req.body.department.trim()
            : undefined,
        requestedRoleNote:
          typeof req.body?.requestedRoleNote === 'string'
            ? req.body.requestedRoleNote
            : null,
      },
      profileRepo
    );

    return {
      status: 200,
      body: {
        ok: true,
        uid: verifiedToken.uid,
        projectId: expectedProjectId,
        roleClaimAssigned,
        alreadyHadRoleClaim,
        requiresTokenRefresh,
        profile: resolution.profile,
        isNewProfile: resolution.isNewProfile,
        message: resolution.isNewProfile
          ? 'Institutional profile provisioned successfully.'
          : 'Institutional profile verified.',
      },
    };
  } catch (err) {
    if (err instanceof IdentityResolutionError) {
      const statusMap: Record<string, number> = {
        CROSS_PROVIDER_EMAIL_CONFLICT: 409,
        ACCOUNT_SUSPENDED: 403,
        EMAIL_NOT_VERIFIED: 403,
        UNAUTHORIZED_PROFILE_UPDATE: 403,
        INVALID_IDENTITY_PAYLOAD: 400,
        DATABASE_ERROR: 500,
      };
      const status = statusMap[err.code] || 400;
      const safeMessage =
        err.code === 'DATABASE_ERROR'
          ? 'We could not complete your institutional profile setup right now. Please try again in a moment.'
          : err.message;
      return {
        status,
        body: {
          ok: false,
          code: err.code,
          message: safeMessage,
        },
      };
    }

    return {
      status: 500,
      body: {
        ok: false,
        code: 'PROFILE_PROVISIONING_ERROR',
        message:
          'We could not complete your institutional profile setup right now. Please try again in a moment.',
      },
    };
  }
}

// Vercel Serverless Function Default Handler
export default async function handler(req: any, res: any) {
  const sendResponse = (status: number, body: any) => {
    try {
      if (status === 204) {
        if (typeof res.status === 'function' && typeof res.end === 'function') {
          res.status(204).end();
        } else {
          res.statusCode = 204;
          res.end();
        }
        return;
      }
      if (typeof res.status === 'function' && typeof res.json === 'function') {
        res.status(status).json(body);
        return;
      }
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    } catch {
      try {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            ok: false,
            code: 'SERVER_ERROR',
            message: 'Failed writing authentication response.',
          })
        );
      } catch {
        // Socket closed
      }
    }
  };

  try {
    let parsedBody = req.body;
    if (typeof parsedBody === 'string' && parsedBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        parsedBody = undefined;
      }
    } else if (parsedBody === undefined && typeof req.on === 'function') {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.trim().length > 0) {
          parsedBody = JSON.parse(raw);
        }
      } catch {
        parsedBody = undefined;
      }
    }

    const result = await processFirebaseClaimRequest({
      method: req.method,
      headers: req.headers || {},
      body: parsedBody,
    });
    sendResponse(result.status, result.body);
  } catch (err) {
    sendResponse(500, {
      ok: false,
      code: 'SERVER_ERROR',
      message:
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while verifying your authentication session. Please try again.',
    });
  }
}
