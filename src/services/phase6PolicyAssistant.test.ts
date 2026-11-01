import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseClient } from '@supabase/supabase-js';
import { ActorRole } from '../types/domain';
import {
  processPolicyAssistantRequest,
  type InjectedPolicyAssistantTestContext,
} from '../../api/ai/policy-assistant';
import {
  getReferenceCorpus,
  type VerifiedCallerIdentity,
} from '../../api/ops/workspace';
import type {
  PolicyDocumentRecord,
  KnowledgeArticleRecord,
} from '../types/phase3';

function createMockSupabaseClient(
  policies: PolicyDocumentRecord[],
  articles: KnowledgeArticleRecord[]
) {
  const insertedLogs: Record<string, any>[] = [];
  const updatedLogs: Array<{ queryId: string; patch: Record<string, any> }> = [];

  const mockClient = {
    insertedLogs,
    updatedLogs,
    from(table: string) {
      if (table === 'policy_documents') {
        return {
          select() {
            return Promise.resolve({ data: policies, error: null });
          },
        };
      }
      if (table === 'knowledge_articles') {
        return {
          select() {
            return Promise.resolve({ data: articles, error: null });
          },
        };
      }
      if (table === 'policy_version_history') {
        return {
          select() {
            return Promise.resolve({ data: [], error: null });
          },
        };
      }
      if (table === 'ai_retrieval_logs') {
        return {
          insert(payload: Record<string, any>) {
            insertedLogs.push({ ...payload });
            return Promise.resolve({ data: [payload], error: null });
          },
          select() {
            return {
              eq(_col: string, val: string) {
                return {
                  maybeSingle() {
                    const found =
                      insertedLogs.find((r) => r.query_id === val) ?? null;
                    return Promise.resolve({ data: found, error: null });
                  },
                };
              },
            };
          },
          update(patch: Record<string, any>) {
            let targetQueryId = '';
            const chain: any = {
              eq(col: string, val: string) {
                if (col === 'query_id') {
                  targetQueryId = val;
                }
                return chain;
              },
              select() {
                return {
                  maybeSingle() {
                    const existing =
                      insertedLogs.find((r) => r.query_id === targetQueryId) ??
                      null;
                    if (existing) {
                      Object.assign(existing, patch);
                      updatedLogs.push({ queryId: targetQueryId, patch });
                    }
                    return Promise.resolve({ data: existing, error: null });
                  },
                };
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table in mock Supabase client: ${table}`);
    },
  };

  return mockClient;
}

describe('Phase 6: AI Policy Assistant — 10 Core Verification Scenarios & Integration', () => {
  const dataset = getReferenceCorpus();
  const referenceDate = '2026-10-15';

  const learnerProfile: VerifiedCallerIdentity = {
    id: '00000000-0000-4000-8000-000000000001',
    auth_provider: 'supabase_email',
    provider_subject: '00000000-0000-4000-8000-000000000001',
    verified_email: 'elena.rostova@university.edu',
    display_name: 'Elena Rostova',
    department: 'School of Engineering & Computer Science',
    office_or_cohort: 'Undergraduate Class of 2027',
    actor_role: ActorRole.Learner,
    account_status: 'active',
  };

  const adminProfile: VerifiedCallerIdentity = {
    id: '00000000-0000-4000-8000-000000000005',
    auth_provider: 'supabase_email',
    provider_subject: '00000000-0000-4000-8000-000000000005',
    verified_email: 'sarah.jenkins@university.edu',
    display_name: 'Sarah Jenkins',
    department: 'Enterprise IT & Governance',
    office_or_cohort: 'Platform Administration',
    actor_role: ActorRole.PlatformAdministrator,
    account_status: 'active',
  };

  it('Scenario 1: Answers question accurately using a current, effective policy (POL-FINAID-2026-002 v2.0)', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const ctx: InjectedPolicyAssistantTestContext = {
      profile: learnerProfile,
      client: mockDb as unknown as SupabaseClient,
      serviceRoleClient: mockDb as unknown as SupabaseClient,
    };

    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'What is the current deadline in business days to submit a Satisfactory Academic Progress (SAP) appeal and what GPA is required?',
        asOfDate: referenceDate,
      },
      {},
      ctx
    );

    assert.equal(result.status, 200);
    const body = result.body;
    assert.equal(body.evidenceStatus, 'supported');
    assert.ok(
      body.retrievalLog.retrieved_policy_ids.includes('POL-FINAID-2026-002'),
      'Must retrieve active policy POL-FINAID-2026-002'
    );
    assert.ok(
      body.retrievalLog.retrieved_policy_versions.includes('2.0'),
      'Must retain version 2.0'
    );
    assert.ok(
      String(body.answer).includes('15 business days') &&
        String(body.answer).includes('2.0'),
      'Answer must state 15 business days and 2.0 GPA from POL-FINAID-2026-002 v2.0'
    );
    assert.ok(
      typeof body.explanation === 'string' && body.explanation.length > 20,
      'Must include structured explanation distinguishing verified provisions from operational context'
    );
  });

  it('Scenario 2: Returns accurate source citations with sourceId, version, effectiveDate, sectionRef, and passage', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const ctx: InjectedPolicyAssistantTestContext = {
      profile: learnerProfile,
      client: mockDb as unknown as SupabaseClient,
      serviceRoleClient: mockDb as unknown as SupabaseClient,
    };

    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'How quickly must the Disability Resource Center issue temporary accommodations after documentation is submitted under POL-ACCESS-2026-002?',
        asOfDate: referenceDate,
      },
      {},
      ctx
    );

    assert.equal(result.status, 200);
    const body = result.body;
    assert.ok(
      Array.isArray(body.citedSources) && body.citedSources.length >= 1,
      'Must return cited policy sources'
    );

    const policySource = body.citedSources.find(
      (s: any) => s.id === 'POL-ACCESS-2026-002'
    );
    assert.ok(policySource, 'citedSources must include POL-ACCESS-2026-002');
    assert.equal(policySource.sourceId, 'POL-ACCESS-2026-002');
    assert.equal(policySource.version, '2.0');
    assert.ok(
      typeof policySource.sourceDocumentTitle === 'string' &&
        policySource.sourceDocumentTitle.length > 5
    );
    assert.ok(
      typeof policySource.effectiveDate === 'string' &&
        policySource.effectiveDate.length >= 10
    );
    assert.ok(
      typeof policySource.sectionRef === 'string' &&
        policySource.sectionRef.length > 0
    );
    assert.ok(
      typeof policySource.relevantSectionOrPassage === 'string' &&
        policySource.relevantSectionOrPassage.length > 15
    );
    assert.ok(
      String(policySource.citation).includes('POL-ACCESS-2026-002 v2.0'),
      'Citation must include policy ID and exact version'
    );
  });

  it('Scenario 3: Rejects expired policy version as current guidance and explains supersession or expired-only state', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const ctx: InjectedPolicyAssistantTestContext = {
      profile: learnerProfile,
      client: mockDb as unknown as SupabaseClient,
      serviceRoleClient: mockDb as unknown as SupabaseClient,
    };

    // Case 3A: Querying expired POL-FINAID-2026-001 v1.0 when superseding v2.0 exists
    const resultWithReplacement = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'Under legacy policy POL-FINAID-2026-001 v1.0, do I still have 30 calendar days to submit my SAP appeal?',
        asOfDate: referenceDate,
      },
      {},
      ctx
    );

    assert.equal(resultWithReplacement.status, 200);
    const bodyA = resultWithReplacement.body;
    assert.equal(bodyA.expiredPolicyRejected, true);
    assert.ok(
      bodyA.retrievalLog.expired_sources_excluded.includes(
        'POL-FINAID-2026-001@v1.0'
      )
    );
    assert.ok(
      !bodyA.citedSources.some((s: any) => s.id === 'POL-FINAID-2026-001'),
      'Expired policy POL-FINAID-2026-001 must never appear in active citedSources'
    );
    const excludedDetail = bodyA.expiredSourcesExcludedDetails.find(
      (d: any) => d.id === 'POL-FINAID-2026-001'
    );
    assert.ok(excludedDetail);
    assert.equal(excludedDetail.version, '1.0');
    assert.equal(excludedDetail.supersededByPolicyId, 'POL-FINAID-2026-002');
    assert.ok(
      String(bodyA.answer).includes('POL-FINAID-2026-001') &&
        String(bodyA.answer).includes('POL-FINAID-2026-002')
    );

    // Case 3B: Querying when ONLY an expired policy matches (no active replacement)
    const expiredOnlyPolicies = dataset.policyDocuments.filter(
      (p: PolicyDocumentRecord) => p.policy_id === 'POL-FINAID-2026-001'
    );
    const expiredOnlyMockDb = createMockSupabaseClient(expiredOnlyPolicies, []);
    const resultExpiredOnly = await processPolicyAssistantRequest(
      'POST',
      {
        query: 'What is the SAP appeal deadline under POL-FINAID-2026-001?',
        asOfDate: referenceDate,
      },
      {},
      {
        profile: learnerProfile,
        client: expiredOnlyMockDb as unknown as SupabaseClient,
        serviceRoleClient: expiredOnlyMockDb as unknown as SupabaseClient,
        customCorpus: {
          policies: expiredOnlyPolicies,
          articles: [],
        },
      }
    );

    const bodyB = resultExpiredOnly.body;
    assert.equal(bodyB.evidenceStatus, 'expired_only');
    assert.equal(bodyB.citedSources.length, 0);
    assert.equal(bodyB.retrievalLog.escalation_triggered, true);
  });

  it('Scenario 4: Identifies conflicting applicable policy sources and surfaces both without choosing arbitrarily', async () => {
    const basePolicy = dataset.policyDocuments.find(
      (p) => p.policy_id === 'POL-FINAID-2026-002'
    )!;
    const conflictingPolicyB: PolicyDocumentRecord = {
      ...basePolicy,
      policy_id: 'POL-FINAID-2026-099',
      title:
        'Emergency Satisfactory Academic Progress (SAP) Appeal Fast-Track Directive',
      version: '1.0',
      effective_date: '2026-09-01',
      expiration_date: null,
      lifecycle_state: 'active',
      supersedes_policy_id: null,
      superseded_by_policy_id: null,
      summary:
        'Directive governing Satisfactory Academic Progress (SAP) appeal deadlines and financial aid reinstatement.',
      content:
        'Students submitting a Satisfactory Academic Progress (SAP) appeal must file within 5 business days of term start and hold a 2.5 cumulative GPA.',
      authoritative_section_ref: basePolicy.authoritative_section_ref,
    };

    const policiesWithConflict = [
      ...dataset.policyDocuments,
      conflictingPolicyB,
    ];
    const mockDb = createMockSupabaseClient(
      policiesWithConflict,
      dataset.knowledgeArticles
    );

    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'What is the official Satisfactory Academic Progress (SAP) appeal deadline and required GPA for financial aid reinstatement?',
        asOfDate: referenceDate,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
        customCorpus: {
          policies: policiesWithConflict,
          articles: dataset.knowledgeArticles,
        },
      }
    );

    assert.equal(result.status, 200);
    const body = result.body;
    assert.equal(body.hasConflictingSources, true);
    assert.ok(
      Array.isArray(body.conflictingSources) &&
        body.conflictingSources.length >= 1
    );
    assert.equal(body.evidenceStatus, 'partial_or_ambiguous');
    assert.equal(body.retrievalLog.escalation_triggered, true);
    assert.ok(
      String(body.answer).includes('CONFLICTING POLICY SOURCES IDENTIFIED') &&
        String(body.answer).includes('POL-FINAID-2026-002') &&
        String(body.answer).includes('POL-FINAID-2026-099')
    );
  });

  it('Scenario 5: Safely handles questions with no supporting source without fabricating policy', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'What is the university policy on cryptocurrency mining inside dormitory laundry rooms and stadium helicopter landing permits?',
        asOfDate: referenceDate,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );

    assert.equal(result.status, 200);
    const body = result.body;
    assert.equal(body.evidenceStatus, 'unsupported_or_missing');
    assert.equal(body.citedSources.length, 0);
    assert.equal(body.retrievalLog.escalation_triggered, true);
    assert.ok(
      String(body.answer).includes('INSUFFICIENT POLICY EVIDENCE')
    );
  });

  it('Scenario 6: Detects ambiguous questions and provides focused clarification questions', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );

    // Case 6A: Underspecified / generic question
    const resultGeneric = await processPolicyAssistantRequest(
      'POST',
      {
        query: 'What is the deadline to submit my form?',
        asOfDate: referenceDate,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );

    assert.equal(resultGeneric.status, 200);
    const bodyGeneric = resultGeneric.body;
    assert.equal(bodyGeneric.clarificationNeeded, true);
    assert.ok(
      Array.isArray(bodyGeneric.clarificationQuestions) &&
        bodyGeneric.clarificationQuestions.length >= 1
    );

    // Case 6B: Domain question missing conditional parameters (drop/withdraw without week of term)
    const resultConditional = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'Can I drop or withdraw from my course under registration policy and how does it affect my transcript?',
        asOfDate: referenceDate,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );

    const bodyConditional = resultConditional.body;
    assert.equal(bodyConditional.clarificationNeeded, true);
    assert.equal(bodyConditional.evidenceStatus, 'partial_or_ambiguous');
    assert.ok(
      bodyConditional.clarificationQuestions.some(
        (q: string) => q.includes('Week 2') || q.includes('Week 8')
      )
    );
  });

  it('Scenario 7: Refuses to invent unsupported facts (e.g. non-existent dollar filing fees) when queried', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'What is the exact dollar filing fee ($ amount) required to submit a Satisfactory Academic Progress (SAP) appeal under POL-FINAID-2026-002?',
        asOfDate: referenceDate,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );

    assert.equal(result.status, 200);
    const body = result.body;
    assert.equal(body.unsupportedClaimRequested, true);
    assert.ok(
      Array.isArray(body.unsupportedClaimDetails) &&
        body.unsupportedClaimDetails.some((d: string) =>
          d.toLowerCase().includes('monetary fees')
        )
    );
    assert.equal(body.evidenceStatus, 'partial_or_ambiguous');
    assert.ok(
      !String(body.answer).match(/\$\d+/),
      'Must not invent any dollar fee amount'
    );
    assert.ok(String(body.answer).includes('UNSUPPORTED FACT NOTICE'));
  });

  it('Scenario 8: Recommends human escalation for policy exceptions and links escalated ticket ID in ai_retrieval_logs', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const ctx: InjectedPolicyAssistantTestContext = {
      profile: learnerProfile,
      client: mockDb as unknown as SupabaseClient,
      serviceRoleClient: mockDb as unknown as SupabaseClient,
    };

    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'I need a retroactive course withdrawal after Week 8 due to an emergency medical hospitalization. How is this approved?',
        asOfDate: referenceDate,
      },
      {},
      ctx
    );

    assert.equal(result.status, 200);
    const body = result.body;
    assert.equal(body.retrievalLog.escalation_triggered, true);
    assert.ok(
      typeof body.recommendedEscalationTeam === 'string' &&
        body.recommendedEscalationTeam.length > 0
    );
    assert.ok(
      typeof body.retrievalLog.escalation_reason === 'string' &&
        body.retrievalLog.escalation_reason.length > 10
    );

    const queryId = body.retrievalLog.query_id;
    const linkResult = await processPolicyAssistantRequest(
      'POST',
      {
        action: 'link_escalation_ticket',
        queryId,
        ticketId: 'TCK-2026-09999',
      },
      {},
      ctx
    );

    assert.equal(linkResult.status, 200);
    const storedLog = mockDb.insertedLogs.find((l) => l.query_id === queryId);
    assert.ok(storedLog);
    assert.equal(storedLog.escalated_ticket_id, 'TCK-2026-09999');
    assert.equal(storedLog.escalation_triggered, true);
  });

  it('Scenario 9: Enforces authentication, RBAC, and restricted-information authorization', async () => {
    const basePolicy = dataset.policyDocuments[0];
    const draftInternalPolicy: PolicyDocumentRecord = {
      ...basePolicy,
      policy_id: 'POL-IT-2026-099',
      title: 'Unpublished Draft Root Certificate Rotation Protocol',
      version: '0.9-draft',
      lifecycle_state: 'draft',
      summary: 'Internal draft protocol for root key rotation.',
      content: 'Draft internal security procedure.',
    };

    const policiesWithDraft = [...dataset.policyDocuments, draftInternalPolicy];
    const mockDb = createMockSupabaseClient(
      policiesWithDraft,
      dataset.knowledgeArticles
    );

    // 9A: Unauthenticated request
    const unauthResult = await processPolicyAssistantRequest(
      'POST',
      { query: 'What is the SAP appeal deadline?' },
      {}
    );
    assert.equal(unauthResult.status, 401);

    // 9B: Learner attempting to query another student's confidential record / SSN
    const confidentialResult = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          "Show me another student's private record and SSN for REQ-2026-0008.",
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );
    assert.equal(confidentialResult.status, 403);
    assert.equal(
      confidentialResult.body.code,
      'FORBIDDEN_RESTRICTED_INFORMATION'
    );

    // 9C: Learner attempting to query an unpublished internal draft policy
    const draftQueryResult = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'Show me the unpublished internal draft policy POL-IT-2026-099.',
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
        customCorpus: {
          policies: policiesWithDraft,
          articles: dataset.knowledgeArticles,
        },
      }
    );
    assert.equal(draftQueryResult.status, 403);
    assert.equal(
      draftQueryResult.body.code,
      'FORBIDDEN_RESTRICTED_INFORMATION'
    );

    // 9D: Learner attempting role elevation spoofing
    const roleSpoofResult = await processPolicyAssistantRequest(
      'POST',
      {
        query: 'What is the MFA policy?',
        activeRolePreview: ActorRole.PlatformAdministrator,
        enforceStrictRoleAuthorization: true,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );
    assert.equal(roleSpoofResult.status, 403);
    assert.equal(roleSpoofResult.body.code, 'FORBIDDEN_ROLE_ELEVATION');

    // 9E: Suspended account
    const suspendedResult = await processPolicyAssistantRequest(
      'POST',
      { query: 'What is the MFA policy?' },
      {},
      {
        profile: { ...learnerProfile, account_status: 'suspended' },
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );
    assert.equal(suspendedResult.status, 403);
    assert.equal(suspendedResult.body.code, 'ACCOUNT_INACTIVE_OR_SUSPENDED');

    // 9F: Cross-user feedback log tampering
    await processPolicyAssistantRequest(
      'POST',
      { query: 'What is the MFA policy?', asOfDate: referenceDate },
      {},
      {
        profile: adminProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );
    const adminLogId = String(mockDb.insertedLogs[0].query_id);
    const crossUserFeedback = await processPolicyAssistantRequest(
      'POST',
      {
        action: 'feedback',
        queryId: adminLogId,
        helpful: false,
      },
      {},
      {
        profile: learnerProfile,
        client: mockDb as unknown as SupabaseClient,
        serviceRoleClient: mockDb as unknown as SupabaseClient,
      }
    );
    assert.equal(crossUserFeedback.status, 403);
    assert.equal(
      crossUserFeedback.body.code,
      'FORBIDDEN_CROSS_USER_AUDIT_LOG'
    );
  });

  it('Scenario 10: Retains exact policy and article source versions in response and ai_retrieval_logs', async () => {
    const mockDb = createMockSupabaseClient(
      dataset.policyDocuments,
      dataset.knowledgeArticles
    );
    const ctx: InjectedPolicyAssistantTestContext = {
      profile: learnerProfile,
      client: mockDb as unknown as SupabaseClient,
      serviceRoleClient: mockDb as unknown as SupabaseClient,
      customGeminiSynthesizer: async () => ({
        groundedAnswer:
          'Under [POL-IT-2026-002 v2.0, Section 1.2 (Current)] and [KB-000008 v2.0], all learners, instructors, and staff must use FIDO2 passkeys or TOTP authenticator apps for Single Sign-On (SSO).',
        explanation:
          'Verified provisions come directly from POL-IT-2026-002 version 2.0 (effective 2026-05-01) and KB-000008 version 2.0.',
        supportedFacts: [
          'POL-IT-2026-002 v2.0 requires FIDO2 passkeys or TOTP authenticator apps for Single Sign-On (SSO).',
        ],
        missingOrUnestablishedFacts: [],
      }),
    };

    const result = await processPolicyAssistantRequest(
      'POST',
      {
        query:
          'What is the current Multi-Factor Authentication (MFA) requirement for Single Sign-On (SSO) under POL-IT-2026-002?',
        asOfDate: referenceDate,
      },
      {},
      ctx
    );

    assert.equal(result.status, 200);
    const body = result.body;

    const citedPolicy = body.citedSources.find(
      (s: any) => s.id === 'POL-IT-2026-002'
    );
    const citedKb = body.citedSources.find(
      (s: any) => s.sourceType === 'article' && s.id.startsWith('KB-')
    );
    assert.ok(citedPolicy, 'Must cite active policy POL-IT-2026-002');
    assert.equal(citedPolicy.version, '2.0', 'Must retain exact version 2.0');
    assert.ok(citedKb, 'Must cite linked KnowledgeArticle');
    assert.equal(
      citedPolicy.version,
      body.retrievalLog.retrieved_policy_versions[0],
      'Cited policy version must match retrievalLog version'
    );

    const auditRecord = mockDb.insertedLogs[0];
    assert.ok(auditRecord);
    assert.ok(
      (auditRecord.retrieved_policy_ids as string[]).includes('POL-IT-2026-002')
    );
    assert.ok(
      (auditRecord.retrieved_policy_versions as string[]).includes('2.0')
    );
    assert.ok(
      (auditRecord.retrieved_article_ids as string[]).includes(citedKb.id)
    );
    assert.ok(
      (auditRecord.retrieved_article_versions as string[]).includes(
        citedKb.version
      )
    );

    const feedbackRes = await processPolicyAssistantRequest(
      'POST',
      {
        action: 'feedback',
        queryId: body.retrievalLog.query_id,
        helpful: true,
      },
      {},
      ctx
    );
    assert.equal(feedbackRes.status, 200);
    assert.equal(auditRecord.feedback_helpful, true);
    assert.ok(
      (auditRecord.retrieved_policy_versions as string[]).includes('2.0'),
      'Feedback update must preserve exact retrieved_policy_versions'
    );
  });
});
