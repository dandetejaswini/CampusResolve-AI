import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActorRole } from '../types/domain';
import {
  AppProfile,
  IdentityResolutionError,
  ProfileRepository,
  WelcomeEmailLogRecord,
  resolveOrCreateAppProfile,
  sanitizeRequestedRoleNote,
  triggerWelcomeEmailIfEligible,
  updateOwnAppProfile,
} from './identityService';
import {
  processWelcomeEmailRequest,
  DEDICATED_GMAIL_SENDER,
} from '../../api/auth/welcome-email';
import { processFirebaseClaimRequest } from '../../api/auth/firebase-claim';
import { getPublicNavigationItems } from '../components/layout/PublicNavbar';
import { authorizedJsonFetch } from './workspaceClient';

function createInMemoryProfileRepo(): ProfileRepository & {
  profiles: AppProfile[];
  emailLogs: WelcomeEmailLogRecord[];
} {
  const profiles: AppProfile[] = [];
  const emailLogs: WelcomeEmailLogRecord[] = [];

  return {
    profiles,
    emailLogs,
    async findByProviderIdentity(authProvider, providerSubject) {
      return (
        profiles.find(
          (p) =>
            p.auth_provider === authProvider &&
            p.provider_subject === providerSubject
        ) || null
      );
    },
    async findByVerifiedEmail(email) {
      const normalized = email.trim().toLowerCase();
      return (
        profiles.find((p) => p.verified_email.toLowerCase() === normalized) ||
        null
      );
    },
    async createProfile(insertData) {
      const duplicateEmail = profiles.find(
        (p) =>
          p.verified_email.toLowerCase() ===
          insertData.verified_email.toLowerCase()
      );
      if (duplicateEmail) {
        throw new IdentityResolutionError(
          'CROSS_PROVIDER_EMAIL_CONFLICT',
          'Duplicate verified email.'
        );
      }

      const now = new Date().toISOString();
      const record: AppProfile = {
        id: `prof_${profiles.length + 1}`,
        auth_provider: insertData.auth_provider,
        provider_subject: insertData.provider_subject,
        verified_email: insertData.verified_email,
        display_name: insertData.display_name,
        actor_role: insertData.actor_role,
        department: insertData.department,
        office_or_cohort: insertData.office_or_cohort,
        requested_role_note: insertData.requested_role_note,
        account_status: insertData.account_status,
        welcome_email_sent_at: null,
        created_at: now,
        updated_at: now,
      };
      profiles.push(record);
      return record;
    },
    async updateEditableProfileFields(
      profileId,
      authProvider,
      providerSubject,
      updates
    ) {
      const target = profiles.find(
        (p) =>
          p.id === profileId &&
          p.auth_provider === authProvider &&
          p.provider_subject === providerSubject
      );
      if (!target) {
        throw new IdentityResolutionError(
          'UNAUTHORIZED_PROFILE_UPDATE',
          'Profile not found for current provider identity.'
        );
      }
      target.display_name = updates.display_name;
      target.department = updates.department;
      target.office_or_cohort = updates.office_or_cohort;
      target.updated_at = new Date().toISOString();
      return { ...target };
    },
    async markWelcomeEmailSent(profileId, sentAtIso) {
      const target = profiles.find((p) => p.id === profileId);
      if (!target) {
        throw new IdentityResolutionError('DATABASE_ERROR', 'Profile missing.');
      }
      target.welcome_email_sent_at = sentAtIso;
      return { ...target };
    },
    async getWelcomeEmailLog(profileId) {
      return emailLogs.find((e) => e.profile_id === profileId) || null;
    },
    async upsertWelcomeEmailLog(entry) {
      const now = new Date().toISOString();
      const existing = emailLogs.find((e) => e.profile_id === entry.profile_id);
      if (!existing) {
        const created: WelcomeEmailLogRecord = {
          id: `log_${emailLogs.length + 1}`,
          profile_id: entry.profile_id,
          recipient_email: entry.recipient_email,
          email_type: 'welcome_email',
          auth_provider: entry.auth_provider,
          sender_email: entry.sender_email,
          delivery_status: entry.delivery_status,
          attempt_count: entry.attempt_count,
          failure_details: entry.failure_details,
          created_at: now,
          updated_at: now,
          sent_at: entry.sent_at,
        };
        emailLogs.push(created);
        return created;
      }

      existing.delivery_status = entry.delivery_status;
      existing.attempt_count = entry.attempt_count;
      existing.failure_details = entry.failure_details;
      existing.sent_at = entry.sent_at;
      existing.updated_at = now;
      return { ...existing };
    },
  };
}

describe('Phase 2 Unified Identity & Google Apps Script + Gmail Welcome Email Service', () => {
  it('Flow A (Supabase Email/Password): provisions a new Learner profile for a verified Supabase UUID and prevents self-promotion', async () => {
    const repo = createInMemoryProfileRepo();
    const supabaseUuid = '550e8400-e29b-41d4-a716-446655440000';

    const { profile, isNewProfile } = await resolveOrCreateAppProfile(
      {
        authProvider: 'supabase_email',
        providerSubject: supabaseUuid,
        email: 'Elena.Rostova@University.edu',
        emailVerified: true,
        displayName: 'Dr. Elena Rostova',
        department: 'Department of Computer Science',
        requestedRoleNote: ActorRole.PlatformAdministrator,
      },
      repo
    );

    assert.equal(isNewProfile, true);
    assert.equal(profile.auth_provider, 'supabase_email');
    assert.equal(profile.provider_subject, supabaseUuid);
    assert.equal(profile.verified_email, 'elena.rostova@university.edu');
    assert.equal(profile.actor_role, ActorRole.Learner);
    assert.equal(
      profile.requested_role_note,
      'Requested institutional role review: platform_administrator'
    );
    assert.equal(profile.account_status, 'active');
  });

  it('Flow A (Supabase Email/Password): rejects unverified email addresses before workspace access', async () => {
    const repo = createInMemoryProfileRepo();

    await assert.rejects(
      async () => {
        await resolveOrCreateAppProfile(
          {
            authProvider: 'supabase_email',
            providerSubject: '550e8400-e29b-41d4-a716-446655440001',
            email: 'unverified@university.edu',
            emailVerified: false,
            displayName: 'Unverified Student',
          },
          repo
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof IdentityResolutionError);
        assert.equal(err.code, 'EMAIL_NOT_VERIFIED');
        return true;
      }
    );
  });

  it('Flow B (Firebase Google Auth): provisions and resolves a Firebase UID (non-UUID format) without format conflicts', async () => {
    const repo = createInMemoryProfileRepo();
    const firebaseUid = 'fB9xLmP2qR7vWzK8nJ4cT1yH6sD3';

    const firstLogin = await resolveOrCreateAppProfile(
      {
        authProvider: 'firebase_google',
        providerSubject: firebaseUid,
        email: 'marcus.vance@university.edu',
        emailVerified: true,
        displayName: 'Marcus Vance',
      },
      repo
    );

    assert.equal(firstLogin.isNewProfile, true);
    assert.equal(firstLogin.profile.auth_provider, 'firebase_google');
    assert.equal(firstLogin.profile.provider_subject, firebaseUid);
    assert.equal(firstLogin.profile.actor_role, ActorRole.Learner);

    const secondLogin = await resolveOrCreateAppProfile(
      {
        authProvider: 'firebase_google',
        providerSubject: firebaseUid,
        email: 'marcus.vance@university.edu',
        emailVerified: true,
        displayName: 'Marcus Vance',
      },
      repo
    );

    assert.equal(secondLogin.isNewProfile, false);
    assert.equal(secondLogin.profile.id, firstLogin.profile.id);
  });

  it('Cross-Provider Collision Guard: blocks silent merging when a Firebase Google login uses an email already registered via Supabase Email/Password', async () => {
    const repo = createInMemoryProfileRepo();

    await resolveOrCreateAppProfile(
      {
        authProvider: 'supabase_email',
        providerSubject: '11111111-2222-3333-4444-555555555555',
        email: 'shared.scholar@university.edu',
        emailVerified: true,
        displayName: 'Shared Scholar',
        department: 'Mathematics',
      },
      repo
    );

    await assert.rejects(
      async () => {
        await resolveOrCreateAppProfile(
          {
            authProvider: 'firebase_google',
            providerSubject: 'googleUid_987654321',
            email: 'shared.scholar@university.edu',
            emailVerified: true,
            displayName: 'Shared Scholar',
          },
          repo
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof IdentityResolutionError);
        assert.equal(err.code, 'CROSS_PROVIDER_EMAIL_CONFLICT');
        assert.match(err.message, /not automatically merged/i);
        return true;
      }
    );
  });

  it('Profile Update Guard: updates editable fields while keeping role, provider, and verified email immutable', async () => {
    const repo = createInMemoryProfileRepo();
    const { profile } = await resolveOrCreateAppProfile(
      {
        authProvider: 'supabase_email',
        providerSubject: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email: 'student.one@university.edu',
        emailVerified: true,
        displayName: 'Initial Name',
        department: 'Biology',
      },
      repo
    );

    const updated = await updateOwnAppProfile(
      profile,
      {
        displayName: 'Updated Scholar Name',
        department: 'Molecular Biology',
        officeOrCohort: 'Fall 2026 Cohort',
      },
      repo
    );

    assert.equal(updated.display_name, 'Updated Scholar Name');
    assert.equal(updated.department, 'Molecular Biology');
    assert.equal(updated.office_or_cohort, 'Fall 2026 Cohort');
    assert.equal(updated.actor_role, ActorRole.Learner);
    assert.equal(updated.verified_email, 'student.one@university.edu');
  });

  it('Welcome Email Idempotency & Safe Retry: retries after transient failure, then permanently locks after Google Apps Script send succeeds', async () => {
    const repo = createInMemoryProfileRepo();
    const { profile } = await resolveOrCreateAppProfile(
      {
        authProvider: 'firebase_google',
        providerSubject: 'fbUid_welcome_test_01',
        email: 'welcome.user@university.edu',
        emailVerified: true,
        displayName: 'Welcome User',
      },
      repo
    );

    let callNumber = 0;
    const mockFetch = (async () => {
      callNumber += 1;
      if (callNumber === 1) {
        // Simulate first attempt failing due to transient network error
        return new Response(
          JSON.stringify({
            ok: false,
            requestAccepted: true,
            appsScriptExecuted: false,
            emailSendApiSucceeded: false,
            inboxDeliveryGuaranteed: false,
            senderEmail: DEDICATED_GMAIL_SENDER,
            deliveryStatus: 'failed',
            sentAt: null,
            failureDetails: 'Transient timeout reaching Google Apps Script.',
            message: 'Transient timeout.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Second attempt succeeds via Google Apps Script MailApp
      return new Response(
        JSON.stringify({
          ok: true,
          requestAccepted: true,
          appsScriptExecuted: true,
          emailSendApiSucceeded: true,
          inboxDeliveryGuaranteed: false,
          senderEmail: DEDICATED_GMAIL_SENDER,
          deliveryStatus: 'sent',
          sentAt: '2026-10-30T11:00:00.000Z',
          failureDetails: null,
          message:
            'Google Apps Script MailApp.sendEmail succeeded from campusresolveai@gmail.com.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    // Attempt 1: Fails -> recorded with delivery_status='failed', attempt_count=1
    const firstAttempt = await triggerWelcomeEmailIfEligible(profile, repo, {
      bearerToken: 'valid.jwt.token',
      fetchFn: mockFetch,
    });
    assert.equal(firstAttempt.triggered, false);
    assert.equal(firstAttempt.reason, 'failed');
    assert.equal(repo.emailLogs[0].delivery_status, 'failed');
    assert.equal(repo.emailLogs[0].attempt_count, 1);
    assert.equal(firstAttempt.updatedProfile.welcome_email_sent_at, null);

    // Attempt 2 (Safe Retry): Succeeds -> updates log to delivery_status='sent', attempt_count=2
    const secondAttempt = await triggerWelcomeEmailIfEligible(
      firstAttempt.updatedProfile,
      repo,
      {
        bearerToken: 'valid.jwt.token',
        fetchFn: mockFetch,
      }
    );
    assert.equal(secondAttempt.triggered, true);
    assert.equal(secondAttempt.requestAccepted, true);
    assert.equal(secondAttempt.appsScriptExecuted, true);
    assert.equal(secondAttempt.emailSendApiSucceeded, true);
    assert.equal(secondAttempt.inboxDeliveryGuaranteed, false);
    assert.equal(secondAttempt.reason, 'sent');
    assert.equal(repo.emailLogs.length, 1); // Still single row per user
    assert.equal(repo.emailLogs[0].delivery_status, 'sent');
    assert.equal(repo.emailLogs[0].attempt_count, 2);
    assert.equal(repo.emailLogs[0].sender_email, 'campusresolveai@gmail.com');
    assert.ok(secondAttempt.updatedProfile.welcome_email_sent_at);

    // Attempt 3 (Repeated login / refresh): Permanently blocked without calling fetch again
    const thirdAttempt = await triggerWelcomeEmailIfEligible(
      secondAttempt.updatedProfile,
      repo,
      {
        bearerToken: 'valid.jwt.token',
        fetchFn: mockFetch,
      }
    );
    assert.equal(thirdAttempt.triggered, false);
    assert.equal(thirdAttempt.reason, 'already_sent');
    assert.equal(callNumber, 2);
  });

  it('Server Endpoint (/api/auth/welcome-email): enforces Bearer authentication, verifies profile ownership, and authenticates with Google Apps Script', async () => {
    // 1. Rejects unauthenticated request without Authorization Bearer header
    const unauthRes = await processWelcomeEmailRequest(
      'POST',
      {
        profileId: 'prof_1',
        recipientEmail: 'scholar@university.edu',
      },
      {}
    );
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.body.deliveryStatus, 'unauthorized');

    // 2. Rejects mismatched recipientEmail (prevents spoofing another user's email)
    const spoofedRes = await processWelcomeEmailRequest(
      'POST',
      {
        profileId: 'prof_1',
        recipientEmail: 'attacker@other.org',
      },
      { authorization: 'Bearer valid.jwt.token' },
      {
        verifyCallerProfile: async () => ({
          verified: true,
          profile: {
            id: 'prof_1',
            verified_email: 'scholar@university.edu',
            display_name: 'Verified Scholar',
            auth_provider: 'supabase_email',
            actor_role: 'learner',
            account_status: 'active',
            welcome_email_sent_at: null,
          },
        }),
      }
    );
    assert.equal(spoofedRes.status, 403);
    assert.equal(spoofedRes.body.deliveryStatus, 'unauthorized');

    // 3. When verified, invokes Google Apps Script Web App with shared secret and returns structured delivery status
    const mockAppsScriptFetch = (async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          requestAccepted: true,
          appsScriptExecuted: true,
          emailSendApiSucceeded: true,
          inboxDeliveryGuaranteed: false,
          senderEmail: DEDICATED_GMAIL_SENDER,
          sentAt: '2026-10-30T11:30:00.000Z',
          message: 'MailApp.sendEmail succeeded.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const prevUrl = process.env.APPS_SCRIPT_WEB_APP_URL;
    const prevSecret = process.env.APPS_SCRIPT_SHARED_SECRET;
    process.env.APPS_SCRIPT_WEB_APP_URL =
      'https://script.google.com/macros/s/test-deployment/exec';
    process.env.APPS_SCRIPT_SHARED_SECRET =
      'test-shared-secret-minimum-16-chars';

    try {
      const configuredRes = await processWelcomeEmailRequest(
        'POST',
        {
          profileId: 'prof_1',
          recipientEmail: 'scholar@university.edu',
        },
        { authorization: 'Bearer valid.jwt.token' },
        {
          fetchFn: mockAppsScriptFetch,
          verifyCallerProfile: async () => ({
            verified: true,
            profile: {
              id: 'prof_1',
              verified_email: 'scholar@university.edu',
              display_name: 'Verified Scholar',
              auth_provider: 'supabase_email',
              actor_role: 'learner',
              account_status: 'active',
              welcome_email_sent_at: null,
            },
          }),
        }
      );
      assert.equal(configuredRes.status, 200);
      assert.equal(configuredRes.body.requestAccepted, true);
      assert.equal(configuredRes.body.appsScriptExecuted, true);
      assert.equal(configuredRes.body.emailSendApiSucceeded, true);
      assert.equal(configuredRes.body.inboxDeliveryGuaranteed, false);
      assert.equal(configuredRes.body.deliveryStatus, 'sent');
    } finally {
      process.env.APPS_SCRIPT_WEB_APP_URL = prevUrl;
      process.env.APPS_SCRIPT_SHARED_SECRET = prevSecret;
    }

    // 4. Verify Firebase claim endpoint rejects missing token and reports unconfigured admin SDK honestly
    const claimMissingToken = await processFirebaseClaimRequest({
      method: 'POST',
      headers: {},
    });
    assert.equal(claimMissingToken.status, 401);
    assert.equal(claimMissingToken.body.code, 'MISSING_BEARER_TOKEN');
  });

  it('sanitizeRequestedRoleNote: returns null for learner and formats elevated roles as review notes', () => {
    assert.equal(sanitizeRequestedRoleNote(ActorRole.Learner), null);
    assert.equal(sanitizeRequestedRoleNote(''), null);
    assert.equal(
      sanitizeRequestedRoleNote(ActorRole.Instructor),
      'Requested institutional role review: instructor'
    );
  });

  it('Authentication-Aware Public Navigation: shows Sign In when signed out, Open Workspace when signed in, and suppresses Sign In during loading', () => {
    const signedOutLinks = getPublicNavigationItems('unauthenticated', false);
    assert.deepEqual(
      signedOutLinks.map((l) => l.label),
      ['Home', 'About', 'Features', 'Contact', 'Sign In']
    );

    const signedInLinks = getPublicNavigationItems('authenticated', true);
    assert.deepEqual(
      signedInLinks.map((l) => l.label),
      ['Home', 'About', 'Features', 'Contact', 'Open Workspace']
    );
    assert.equal(
      signedInLinks.find((l) => l.label === 'Open Workspace')?.to,
      '/workspace/dashboard'
    );
    assert.equal(
      signedInLinks.some((l) => l.label === 'Sign In'),
      false
    );

    const loadingLinks = getPublicNavigationItems('loading', false);
    assert.deepEqual(
      loadingLinks.map((l) => l.label),
      ['Home', 'About', 'Features', 'Contact']
    );
  });

  it('Workspace Synchronization Safe JSON Parsing: handles non-JSON server error text without throwing SyntaxError', async () => {
    const mockNonJson500Fetch = (async () => {
      return new Response(
        'A server error has occurred\n\nFUNCTION_INVOCATION_FAILED',
        { status: 500, headers: { 'Content-Type': 'text/plain' } }
      );
    }) as unknown as typeof fetch;

    await assert.rejects(
      async () => {
        await authorizedJsonFetch(
          '/api/ops/workspace?action=bootstrap',
          { method: 'GET' },
          mockNonJson500Fetch
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err instanceof SyntaxError, false);
        assert.doesNotMatch(err.message, /Unexpected token/i);
        assert.match(err.message, /temporary server error \(HTTP 500\)/i);
        return true;
      }
    );
  });

  it('Welcome Email Clean User Notification: returns clean user-facing message on new send and suppresses banner when script reports already_sent', async () => {
    const repo = createInMemoryProfileRepo();
    const { profile } = await resolveOrCreateAppProfile(
      {
        authProvider: 'supabase_email',
        providerSubject: '22222222-3333-4444-5555-666666666666',
        email: 'clean.banner@university.edu',
        emailVerified: true,
        displayName: 'Clean Banner User',
      },
      repo
    );

    const mockSentFetch = (async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          requestAccepted: true,
          appsScriptExecuted: true,
          emailSendApiSucceeded: true,
          inboxDeliveryGuaranteed: false,
          senderEmail: DEDICATED_GMAIL_SENDER,
          deliveryStatus: 'sent',
          sentAt: '2026-10-30T12:00:00.000Z',
          failureDetails: null,
          message: 'Your welcome email has been sent successfully.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const sentResult = await triggerWelcomeEmailIfEligible(profile, repo, {
      bearerToken: 'valid.jwt.token',
      fetchFn: mockSentFetch,
    });

    assert.equal(sentResult.triggered, true);
    assert.equal(
      sentResult.message,
      'Your welcome email has been sent successfully.'
    );
    assert.doesNotMatch(sentResult.message, /MailApp\.sendEmail/i);
    assert.doesNotMatch(sentResult.message, /campusresolveai@gmail\.com/i);
  });
});
