import { GoogleGenAI, Type } from '@google/genai';
import { ActorRole } from '../../src/types/domain.js';
import {
  AIRetrievalLogRecord,
  KnowledgeArticleRecord,
  OfficialCategoryName,
  PolicyDocumentRecord,
  PolicyVersionHistoryRecord,
} from '../../src/types/phase3.js';
import {
  ConflictingSourcePair,
  DOCUMENTED_ROUTING_RULES,
  UNMAPPED_HUMAN_REVIEW_ROUTING,
  evaluateSourceApplicability,
  retrieveApplicablePolicyEvidence,
} from '../../src/services/workflowEngine.js';
import {
  InjectedWorkspaceTestContext,
  VerifiedCallerIdentity,
  createServiceRoleSupabaseClient,
  getReferenceCorpus,
  verifyAuthenticatedProfileFromHeaders,
} from '../ops/workspace.js';

export interface PolicyAssistantQueryInput {
  action?: 'query' | 'feedback' | 'link_escalation_ticket';
  query?: string;
  asOfDate?: string;
  activeRolePreview?: ActorRole;
  enforceStrictRoleAuthorization?: boolean;
  queryId?: string;
  helpful?: boolean;
  ticketId?: string;
}

export interface CitedSourceDetail {
  sourceType: 'policy' | 'article';
  id: string;
  sourceId: string;
  version: string;
  title: string;
  sourceDocumentTitle: string;
  domainOrCategory: string;
  effectiveDate: string;
  expirationDate: string | null;
  lifecycleState: string;
  sectionRef?: string;
  relevantSectionOrPassage: string;
  citation: string;
  summary: string;
  content: string;
  sourceUrl: string;
  isSynthetic: boolean;
  supersedesPolicyId?: string | null;
  supersededByPolicyId?: string | null;
  exclusionReason?: string;
}

export interface InjectedPolicyAssistantTestContext
  extends InjectedWorkspaceTestContext {
  customCorpus?: {
    policies?: PolicyDocumentRecord[];
    articles?: KnowledgeArticleRecord[];
    policyVersionHistory?: PolicyVersionHistoryRecord[];
  };
  customGeminiSynthesizer?: (params: {
    query: string;
    asOfDate: string;
    evidenceContext: string;
  }) => Promise<{
    groundedAnswer: string;
    explanation?: string;
    supportedFacts: string[];
    missingOrUnestablishedFacts: string[];
  }>;
  allowLiveGemini?: boolean;
}

/**
 * Evaluates role-based access control and prevents unauthorized access to
 * restricted administrative, internal, draft, or cross-requester confidential records.
 */
export function evaluatePolicyAssistantAccessControl(params: {
  profile: VerifiedCallerIdentity;
  body: PolicyAssistantQueryInput | undefined;
  policies: PolicyDocumentRecord[];
}): {
  authorized: boolean;
  status: number;
  code: string;
  message: string;
} {
  const { profile, body, policies } = params;

  if (profile.account_status !== 'active') {
    return {
      authorized: false,
      status: 403,
      code: 'ACCOUNT_INACTIVE_OR_SUSPENDED',
      message: `Access denied: Institutional profile for '${profile.verified_email}' has status '${profile.account_status}' and is not authorized to query the AI Policy Assistant.`,
    };
  }

  const isElevatedRole =
    profile.actor_role === ActorRole.SupportStaff ||
    profile.actor_role === ActorRole.AcademicAdministrator ||
    profile.actor_role === ActorRole.PlatformAdministrator;

  const isAdminRole =
    profile.actor_role === ActorRole.AcademicAdministrator ||
    profile.actor_role === ActorRole.PlatformAdministrator;

  // Reject unauthorized role elevation when strict role authorization is requested
  if (
    body?.enforceStrictRoleAuthorization &&
    body.activeRolePreview &&
    body.activeRolePreview !== profile.actor_role &&
    profile.actor_role !== ActorRole.PlatformAdministrator
  ) {
    return {
      authorized: false,
      status: 403,
      code: 'FORBIDDEN_ROLE_ELEVATION',
      message: `Access denied: Authenticated role '${profile.actor_role}' is not authorized to execute policy assistant operations under elevated role '${body.activeRolePreview}'.`,
    };
  }

  const rawQuery = (body?.query || '').trim();
  const lowerQuery = rawQuery.toLowerCase();

  // Check if a non-elevated user attempts to access restricted internal security/override records or another user's private records
  const requestsCrossUserConfidentialRecords =
    /\b(other student's|another student's|other learner's|another learner's|confidential disability file|private ssn|social security number|all student records|export all requesters|bypass rls|service_role key|internal staff override code)\b/i.test(
      lowerQuery
    ) ||
    (!isElevatedRole && /\breq-(2026-[0-9]{6}|usr-[a-z0-9]+)\b/i.test(lowerQuery));

  if (requestsCrossUserConfidentialRecords) {
    return {
      authorized: false,
      status: 403,
      code: 'FORBIDDEN_RESTRICTED_INFORMATION',
      message: `Access denied: Role '${profile.actor_role}' is not authorized to access confidential cross-requester records, private disability/financial files, or restricted internal security credentials.`,
    };
  }

  // Check if a non-admin user explicitly requests unpublished draft policies or restricted admin-only governance records
  const draftPoliciesReferenced = policies.filter(
    (p) =>
      p.lifecycle_state === 'draft' &&
      lowerQuery.includes(p.policy_id.toLowerCase())
  );

  if (
    !isAdminRole &&
    (draftPoliciesReferenced.length > 0 ||
      /\b(unpublished draft policy|internal draft regulation|restricted admin-only policy|confidential committee minutes)\b/i.test(
        lowerQuery
      ))
  ) {
    return {
      authorized: false,
      status: 403,
      code: 'FORBIDDEN_RESTRICTED_INFORMATION',
      message: `Access denied: Role '${profile.actor_role}' is not authorized to access unpublished draft policy documents or restricted administrative committee records.`,
    };
  }

  return {
    authorized: true,
    status: 200,
    code: 'AUTHORIZED',
    message: 'Caller is authorized to query the AI Policy Assistant.',
  };
}

function buildDeterministicEvidenceSynthesis(params: {
  query: string;
  asOfDate: string;
  detectedCategory: OfficialCategoryName | null;
  applicablePolicies: PolicyDocumentRecord[];
  applicableArticles: KnowledgeArticleRecord[];
  expiredPoliciesExcluded: PolicyDocumentRecord[];
  expiredArticlesExcluded: KnowledgeArticleRecord[];
  evidenceStatus: AIRetrievalLogRecord['evidence_status'];
  escalationReason: string | null;
  hasConflictingSources: boolean;
  conflictingSources: ConflictingSourcePair[];
  clarificationNeeded: boolean;
  clarificationQuestions: string[];
  unsupportedClaimRequested: boolean;
  unsupportedClaimDetails: string[];
}): {
  answer: string;
  explanation: string;
  supportedFacts: string[];
  missingOrUnestablishedFacts: string[];
} {
  const {
    query,
    asOfDate,
    detectedCategory,
    applicablePolicies,
    applicableArticles,
    expiredPoliciesExcluded,
    expiredArticlesExcluded,
    evidenceStatus,
    escalationReason,
    hasConflictingSources,
    conflictingSources,
    clarificationNeeded,
    clarificationQuestions,
    unsupportedClaimRequested,
    unsupportedClaimDetails,
  } = params;

  const supportedFacts: string[] = [];
  const missingOrUnestablishedFacts: string[] = [];

  if (expiredPoliciesExcluded.length > 0) {
    for (const exp of expiredPoliciesExcluded) {
      const reasonDesc =
        exp.effective_date > asOfDate
          ? `is not yet effective (effective ${exp.effective_date})`
          : exp.lifecycle_state === 'superseded' && !exp.expiration_date
          ? `was superseded`
          : `expired on ${exp.expiration_date || 'prior date'}`;
      supportedFacts.push(
        `Historical/Non-Applicable Policy Excluded: ${exp.policy_id} v${exp.version} ("${exp.title}") ${reasonDesc} and is NOT authoritative as of ${asOfDate}${
          exp.superseded_by_policy_id
            ? `; superseded by ${exp.superseded_by_policy_id}.`
            : '.'
        }`
      );
    }
  }

  if (expiredArticlesExcluded.length > 0) {
    for (const expArt of expiredArticlesExcluded) {
      supportedFacts.push(
        `Historical Knowledge Article Excluded: ${expArt.article_id} v${expArt.version} ("${expArt.title}") is expired/inactive as of ${asOfDate} and excluded from authoritative guidance.`
      );
    }
  }

  for (const pol of applicablePolicies) {
    supportedFacts.push(
      `[${pol.policy_id} v${pol.version} · ${pol.authoritative_section_ref} · Effective ${pol.effective_date}] ${pol.content}`
    );
  }

  for (const art of applicableArticles) {
    supportedFacts.push(
      `[${art.article_id} v${art.version} · Linked to ${art.primary_policy_id} v${art.primary_policy_version} · Effective ${art.effective_date}] ${art.summary}`
    );
  }

  if (evidenceStatus === 'unsupported_or_missing') {
    missingOrUnestablishedFacts.push(
      `No active institutional policy document in the four supported domains (Financial Aid, Registration, IT, Accessibility) establishes rules for: "${query}".`
    );
    missingOrUnestablishedFacts.push(
      `Recommended Action: Escalate to ${UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team} under rule ${UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id}.`
    );

    return {
      answer: `INSUFFICIENT POLICY EVIDENCE (HUMAN ESCALATION REQUIRED): Based on a search of the active institutional knowledge base as of ${asOfDate}, no applicable policy document or knowledge article establishes an authoritative rule for your inquiry. In accordance with institutional AI governance, CampusResolve AI does not fabricate unsupported policy rules, deadlines, or eligibility criteria. Reason for escalation: ${
        escalationReason || 'No matching active policy coverage.'
      }`,
      explanation: `General Explanatory Context: CampusResolve AI searched all active PolicyDocuments (POL-<domain>-2026-XXX) and KnowledgeArticles (KB-XXXXXX) across Financial Aid, Registration, IT, and Accessibility as of ${asOfDate}. Zero authoritative sources matched your question. You may escalate this inquiry to ${UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team} via the ticket workflow.`,
      supportedFacts,
      missingOrUnestablishedFacts,
    };
  }

  if (evidenceStatus === 'expired_only') {
    missingOrUnestablishedFacts.push(
      'Only expired, superseded, or not-yet-effective policy versions matched this topic; expired versions cannot be used as current institutional guidance.'
    );
    const expiredList = expiredPoliciesExcluded
      .map(
        (p) =>
          `${p.policy_id} v${p.version} (effective ${p.effective_date}${
            p.expiration_date ? `, expired ${p.expiration_date}` : ''
          })`
      )
      .join(', ');

    return {
      answer: `EXPIRED POLICY REJECTED AS CURRENT GUIDANCE (HUMAN VERIFICATION REQUIRED): The matched regulation(s) (${
        expiredList || 'historical source'
      }) are expired, superseded, or not in force as of the reference date (${asOfDate}). CampusResolve AI rejects expired or superseded versions as current policy authority and requires human review.`,
      explanation: `Version Applicability Explanation: Verified historical metadata confirms that ${
        expiredList || 'the matched source'
      } is not active as of ${asOfDate}. No active replacement version in the current repository establishes a rule for this query without human adjudication.`,
      supportedFacts,
      missingOrUnestablishedFacts,
    };
  }

  // Handle conflicting active sources explicitly without choosing arbitrarily
  if (hasConflictingSources && conflictingSources.length > 0) {
    for (const conflict of conflictingSources) {
      missingOrUnestablishedFacts.push(conflict.conflictSummary);
    }
    const routingRule = detectedCategory
      ? DOCUMENTED_ROUTING_RULES[detectedCategory]
      : null;
    const escalationTeam =
      routingRule?.escalation_assigned_team ||
      UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;

    const conflictDescriptions = conflictingSources
      .map(
        (c) =>
          `• Source A (${c.sourceAId} v${c.sourceAVersion}, effective ${c.sourceAEffectiveDate}, "${c.sourceATitle}") states: "${c.sourceAClaim}"\n• Source B (${c.sourceBId} v${c.sourceBVersion}, effective ${c.sourceBEffectiveDate}, "${c.sourceBTitle}") states: "${c.sourceBClaim}"`
      )
      .join('\n');

    return {
      answer: `CONFLICTING POLICY SOURCES IDENTIFIED (HUMAN ESCALATION REQUIRED): Multiple active institutional sources retrieved as of ${asOfDate} contain conflicting provisions (${conflictingSources
        .map(
          (c) =>
            `${c.sourceAId} v${c.sourceAVersion} vs. ${c.sourceBId} v${c.sourceBVersion}`
        )
        .join(
          '; '
        )}). CampusResolve AI does not choose arbitrarily between conflicting active sources. Both provisions are surfaced below for human adjudication by ${escalationTeam}:\n${conflictDescriptions}`,
      explanation: `Conflict & Evidence Explanation: Both sources are marked active/published as of ${asOfDate}, but specify divergent versions or policy clauses. Escalation to ${escalationTeam} is required for authoritative interpretation.`,
      supportedFacts,
      missingOrUnestablishedFacts,
    };
  }

  // Handle underspecified / ambiguous query when no single policy is yet pinned down
  if (applicablePolicies.length === 0 && clarificationNeeded) {
    for (const cq of clarificationQuestions) {
      missingOrUnestablishedFacts.push(`Clarification Required: ${cq}`);
    }
    return {
      answer: `CLARIFICATION REQUIRED (AMBIGUOUS INQUIRY): Your question could apply to multiple institutional policy domains or conditional procedures as of ${asOfDate}. Please clarify the following so CampusResolve AI can cite the exact governing policy version:\n${clarificationQuestions
        .map((q, idx) => `${idx + 1}. ${q}`)
        .join('\n')}`,
      explanation: `Ambiguity Explanation: Institutional deadlines and eligibility rules differ across Financial Aid (15 business days for SAP appeals), Registration (10 business days for add/drop; Week 8 for W withdrawal), IT (FIDO2/TOTP MFA), and Accessibility (5 business days for exam notice). Clarifying your domain and timing allows exact policy grounding.`,
      supportedFacts,
      missingOrUnestablishedFacts,
    };
  }

  const primaryPol = applicablePolicies[0];
  const primaryArt = applicableArticles[0];
  const routingRule = detectedCategory
    ? DOCUMENTED_ROUTING_RULES[detectedCategory]
    : null;

  const expiredNote =
    expiredPoliciesExcluded.length > 0
      ? `Rejected Expired/Superseded Policy Note: Historical version(s) (${expiredPoliciesExcluded
          .map(
            (p) =>
              `${p.policy_id} v${p.version}, effective ${p.effective_date}${
                p.expiration_date ? `, expired ${p.expiration_date}` : ''
              }${
                p.superseded_by_policy_id
                  ? `, superseded by ${p.superseded_by_policy_id}`
                  : ''
              }`
          )
          .join(
            '; '
          )}) were rejected as current guidance and excluded from active policy authority.`
      : '';

  if (unsupportedClaimRequested && unsupportedClaimDetails.length > 0) {
    for (const detail of unsupportedClaimDetails) {
      missingOrUnestablishedFacts.push(`Unsupported Fact Requested: ${detail}`);
    }
  }

  if (clarificationNeeded && clarificationQuestions.length > 0) {
    for (const cq of clarificationQuestions) {
      missingOrUnestablishedFacts.push(`Clarification Question: ${cq}`);
    }
  }

  if (
    evidenceStatus === 'partial_or_ambiguous' &&
    !unsupportedClaimRequested &&
    !clarificationNeeded
  ) {
    missingOrUnestablishedFacts.push(
      escalationReason ||
        'Exception, retroactive petition, or appeal approval requires discretionary committee review and cannot be automatically granted.'
    );
  }

  const unsupportedWarningPrefix = unsupportedClaimRequested
    ? `UNSUPPORTED FACT NOTICE: Available active policy sources (${primaryPol.policy_id} v${primaryPol.version}) do NOT establish the requested monetary fee, fine, stipend, or guarantee (${unsupportedClaimDetails.join(
        ' '
      )}). CampusResolve AI will not fabricate unestablished figures. Verified provisions that ARE established in ${primaryPol.policy_id} v${primaryPol.version} are provided below:`
    : '';

  const clarificationSuffix =
    clarificationNeeded && clarificationQuestions.length > 0
      ? `Clarification Needed to Confirm Exact Provision: ${clarificationQuestions.join(
          ' '
        )}`
      : '';

  const escalationNote =
    evidenceStatus === 'partial_or_ambiguous'
      ? `Because this inquiry involves an exception, formal appeal, unsupported claim, or conditional ambiguity, human review by ${
          routingRule?.escalation_assigned_team ||
          UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team
        } is recommended.`
      : '';

  const additionalPoliciesText =
    applicablePolicies.length > 1
      ? `Additional Applicable Policy Provisions: ${applicablePolicies
          .slice(1)
          .map(
            (p) =>
              `[${p.policy_id} v${p.version}, effective ${p.effective_date}, ${p.authoritative_section_ref}]: ${p.content}`
          )
          .join(' ')}`
      : '';

  const answer = [
    unsupportedWarningPrefix,
    `Grounded in active policy ${primaryPol.policy_id} (v${primaryPol.version}, effective ${primaryPol.effective_date}, ${primaryPol.authoritative_section_ref}: "${primaryPol.title}")${
      primaryArt
        ? ` and knowledge article ${primaryArt.article_id} (v${primaryArt.version})`
        : ''
    }:`,
    primaryPol.content,
    additionalPoliciesText,
    primaryArt
      ? `Operational Procedure (${primaryArt.article_id} v${primaryArt.version}): ${primaryArt.content}`
      : '',
    expiredNote.trim(),
    clarificationSuffix.trim(),
    escalationNote.trim(),
  ]
    .filter(Boolean)
    .join(' ');

  const explanation = [
    `Verified Policy Evidence: Cited directly from ${primaryPol.policy_id} v${primaryPol.version} (${primaryPol.authoritative_section_ref}, effective ${primaryPol.effective_date})${
      primaryArt
        ? ` and ${primaryArt.article_id} v${primaryArt.version} (effective ${primaryArt.effective_date})`
        : ''
    }.`,
    routingRule
      ? `General Operational Routing Context: Standard inquiries in '${detectedCategory}' route to ${routingRule.primary_assigned_team} under ${routingRule.rule_id}, while exceptions and appeals escalate to ${routingRule.escalation_assigned_team}.`
      : '',
    expiredNote.trim(),
    unsupportedClaimRequested
      ? `Limitation Statement: ${unsupportedClaimDetails.join(' ')}`
      : '',
    clarificationNeeded
      ? `Clarification Prompt: ${clarificationQuestions.join(' ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    answer,
    explanation,
    supportedFacts,
    missingOrUnestablishedFacts,
  };
}

function mapPolicyToCitedSourceDetail(
  p: PolicyDocumentRecord,
  asOfDate: string,
  isExcluded = false
): CitedSourceDetail {
  const app = evaluateSourceApplicability(p, asOfDate);
  const citation = `${p.policy_id} v${p.version} (${p.authoritative_section_ref}, Effective ${p.effective_date}${
    p.expiration_date ? `, Expired ${p.expiration_date}` : ''
  }): "${p.title}"`;

  return {
    sourceType: 'policy',
    id: p.policy_id,
    sourceId: p.policy_id,
    version: p.version,
    title: p.title,
    sourceDocumentTitle: p.title,
    domainOrCategory: p.domain,
    effectiveDate: p.effective_date,
    expirationDate: p.expiration_date,
    lifecycleState: p.lifecycle_state,
    sectionRef: p.authoritative_section_ref,
    relevantSectionOrPassage: `${p.authoritative_section_ref}: ${p.content}`,
    citation,
    summary: p.summary,
    content: p.content,
    sourceUrl: p.source_url,
    isSynthetic: p.is_synthetic_policy,
    supersedesPolicyId: p.supersedes_policy_id,
    supersededByPolicyId: p.superseded_by_policy_id,
    exclusionReason: isExcluded ? app.reason : undefined,
  };
}

function mapArticleToCitedSourceDetail(
  a: KnowledgeArticleRecord,
  asOfDate: string,
  isExcluded = false
): CitedSourceDetail {
  const app = evaluateSourceApplicability(a, asOfDate);
  const sectionRef = `Linked to ${a.primary_policy_id} v${a.primary_policy_version}`;
  const citation = `${a.article_id} v${a.version} (${sectionRef}, Effective ${a.effective_date}${
    a.expiration_date ? `, Expired ${a.expiration_date}` : ''
  }): "${a.title}"`;

  return {
    sourceType: 'article',
    id: a.article_id,
    sourceId: a.article_id,
    version: a.version,
    title: a.title,
    sourceDocumentTitle: a.title,
    domainOrCategory: a.category_id,
    effectiveDate: a.effective_date,
    expirationDate: a.expiration_date,
    lifecycleState: a.lifecycle_state,
    sectionRef,
    relevantSectionOrPassage: `${sectionRef}: ${a.content}`,
    citation,
    summary: a.summary,
    content: a.content,
    sourceUrl: a.source_url,
    isSynthetic: a.is_synthetic_article,
    exclusionReason: isExcluded ? app.reason : undefined,
  };
}

export async function processPolicyAssistantRequest(
  method: string | undefined,
  body: PolicyAssistantQueryInput | undefined,
  headers: Record<string, string | string[] | undefined>,
  injectedContext?: InjectedPolicyAssistantTestContext
): Promise<{ status: number; body: any }> {
  if ((method || '').toUpperCase() !== 'POST') {
    return {
      status: 405,
      body: {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST requests are supported on /api/ai/policy-assistant.',
      },
    };
  }

  let profile: VerifiedCallerIdentity;
  let client: any;
  let injectedServiceClient: any;

  if (injectedContext) {
    profile = injectedContext.profile;
    client = injectedContext.client;
    injectedServiceClient = injectedContext.serviceRoleClient;
    if (typeof client?.setAuthenticatedTestCaller === 'function') {
      client.setAuthenticatedTestCaller(profile);
    }
  } else {
    const caller = await verifyAuthenticatedProfileFromHeaders(headers);
    if (!caller.verified || !caller.profile || !caller.client) {
      return {
        status: 401,
        body: {
          ok: false,
          code: 'UNAUTHORIZED',
          message:
            caller.errorMessage ||
            'Authentication is required to use the AI Policy Assistant.',
        },
      };
    }
    profile = caller.profile;
    client = caller.client;
  }

  const auditClient = injectedContext
    ? injectedServiceClient || client
    : createServiceRoleSupabaseClient() || client;
  const action = body?.action || 'query';

  // --------------------------------------------------------------------------
  // ACTION: RECORD HELPFULNESS FEEDBACK ON RETRIEVAL LOG
  // --------------------------------------------------------------------------
  if (action === 'feedback') {
    const queryId = (body?.queryId || '').trim();
    if (!queryId || typeof body?.helpful !== 'boolean') {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'INVALID_FEEDBACK_PAYLOAD',
          message: 'queryId and boolean helpful flag are required.',
        },
      };
    }

    const { data: existingLog } = await auditClient
      .from('ai_retrieval_logs')
      .select('*')
      .eq('query_id', queryId)
      .maybeSingle();

    if (existingLog && existingLog.requester_profile_id !== profile.id) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'FORBIDDEN_CROSS_USER_AUDIT_LOG',
          message:
            'You are only authorized to submit feedback on your own AI policy retrieval sessions.',
        },
      };
    }

    const { data: updated, error } = await auditClient
      .from('ai_retrieval_logs')
      .update({ feedback_helpful: body.helpful })
      .eq('query_id', queryId)
      .eq('requester_profile_id', profile.id)
      .select('*')
      .maybeSingle();

    if (error) {
      return {
        status: 503,
        body: {
          ok: false,
          code: 'DATABASE_SCHEMA_NOT_APPLIED',
          errorCode: error.code,
          message: `Could not persist feedback in remote PostgreSQL table public.ai_retrieval_logs (${error.code}: ${error.message}).`,
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        retrievalLog: updated,
        message: 'Retrieval feedback recorded in remote PostgreSQL.',
      },
    };
  }

  // --------------------------------------------------------------------------
  // ACTION: LINK ESCALATED TICKET ID TO AI RETRIEVAL LOG
  // --------------------------------------------------------------------------
  if (action === 'link_escalation_ticket') {
    const queryId = (body?.queryId || '').trim();
    const ticketId = (body?.ticketId || '').trim();
    if (!queryId || !ticketId) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'INVALID_ESCALATION_LINK_PAYLOAD',
          message: 'queryId and ticketId are required to link an escalated ticket.',
        },
      };
    }

    const { data: existingLog } = await auditClient
      .from('ai_retrieval_logs')
      .select('*')
      .eq('query_id', queryId)
      .maybeSingle();

    if (existingLog && existingLog.requester_profile_id !== profile.id) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'FORBIDDEN_CROSS_USER_AUDIT_LOG',
          message:
            'You are only authorized to link escalation tickets to your own AI policy retrieval sessions.',
        },
      };
    }

    const { data: updated, error } = await auditClient
      .from('ai_retrieval_logs')
      .update({
        escalated_ticket_id: ticketId,
        escalation_triggered: true,
      })
      .eq('query_id', queryId)
      .eq('requester_profile_id', profile.id)
      .select('*')
      .maybeSingle();

    if (error) {
      return {
        status: 503,
        body: {
          ok: false,
          code: 'DATABASE_SCHEMA_NOT_APPLIED',
          errorCode: error.code,
          message: `Could not link escalated ticket ${ticketId} in public.ai_retrieval_logs (${error.code}: ${error.message}).`,
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        retrievalLog: updated,
        message: `Linked escalated ticket ${ticketId} to retrieval session ${queryId}.`,
      },
    };
  }

  // --------------------------------------------------------------------------
  // ACTION: GROUNDED POLICY QUERY
  // --------------------------------------------------------------------------
  const rawQuery = (body?.query || '').trim();
  if (rawQuery.length < 5) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'QUERY_TOO_SHORT',
        message: 'Please enter a specific policy question (minimum 5 characters).',
      },
    };
  }

  const asOfDate = (
    body?.asOfDate || new Date().toISOString().slice(0, 10)
  ).trim();

  // Retrieve policy documents, knowledge articles, and version history from Supabase
  const [polRes, artRes, histRes] = await Promise.all([
    client.from('policy_documents').select('*'),
    client.from('knowledge_articles').select('*'),
    client.from('policy_version_history').select('*'),
  ]);

  const fallbackCorpus = getReferenceCorpus();

  const rawPolicies: PolicyDocumentRecord[] =
    injectedContext?.customCorpus?.policies ??
    (polRes.data && polRes.data.length > 0
      ? (polRes.data as PolicyDocumentRecord[])
      : fallbackCorpus.policyDocuments);

  const rawArticles: KnowledgeArticleRecord[] =
    injectedContext?.customCorpus?.articles ??
    (artRes.data && artRes.data.length > 0
      ? (artRes.data as KnowledgeArticleRecord[])
      : fallbackCorpus.knowledgeArticles);

  const versionHistoryRecords: PolicyVersionHistoryRecord[] =
    injectedContext?.customCorpus?.policyVersionHistory ??
    ((histRes?.data || []) as PolicyVersionHistoryRecord[]);

  // Enforce RBAC & restricted-information access check
  const accessCheck = evaluatePolicyAssistantAccessControl({
    profile,
    body,
    policies: rawPolicies,
  });

  if (!accessCheck.authorized) {
    return {
      status: accessCheck.status,
      body: {
        ok: false,
        code: accessCheck.code,
        message: accessCheck.message,
      },
    };
  }

  const isAdminCaller =
    profile.actor_role === ActorRole.AcademicAdministrator ||
    profile.actor_role === ActorRole.PlatformAdministrator;

  // Non-admin callers may never retrieve unpublished draft policies or draft articles
  const policyDocuments = isAdminCaller
    ? rawPolicies
    : rawPolicies.filter((p) => p.lifecycle_state !== 'draft');

  const knowledgeArticles = isAdminCaller
    ? rawArticles
    : rawArticles.filter((a) => a.lifecycle_state !== 'draft');

  const retrieval = retrieveApplicablePolicyEvidence({
    query: rawQuery,
    policies: policyDocuments,
    articles: knowledgeArticles,
    asOfDateIso: `${asOfDate}T12:00:00.000Z`,
  });

  const routingRule = retrieval.detectedCategory
    ? DOCUMENTED_ROUTING_RULES[retrieval.detectedCategory]
    : null;
  const recommendedTeam = retrieval.escalationRecommended
    ? routingRule?.escalation_assigned_team ||
      UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team
    : routingRule?.primary_assigned_team ||
      UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
  const recommendedRoutingRuleId = retrieval.escalationRecommended
    ? routingRule?.rule_id || UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id
    : routingRule?.rule_id || UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id;

  // 1. Build deterministic evidence-grounded baseline synthesis
  let synthesized = buildDeterministicEvidenceSynthesis({
    query: rawQuery,
    asOfDate,
    detectedCategory: retrieval.detectedCategory,
    applicablePolicies: retrieval.applicablePolicies,
    applicableArticles: retrieval.applicableArticles,
    expiredPoliciesExcluded: retrieval.expiredPoliciesExcluded,
    expiredArticlesExcluded: retrieval.expiredArticlesExcluded,
    evidenceStatus: retrieval.evidenceStatus,
    escalationReason: retrieval.escalationReason,
    hasConflictingSources: Boolean(retrieval.hasConflictingSources),
    conflictingSources: retrieval.conflictingSources || [],
    clarificationNeeded: Boolean(retrieval.clarificationNeeded),
    clarificationQuestions: retrieval.clarificationQuestions || [],
    unsupportedClaimRequested: Boolean(retrieval.unsupportedClaimRequested),
    unsupportedClaimDetails: retrieval.unsupportedClaimDetails || [],
  });

  let synthesisMode: 'gemini_api' | 'deterministic_fallback' =
    'deterministic_fallback';
  let modelUsed = 'deterministic-rule-engine';
  let geminiApiStatus: 'succeeded' | 'fallback_after_error' | 'api_key_missing' =
    'api_key_missing';
  let geminiApiError: string | null = null;

  const evidenceContext = [
    ...retrieval.applicablePolicies.map(
      (p) =>
        `POLICY_ID: ${p.policy_id} | VERSION: ${p.version} | EFFECTIVE: ${p.effective_date} | SECTION: ${p.authoritative_section_ref} | TITLE: ${p.title}\nCONTENT: ${p.content}`
    ),
    ...retrieval.applicableArticles.map(
      (a) =>
        `ARTICLE_ID: ${a.article_id} | VERSION: ${a.version} | LINKED_POLICY: ${a.primary_policy_id} v${a.primary_policy_version} | EFFECTIVE: ${a.effective_date} | TITLE: ${a.title}\nCONTENT: ${a.content}`
    ),
  ].join('\n\n---\n\n');

  // 2. Optional injected Gemini synthesizer for deterministic automated testing of Gemini pipeline
  if (
    injectedContext?.customGeminiSynthesizer &&
    retrieval.applicablePolicies.length > 0 &&
    retrieval.evidenceStatus !== 'unsupported_or_missing' &&
    retrieval.evidenceStatus !== 'expired_only' &&
    !retrieval.hasConflictingSources
  ) {
    try {
      const customRes = await injectedContext.customGeminiSynthesizer({
        query: rawQuery,
        asOfDate,
        evidenceContext,
      });
      if (customRes && typeof customRes.groundedAnswer === 'string') {
        synthesized = {
          answer: customRes.groundedAnswer,
          explanation: customRes.explanation || synthesized.explanation,
          supportedFacts:
            customRes.supportedFacts?.length > 0
              ? customRes.supportedFacts
              : synthesized.supportedFacts,
          missingOrUnestablishedFacts:
            customRes.missingOrUnestablishedFacts?.length > 0
              ? customRes.missingOrUnestablishedFacts
              : synthesized.missingOrUnestablishedFacts,
        };
        synthesisMode = 'gemini_api';
        modelUsed = 'gemini-3-flash-preview';
        geminiApiStatus = 'succeeded';
      }
    } catch (err: any) {
      geminiApiStatus = 'fallback_after_error';
      geminiApiError =
        err instanceof Error ? err.message : String(err || 'Gemini API error');
    }
  } else {
    // 3. Call server-side Gemini API if GEMINI_API_KEY is configured and applicable non-conflicting evidence exists
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const hasRealGeminiKey =
      Boolean(apiKey) &&
      apiKey !== 'MY_GEMINI_API_KEY' &&
      !apiKey.startsWith('YOUR_');

    if (
      (!injectedContext || injectedContext.allowLiveGemini) &&
      hasRealGeminiKey &&
      retrieval.applicablePolicies.length > 0 &&
      retrieval.evidenceStatus !== 'unsupported_or_missing' &&
      retrieval.evidenceStatus !== 'expired_only' &&
      !retrieval.hasConflictingSources
    ) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const expiredContext =
        retrieval.expiredPoliciesExcluded.length > 0
          ? retrieval.expiredPoliciesExcluded
              .map(
                (p) =>
                  `EXPIRED_POLICY_ID: ${p.policy_id} v${p.version} (Expired ${p.expiration_date}) — REJECTED AS CURRENT AUTHORITY`
              )
              .join('\n')
          : 'None';

      const candidateModels = ['gemini-2.5-flash'];
      for (const candidateModel of candidateModels) {
        try {
          const callWithTimeout = (timeoutMs = 12000) =>
            Promise.race([
              ai.models.generateContent({
                model: candidateModel,
                contents: `User Policy Question: "${rawQuery}"\nReference Date: ${asOfDate}\n\nAPPLICABLE RETRIEVED EVIDENCE:\n${evidenceContext}\n\nEXCLUDED EXPIRED SOURCES:\n${expiredContext}`,
                config: {
                  systemInstruction:
                    'You are the CampusResolve AI Policy Assistant. Answer ONLY using the provided APPLICABLE RETRIEVED EVIDENCE. Cite the exact POLICY_ID (with version and effective date) and ARTICLE_ID (with version). Never invent policy rules, deadlines, fees, or numeric thresholds not explicitly written in the evidence. Explicitly reject any EXCLUDED EXPIRED SOURCES as current guidance. Clearly state if any aspect of the question is not established in the provided evidence and requires clarification or human escalation.',
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      groundedAnswer: {
                        type: Type.STRING,
                        description:
                          'Policy-grounded answer citing exact POLICY_ID vX.X (with effective date) and ARTICLE_ID vX.X.',
                      },
                      explanation: {
                        type: Type.STRING,
                        description:
                          'Explanation distinguishing verified policy provisions from general routing context and any unestablished facts.',
                      },
                      supportedFacts: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                          'Specific facts directly supported by the retrieved policy and article versions.',
                      },
                      missingOrUnestablishedFacts: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description:
                          'Any parts of the user question that cannot be established from the retrieved sources.',
                      },
                    },
                    required: [
                      'groundedAnswer',
                      'explanation',
                      'supportedFacts',
                      'missingOrUnestablishedFacts',
                    ],
                  },
                },
              }),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Gemini model ${candidateModel} timed out after ${timeoutMs}ms.`
                      )
                    ),
                  timeoutMs
                )
              ),
            ]);

          const response = await callWithTimeout(12000);

          const rawJson = (response.text ?? '').trim();
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (
              parsed &&
              typeof parsed.groundedAnswer === 'string' &&
              parsed.groundedAnswer.length >= 20
            ) {
              // Ensure exact primary policy ID and version are preserved in the synthesized answer
              const primaryPol = retrieval.applicablePolicies[0];
              const includesPrimaryCitation =
                parsed.groundedAnswer.includes(primaryPol.policy_id) &&
                parsed.groundedAnswer.includes(primaryPol.version);
              const verifiedAnswer = includesPrimaryCitation
                ? parsed.groundedAnswer
                : `[${primaryPol.policy_id} v${primaryPol.version}, Effective ${primaryPol.effective_date}] ${parsed.groundedAnswer}`;

              synthesized = {
                answer: verifiedAnswer,
                explanation:
                  typeof parsed.explanation === 'string' &&
                  parsed.explanation.length >= 10
                    ? parsed.explanation
                    : synthesized.explanation,
                supportedFacts:
                  Array.isArray(parsed.supportedFacts) &&
                  parsed.supportedFacts.length > 0
                    ? parsed.supportedFacts
                    : synthesized.supportedFacts,
                missingOrUnestablishedFacts:
                  Array.isArray(parsed.missingOrUnestablishedFacts) &&
                  parsed.missingOrUnestablishedFacts.length > 0
                    ? parsed.missingOrUnestablishedFacts
                    : synthesized.missingOrUnestablishedFacts,
              };
              synthesisMode = 'gemini_api';
              modelUsed = candidateModel;
              geminiApiStatus = 'succeeded';
              geminiApiError = null;
              break;
            }
          }
        } catch (err: any) {
          geminiApiStatus = 'fallback_after_error';
          geminiApiError =
            err instanceof Error
              ? err.message
              : String(err || 'Gemini API error');
        }
      }
    }
  }

  const queryId = `QRY-2026-${String(Date.now()).slice(-6)}`;
  const logRecord: AIRetrievalLogRecord = {
    query_id: queryId,
    requester_profile_id: profile.id,
    actor_role: profile.actor_role as ActorRole,
    user_query: rawQuery,
    detected_category: retrieval.detectedCategory,
    retrieved_policy_ids: retrieval.applicablePolicies.map((p) => p.policy_id),
    retrieved_policy_versions: retrieval.applicablePolicies.map(
      (p) => p.version
    ),
    retrieved_article_ids: retrieval.applicableArticles.map(
      (a) => a.article_id
    ),
    retrieved_article_versions: retrieval.applicableArticles.map(
      (a) => a.version
    ),
    expired_sources_excluded: [
      ...retrieval.expiredPoliciesExcluded.map(
        (p) => `${p.policy_id}@v${p.version}`
      ),
      ...retrieval.expiredArticlesExcluded.map(
        (a) => `${a.article_id}@v${a.version}`
      ),
    ],
    generated_response: synthesized.answer,
    retrieval_confidence: retrieval.retrievalConfidence,
    evidence_status: retrieval.evidenceStatus,
    escalation_triggered: retrieval.escalationRecommended,
    escalation_reason: retrieval.escalationReason,
    escalated_ticket_id: null,
    feedback_helpful: null,
    created_at: new Date().toISOString(),
  };

  // Persist logRecord to remote PostgreSQL public.ai_retrieval_logs
  const { error: logInsertErr } = await auditClient
    .from('ai_retrieval_logs')
    .insert(logRecord);

  const databasePersistence = {
    persistedToPostgres: !logInsertErr,
    table: 'public.ai_retrieval_logs',
    errorCode: logInsertErr?.code ?? null,
    errorMessage: logInsertErr?.message ?? null,
  };

  const citedSources: CitedSourceDetail[] = [
    ...retrieval.applicablePolicies.map((p) =>
      mapPolicyToCitedSourceDetail(p, asOfDate, false)
    ),
    ...retrieval.applicableArticles.map((a) =>
      mapArticleToCitedSourceDetail(a, asOfDate, false)
    ),
  ];

  const expiredSourcesExcludedDetails: CitedSourceDetail[] = [
    ...retrieval.expiredPoliciesExcluded.map((p) =>
      mapPolicyToCitedSourceDetail(p, asOfDate, true)
    ),
    ...retrieval.expiredArticlesExcluded.map((a) =>
      mapArticleToCitedSourceDetail(a, asOfDate, true)
    ),
  ];

  const relevantPolicyIds = new Set([
    ...retrieval.applicablePolicies.map((p) => p.policy_id),
    ...retrieval.expiredPoliciesExcluded.map((p) => p.policy_id),
  ]);
  const policyVersionHistoryMatched = versionHistoryRecords.filter((h) =>
    relevantPolicyIds.has(h.policy_id)
  );

  return {
    status: 200,
    body: {
      ok: true,
      // Structured Phase 6 Grounded Response Fields
      answer: synthesized.answer,
      explanation: synthesized.explanation,
      confidence: retrieval.retrievalConfidence,
      evidenceStatus: retrieval.evidenceStatus,
      clarificationNeeded: Boolean(retrieval.clarificationNeeded),
      clarificationQuestions: retrieval.clarificationQuestions || [],
      hasConflictingSources: Boolean(retrieval.hasConflictingSources),
      conflictingSources: retrieval.conflictingSources || [],
      unsupportedClaimRequested: Boolean(retrieval.unsupportedClaimRequested),
      unsupportedClaimDetails: retrieval.unsupportedClaimDetails || [],
      expiredPolicyRejected: Boolean(retrieval.expiredPolicyRejected),
      // Operational & Audit Metadata
      synthesisMode,
      modelUsed,
      geminiApiStatus,
      geminiApiError,
      databasePersistence,
      retrievalLog: logRecord,
      citedSources,
      expiredSourcesExcludedDetails,
      policyVersionHistoryMatched,
      supportedFacts: synthesized.supportedFacts,
      missingOrUnestablishedFacts: synthesized.missingOrUnestablishedFacts,
      recommendedEscalationTeam: recommendedTeam,
      recommendedRoutingRuleId,
    },
  };
}

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
            message: 'Failed writing policy assistant response.',
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

    const result = await processPolicyAssistantRequest(
      req.method,
      parsedBody,
      req.headers || {}
    );
    sendResponse(result.status, result.body);
  } catch (err) {
    sendResponse(500, {
      ok: false,
      code: 'SERVER_ERROR',
      message:
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred in the policy assistant service.',
    });
  }
}


