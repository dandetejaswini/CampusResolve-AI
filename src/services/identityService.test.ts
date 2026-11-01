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
import crypto from 'node:crypto';
import {
  processWelcomeEmailRequest,
  DEDICATED_GMAIL_SENDER,
} from '../../api/auth/welcome-email';
import {
  processFirebaseClaimRequest,
  verifyFirebaseTokenWithGooglePublicCerts,
} from '../../api/auth/firebase-claim';
import { processWorkspaceOperationRequest } from '../../api/ops/workspace';
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

  it('Google Sign-In Server-Side Provisioning (Cases 1, 2, 3, 5): provisions single profile from verified token, ignores spoofed client fields/roles, is idempotent on repeat sign-in & refresh, and supports profile updates', async () => {
    const repo = createInMemoryProfileRepo();
    const verifiedUid = 'google_verified_uid_778899';
    const verifiedEmail = 'priya.nair@university.edu';

    const mockVerifyToken = async () => ({
      uid: verifiedUid,
      email: verifiedEmail,
      emailVerified: true,
      name: 'Priya Nair',
      aud: 'campusresolveai',
      iss: 'https://securetoken.google.com/campusresolveai',
      roleClaim: undefined,
      verifiedVia: 'google_securetoken_x509' as const,
    });

    // Case 1 & Case 5: First-time Google Sign-In creates a single valid profile
    // and ignores spoofed client body fields (uid, email, actorRole)
    const firstSignIn = await processFirebaseClaimRequest(
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid.firebase.jwt' },
        body: {
          action: 'provision_profile',
          displayName: 'Priya Nair',
          department: 'School of Engineering',
          requestedRoleNote: ActorRole.PlatformAdministrator,
          uid: 'spoofed_attacker_uid',
          email: 'spoofed_attacker@university.edu',
          actorRole: ActorRole.PlatformAdministrator,
        },
      },
      {
        verifyIdTokenFn: mockVerifyToken,
        profileRepo: repo,
      }
    );

    assert.equal(firstSignIn.status, 200);
    assert.equal(firstSignIn.body.ok, true);
    assert.equal(firstSignIn.body.isNewProfile, true);
    assert.ok(firstSignIn.body.profile);
    assert.equal(firstSignIn.body.profile.auth_provider, 'firebase_google');
    assert.equal(firstSignIn.body.profile.provider_subject, verifiedUid);
    assert.equal(firstSignIn.body.profile.verified_email, verifiedEmail);
    assert.equal(firstSignIn.body.profile.actor_role, ActorRole.Learner);
    assert.equal(firstSignIn.body.profile.account_status, 'active');
    assert.equal(repo.profiles.length, 1);

    // Case 2: Existing Google user signs in again without duplicate profile creation
    const secondSignIn = await processFirebaseClaimRequest(
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid.firebase.jwt' },
        body: {
          action: 'provision_profile',
        },
      },
      {
        verifyIdTokenFn: mockVerifyToken,
        profileRepo: repo,
      }
    );

    assert.equal(secondSignIn.status, 200);
    assert.equal(secondSignIn.body.ok, true);
    assert.equal(secondSignIn.body.isNewProfile, false);
    assert.equal(secondSignIn.body.profile?.id, firstSignIn.body.profile.id);
    assert.equal(repo.profiles.length, 1);

    // Case 3: Refreshing session and updating profile attributes preserves session & immutable role
    const profileUpdate = await processFirebaseClaimRequest(
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid.firebase.jwt' },
        body: {
          action: 'update_profile',
          displayName: 'Priya S. Nair',
          department: 'Electrical & Computer Engineering',
          officeOrCohort: 'Spring 2026 Graduate Cohort',
          actorRole: ActorRole.PlatformAdministrator,
        },
      },
      {
        verifyIdTokenFn: mockVerifyToken,
        profileRepo: repo,
      }
    );

    assert.equal(profileUpdate.status, 200);
    assert.equal(profileUpdate.body.ok, true);
    assert.equal(profileUpdate.body.profile?.display_name, 'Priya S. Nair');
    assert.equal(
      profileUpdate.body.profile?.department,
      'Electrical & Computer Engineering'
    );
    assert.equal(
      profileUpdate.body.profile?.actor_role,
      ActorRole.Learner
    );
  });

  it('Google Sign-In Server-Side Provisioning (Cases 4, 7, 8): enforces cross-provider collision guard, blocks unverified/invalid tokens cleanly without exposing SQL/RLS errors, and allows workspace access after provisioning', async () => {
    const repo = createInMemoryProfileRepo();

    // Pre-register an email/password user
    await resolveOrCreateAppProfile(
      {
        authProvider: 'supabase_email',
        providerSubject: '99999999-8888-7777-6666-555555555555',
        email: 'existing.email@university.edu',
        emailVerified: true,
        displayName: 'Existing Email User',
      },
      repo
    );

    // Case 7: Cross-provider email collision returns HTTP 409 with clean message
    const conflictRes = await processFirebaseClaimRequest(
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid.firebase.jwt' },
        body: { action: 'provision_profile' },
      },
      {
        verifyIdTokenFn: async () => ({
          uid: 'google_uid_collision_01',
          email: 'existing.email@university.edu',
          emailVerified: true,
          name: 'Collision Attempt',
          aud: 'campusresolveai',
          iss: 'https://securetoken.google.com/campusresolveai',
          verifiedVia: 'google_securetoken_x509',
        }),
        profileRepo: repo,
      }
    );

    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.body.code, 'CROSS_PROVIDER_EMAIL_CONFLICT');
    assert.doesNotMatch(conflictRes.body.message, /row-level security/i);

    // Case 8: Invalid / expired token or database error returns clean user-friendly JSON without SQL/RLS internals
    const invalidTokenRes = await processFirebaseClaimRequest(
      {
        method: 'POST',
        headers: { authorization: 'Bearer forged.jwt.token' },
      },
      {
        verifyIdTokenFn: async () => {
          throw new Error('Firebase ID token cryptographic signature verification failed.');
        },
        profileRepo: repo,
      }
    );
    assert.equal(invalidTokenRes.status, 401);
    assert.equal(invalidTokenRes.body.code, 'TOKEN_VERIFICATION_FAILED');
    assert.doesNotMatch(invalidTokenRes.body.message, /row-level security/i);

    // Provision a valid Google user and verify Case 4: Workspace access succeeds for that provisioned profile
    const validGoogleRes = await processFirebaseClaimRequest(
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid.google.jwt' },
        body: {
          action: 'provision_profile',
          displayName: 'Devon Brooks',
          department: 'Academic Advising',
        },
      },
      {
        verifyIdTokenFn: async () => ({
          uid: 'google_uid_workspace_user',
          email: 'devon.brooks@university.edu',
          emailVerified: true,
          name: 'Devon Brooks',
          aud: 'campusresolveai',
          iss: 'https://securetoken.google.com/campusresolveai',
          verifiedVia: 'google_securetoken_x509',
        }),
        profileRepo: repo,
      }
    );

    assert.equal(validGoogleRes.status, 200);
    assert.ok(validGoogleRes.body.profile);

    const provisionedProfile = validGoogleRes.body.profile;
    const mockQueryChain: any = {
      select: () => mockQueryChain,
      eq: () => mockQueryChain,
      ilike: () => mockQueryChain,
      order: () => mockQueryChain,
      limit: () => mockQueryChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            requester_id: 'REQ-USR-GOOGLE01',
            app_profile_id: provisionedProfile.id,
            role_id: 'ROLE-LEARNER',
            primary_term_id: 'TERM-2026-FALL',
            verified_email: provisionedProfile.verified_email,
            display_name: provisionedProfile.display_name,
            department: provisionedProfile.department,
            program_or_unit: provisionedProfile.office_or_cohort,
            account_status: 'active',
            is_synthetic_eval: false,
          },
          error: null,
        }),
      then: (resolve: any) => resolve({ data: [], error: null, status: 200 }),
    };
    const mockWorkspaceClient = {
      from: () => mockQueryChain,
    } as any;

    const workspaceBootstrap = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      undefined,
      { authorization: 'Bearer valid.google.jwt' },
      {
        profile: {
          id: provisionedProfile.id,
          auth_provider: provisionedProfile.auth_provider,
          provider_subject: provisionedProfile.provider_subject,
          verified_email: provisionedProfile.verified_email,
          display_name: provisionedProfile.display_name,
          department: provisionedProfile.department,
          office_or_cohort: provisionedProfile.office_or_cohort,
          actor_role: provisionedProfile.actor_role,
          account_status: provisionedProfile.account_status,
        },
        client: mockWorkspaceClient,
        serviceRoleClient: null,
      }
    );

    assert.equal(workspaceBootstrap.status, 200);
    assert.equal(workspaceBootstrap.body.ok, true);
    assert.equal(
      workspaceBootstrap.body.requester.verified_email,
      'devon.brooks@university.edu'
    );
  });

  it('Cryptographic RS256 Firebase ID Token Verifier: validates authentic RSA-SHA256 signed JWT and rejects tampered payload', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const kid = 'test-google-key-id-2026';
    const nowSec = Math.floor(Date.now() / 1000);

    const headerB64 = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })
    ).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        iss: 'https://securetoken.google.com/campusresolveai',
        aud: 'campusresolveai',
        sub: 'firebase_crypto_uid_123',
        email: 'crypto.verified@university.edu',
        email_verified: true,
        name: 'Crypto Verified Scholar',
        iat: nowSec - 30,
        exp: nowSec + 3600,
      })
    ).toString('base64url');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${headerB64}.${payloadB64}`);
    signer.end();
    const signatureB64 = signer.sign(privateKey).toString('base64url');

    const validJwt = `${headerB64}.${payloadB64}.${signatureB64}`;

    const mockCertFetch = (async () =>
      new Response(JSON.stringify({ [kid]: publicKey }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    const verified = await verifyFirebaseTokenWithGooglePublicCerts(
      validJwt,
      'campusresolveai',
      mockCertFetch
    );

    assert.equal(verified.uid, 'firebase_crypto_uid_123');
    assert.equal(verified.email, 'crypto.verified@university.edu');
    assert.equal(verified.emailVerified, true);
    assert.equal(verified.verifiedVia, 'google_securetoken_x509');

    // Tamper with the payload and confirm cryptographic verification rejects it
    const tamperedPayloadB64 = Buffer.from(
      JSON.stringify({
        iss: 'https://securetoken.google.com/campusresolveai',
        aud: 'campusresolveai',
        sub: 'attacker_uid_999',
        email: 'attacker@university.edu',
        email_verified: true,
        iat: nowSec - 30,
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const tamperedJwt = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;

    await assert.rejects(
      async () => {
        await verifyFirebaseTokenWithGooglePublicCerts(
          tamperedJwt,
          'campusresolveai',
          mockCertFetch
        );
      },
      /signature verification failed/i
    );
  });
});

