// server-api/auth/firebase-claim.ts
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// src/types/domain.ts
var ActorRole = /* @__PURE__ */ ((ActorRole2) => {
  ActorRole2["Learner"] = "learner";
  ActorRole2["Instructor"] = "instructor";
  ActorRole2["AcademicAdministrator"] = "academic_administrator";
  ActorRole2["SupportStaff"] = "support_staff";
  ActorRole2["PlatformAdministrator"] = "platform_administrator";
  return ActorRole2;
})(ActorRole || {});

// src/utils/validation.ts
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(email) {
  return EMAIL_REGEX.test(email.trim());
}

// src/services/identityService.ts
var IdentityResolutionError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IdentityResolutionError";
    this.code = code;
  }
};
function sanitizeRequestedRoleNote(rawRole) {
  if (!rawRole) return null;
  const normalized = rawRole.trim().toLowerCase();
  if (!normalized || normalized === "learner" /* Learner */) {
    return null;
  }
  const validRoles = Object.values(ActorRole);
  if (validRoles.includes(normalized)) {
    return `Requested institutional role review: ${normalized}`;
  }
  return normalized.slice(0, 120);
}
async function resolveOrCreateAppProfile(input, repo) {
  const providerSubject = input.providerSubject?.trim();
  const normalizedEmail = input.email?.trim().toLowerCase();
  if (!providerSubject || !normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new IdentityResolutionError(
      "INVALID_IDENTITY_PAYLOAD",
      "Authenticated identity is missing a valid provider subject or institutional email address."
    );
  }
  if (input.authProvider !== "supabase_email" && input.authProvider !== "firebase_google") {
    throw new IdentityResolutionError(
      "INVALID_IDENTITY_PAYLOAD",
      "Unsupported authentication provider."
    );
  }
  if (!input.emailVerified) {
    throw new IdentityResolutionError(
      "EMAIL_NOT_VERIFIED",
      "Please verify your email address before accessing the CampusResolve AI workspace."
    );
  }
  const existingBySubject = await repo.findByProviderIdentity(
    input.authProvider,
    providerSubject
  );
  if (existingBySubject) {
    if (existingBySubject.account_status === "suspended") {
      throw new IdentityResolutionError(
        "ACCOUNT_SUSPENDED",
        "This institutional account has been suspended by an administrator."
      );
    }
    return { profile: existingBySubject, isNewProfile: false };
  }
  const existingByEmail = await repo.findByVerifiedEmail(normalizedEmail);
  if (existingByEmail) {
    const existingProviderLabel = existingByEmail.auth_provider === "firebase_google" ? "Google Sign-In" : "Institutional Email & Password";
    throw new IdentityResolutionError(
      "CROSS_PROVIDER_EMAIL_CONFLICT",
      `An account for ${normalizedEmail} is already registered using ${existingProviderLabel}. For security, accounts are not automatically merged across authentication providers. Please sign in using ${existingProviderLabel}.`
    );
  }
  const fallbackName = normalizedEmail.split("@")[0] || "Institutional User";
  const displayName = input.displayName && input.displayName.trim().length >= 2 ? input.displayName.trim() : fallbackName;
  const department = input.department && input.department.trim().length >= 2 ? input.department.trim() : "Unassigned Academic Unit";
  const requestedRoleNote = sanitizeRequestedRoleNote(input.requestedRoleNote);
  const created = await repo.createProfile({
    auth_provider: input.authProvider,
    provider_subject: providerSubject,
    verified_email: normalizedEmail,
    display_name: displayName,
    actor_role: "learner" /* Learner */,
    department,
    office_or_cohort: null,
    requested_role_note: requestedRoleNote,
    account_status: "active"
  });
  return { profile: created, isNewProfile: true };
}
async function updateOwnAppProfile(currentProfile, updates, repo) {
  const trimmedName = updates.displayName?.trim() || "";
  const trimmedDept = updates.department?.trim() || "";
  const trimmedOffice = updates.officeOrCohort?.trim() || null;
  if (trimmedName.length < 2) {
    throw new IdentityResolutionError(
      "INVALID_IDENTITY_PAYLOAD",
      "Display name must be at least 2 characters."
    );
  }
  if (trimmedDept.length < 2) {
    throw new IdentityResolutionError(
      "INVALID_IDENTITY_PAYLOAD",
      "Academic department or unit must be at least 2 characters."
    );
  }
  return await repo.updateEditableProfileFields(
    currentProfile.id,
    currentProfile.auth_provider,
    currentProfile.provider_subject,
    {
      display_name: trimmedName,
      department: trimmedDept,
      office_or_cohort: trimmedOffice
    }
  );
}
function createSupabaseProfileRepository(client) {
  return {
    async findByProviderIdentity(authProvider, providerSubject) {
      const { data, error } = await client.from("app_profiles").select("*").eq("auth_provider", authProvider).eq("provider_subject", providerSubject).maybeSingle();
      if (error) {
        if (error.code === "PGRST205" || error.message.includes("Could not find the table 'public.app_profiles'")) {
          throw new IdentityResolutionError(
            "DATABASE_ERROR",
            "The institutional profile directory is temporarily unavailable while database setup completes. Please contact your platform administrator."
          );
        }
        if (error.code === "PGRST301" || error.message.includes("No suitable key or wrong key type")) {
          throw new IdentityResolutionError(
            "DATABASE_ERROR",
            "Unable to verify third-party authentication session with the institutional directory."
          );
        }
        throw new IdentityResolutionError(
          "DATABASE_ERROR",
          "Unable to verify your institutional profile at this time. Please try again."
        );
      }
      return data ?? null;
    },
    async findByVerifiedEmail(email) {
      const { data, error } = await client.from("app_profiles").select("*").ilike("verified_email", email.trim().toLowerCase()).maybeSingle();
      if (error) {
        return null;
      }
      return data ?? null;
    },
    async createProfile(insertData) {
      const { data, error } = await client.from("app_profiles").insert(insertData).select("*").single();
      if (error) {
        if (error.code === "23505" || error.message.toLowerCase().includes("duplicate key")) {
          const concurrentRow = await this.findByProviderIdentity(
            insertData.auth_provider,
            insertData.provider_subject
          ).catch(() => null);
          if (concurrentRow) {
            return concurrentRow;
          }
          throw new IdentityResolutionError(
            "CROSS_PROVIDER_EMAIL_CONFLICT",
            `An institutional account with email ${insertData.verified_email} already exists under another authentication method. Accounts are not silently merged across providers.`
          );
        }
        throw new IdentityResolutionError(
          "DATABASE_ERROR",
          "We could not complete your institutional profile setup right now. Please try signing in again."
        );
      }
      return data;
    },
    async updateEditableProfileFields(profileId, authProvider, providerSubject, updates) {
      const { data, error } = await client.from("app_profiles").update({
        display_name: updates.display_name,
        department: updates.department,
        office_or_cohort: updates.office_or_cohort
      }).eq("id", profileId).eq("auth_provider", authProvider).eq("provider_subject", providerSubject).select("*").single();
      if (error) {
        throw new IdentityResolutionError(
          "DATABASE_ERROR",
          "We could not update your institutional profile attributes right now. Please try again."
        );
      }
      return data;
    },
    async markWelcomeEmailSent(profileId, sentAtIso) {
      const { data, error } = await client.from("app_profiles").update({ welcome_email_sent_at: sentAtIso }).eq("id", profileId).select("*").single();
      if (error) {
        throw new IdentityResolutionError(
          "DATABASE_ERROR",
          `Failed to record welcome email timestamp: ${error.message}`
        );
      }
      return data;
    },
    async getWelcomeEmailLog(profileId) {
      const { data, error } = await client.from("welcome_email_log").select("*").eq("profile_id", profileId).maybeSingle();
      if (error || !data) {
        return null;
      }
      return data;
    },
    async upsertWelcomeEmailLog(entry) {
      const existing = await this.getWelcomeEmailLog(entry.profile_id);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      if (!existing) {
        const { data: data2, error: error2 } = await client.from("welcome_email_log").insert({
          profile_id: entry.profile_id,
          recipient_email: entry.recipient_email,
          email_type: "welcome_email",
          auth_provider: entry.auth_provider,
          sender_email: entry.sender_email,
          delivery_status: entry.delivery_status,
          attempt_count: entry.attempt_count,
          failure_details: entry.failure_details,
          sent_at: entry.sent_at,
          updated_at: nowIso
        }).select("*").single();
        if (error2) {
          throw new IdentityResolutionError(
            "DATABASE_ERROR",
            `Failed to insert welcome email log: ${error2.message}`
          );
        }
        return data2;
      }
      const { data, error } = await client.from("welcome_email_log").update({
        delivery_status: entry.delivery_status,
        attempt_count: entry.attempt_count,
        failure_details: entry.failure_details,
        sent_at: entry.sent_at,
        updated_at: nowIso
      }).eq("profile_id", entry.profile_id).select("*").single();
      if (error) {
        throw new IdentityResolutionError(
          "DATABASE_ERROR",
          `Failed to update welcome email log: ${error.message}`
        );
      }
      return data;
    }
  };
}

// server-api/auth/firebase-claim.ts
var EXPECTED_FIREBASE_PROJECT_ID = "campusresolveai";
var GOOGLE_SECURETOKEN_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
var cachedGoogleCerts = null;
function getExpectedProjectId() {
  return (process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || EXPECTED_FIREBASE_PROJECT_ID).trim();
}
var cachedFirebaseApp = null;
async function getFirebaseAdminAppAsync() {
  if (cachedFirebaseApp) return cachedFirebaseApp;
  try {
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const existing = getApps();
    if (existing.length > 0) {
      cachedFirebaseApp = existing[0];
      return cachedFirebaseApp;
    }
    const projectId = getExpectedProjectId();
    const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || "").trim().replace(/^["']|["']$/g, "");
    const rawPrivateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
    if (!clientEmail || !rawPrivateKey || rawPrivateKey.includes("YOUR_PRIVATE_KEY")) {
      return null;
    }
    const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
    cachedFirebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      }),
      projectId
    });
    return cachedFirebaseApp;
  } catch {
    return null;
  }
}
function getFirebaseAdminApp() {
  return cachedFirebaseApp;
}
var cachedFirebaseAuth = null;
async function getLazyFirebaseAuth() {
  if (cachedFirebaseAuth) return cachedFirebaseAuth;
  try {
    const authModule = await import("firebase-admin/auth");
    cachedFirebaseAuth = authModule;
    return authModule;
  } catch {
    return null;
  }
}
var DEFAULT_SUPABASE_URL = "https://llotsqzeppiltosllxvx.supabase.co";
function createServerServiceRoleProfileRepository() {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes("your-project-ref") || serviceRoleKey.includes("your-service-role-key")) {
    return null;
  }
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  return createSupabaseProfileRepository(serviceClient);
}
async function fetchGoogleSecureTokenCerts(fetchFn = fetch) {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAtMs > now) {
    return cachedGoogleCerts.certs;
  }
  const response = await fetchFn(GOOGLE_SECURETOKEN_CERTS_URL, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(
      `Unable to retrieve Google SecureToken public certificates (HTTP ${response.status}).`
    );
  }
  const certs = await response.json();
  cachedGoogleCerts = {
    certs,
    expiresAtMs: now + 50 * 60 * 1e3
  };
  return certs;
}
async function verifyFirebaseTokenWithGooglePublicCerts(idToken, expectedProjectId = getExpectedProjectId(), fetchFn = fetch) {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new Error("Malformed Firebase ID token structure.");
  }
  const [headerB64, payloadB64, signatureB64] = segments;
  let header;
  let payload;
  try {
    header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf8")
    );
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
  } catch {
    throw new Error("Invalid base64url encoding in Firebase ID token.");
  }
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Unsupported Firebase ID token signature algorithm.");
  }
  const nowSeconds = Math.floor(Date.now() / 1e3);
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  if (exp <= nowSeconds) {
    throw new Error("Firebase ID token has expired.");
  }
  if (iat > nowSeconds + 300) {
    throw new Error("Firebase ID token issued-at timestamp is invalid.");
  }
  const aud = typeof payload.aud === "string" ? payload.aud : "";
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  const iss = typeof payload.iss === "string" ? payload.iss : "";
  if (aud !== expectedProjectId || iss !== expectedIssuer) {
    throw new Error("Firebase ID token audience or issuer does not match project.");
  }
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub || sub.length > 128) {
    throw new Error("Firebase ID token is missing a valid subject (sub) claim.");
  }
  const certs = await fetchGoogleSecureTokenCerts(fetchFn);
  const certificatePem = certs[header.kid];
  if (!certificatePem) {
    throw new Error("No matching Google SecureToken public key found for token kid.");
  }
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureValid = verifier.verify(
    certificatePem,
    Buffer.from(signatureB64, "base64url")
  );
  if (!signatureValid) {
    throw new Error("Firebase ID token cryptographic signature verification failed.");
  }
  return {
    uid: sub,
    email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "",
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name.trim() : void 0,
    aud,
    iss,
    roleClaim: typeof payload.role === "string" ? payload.role : void 0,
    verifiedVia: "google_securetoken_x509"
  };
}
async function verifyFirebaseIdTokenServerSide(idToken, fetchFn = fetch) {
  const expectedProjectId = getExpectedProjectId();
  const adminApp = await getFirebaseAdminAppAsync();
  if (adminApp) {
    try {
      const authMod = await getLazyFirebaseAuth();
      if (authMod?.getAuth) {
        const adminAuth = authMod.getAuth(adminApp);
        const decoded = await adminAuth.verifyIdToken(idToken, true);
        return {
          uid: decoded.uid,
          email: (decoded.email || "").trim().toLowerCase(),
          emailVerified: decoded.email_verified === true,
          name: typeof decoded.name === "string" ? decoded.name.trim() : void 0,
          aud: typeof decoded.aud === "string" ? decoded.aud : expectedProjectId,
          iss: typeof decoded.iss === "string" ? decoded.iss : `https://securetoken.google.com/${expectedProjectId}`,
          roleClaim: typeof decoded.role === "string" ? decoded.role : void 0,
          verifiedVia: "firebase_admin"
        };
      }
    } catch (adminErr) {
      const msg = adminErr instanceof Error ? adminErr.message : "";
      const isTokenInvalidError = msg.includes("id-token-expired") || msg.includes("id-token-revoked") || msg.includes("argument-error");
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
async function processFirebaseClaimRequest(req, deps = {}) {
  if (req.method && req.method.toUpperCase() !== "POST") {
    return {
      status: 405,
      body: {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        message: "Only POST requests are supported for /api/auth/firebase-claim."
      }
    };
  }
  const authHeaderRaw = req.headers["authorization"] || req.headers["Authorization"];
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      status: 401,
      body: {
        ok: false,
        code: "MISSING_BEARER_TOKEN",
        message: "Missing Authorization Bearer Firebase ID token."
      }
    };
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    return {
      status: 401,
      body: {
        ok: false,
        code: "EMPTY_BEARER_TOKEN",
        message: "Provided Authorization Bearer token is empty."
      }
    };
  }
  const expectedProjectId = getExpectedProjectId();
  const adminApp = getFirebaseAdminApp();
  const profileRepo = deps.profileRepo !== void 0 ? deps.profileRepo : createServerServiceRoleProfileRepository();
  if (!adminApp && !profileRepo && !deps.verifyIdTokenFn) {
    return {
      status: 503,
      body: {
        ok: false,
        code: "FIREBASE_ADMIN_NOT_CONFIGURED",
        message: "Google Sign-In profile provisioning is temporarily unavailable on the server. Please sign in with your institutional email and password or contact support."
      }
    };
  }
  let verifiedToken;
  try {
    const verifyFn = deps.verifyIdTokenFn || ((token) => verifyFirebaseIdTokenServerSide(token, deps.fetchFn || fetch));
    verifiedToken = await verifyFn(idToken);
  } catch {
    return {
      status: 401,
      body: {
        ok: false,
        code: "TOKEN_VERIFICATION_FAILED",
        message: "Your Google authentication session could not be verified. Please sign in again."
      }
    };
  }
  if (verifiedToken.aud !== expectedProjectId) {
    return {
      status: 403,
      body: {
        ok: false,
        code: "INVALID_FIREBASE_PROJECT",
        message: "Google authentication token does not match this institutional workspace."
      }
    };
  }
  if (!verifiedToken.email || verifiedToken.emailVerified !== true) {
    return {
      status: 403,
      body: {
        ok: false,
        code: "UNVERIFIED_GOOGLE_EMAIL",
        message: "Your Google account must have a verified email address to sign in."
      }
    };
  }
  let roleClaimAssigned = verifiedToken.roleClaim === "authenticated";
  let alreadyHadRoleClaim = verifiedToken.roleClaim === "authenticated";
  let requiresTokenRefresh = false;
  if (!alreadyHadRoleClaim && adminApp && !deps.verifyIdTokenFn) {
    try {
      const authMod = await getLazyFirebaseAuth();
      if (authMod?.getAuth) {
        const adminAuth = authMod.getAuth(adminApp);
        const userRecord = await adminAuth.getUser(verifiedToken.uid);
        const existingClaims = userRecord.customClaims || {};
        await adminAuth.setCustomUserClaims(verifiedToken.uid, {
          ...existingClaims,
          role: "authenticated"
        });
        roleClaimAssigned = true;
        requiresTokenRefresh = true;
      }
    } catch {
      roleClaimAssigned = false;
    }
  }
  const requestedAction = req.body?.action || "provision_profile";
  if (requestedAction === "claim_only" || !profileRepo) {
    return {
      status: 200,
      body: {
        ok: true,
        uid: verifiedToken.uid,
        projectId: expectedProjectId,
        roleClaimAssigned,
        alreadyHadRoleClaim,
        requiresTokenRefresh,
        message: alreadyHadRoleClaim ? 'Firebase user already carries custom claim role="authenticated".' : roleClaimAssigned ? 'Assigned custom claim role="authenticated" to Firebase user.' : "Verified Firebase Google identity on the server."
      }
    };
  }
  try {
    if (requestedAction === "update_profile") {
      const existingProfile = await profileRepo.findByProviderIdentity(
        "firebase_google",
        verifiedToken.uid
      );
      if (!existingProfile) {
        return {
          status: 404,
          body: {
            ok: false,
            code: "PROFILE_NOT_FOUND",
            message: "Could not locate your institutional profile. Please sign in again."
          }
        };
      }
      if (existingProfile.account_status === "suspended") {
        return {
          status: 403,
          body: {
            ok: false,
            code: "ACCOUNT_SUSPENDED",
            message: "Your institutional profile is currently suspended. Please contact a Platform Administrator."
          }
        };
      }
      const updatedProfile = await updateOwnAppProfile(
        existingProfile,
        {
          displayName: typeof req.body?.displayName === "string" ? req.body.displayName : existingProfile.display_name,
          department: typeof req.body?.department === "string" ? req.body.department : existingProfile.department,
          officeOrCohort: req.body?.officeOrCohort !== void 0 ? req.body.officeOrCohort : existingProfile.office_or_cohort
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
          message: "Institutional profile updated successfully."
        }
      };
    }
    const resolution = await resolveOrCreateAppProfile(
      {
        authProvider: "firebase_google",
        providerSubject: verifiedToken.uid,
        email: verifiedToken.email,
        emailVerified: true,
        displayName: typeof req.body?.displayName === "string" && req.body.displayName.trim().length > 0 ? req.body.displayName.trim() : verifiedToken.name,
        department: typeof req.body?.department === "string" && req.body.department.trim().length > 0 ? req.body.department.trim() : void 0,
        requestedRoleNote: typeof req.body?.requestedRoleNote === "string" ? req.body.requestedRoleNote : null
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
        message: resolution.isNewProfile ? "Institutional profile provisioned successfully." : "Institutional profile verified."
      }
    };
  } catch (err) {
    if (err instanceof IdentityResolutionError) {
      const statusMap = {
        CROSS_PROVIDER_EMAIL_CONFLICT: 409,
        ACCOUNT_SUSPENDED: 403,
        EMAIL_NOT_VERIFIED: 403,
        UNAUTHORIZED_PROFILE_UPDATE: 403,
        INVALID_IDENTITY_PAYLOAD: 400,
        DATABASE_ERROR: 500
      };
      const status = statusMap[err.code] || 400;
      const safeMessage = err.code === "DATABASE_ERROR" ? "We could not complete your institutional profile setup right now. Please try again in a moment." : err.message;
      return {
        status,
        body: {
          ok: false,
          code: err.code,
          message: safeMessage
        }
      };
    }
    return {
      status: 500,
      body: {
        ok: false,
        code: "PROFILE_PROVISIONING_ERROR",
        message: "We could not complete your institutional profile setup right now. Please try again in a moment."
      }
    };
  }
}
async function handler(req, res) {
  const sendResponse = (status, body) => {
    try {
      if (status === 204) {
        if (typeof res.status === "function" && typeof res.end === "function") {
          res.status(204).end();
        } else {
          res.statusCode = 204;
          res.end();
        }
        return;
      }
      if (typeof res.status === "function" && typeof res.json === "function") {
        res.status(status).json(body);
        return;
      }
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    } catch {
      try {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: false,
            code: "SERVER_ERROR",
            message: "Failed writing authentication response."
          })
        );
      } catch {
      }
    }
  };
  try {
    const method = (req.method || "GET").toUpperCase();
    let parsedBody = req.body;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      parsedBody = void 0;
    } else if (typeof parsedBody === "string" && parsedBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        parsedBody = void 0;
      }
    } else if (parsedBody === void 0 && typeof req.on === "function" && !req.readableEnded) {
      const contentLength = req.headers?.["content-length"];
      const hasBody = contentLength && parseInt(contentLength, 10) > 0 || Boolean(req.headers?.["transfer-encoding"]);
      if (hasBody) {
        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          if (raw.trim().length > 0) {
            parsedBody = JSON.parse(raw);
          }
        } catch {
          parsedBody = void 0;
        }
      }
    }
    const result = await processFirebaseClaimRequest({
      method: req.method,
      headers: req.headers || {},
      body: parsedBody
    });
    sendResponse(result.status, result.body);
  } catch (err) {
    sendResponse(500, {
      ok: false,
      code: "SERVER_ERROR",
      message: err instanceof Error ? err.message : "An unexpected error occurred while verifying your authentication session. Please try again."
    });
  }
}
export {
  EXPECTED_FIREBASE_PROJECT_ID,
  handler as default,
  getFirebaseAdminApp,
  getFirebaseAdminAppAsync,
  getLazyFirebaseAuth,
  processFirebaseClaimRequest,
  verifyFirebaseIdTokenServerSide,
  verifyFirebaseTokenWithGooglePublicCerts
};
