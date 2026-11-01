import { createClient } from '@supabase/supabase-js';
import { verifyFirebaseIdTokenServerSide } from './firebase-claim.js';
import { createSupabaseProfileRepository } from '../../src/services/identityService.js';

export const DEDICATED_GMAIL_SENDER = 'campusresolveai@gmail.com';

export interface WelcomeEmailRequestPayload {
  profileId?: string;
  recipientEmail?: string;
  displayName?: string;
  authProvider?: 'supabase_email' | 'firebase_google';
  actorRole?: string;
}

export type WelcomeEmailDeliveryStatus =
  | 'sent'
  | 'already_sent'
  | 'failed'
  | 'skipped_unconfigured'
  | 'validation_error'
  | 'unauthorized';

export interface WelcomeEmailResponsePayload {
  ok: boolean;
  /**
   * True when the backend accepted and validated the authenticated request.
   */
  requestAccepted: boolean;
  /**
   * True when the Google Apps Script Web App endpoint executed and returned a response.
   */
  appsScriptExecuted: boolean;
  /**
   * True when Google Apps Script MailApp.sendEmail / GmailApp.sendEmail succeeded.
   */
  emailSendApiSucceeded: boolean;
  /**
   * Always false: a successful email sending API call dispatches the message from
   * campusresolveai@gmail.com, but final inbox placement depends on the recipient mail server.
   */
  inboxDeliveryGuaranteed: false;
  senderEmail: string;
  deliveryStatus: WelcomeEmailDeliveryStatus;
  sentAt: string | null;
  failureDetails: string | null;
  message: string;
}

export interface VerifiedCallerProfile {
  id: string;
  verified_email: string;
  display_name: string;
  auth_provider: 'supabase_email' | 'firebase_google';
  actor_role: string;
  account_status: string;
  welcome_email_sent_at: string | null;
}

export interface WelcomeEmailDependencies {
  fetchFn?: typeof fetch;
  verifyCallerProfile?: (
    bearerToken: string,
    expectedProfileId: string
  ) => Promise<{
    verified: boolean;
    profile?: VerifiedCallerProfile;
    errorMessage?: string;
  }>;
}

/**
 * Default server-side identity and profile verifier.
 * Uses the caller's Bearer JWT (Supabase Auth token or Firebase ID token) to query
 * `public.app_profiles` under Supabase PostgreSQL Row Level Security (RLS), ensuring
 * that an unauthenticated browser cannot spoof `profileId` or `recipientEmail`.
 */
const DEFAULT_SUPABASE_URL = 'https://llotsqzeppiltosllxvx.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_JX6Tuki8_uwYBPuQfsGmtA_2eJPoz_W';
const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzt_hRuiMFy_ZYjwAwc5dssY0WOfsallOjV57PocvIKS3dtXOh_5EMa9WLbDhHnrpEs/exec';
const DEFAULT_APPS_SCRIPT_SECRET =
  'CampusResolve_Demo_2026!x9Kp7Lm2Qv8Rt5Wn4Yz6';

async function defaultVerifyCallerProfile(
  bearerToken: string,
  expectedProfileId: string
): Promise<{
  verified: boolean;
  profile?: VerifiedCallerProfile;
  errorMessage?: string;
}> {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL
  ).trim();
  const supabasePublishableKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  ).trim();

  if (
    !supabaseUrl ||
    !supabasePublishableKey ||
    supabaseUrl.includes('your-project-ref')
  ) {
    return {
      verified: false,
      errorMessage:
        'Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) are not configured on the server to verify the caller identity.',
    };
  }

  try {
    const scopedClient = createClient(supabaseUrl, supabasePublishableKey, {
      accessToken: async () => bearerToken,
    });

    const { data, error } = await scopedClient
      .from('app_profiles')
      .select(
        'id, verified_email, display_name, auth_provider, actor_role, account_status, welcome_email_sent_at'
      )
      .eq('id', expectedProfileId)
      .maybeSingle();

    if (!error && data) {
      return {
        verified: true,
        profile: data as VerifiedCallerProfile,
      };
    }

    // Fallback for Firebase Google ID tokens when PostgREST RLS did not match `role: "authenticated"`:
    // Verify the Firebase ID token cryptographically on the server and verify profile ownership by UID + expectedProfileId.
    const serviceRoleKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )
      .trim()
      .replace(/^["']|["']$/g, '');
    if (serviceRoleKey && !serviceRoleKey.includes('your-service-role-key')) {
      try {
        const verifiedFirebase = await verifyFirebaseIdTokenServerSide(
          bearerToken
        );
        const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });

        const { data: fbProfile, error: fbError } = await serviceClient
          .from('app_profiles')
          .select(
            'id, verified_email, display_name, auth_provider, actor_role, account_status, welcome_email_sent_at'
          )
          .eq('id', expectedProfileId)
          .eq('auth_provider', 'firebase_google')
          .eq('provider_subject', verifiedFirebase.uid)
          .maybeSingle();

        if (!fbError && fbProfile) {
          return {
            verified: true,
            profile: fbProfile as VerifiedCallerProfile,
          };
        }
      } catch {
        // Not a valid Firebase ID token; fall through to standard rejection
      }
    }

    return {
      verified: false,
      errorMessage:
        'Authenticated caller does not own an active profile matching the requested profileId.',
    };
  } catch (err) {
    return {
      verified: false,
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Failed to verify caller profile against Supabase.',
    };
  }
}

async function persistServerWelcomeEmailOutcome(params: {
  profile: VerifiedCallerProfile;
  deliveryStatus: 'sent' | 'failed' | 'skipped_unconfigured';
  sentAtIso: string | null;
  failureDetails: string | null;
  senderEmail: string;
}): Promise<void> {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL
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
    return;
  }

  try {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
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
      sent_at: params.sentAtIso,
    });

    if (params.deliveryStatus === 'sent' && params.sentAtIso) {
      await repo.markWelcomeEmailSent(params.profile.id, params.sentAtIso);
    }
  } catch {
    // Non-fatal: client-side repository also records welcome email status when permitted by RLS
  }
}

function resolveApplicationSignInUrl(
  headers?: Record<string, string | string[] | undefined>
): string {
  const configuredBase = (
    process.env.APPLICATION_BASE_URL ||
    process.env.APP_URL ||
    ''
  ).trim();

  if (
    configuredBase &&
    configuredBase.startsWith('http') &&
    !configuredBase.includes('MY_APP_URL') &&
    !configuredBase.includes('your-application-domain')
  ) {
    return `${configuredBase.replace(/\/+$/, '')}/sign-in`;
  }

  const originRaw = headers?.['origin'] || headers?.['Origin'];
  const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
  if (origin && origin.startsWith('http')) {
    return `${origin.replace(/\/+$/, '')}/sign-in`;
  }

  return 'http://localhost:3000/sign-in';
}

export async function processWelcomeEmailRequest(
  method: string | undefined,
  body: WelcomeEmailRequestPayload | undefined,
  headers?: Record<string, string | string[] | undefined>,
  deps: WelcomeEmailDependencies = {}
): Promise<{ status: number; body: WelcomeEmailResponsePayload }> {
  if (method && method.toUpperCase() !== 'POST') {
    return {
      status: 405,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'validation_error',
        sentAt: null,
        failureDetails: 'Only POST requests are supported for /api/auth/welcome-email.',
        message: 'Only POST requests are supported for /api/auth/welcome-email.',
      },
    };
  }

  // 1. Require authenticated Bearer token from the caller
  const authHeaderRaw =
    headers?.['authorization'] || headers?.['Authorization'];
  const authHeader = Array.isArray(authHeaderRaw)
    ? authHeaderRaw[0]
    : authHeaderRaw;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      status: 401,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'unauthorized',
        sentAt: null,
        failureDetails: 'Missing Authorization Bearer token.',
        message:
          'Authentication required: welcome email requests must include a valid Bearer token.',
      },
    };
  }

  const bearerToken = authHeader.slice('Bearer '.length).trim();
  const requestedProfileId = body?.profileId?.trim() || '';
  const requestedEmail = body?.recipientEmail?.trim().toLowerCase() || '';

  if (
    !bearerToken ||
    !requestedProfileId ||
    !requestedEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(requestedEmail)
  ) {
    return {
      status: 400,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'validation_error',
        sentAt: null,
        failureDetails:
          'Valid Authorization token, profileId, and verified recipientEmail are required.',
        message:
          'Valid Authorization token, profileId, and verified recipientEmail are required.',
      },
    };
  }

  // 2. Verify the caller's identity and profile activation status
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
        deliveryStatus: 'unauthorized',
        sentAt: null,
        failureDetails:
          verification.errorMessage ||
          'Caller identity verification failed.',
        message:
          verification.errorMessage ||
          'Could not verify caller identity or profile ownership.',
      },
    };
  }

  const verifiedProfile = verification.profile;

  if (verifiedProfile.account_status !== 'active') {
    return {
      status: 403,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'unauthorized',
        sentAt: null,
        failureDetails: `Account status is '${verifiedProfile.account_status}', not 'active'.`,
        message: 'Welcome email can only be sent for active accounts.',
      },
    };
  }

  if (
    verifiedProfile.verified_email.trim().toLowerCase() !== requestedEmail
  ) {
    return {
      status: 403,
      body: {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'unauthorized',
        sentAt: null,
        failureDetails:
          'Requested recipientEmail does not match the caller verified_email in public.app_profiles.',
        message:
          'Recipient email mismatch: cannot send welcome email to an address different from the verified profile email.',
      },
    };
  }

  // 3. Check if the profile already has a recorded welcome_email_sent_at timestamp
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
        deliveryStatus: 'already_sent',
        sentAt: verifiedProfile.welcome_email_sent_at,
        failureDetails: null,
        message:
          'Welcome email was already sent for this account. Duplicate send prevented.',
      },
    };
  }

  // 4. Verify server-side Google Apps Script configuration
  const appsScriptUrl = (
    process.env.APPS_SCRIPT_WEB_APP_URL || DEFAULT_APPS_SCRIPT_URL
  ).trim();
  const appsScriptSecret = (
    process.env.APPS_SCRIPT_SHARED_SECRET || DEFAULT_APPS_SCRIPT_SECRET
  ).trim();

  if (
    !appsScriptUrl ||
    !appsScriptSecret ||
    appsScriptUrl.includes('your-deployment-id') ||
    appsScriptSecret.includes('your-high-entropy')
  ) {
    return {
      status: 200,
      body: {
        ok: true,
        requestAccepted: true,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'skipped_unconfigured',
        sentAt: null,
        failureDetails:
          'APPS_SCRIPT_WEB_APP_URL or APPS_SCRIPT_SHARED_SECRET is not configured on the server.',
        message:
          'Welcome email request accepted and logged, but Google Apps Script Web App credentials (APPS_SCRIPT_WEB_APP_URL / APPS_SCRIPT_SHARED_SECRET) are not yet configured on the server. No email was sent.',
      },
    };
  }

  // 5. Invoke the Google Apps Script Web App (campusresolveai@gmail.com)
  const fetchFn = deps.fetchFn || fetch;
  const signInUrl = resolveApplicationSignInUrl(headers);

  try {
    const appsScriptResponse = await fetchFn(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      redirect: 'follow',
      body: JSON.stringify({
        sharedSecret: appsScriptSecret,
        senderEmail: DEDICATED_GMAIL_SENDER,
        profileId: verifiedProfile.id,
        recipientEmail: verifiedProfile.verified_email,
        displayName: verifiedProfile.display_name,
        authProvider: verifiedProfile.auth_provider,
        actorRole: verifiedProfile.actor_role,
        signInUrl,
        idempotencyKey: `welcome_email:${verifiedProfile.id}`,
      }),
    });

    const rawText = await appsScriptResponse.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }

    if (!appsScriptResponse.ok || !parsed || parsed.ok !== true) {
      const errDetail =
        parsed?.message ||
        rawText.slice(0, 240) ||
        `Apps Script returned HTTP ${appsScriptResponse.status}`;
      return {
        status: 502,
        body: {
          ok: false,
          requestAccepted: true,
          appsScriptExecuted: Boolean(parsed?.appsScriptExecuted),
          emailSendApiSucceeded: false,
          inboxDeliveryGuaranteed: false,
          senderEmail: DEDICATED_GMAIL_SENDER,
          deliveryStatus: 'failed',
          sentAt: null,
          failureDetails: errDetail,
          message: `Google Apps Script welcome email failed: ${errDetail}`,
        },
      };
    }

    const alreadySentByScript = Boolean(parsed.alreadySent);
    const apiSucceeded = Boolean(parsed.emailSendApiSucceeded);
    const sentAtIso = parsed.sentAt || new Date().toISOString();

    if (!deps.verifyCallerProfile) {
      await persistServerWelcomeEmailOutcome({
        profile: verifiedProfile,
        deliveryStatus: 'sent',
        sentAtIso,
        failureDetails: null,
        senderEmail: parsed.senderEmail || DEDICATED_GMAIL_SENDER,
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
        deliveryStatus: alreadySentByScript ? 'already_sent' : 'sent',
        sentAt: sentAtIso,
        failureDetails: null,
        message: alreadySentByScript
          ? 'Welcome email was already sent for this account.'
          : 'Your welcome email has been sent successfully.',
      },
    };
  } catch (error) {
    const errMessage =
      error instanceof Error
        ? error.message
        : 'Network error communicating with Google Apps Script Web App.';
    return {
      status: 502,
      body: {
        ok: false,
        requestAccepted: true,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_GMAIL_SENDER,
        deliveryStatus: 'failed',
        sentAt: null,
        failureDetails: errMessage,
        message: 'Unable to send welcome email at this time.',
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
            requestAccepted: false,
            appsScriptExecuted: false,
            emailSendApiSucceeded: false,
            inboxDeliveryGuaranteed: false,
            senderEmail: DEDICATED_GMAIL_SENDER,
            deliveryStatus: 'failed',
            sentAt: null,
            failureDetails: 'Failed writing server response',
            message: 'Unable to process welcome email request at this time.',
          })
        );
      } catch {
        // Socket closed
      }
    }
  };

  try {
    const method = (req.method || 'GET').toUpperCase();
    let parsedBody = req.body;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      parsedBody = undefined;
    } else if (typeof parsedBody === 'string' && parsedBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        parsedBody = undefined;
      }
    } else if (parsedBody === undefined && typeof req.on === 'function' && !req.readableEnded) {
      const contentLength = req.headers?.['content-length'];
      const hasBody =
        (contentLength && parseInt(contentLength, 10) > 0) ||
        Boolean(req.headers?.['transfer-encoding']);

      if (hasBody) {
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
      deliveryStatus: 'failed',
      sentAt: null,
      failureDetails: err instanceof Error ? err.message : 'Unexpected server error',
      message: 'Unable to process welcome email request at this time.',
    });
  }
}

