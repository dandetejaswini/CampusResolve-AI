// api/auth/welcome-email.ts
import { createClient as createClient2 } from "@supabase/supabase-js";

// api/auth/firebase-claim.js
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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

// src/services/identityService.ts
var IdentityResolutionError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IdentityResolutionError";
    this.code = code;
  }
};
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

// api/auth/welcome-email.ts
var DEDICATED_GMAIL_SENDER = "campusresolveai@gmail.com";
var DEFAULT_SUPABASE_URL = "https://llotsqzeppiltosllxvx.supabase.co";
var DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JX6Tuki8_uwYBPuQfsGmtA_2eJPoz_W";
var DEFAULT_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzt_hRuiMFy_ZYjwAwc5dssY0WOfsallOjV57PocvIKS3dtXOh_5EMa9WLbDhHnrpEs/exec";
var DEFAULT_APPS_SCRIPT_SECRET = "CampusResolve_Demo_2026!x9Kp7Lm2Qv8Rt5Wn4Yz6";
async function defaultVerifyCallerProfile(bearerToken, expectedProfileId) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const supabasePublishableKey = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY).trim();
  if (!supabaseUrl || !supabasePublishableKey || supabaseUrl.includes("your-project-ref")) {
    return {
      verified: false,
      errorMessage: "Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) are not configured on the server to verify the caller identity."
    };
  }
  try {
    const scopedClient = createClient2(supabaseUrl, supabasePublishableKey, {
      accessToken: async () => bearerToken
    });
    const { data, error } = await scopedClient.from("app_profiles").select(
      "id, verified_email, display_name, auth_provider, actor_role, account_status, welcome_email_sent_at"
    ).eq("id", expectedProfileId).maybeSingle();
    if (!error && data) {
      return {
        verified: true,
        profile: data
      };
    }
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "");
    if (serviceRoleKey && !serviceRoleKey.includes("your-service-role-key")) {
      try {
        const verifiedFirebase = await verifyFirebaseIdTokenServerSide(
          bearerToken
        );
        const serviceClient = createClient2(supabaseUrl, serviceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        });
        const { data: fbProfile, error: fbError } = await serviceClient.from("app_profiles").select(
          "id, verified_email, display_name, auth_provider, actor_role, account_status, welcome_email_sent_at"
        ).eq("id", expectedProfileId).eq("auth_provider", "firebase_google").eq("provider_subject", verifiedFirebase.uid).maybeSingle();
        if (!fbError && fbProfile) {
          return {
            verified: true,
            profile: fbProfile
          };
        }
      } catch {
      }
    }
    return {
      verified: false,
      errorMessage: "Authenticated caller does not own an active profile matching the requested profileId."
    };
  } catch (err) {
    return {
      verified: false,
      errorMessage: err instanceof Error ? err.message : "Failed to verify caller profile against Supabase."
    };
  }
}
async function persistServerWelcomeEmailOutcome(params) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes("your-project-ref") || serviceRoleKey.includes("your-service-role-key")) {
    return;
  }
  try {
    const serviceClient = createClient2(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    const repo = createSupabaseProfileRepository(serviceClient);
    const existingLog = await repo.getWelcomeEmailLog(params.profile.id);
    const nextAttemptCount = (existingLog?.attempt_count ?? 0) + 1;
    await repo.upsertWelcomeEmailLog({
      profile_id: params.profile.id,
      recipient_email: params.profile.verified_email,
      auth_provider: params.profile.auth_provider,
      sender_email: params.senderEmail,
      delivery_status: params.deliveryStatus,
      attempt_count: nextAttemptCount,
      failure_details: params.failureDetails,
      sent_at: params.sentAtIso
    });
    if (params.deliveryStatus === "sent" && params.sentAtIso) {
      await repo.markWelcomeEmailSent(params.profile.id, params.sentAtIso);
    }
  } catch {
  }
}
function resolveApplicationSignInUrl(headers) {
  const configuredBase = (process.env.APPLICATION_BASE_URL || process.env.APP_URL || "").trim();
  if (configuredBase && configuredBase.startsWith("http") && !configuredBase.includes("MY_APP_URL") && !configuredBase.includes("your-application-domain")) {
    return `${configuredBase.replace(/\/+$/, "")}/sign-in`;
  }
  const originRaw = headers?.["origin"] || headers?.["Origin"];
  const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
  if (origin && origin.startsWith("http")) {
    return `${origin.replace(/\/+$/, "")}/sign-in`;
  }
  return "http://localhost:3000/sign-in";
}
async function processWelcomeEmailRequest(method, body, headers, deps = {}) {
  if (method && method.toUpperCase() !== "POST") {
    return {
      status: 405,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "validation_error",
        sentAt: null,
        failureDetails: "Only POST requests are supported for /api/auth/welcome-email.",
        message: "Only POST requests are supported for /api/auth/welcome-email."
      }
    };
  }
  const authHeaderRaw = headers?.["authorization"] || headers?.["Authorization"];
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      status: 401,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "unauthorized",
        sentAt: null,
        failureDetails: "Missing Authorization Bearer token.",
        message: "Authentication required: welcome email requests must include a valid Bearer token."
      }
    };
  }
  const bearerToken = authHeader.slice("Bearer ".length).trim();
  const requestedProfileId = body?.profileId?.trim() || "";
  const requestedEmail = body?.recipientEmail?.trim().toLowerCase() || "";
  if (!bearerToken || !requestedProfileId || !requestedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(requestedEmail)) {
    return {
      status: 400,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "validation_error",
        sentAt: null,
        failureDetails: "Valid Authorization token, profileId, and verified recipientEmail are required.",
        message: "Valid Authorization token, profileId, and verified recipientEmail are required."
      }
    };
  }
  const verifyFn = deps.verifyCallerProfile || defaultVerifyCallerProfile;
  const verification = await verifyFn(bearerToken, requestedProfileId);
  if (!verification.verified || !verification.profile) {
    return {
      status: 403,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "unauthorized",
        sentAt: null,
        failureDetails: verification.errorMessage || "Caller identity verification failed.",
        message: verification.errorMessage || "Could not verify caller identity or profile ownership."
      }
    };
  }
  const verifiedProfile = verification.profile;
  if (verifiedProfile.account_status !== "active") {
    return {
      status: 403,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "unauthorized",
        sentAt: null,
        failureDetails: `Account status is '${verifiedProfile.account_status}', not 'active'.`,
        message: "Welcome email can only be sent for active accounts."
      }
    };
  }
  if (verifiedProfile.verified_email.trim().toLowerCase() !== requestedEmail) {
    return {
      status: 403,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "unauthorized",
        sentAt: null,
        failureDetails: "Requested recipientEmail does not match the caller verified_email in public.app_profiles.",
        message: "Recipient email mismatch: cannot send welcome email to an address different from the verified profile email."
      }
    };
  }
  if (verifiedProfile.welcome_email_sent_at) {
    return {
      status: 200,
      body: {
        ok: true,
        requestAccepted: true,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "already_sent",
        sentAt: verifiedProfile.welcome_email_sent_at,
        failureDetails: null,
        message: "Welcome email was already sent for this account. Duplicate send prevented."
      }
    };
  }
  const appsScriptUrl = (process.env.APPS_SCRIPT_WEB_APP_URL || DEFAULT_APPS_SCRIPT_URL).trim();
  const appsScriptSecret = (process.env.APPS_SCRIPT_SHARED_SECRET || DEFAULT_APPS_SCRIPT_SECRET).trim();
  if (!appsScriptUrl || !appsScriptSecret || appsScriptUrl.includes("your-deployment-id") || appsScriptSecret.includes("your-high-entropy")) {
    return {
      status: 200,
      body: {
        ok: true,
        requestAccepted: true,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "skipped_unconfigured",
        sentAt: null,
        failureDetails: "APPS_SCRIPT_WEB_APP_URL or APPS_SCRIPT_SHARED_SECRET is not configured on the server.",
        message: "Welcome email request accepted and logged, but Google Apps Script Web App credentials (APPS_SCRIPT_WEB_APP_URL / APPS_SCRIPT_SHARED_SECRET) are not yet configured on the server. No email was sent."
      }
    };
  }
  const fetchFn = deps.fetchFn || fetch;
  const signInUrl = resolveApplicationSignInUrl(headers);
  try {
    const appsScriptResponse = await fetchFn(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      redirect: "follow",
      body: JSON.stringify({
        sharedSecret: appsScriptSecret,
        senderEmail: DEDICATED_GMAIL_SENDER,
        profileId: verifiedProfile.id,
        recipientEmail: verifiedProfile.verified_email,
        displayName: verifiedProfile.display_name,
        authProvider: verifiedProfile.auth_provider,
        actorRole: verifiedProfile.actor_role,
        signInUrl,
        idempotencyKey: `welcome_email:${verifiedProfile.id}`
      })
    });
    const rawText = await appsScriptResponse.text();
    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
    if (!appsScriptResponse.ok || !parsed || parsed.ok !== true) {
      const errDetail = parsed?.message || rawText.slice(0, 240) || `Apps Script returned HTTP ${appsScriptResponse.status}`;
      return {
        status: 502,
        body: {
          ok: false,
          requestAccepted: true,
          appsScriptExecuted: Boolean(parsed?.appsScriptExecuted),
          emailSendApiSucceeded: false,
          inboxDeliveryGuaranteed: false,
          senderEmail: DEDICATED_GMAIL_SENDER,
          deliveryStatus: "failed",
          sentAt: null,
          failureDetails: errDetail,
          message: `Google Apps Script welcome email failed: ${errDetail}`
        }
      };
    }
    const alreadySentByScript = Boolean(parsed.alreadySent);
    const apiSucceeded = Boolean(parsed.emailSendApiSucceeded);
    const sentAtIso = parsed.sentAt || (/* @__PURE__ */ new Date()).toISOString();
    if (!deps.verifyCallerProfile) {
      await persistServerWelcomeEmailOutcome({
        profile: verifiedProfile,
        deliveryStatus: "sent",
        sentAtIso,
        failureDetails: null,
        senderEmail: parsed.senderEmail || DEDICATED_GMAIL_SENDER
      });
    }
    return {
      status: 200,
      body: {
        ok: true,
        requestAccepted: true,
        appsScriptExecuted: true,
        emailSendApiSucceeded: apiSucceeded,
        inboxDeliveryGuaranteed: false,
        senderEmail: parsed.senderEmail || DEDICATED_GMAIL_SENDER,
        deliveryStatus: alreadySentByScript ? "already_sent" : "sent",
        sentAt: sentAtIso,
        failureDetails: null,
        message: alreadySentByScript ? "Welcome email was already sent for this account." : "Your welcome email has been sent successfully."
      }
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : "Network error communicating with Google Apps Script Web App.";
    return {
      status: 502,
      body: {
        ok: false,
        requestAccepted: true,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: "failed",
        sentAt: null,
        failureDetails: errMessage,
        message: "Unable to send welcome email at this time."
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
            requestAccepted: false,
            appsScriptExecuted: false,
            emailSendApiSucceeded: false,
            inboxDeliveryGuaranteed: false,
            senderEmail: DEDICATED_GMAIL_SENDER,
            deliveryStatus: "failed",
            sentAt: null,
            failureDetails: "Failed writing server response",
            message: "Unable to process welcome email request at this time."
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
    const result = await processWelcomeEmailRequest(
      req.method,
      parsedBody,
      req.headers || {}
    );
    sendResponse(result.status, result.body);
  } catch (err) {
    sendResponse(500, {
      ok: false,
      requestAccepted: false,
      appsScriptExecuted: false,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      senderEmail: DEDICATED_GMAIL_SENDER,
      deliveryStatus: "failed",
      sentAt: null,
      failureDetails: err instanceof Error ? err.message : "Unexpected server error",
      message: "Unable to process welcome email request at this time."
    });
  }
}
export {
  DEDICATED_GMAIL_SENDER,
  handler as default,
  processWelcomeEmailRequest
};
