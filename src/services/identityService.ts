import type { SupabaseClient } from '@supabase/supabase-js';
import { ActorRole } from '../types/domain';
import { isValidEmail } from '../utils/validation';

export type AuthProviderType = 'supabase_email' | 'firebase_google';
export type AccountStatus = 'pending_verification' | 'active' | 'suspended';

export type EmailLogDeliveryStatus =
  | 'pending'
  | 'request_accepted'
  | 'apps_script_succeeded'
  | 'sent'
  | 'failed'
  | 'skipped_unconfigured';

export interface AppProfile {
  id: string;
  auth_provider: AuthProviderType;
  provider_subject: string;
  verified_email: string;
  display_name: string;
  actor_role: ActorRole;
  department: string;
  office_or_cohort: string | null;
  requested_role_note: string | null;
  account_status: AccountStatus;
  welcome_email_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderIdentityInput {
  authProvider: AuthProviderType;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  department?: string;
  requestedRoleNote?: string | null;
}

export interface ProfileUpdateInput {
  displayName: string;
  department: string;
  officeOrCohort?: string | null;
}

export type IdentityErrorCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'INVALID_IDENTITY_PAYLOAD'
  | 'CROSS_PROVIDER_EMAIL_CONFLICT'
  | 'DUPLICATE_ACCOUNT'
  | 'ACCOUNT_SUSPENDED'
  | 'UNAUTHORIZED_PROFILE_UPDATE'
  | 'DATABASE_ERROR';

export class IdentityResolutionError extends Error {
  public readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message: string) {
    super(message);
    this.name = 'IdentityResolutionError';
    this.code = code;
  }
}

export interface WelcomeEmailLogRecord {
  id: string;
  profile_id: string;
  recipient_email: string;
  email_type: 'welcome_email';
  auth_provider: AuthProviderType;
  sender_email: string;
  delivery_status: EmailLogDeliveryStatus;
  attempt_count: number;
  failure_details: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface ProfileRepository {
  findByProviderIdentity(
    authProvider: AuthProviderType,
    providerSubject: string
  ): Promise<AppProfile | null>;
  findByVerifiedEmail(email: string): Promise<AppProfile | null>;
  createProfile(insertData: {
    auth_provider: AuthProviderType;
    provider_subject: string;
    verified_email: string;
    display_name: string;
    actor_role: ActorRole.Learner;
    department: string;
    office_or_cohort: string | null;
    requested_role_note: string | null;
    account_status: 'active';
  }): Promise<AppProfile>;
  updateEditableProfileFields(
    profileId: string,
    authProvider: AuthProviderType,
    providerSubject: string,
    updates: {
      display_name: string;
      department: string;
      office_or_cohort: string | null;
    }
  ): Promise<AppProfile>;
  markWelcomeEmailSent(
    profileId: string,
    sentAtIso: string
  ): Promise<AppProfile>;
  getWelcomeEmailLog(profileId: string): Promise<WelcomeEmailLogRecord | null>;
  upsertWelcomeEmailLog(entry: {
    profile_id: string;
    recipient_email: string;
    auth_provider: AuthProviderType;
    sender_email: string;
    delivery_status: EmailLogDeliveryStatus;
    attempt_count: number;
    failure_details: string | null;
    sent_at: string | null;
  }): Promise<WelcomeEmailLogRecord>;
}

/**
 * Sanitizes a user-supplied requested role note during Sign Up.
 * Users can NEVER self-promote to elevated roles (`instructor`, `academic_administrator`,
 * `support_staff`, `platform_administrator`) from the frontend. Their selection is stored
 * strictly as an unprivileged administrative request note (`requested_role_note`).
 */
export function sanitizeRequestedRoleNote(rawRole?: string | null): string | null {
  if (!rawRole) return null;
  const normalized = rawRole.trim().toLowerCase();
  if (!normalized || normalized === ActorRole.Learner) {
    return null;
  }
  const validRoles = Object.values(ActorRole) as string[];
  if (validRoles.includes(normalized)) {
    return `Requested institutional role review: ${normalized}`;
  }
  return normalized.slice(0, 120);
}

/**
 * Resolves an existing `AppProfile` or safely provisions a new one for an authenticated
 * Supabase Email/Password user (UUID subject) or Firebase Google user (Firebase UID subject).
 */
export async function resolveOrCreateAppProfile(
  input: ProviderIdentityInput,
  repo: ProfileRepository
): Promise<{ profile: AppProfile; isNewProfile: boolean }> {
  const providerSubject = input.providerSubject?.trim();
  const normalizedEmail = input.email?.trim().toLowerCase();

  if (!providerSubject || !normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new IdentityResolutionError(
      'INVALID_IDENTITY_PAYLOAD',
      'Authenticated identity is missing a valid provider subject or institutional email address.'
    );
  }

  if (
    input.authProvider !== 'supabase_email' &&
    input.authProvider !== 'firebase_google'
  ) {
    throw new IdentityResolutionError(
      'INVALID_IDENTITY_PAYLOAD',
      'Unsupported authentication provider.'
    );
  }

  if (!input.emailVerified) {
    throw new IdentityResolutionError(
      'EMAIL_NOT_VERIFIED',
      'Please verify your email address before accessing the CampusResolve AI workspace.'
    );
  }

  // 1. Look up by authoritative (auth_provider, provider_subject) pair
  const existingBySubject = await repo.findByProviderIdentity(
    input.authProvider,
    providerSubject
  );

  if (existingBySubject) {
    if (existingBySubject.account_status === 'suspended') {
      throw new IdentityResolutionError(
        'ACCOUNT_SUSPENDED',
        'This institutional account has been suspended by an administrator.'
      );
    }
    return { profile: existingBySubject, isNewProfile: false };
  }

  // 2. Check if another profile already claims this verified email address
  const existingByEmail = await repo.findByVerifiedEmail(normalizedEmail);
  if (existingByEmail) {
    const existingProviderLabel =
      existingByEmail.auth_provider === 'firebase_google'
        ? 'Google Sign-In'
        : 'Institutional Email & Password';

    throw new IdentityResolutionError(
      'CROSS_PROVIDER_EMAIL_CONFLICT',
      `An account for ${normalizedEmail} is already registered using ${existingProviderLabel}. For security, accounts are not automatically merged across authentication providers. Please sign in using ${existingProviderLabel}.`
    );
  }

  // 3. Provision a new profile with safe default least-privilege role ('learner')
  const fallbackName = normalizedEmail.split('@')[0] || 'Institutional User';
  const displayName =
    input.displayName && input.displayName.trim().length >= 2
      ? input.displayName.trim()
      : fallbackName;
  const department =
    input.department && input.department.trim().length >= 2
      ? input.department.trim()
      : 'Unassigned Academic Unit';
  const requestedRoleNote = sanitizeRequestedRoleNote(input.requestedRoleNote);

  const created = await repo.createProfile({
    auth_provider: input.authProvider,
    provider_subject: providerSubject,
    verified_email: normalizedEmail,
    display_name: displayName,
    actor_role: ActorRole.Learner,
    department,
    office_or_cohort: null,
    requested_role_note: requestedRoleNote,
    account_status: 'active',
  });

  return { profile: created, isNewProfile: true };
}

/**
 * Safely updates only the user-editable metadata fields (`display_name`, `department`,
 * `office_or_cohort`) for the currently authenticated user.
 */
export async function updateOwnAppProfile(
  currentProfile: AppProfile,
  updates: ProfileUpdateInput,
  repo: ProfileRepository
): Promise<AppProfile> {
  const trimmedName = updates.displayName?.trim() || '';
  const trimmedDept = updates.department?.trim() || '';
  const trimmedOffice = updates.officeOrCohort?.trim() || null;

  if (trimmedName.length < 2) {
    throw new IdentityResolutionError(
      'INVALID_IDENTITY_PAYLOAD',
      'Display name must be at least 2 characters.'
    );
  }

  if (trimmedDept.length < 2) {
    throw new IdentityResolutionError(
      'INVALID_IDENTITY_PAYLOAD',
      'Academic department or unit must be at least 2 characters.'
    );
  }

  return await repo.updateEditableProfileFields(
    currentProfile.id,
    currentProfile.auth_provider,
    currentProfile.provider_subject,
    {
      display_name: trimmedName,
      department: trimmedDept,
      office_or_cohort: trimmedOffice,
    }
  );
}

export interface WelcomeEmailTriggerOptions {
  bearerToken: string;
  fetchFn?: typeof fetch;
}

export interface WelcomeEmailTriggerResult {
  triggered: boolean;
  requestAccepted: boolean;
  appsScriptExecuted: boolean;
  emailSendApiSucceeded: boolean;
  inboxDeliveryGuaranteed: false;
  reason:
    | 'sent'
    | 'already_sent'
    | 'skipped_unconfigured'
    | 'not_eligible'
    | 'in_flight_duplicate_blocked'
    | 'failed';
  message: string;
  updatedProfile: AppProfile;
}

// In-flight concurrency guard preventing simultaneous duplicate requests for the same profileId
const inFlightWelcomeEmailProfiles = new Set<string>();

/**
 * Triggers a one-time welcome email via the trusted server-side `/api/auth/welcome-email`
 * endpoint backed by Google Apps Script + Gmail (`campusresolveai@gmail.com`).
 *
 * Guarantees:
 * 1. Never sends duplicate emails on repeated login, browser refresh, auth callback repetition,
 *    token refresh, or concurrent invocations.
 * 2. Distinguishes between request accepted, Apps Script execution, email send API success,
 *    and actual inbox delivery (which cannot be guaranteed by an API call).
 * 3. Supports safe retries if a previous attempt failed (`delivery_status = 'failed'`)
 *    without ever re-sending once `delivery_status = 'sent'` or `welcome_email_sent_at` is set.
 */
export async function triggerWelcomeEmailIfEligible(
  profile: AppProfile,
  repo: ProfileRepository,
  options: WelcomeEmailTriggerOptions
): Promise<WelcomeEmailTriggerResult> {
  if (profile.account_status !== 'active') {
    return {
      triggered: false,
      requestAccepted: false,
      appsScriptExecuted: false,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      reason: 'not_eligible',
      message: 'Account is not yet active.',
      updatedProfile: profile,
    };
  }

  if (profile.welcome_email_sent_at) {
    return {
      triggered: false,
      requestAccepted: false,
      appsScriptExecuted: false,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      reason: 'already_sent',
      message: 'Welcome email was already sent for this profile.',
      updatedProfile: profile,
    };
  }

  if (inFlightWelcomeEmailProfiles.has(profile.id)) {
    return {
      triggered: false,
      requestAccepted: false,
      appsScriptExecuted: false,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      reason: 'in_flight_duplicate_blocked',
      message: 'Welcome email dispatch is already in progress for this profile.',
      updatedProfile: profile,
    };
  }

  inFlightWelcomeEmailProfiles.add(profile.id);

  try {
    const existingLog = await repo.getWelcomeEmailLog(profile.id);

    if (existingLog && existingLog.delivery_status === 'sent') {
      const sentTimestamp = existingLog.sent_at || new Date().toISOString();
      const stamped = await repo.markWelcomeEmailSent(
        profile.id,
        sentTimestamp
      );
      return {
        triggered: false,
        requestAccepted: false,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        reason: 'already_sent',
        message: 'Welcome email delivery log already records status="sent".',
        updatedProfile: stamped,
      };
    }

    const nextAttemptCount = existingLog ? existingLog.attempt_count + 1 : 1;
    const fetchFn = options.fetchFn || fetch;

    const response = await fetchFn('/api/auth/welcome-email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profile.id,
        recipientEmail: profile.verified_email,
        displayName: profile.display_name,
        authProvider: profile.auth_provider,
        actorRole: profile.actor_role,
      }),
    });

    const data = await response.json().catch(() => null);
    const requestAccepted = Boolean(data?.requestAccepted);
    const appsScriptExecuted = Boolean(data?.appsScriptExecuted);
    const emailSendApiSucceeded = Boolean(data?.emailSendApiSucceeded);
    const deliveryStatusRaw = data?.deliveryStatus as string | undefined;

    if (
      response.ok &&
      (emailSendApiSucceeded || deliveryStatusRaw === 'already_sent')
    ) {
      const sentAtIso = data?.sentAt || new Date().toISOString();

      await repo.upsertWelcomeEmailLog({
        profile_id: profile.id,
        recipient_email: profile.verified_email,
        auth_provider: profile.auth_provider,
        sender_email: data?.senderEmail || 'campusresolveai@gmail.com',
        delivery_status: 'sent',
        attempt_count: nextAttemptCount,
        failure_details: null,
        sent_at: sentAtIso,
      });

      const updatedProfile = await repo.markWelcomeEmailSent(
        profile.id,
        sentAtIso
      );

      if (deliveryStatusRaw === 'already_sent') {
        return {
          triggered: false,
          requestAccepted,
          appsScriptExecuted,
          emailSendApiSucceeded: true,
          inboxDeliveryGuaranteed: false,
          reason: 'already_sent',
          message: 'Welcome email was already sent for this account.',
          updatedProfile,
        };
      }

      return {
        triggered: true,
        requestAccepted,
        appsScriptExecuted,
        emailSendApiSucceeded: true,
        inboxDeliveryGuaranteed: false,
        reason: 'sent',
        message: 'Your welcome email has been sent successfully.',
        updatedProfile,
      };
    }

    if (deliveryStatusRaw === 'skipped_unconfigured') {
      await repo.upsertWelcomeEmailLog({
        profile_id: profile.id,
        recipient_email: profile.verified_email,
        auth_provider: profile.auth_provider,
        sender_email: 'campusresolveai@gmail.com',
        delivery_status: 'skipped_unconfigured',
        attempt_count: nextAttemptCount,
        failure_details:
          data?.failureDetails ||
          'APPS_SCRIPT_WEB_APP_URL or APPS_SCRIPT_SHARED_SECRET is not configured on the server.',
        sent_at: null,
      });

      return {
        triggered: false,
        requestAccepted,
        appsScriptExecuted: false,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        reason: 'skipped_unconfigured',
        message:
          data?.message ||
          'Account activated. Welcome email was not sent because Google Apps Script server variables are not yet configured.',
        updatedProfile: profile,
      };
    }

    const failureDetails =
      data?.failureDetails ||
      data?.message ||
      `HTTP ${response.status} from /api/auth/welcome-email`;

    await repo.upsertWelcomeEmailLog({
      profile_id: profile.id,
      recipient_email: profile.verified_email,
      auth_provider: profile.auth_provider,
      sender_email: 'campusresolveai@gmail.com',
      delivery_status: 'failed',
      attempt_count: nextAttemptCount,
      failure_details: failureDetails,
      sent_at: null,
    });

    return {
      triggered: false,
      requestAccepted,
      appsScriptExecuted,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      reason: 'failed',
      message: data?.message || `Welcome email delivery failed: ${failureDetails}`,
      updatedProfile: profile,
    };
  } catch (error) {
    const errMessage =
      error instanceof Error
        ? error.message
        : 'Welcome email dispatch failed.';
    return {
      triggered: false,
      requestAccepted: false,
      appsScriptExecuted: false,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      reason: 'failed',
      message: errMessage,
      updatedProfile: profile,
    };
  } finally {
    inFlightWelcomeEmailProfiles.delete(profile.id);
  }
}

/**
 * Creates a PostgreSQL-backed `ProfileRepository` using a Supabase client
 * (works seamlessly for both Flow A Supabase Auth sessions and Flow B Firebase
 * Third-Party Auth clients using the `accessToken` callback).
 */
export function createSupabaseProfileRepository(
  client: SupabaseClient
): ProfileRepository {
  return {
    async findByProviderIdentity(authProvider, providerSubject) {
      const { data, error } = await client
        .from('app_profiles')
        .select('*')
        .eq('auth_provider', authProvider)
        .eq('provider_subject', providerSubject)
        .maybeSingle();

      if (error) {
        if (
          error.code === 'PGRST205' ||
          error.message.includes("Could not find the table 'public.app_profiles'")
        ) {
          throw new IdentityResolutionError(
            'DATABASE_ERROR',
            'The institutional profile directory is temporarily unavailable while database setup completes. Please contact your platform administrator.'
          );
        }
        if (
          error.code === 'PGRST301' ||
          error.message.includes('No suitable key or wrong key type')
        ) {
          throw new IdentityResolutionError(
            'DATABASE_ERROR',
            'Unable to verify third-party authentication session with the institutional directory.'
          );
        }
        throw new IdentityResolutionError(
          'DATABASE_ERROR',
          'Unable to verify your institutional profile at this time. Please try again.'
        );
      }

      return (data as AppProfile | null) ?? null;
    },

    async findByVerifiedEmail(email) {
      const { data, error } = await client
        .from('app_profiles')
        .select('*')
        .ilike('verified_email', email.trim().toLowerCase())
        .maybeSingle();

      if (error) {
        return null;
      }

      return (data as AppProfile | null) ?? null;
    },

    async createProfile(insertData) {
      const { data, error } = await client
        .from('app_profiles')
        .insert(insertData)
        .select('*')
        .single();

      if (error) {
        if (
          error.code === '23505' ||
          error.message.toLowerCase().includes('duplicate key')
        ) {
          // If a concurrent request for the same (auth_provider, provider_subject) just created the row, return it
          const concurrentRow = await this.findByProviderIdentity(
            insertData.auth_provider,
            insertData.provider_subject
          ).catch(() => null);
          if (concurrentRow) {
            return concurrentRow;
          }

          throw new IdentityResolutionError(
            'CROSS_PROVIDER_EMAIL_CONFLICT',
            `An institutional account with email ${insertData.verified_email} already exists under another authentication method. Accounts are not silently merged across providers.`
          );
        }
        throw new IdentityResolutionError(
          'DATABASE_ERROR',
          `Unable to provision institutional profile in Supabase: ${error.message}`
        );
      }

      return data as AppProfile;
    },

    async updateEditableProfileFields(
      profileId,
      authProvider,
      providerSubject,
      updates
    ) {
      const { data, error } = await client
        .from('app_profiles')
        .update({
          display_name: updates.display_name,
          department: updates.department,
          office_or_cohort: updates.office_or_cohort,
        })
        .eq('id', profileId)
        .eq('auth_provider', authProvider)
        .eq('provider_subject', providerSubject)
        .select('*')
        .single();

      if (error) {
        throw new IdentityResolutionError(
          'DATABASE_ERROR',
          `Failed to update profile attributes: ${error.message}`
        );
      }

      return data as AppProfile;
    },

    async markWelcomeEmailSent(profileId, sentAtIso) {
      const { data, error } = await client
        .from('app_profiles')
        .update({ welcome_email_sent_at: sentAtIso })
        .eq('id', profileId)
        .select('*')
        .single();

      if (error) {
        throw new IdentityResolutionError(
          'DATABASE_ERROR',
          `Failed to record welcome email timestamp: ${error.message}`
        );
      }

      return data as AppProfile;
    },

    async getWelcomeEmailLog(profileId) {
      const { data, error } = await client
        .from('welcome_email_log')
        .select('*')
        .eq('profile_id', profileId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return data as WelcomeEmailLogRecord;
    },

    async upsertWelcomeEmailLog(entry) {
      const existing = await this.getWelcomeEmailLog(entry.profile_id);
      const nowIso = new Date().toISOString();

      if (!existing) {
        const { data, error } = await client
          .from('welcome_email_log')
          .insert({
            profile_id: entry.profile_id,
            recipient_email: entry.recipient_email,
            email_type: 'welcome_email',
            auth_provider: entry.auth_provider,
            sender_email: entry.sender_email,
            delivery_status: entry.delivery_status,
            attempt_count: entry.attempt_count,
            failure_details: entry.failure_details,
            sent_at: entry.sent_at,
            updated_at: nowIso,
          })
          .select('*')
          .single();

        if (error) {
          throw new IdentityResolutionError(
            'DATABASE_ERROR',
            `Failed to insert welcome email log: ${error.message}`
          );
        }
        return data as WelcomeEmailLogRecord;
      }

      const { data, error } = await client
        .from('welcome_email_log')
        .update({
          delivery_status: entry.delivery_status,
          attempt_count: entry.attempt_count,
          failure_details: entry.failure_details,
          sent_at: entry.sent_at,
          updated_at: nowIso,
        })
        .eq('profile_id', entry.profile_id)
        .select('*')
        .single();

      if (error) {
        throw new IdentityResolutionError(
          'DATABASE_ERROR',
          `Failed to update welcome email log: ${error.message}`
        );
      }

      return data as WelcomeEmailLogRecord;
    },
  };
}
