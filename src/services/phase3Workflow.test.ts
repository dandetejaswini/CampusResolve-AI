import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ActorRole, RequestStatus } from '../types/domain';
import {
  ID_PATTERNS,
  formatTicketId,
  formatMessageId,
  formatKnowledgeArticleId,
  formatPolicyId,
  formatSlaId,
  resolveOfficialCategory,
  evaluateTicketRouting,
  isValidLifecycleTransition,
  createLifecycleEvent,
  calculateElapsedBusinessMinutes,
  calculateDueTimestampByBusinessMinutes,
  buildReproducibleSlaRecord,
  evaluateSourceApplicability,
  retrieveApplicablePolicyEvidence,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
} from './workflowEngine';
import {
  generateDeterministicDataset,
  DETERMINISTIC_SEED,
} from './dataGenerator';
import {
  runDatasetValidationSuite,
  evaluateOperationalAnomaliesAgainstGroundTruth,
} from './validationAndEvaluationEngine';

describe('Phase 3 — Exact ID Formats & Regex Validation', () => {
  it('formats and validates all 5 required challenge ID patterns', () => {
    const ticketId = formatTicketId(1);
    assert.equal(ticketId, 'TKT-2026-000001');
    assert.equal(ID_PATTERNS.ticket.test(ticketId), true);
    assert.equal(ID_PATTERNS.ticket.test('TKT-26-1'), false);

    const msgId = formatMessageId(ticketId, 1);
    assert.equal(msgId, 'MSG-TKT-2026-000001-001');
    assert.equal(ID_PATTERNS.message.test(msgId), true);

    const kbId = formatKnowledgeArticleId(1);
    assert.equal(kbId, 'KB-000001');
    assert.equal(ID_PATTERNS.knowledgeArticle.test(kbId), true);

    const polId = formatPolicyId('FINAID', 1);
    assert.equal(polId, 'POL-FINAID-2026-001');
    assert.equal(ID_PATTERNS.policy.test(polId), true);

    const slaId = formatSlaId(ticketId);
    assert.equal(slaId, 'SLA-TKT-2026-000001');
    assert.equal(ID_PATTERNS.sla.test(slaId), true);
  });

  it('formats sequential 3-digit message IDs on the same ticket and verifies regex matching', () => {
    const ticketId = 'TKT-2026-000001';
    const seq1 = formatMessageId(ticketId, 1);
    const seq2 = formatMessageId(ticketId, 2);
    const seq3 = formatMessageId(ticketId, 3);
    const seq10 = formatMessageId(ticketId, 10);
    const seq123 = formatMessageId(ticketId, 123);

    assert.equal(seq1, 'MSG-TKT-2026-000001-001');
    assert.equal(seq2, 'MSG-TKT-2026-000001-002');
    assert.equal(seq3, 'MSG-TKT-2026-000001-003');
    assert.equal(seq10, 'MSG-TKT-2026-000001-010');
    assert.equal(seq123, 'MSG-TKT-2026-000001-123');

    // Matches the SQL check constraint ^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$
    assert.equal(ID_PATTERNS.message.test(seq1), true);
    assert.equal(ID_PATTERNS.message.test(seq2), true);
    assert.equal(ID_PATTERNS.message.test(seq3), true);
    assert.equal(ID_PATTERNS.message.test(seq10), true);
    assert.equal(ID_PATTERNS.message.test(seq123), true);

    // Rejects non-conforming 2-digit, 4-digit, or malformed suffixes
    assert.equal(ID_PATTERNS.message.test('MSG-TKT-2026-000001-01'), false);
    assert.equal(ID_PATTERNS.message.test('MSG-TKT-2026-000001-0001'), false);
    assert.equal(ID_PATTERNS.message.test('MSG-TKT-2026-000001-1'), false);
  });
});

describe('Phase 3 — Official 4-Category Classification & Rule-Based Routing', () => {
  it('classifies requests into the 4 official categories and routes to documented teams', () => {
    const finAid = resolveOfficialCategory(
      null,
      'FAFSA verification and emergency grant disbursement hold'
    );
    assert.equal(finAid.category, 'Financial Aid');
    const finRoute = evaluateTicketRouting({
      ticketId: 'TKT-2026-000001',
      category: finAid.category,
      subject: 'FAFSA verification',
      description: 'Need financial aid review',
      priority: 'Standard Priority',
      assignedAtIso: '2026-09-10T10:00:00.000Z',
    });
    assert.equal(finRoute.assignment.routing_rule_id, 'RULE-FINAID-001');
    assert.equal(
      finRoute.assignment.assigned_team,
      'Office of Financial Aid & Scholarships'
    );

    const reg = resolveOfficialCategory(
      null,
      'Late course drop petition and prerequisite override'
    );
    assert.equal(reg.category, 'Registration');

    const it = resolveOfficialCategory(
      null,
      'SSO MFA hardware token reset and LMS Canvas access'
    );
    assert.equal(it.category, 'IT');

    const access = resolveOfficialCategory(
      null,
      'Extended exam time accommodation letter and captioning'
    );
    assert.equal(access.category, 'Accessibility');
  });

  it('flags unmapped categories for human review instead of silently guessing', () => {
    const unmapped = resolveOfficialCategory(
      'Parking & Dining Services',
      'Campus shuttle schedule'
    );
    assert.equal(unmapped.category, null);

    const fallbackRoute = evaluateTicketRouting({
      ticketId: 'TKT-2026-000002',
      category: unmapped.category,
      subject: 'Campus shuttle schedule',
      description: 'Question about bus stop',
      priority: 'Standard Priority',
      assignedAtIso: '2026-09-10T10:00:00.000Z',
    });
    assert.equal(
      fallbackRoute.assignment.routing_rule_id,
      'RULE-EXCEPTION-HUMAN-TRIAGE'
    );
    assert.equal(fallbackRoute.assignment.requires_human_review, true);
    assert.equal(fallbackRoute.requiresEscalation, true);
  });
});

describe('Phase 3 — Lifecycle State Machine & Immutable Event Audit', () => {
  it('enforces valid lifecycle transitions and records immutable audit events', () => {
    assert.equal(
      isValidLifecycleTransition(
        RequestStatus.Submitted,
        RequestStatus.UnderReview
      ),
      true
    );
    assert.equal(
      isValidLifecycleTransition(
        RequestStatus.UnderReview,
        RequestStatus.PolicyVerified
      ),
      true
    );
    assert.equal(
      isValidLifecycleTransition(
        RequestStatus.UnderReview,
        RequestStatus.Escalated
      ),
      true
    );
    assert.equal(
      isValidLifecycleTransition(
        RequestStatus.Escalated,
        RequestStatus.Resolved
      ),
      true
    );
    assert.equal(
      isValidLifecycleTransition(RequestStatus.Resolved, RequestStatus.Closed),
      true
    );

    // Invalid jump directly from Draft to Closed
    assert.equal(
      isValidLifecycleTransition(RequestStatus.Draft, RequestStatus.Closed),
      false
    );

    const evt = createLifecycleEvent({
      ticketId: 'TKT-2026-000001',
      eventSequence: 1,
      previousState: RequestStatus.Submitted,
      newState: RequestStatus.UnderReview,
      actorId: 'REQ-2026-000001',
      actorRole: ActorRole.SupportStaff,
      reason: 'Assigned to Office of Financial Aid & Scholarships',
      timestampIso: '2026-09-10T10:05:00.000Z',
    });
    assert.equal(evt.ticket_id, 'TKT-2026-000001');
    assert.equal(evt.previous_state, RequestStatus.Submitted);
    assert.equal(evt.new_state, RequestStatus.UnderReview);
  });
});

describe('Phase 3 — Reproducible Business-Hour SLA Engine', () => {
  it('excludes weekend and overnight hours when calculating elapsed business minutes', () => {
    // Working hours under DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE: Mon-Fri 08:00-17:00 UTC
    // Friday 2026-03-06 16:00 UTC to Monday 2026-03-09 09:00 UTC
    const fri1600 = '2026-03-06T16:00:00.000Z'; // 1 hour before Friday 17:00 UTC close
    const mon0900 = '2026-03-09T09:00:00.000Z'; // 1 hour after Monday 08:00 UTC open

    const elapsedBusiness = calculateElapsedBusinessMinutes(
      fri1600,
      mon0900,
      DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
    );
    assert.equal(elapsedBusiness, 120); // 60 mins Friday + 60 mins Monday (weekend excluded)

    const dueIso = calculateDueTimestampByBusinessMinutes(
      fri1600,
      120,
      DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
    );
    assert.equal(dueIso, mon0900);

    const sla = buildReproducibleSlaRecord({
      ticketId: 'TKT-2026-000001',
      category: 'Financial Aid',
      startTimestampIso: fri1600,
      evaluatedTimestampIso: mon0900,
      isTicketEscalated: false,
      requiresEscalation: false,
    });
    assert.equal(sla.sla_id, 'SLA-TKT-2026-000001');
    assert.equal(sla.elapsed_business_minutes, 120);
    assert.equal(sla.breach_status, false);
  });
});

describe('Phase 3 — Date-Aware Policy Retrieval & Expired Policy Guardrail', () => {
  it('excludes expired policies from active citations and flags Scenario 1 expired citations', () => {
    const starter = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
    });
    const expiredPolicy = starter.policyDocuments.find(
      (p) => p.lifecycle_state === 'expired'
    );
    assert.ok(expiredPolicy, 'Dataset must contain expired policy documents');

    const applicability = evaluateSourceApplicability(
      expiredPolicy,
      '2026-09-15T14:00:00.000Z'
    );
    assert.equal(applicability.isApplicable, false);

    const retrieval = retrieveApplicablePolicyEvidence({
      query: `${expiredPolicy.title} ${expiredPolicy.domain} eligibility rules`,
      policies: starter.policyDocuments,
      articles: starter.knowledgeArticles,
      asOfDateIso: '2026-09-15T14:00:00.000Z',
    });
    assert.ok(retrieval.applicablePolicies.length > 0);
    assert.ok(
      retrieval.applicablePolicies.every(
        (p) => p.lifecycle_state === 'active'
      ),
      'All applicable policies returned for active citation must be active'
    );
    assert.ok(
      retrieval.expiredPoliciesExcluded.some(
        (p) => p.policy_id === expiredPolicy.policy_id
      ),
      'Expired policy must be explicitly listed in expiredPoliciesExcluded'
    );
  });
});

describe('Phase 3 — Deterministic Dataset Generator (Seed 20261022), 13 Validation Checks & 5 Anomaly Scenarios', () => {
  it('produces identical output and passes all 13 validation checks & 5 anomaly evaluations in full scale (5,000 tickets, 200 KB, 20,000 messages)', () => {
    const run1 = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: 'full',
    });
    const run2 = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: 'full',
    });

    // Exact challenge baseline counts
    assert.equal(run1.tickets.length, 5000);
    assert.equal(run1.knowledgeArticles.length, 200);
    assert.equal(run1.messages.length, 20000);
    assert.equal(run1.categories.length, 4);

    // Determinism verification and SHA-256 Checksum comparison
    const hash1 = createHash('sha256').update(JSON.stringify(run1)).digest('hex');
    const hash2 = createHash('sha256').update(JSON.stringify(run2)).digest('hex');
    assert.equal(hash1, hash2, 'Deterministic dataset runs must produce identical SHA-256 checksums');
    assert.ok(hash1.length === 64);

    assert.equal(run1.tickets[0].ticket_id, 'TKT-2026-000001');
    assert.equal(run1.tickets[4999].ticket_id, 'TKT-2026-005000');
    assert.deepEqual(run1.tickets[42], run2.tickets[42]);
    assert.deepEqual(run1.messages[1234], run2.messages[1234]);
    assert.deepEqual(run1.groundTruthAnomalies, run2.groundTruthAnomalies);

    // 13-Point Automated Validation Suite + Phase 4 Distribution & Coverage Audit
    const validation = runDatasetValidationSuite(run1);
    assert.equal(validation.checks.length, 13);
    assert.equal(
      validation.checks.filter((c) => c.passed).length,
      13
    );
    assert.equal(validation.overallStructuralPass, true);
    assert.equal(validation.silentRepairsPerformed, 0);

    // Phase 4 Required-Field Completeness across all 11 entities
    assert.ok(validation.distributionsAndCoverage);
    assert.equal(validation.distributionsAndCoverage.requiredFieldCompleteness.totalRecordsChecked, 38803);
    assert.equal(validation.distributionsAndCoverage.requiredFieldCompleteness.missingRequiredFieldsCount, 0);
    assert.equal(validation.distributionsAndCoverage.requiredFieldCompleteness.pass, true);
    assert.equal(validation.distributionsAndCoverage.requiredFieldCompleteness.failures.length, 0);

    // Phase 4 Coverage & Ground-Truth Isolation Verification
    assert.equal(validation.distributionsAndCoverage.assignmentCoverage.coverageRate, 1);
    assert.equal(validation.distributionsAndCoverage.slaCoverage.coverageRate, 1);
    assert.equal(validation.distributionsAndCoverage.feedbackCoverage.coverageRate, 1);
    assert.equal(validation.distributionsAndCoverage.groundTruthIsolation.leakedGroundTruthFieldsCount, 0);
    assert.equal(validation.distributionsAndCoverage.groundTruthIsolation.verifiedIsolated, true);

    // Lawful Synthetic Provenance & RFC 2606 Compliance
    assert.ok(
      run1.requesters.every((r) => r.verified_email.endsWith('@synthetic.campusresolve.invalid')),
      'All synthetic requester emails must use RFC 2606 .invalid TLD'
    );
    assert.ok(
      run1.policyDocuments.every((p) => p.source_url.startsWith('urn:campusresolve:synthetic-policy:')),
      'All synthetic policy documents must use non-fabricated URN identifiers'
    );
    assert.ok(
      run1.knowledgeArticles.every((k) => k.source_url.startsWith('urn:campusresolve:synthetic-kb:')),
      'All synthetic knowledge articles must use non-fabricated URN identifiers'
    );

    // 5-Scenario Ground-Truth Evaluation Suite
    const evaluation = evaluateOperationalAnomaliesAgainstGroundTruth(run1);
    assert.equal(evaluation.byAnomalyType.length, 5);
    assert.ok(evaluation.overallMetrics.precision >= 0.98, 'Precision must exceed 0.98');
    assert.ok(evaluation.overallMetrics.recall >= 0.98, 'Recall must exceed 0.98');
    assert.ok(evaluation.overallMetrics.f1Score >= 0.98, 'F1 score must exceed 0.98');
  });
});

describe('Phase 3 — Multi-Actor RBAC & Permission Governance Across All 5 Roles', () => {
  it('strictly enforces role privileges and rejections across all 5 actors', async () => {
    const { canActorPerformAction } = await import('../utils/rbac.js');
    const { AuthorizedAction } = await import('../types/domain.js');

    // 1. Learner
    assert.equal(canActorPerformAction(ActorRole.Learner, AuthorizedAction.SubmitAcademicPetition), true);
    assert.equal(canActorPerformAction(ActorRole.Learner, AuthorizedAction.TriageSupportQueue), false);
    assert.equal(canActorPerformAction(ActorRole.Learner, AuthorizedAction.ApprovePolicyEscalation), false);
    assert.equal(canActorPerformAction(ActorRole.Learner, AuthorizedAction.ConfigurePlatformGovernance), false);

    // 2. Instructor
    assert.equal(canActorPerformAction(ActorRole.Instructor, AuthorizedAction.SubmitFacultyCourseRequest), true);
    assert.equal(canActorPerformAction(ActorRole.Instructor, AuthorizedAction.ProposePolicyRevision), true);
    assert.equal(canActorPerformAction(ActorRole.Instructor, AuthorizedAction.TriageSupportQueue), false);
    assert.equal(canActorPerformAction(ActorRole.Instructor, AuthorizedAction.ConfigurePlatformGovernance), false);

    // 3. Academic Administrator
    assert.equal(canActorPerformAction(ActorRole.AcademicAdministrator, AuthorizedAction.InitiateAdministrativeReview), true);
    assert.equal(canActorPerformAction(ActorRole.AcademicAdministrator, AuthorizedAction.ApprovePolicyEscalation), true);
    assert.equal(canActorPerformAction(ActorRole.AcademicAdministrator, AuthorizedAction.PublishKnowledgeArticle), true);
    assert.equal(canActorPerformAction(ActorRole.AcademicAdministrator, AuthorizedAction.ConfigureDepartmentRouting), true);
    assert.equal(canActorPerformAction(ActorRole.AcademicAdministrator, AuthorizedAction.ConfigurePlatformGovernance), false);

    // 4. Support Staff
    assert.equal(canActorPerformAction(ActorRole.SupportStaff, AuthorizedAction.LogIntakeSupportTicket), true);
    assert.equal(canActorPerformAction(ActorRole.SupportStaff, AuthorizedAction.TriageSupportQueue), true);
    assert.equal(canActorPerformAction(ActorRole.SupportStaff, AuthorizedAction.ProposePolicyRevision), true);
    assert.equal(canActorPerformAction(ActorRole.SupportStaff, AuthorizedAction.ConfigurePlatformGovernance), false);

    // 5. Platform Administrator
    assert.equal(canActorPerformAction(ActorRole.PlatformAdministrator, AuthorizedAction.ConfigurePlatformGovernance), true);
    assert.equal(canActorPerformAction(ActorRole.PlatformAdministrator, AuthorizedAction.ConfigureDepartmentRouting), true);
    assert.equal(canActorPerformAction(ActorRole.PlatformAdministrator, AuthorizedAction.InitiateAdministrativeReview), true);
    assert.equal(canActorPerformAction(ActorRole.PlatformAdministrator, AuthorizedAction.PublishKnowledgeArticle), true);
  });
});

describe('Phase 3 — Multi-Tenant Row-Level Isolation & Synthetic Data Shielding', () => {
  it('prevents cross-user ticket visibility while permitting authorized staff review', async () => {
    const { isTicketAuthorizedForCaller } = await import('../../api/ops/workspace.js');

    const userA = {
      id: '11111111-1111-1111-1111-111111111111',
      auth_provider: 'supabase_email' as const,
      provider_subject: 'auth-user-a',
      verified_email: 'user.a@campusresolve.edu',
      display_name: 'Student A',
      department: 'College of Arts',
      office_or_cohort: '2026',
      actor_role: ActorRole.Learner,
      account_status: 'active',
    };

    const userB = {
      id: '22222222-2222-2222-2222-222222222222',
      auth_provider: 'supabase_email' as const,
      provider_subject: 'auth-user-b',
      verified_email: 'user.b@campusresolve.edu',
      display_name: 'Student B',
      department: 'School of Business',
      office_or_cohort: '2026',
      actor_role: ActorRole.Learner,
      account_status: 'active',
    };

    const staffMember = {
      id: '33333333-3333-3333-3333-333333333333',
      auth_provider: 'firebase_google' as const,
      provider_subject: 'google-staff-uid',
      verified_email: 'staff@campusresolve.edu',
      display_name: 'Advisor Support',
      department: 'Office of Financial Aid & Scholarships',
      office_or_cohort: null,
      actor_role: ActorRole.SupportStaff,
      account_status: 'active',
    };

    const ticketUserA = {
      ticket_id: 'TKT-2026-000001',
      requester_id: 'REQ-USR-11111111',
      requester_profile_id: userA.id,
      category_id: 'CAT-FINAID' as const,
      category_name: 'Financial Aid' as const,
      term_id: 'TERM-2026-FALL',
      subject: 'FAFSA Verification Request',
      description: 'Private financial details for User A',
      priority: 'Standard Priority' as const,
      lifecycle_status: RequestStatus.UnderReview,
      current_assigned_team: 'Office of Financial Aid & Scholarships',
      current_routing_rule_id: 'RULE-FINAID-001',
      referenced_policy_id: 'POL-FINAID-2026-001',
      referenced_policy_version: '2.0',
      referenced_article_id: 'KB-000001',
      referenced_article_version: '1.0',
      requires_escalation: false,
      is_escalated: false,
      escalation_reason: null,
      resolution_summary: null,
      is_synthetic_eval: false,
      submitted_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-01T10:00:00.000Z',
      resolved_at: null,
      closed_at: null,
    };

    // User A can access their own ticket
    assert.equal(isTicketAuthorizedForCaller(ticketUserA, userA), true);

    // User B CANNOT access User A's private ticket
    assert.equal(isTicketAuthorizedForCaller(ticketUserA, userB), false);

    // Support Staff CAN access the ticket for institutional service
    assert.equal(isTicketAuthorizedForCaller(ticketUserA, staffMember), true);

    // Synthetic evaluation benchmark records are NEVER accessible in normal user workspace
    const syntheticTicket = {
      ...ticketUserA,
      ticket_id: 'TKT-2026-009999',
      is_synthetic_eval: true,
    };
    assert.equal(isTicketAuthorizedForCaller(syntheticTicket, userA), false);
    assert.equal(isTicketAuthorizedForCaller(syntheticTicket, staffMember), false);
  });
});
