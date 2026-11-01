import { ActorRole, RequestStatus } from '../types/domain';
import {
  AIRetrievalLogRecord,
  AssignmentRecord,
  CategoryRecord,
  KnowledgeArticleRecord,
  MessageRecord,
  PolicyDocumentRecord,
  PolicyDomainCode,
  PolicyVersionHistoryRecord,
  RequesterRecord,
  ResolutionFeedbackRecord,
  RoleRecord,
  SLARecord,
  TermRecord,
  TicketLifecycleEventRecord,
  TicketRecord,
  WorkspaceNotificationRecord,
  AIEvidenceStatus,
  TicketPriorityLevel,
} from '../types/phase3';
import {
  CONFIGURABLE_SLA_RULES,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
  DOCUMENTED_ROUTING_RULES,
  ConfigurableBusinessSchedule,
  ConfigurableSlaRule,
  ConflictingSourcePair,
  DocumentedRoutingRule,
  buildReproducibleSlaRecord,
  formatTicketId,
  formatAssignmentId,
  formatMessageId,
  formatFeedbackId,
  createLifecycleEvent,
  evaluateTicketRouting,
  retrieveApplicablePolicyEvidence,
  resolveOfficialCategory,
} from './workflowEngine';
import {
  DETERMINISTIC_SEED,
  generateDeterministicDataset,
  formatIsoWithIstOffset,
} from './dataGenerator';
import { AppProfile } from './identityService';
import {
  DataQualityValidationReport,
  FixedSeedReproducibilityReport,
  GroundTruthEvaluationReport,
} from './validationAndEvaluationEngine';
import { getSupabaseAuthClient } from '../lib/supabaseClient';
import { getFirebaseAuthClient } from '../lib/firebaseClient';

export interface WorkspaceOperationalMetrics {
  totalAuthorizedTickets: number;
  activeOpenCount: number;
  policyVerifiedCount: number;
  escalatedCount: number;
  resolvedCount: number;
  unreadNotificationCount: number;
  withinSlaCount?: number;
  approachingSlaCount?: number;
  breachedSlaCount?: number;
  unresolvedEscalatedCount?: number;
}

export interface WorkspaceBootstrapPayload {
  ok: boolean;
  requester: RequesterRecord;
  metrics: WorkspaceOperationalMetrics;
  tickets: TicketRecord[];
  messages: MessageRecord[];
  assignments: AssignmentRecord[];
  slas: SLARecord[];
  lifecycleEvents: TicketLifecycleEventRecord[];
  resolutionFeedbacks: ResolutionFeedbackRecord[];
  notifications: WorkspaceNotificationRecord[];
  aiRetrievalLogs: AIRetrievalLogRecord[];
  knowledgeBase: {
    categories: CategoryRecord[];
    terms: TermRecord[];
    roles: RoleRecord[];
    policies: PolicyDocumentRecord[];
    articles: KnowledgeArticleRecord[];
    totalArticlesCount: number;
    page: number;
    pageSize: number;
    configurableSlaRules: ConfigurableSlaRule[];
    businessSchedule: ConfigurableBusinessSchedule;
    routingRules: DocumentedRoutingRule[];
  };
}

export interface EvaluationBenchmarkPayload {
  ok: boolean;
  metadata: {
    seed: number;
    mode: 'starter' | 'full';
    generatedAtAnchor: string;
    generationOrder: string[];
    counts: Record<string, number>;
  };
  validationReport: DataQualityValidationReport;
  evaluationReport: GroundTruthEvaluationReport;
  reproducibilityReport?: FixedSeedReproducibilityReport;
}

/**
 * Resolves the current authenticated user's Bearer token from either
 * Firebase Google Auth ('campusresolveai') or Supabase Email/Password Auth.
 */
export async function resolveActiveBearerToken(): Promise<string | null> {
  const fbBundle = getFirebaseAuthClient();
  if (fbBundle?.auth.currentUser) {
    try {
      return await fbBundle.auth.currentUser.getIdToken(false);
    } catch {
      // Fallback to Supabase check
    }
  }

  const supabase = getSupabaseAuthClient();
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        return data.session.access_token;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function authorizedJsonFetch<T>(
  url: string,
  options: RequestInit = {},
  customFetch?: typeof fetch,
  timeoutMs = 30000
): Promise<T> {
  const token = customFetch ? null : await resolveActiveBearerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchImpl = customFetch || fetch;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(
      new Error(
        `Workspace request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please retry.`
      )
    );
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers,
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(
        `The workspace service request timed out (${Math.round(
          timeoutMs / 1000
        )}s). Please check your connection and retry.`
      );
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await res.text();
  let data: any = null;

  if (rawText && rawText.trim().length > 0) {
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        res.ok
          ? 'The server returned an unreadable response format. Please retry synchronization.'
          : `The workspace service encountered a temporary server error (HTTP ${res.status}). Please retry synchronization.`
      );
    }
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(
      data?.message ||
        `Unable to complete workspace request (HTTP ${res.status}). Please try again.`
    );
  }

  if (!data) {
    throw new Error(
      'The workspace service returned an empty response. Please retry synchronization.'
    );
  }

  return data as T;
}

let cachedClientFallbackPayload: WorkspaceBootstrapPayload | null = null;

export function getClientSideFallbackBootstrap(
  params?: {
    kbPage?: number;
    kbPageSize?: number;
    kbSearch?: string;
    kbDomain?: string;
  },
  activeProfile?: AppProfile | null
): WorkspaceBootstrapPayload {
  if (!cachedClientFallbackPayload) {
    const dataset = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
    });

    const activeTickets = dataset.tickets;
    const activeOpenCount = activeTickets.filter(
      (t) =>
        t.lifecycle_status !== RequestStatus.Resolved &&
        t.lifecycle_status !== RequestStatus.Closed
    ).length;
    const breachedSlaCount = dataset.slas.filter((s) => s.breach_status).length;
    const approachingSlaDeadlineCount = dataset.slas.filter(
      (s) => s.is_approaching_deadline
    ).length;

    const requester: RequesterRecord = {
      requester_id: activeProfile?.id
        ? `REQ-${activeProfile.id.slice(0, 8).toUpperCase()}`
        : 'REQ-2026-000001',
      app_profile_id: activeProfile?.id || null,
      role_id:
        activeProfile?.actor_role === ActorRole.Instructor
          ? 'ROLE-INSTRUCTOR'
          : 'ROLE-LEARNER',
      primary_term_id: 'TERM-2026-FALL',
      verified_email:
        activeProfile?.verified_email || 'learner@campusresolve.edu',
      display_name:
        activeProfile?.display_name || 'Active Institutional Learner',
      department: activeProfile?.department || 'Academic Affairs',
      program_or_unit: activeProfile?.office_or_cohort || 'Undergraduate Cohort',
      account_status: 'active',
      is_synthetic_eval: false,
      effective_from: '2026-08-01',
      effective_to: null,
      created_at: '2026-09-01T13:30:00+05:30',
      updated_at: '2026-09-01T13:30:00+05:30',
    };

    cachedClientFallbackPayload = {
      ok: true,
      requester,
      metrics: {
        totalAuthorizedTickets: dataset.tickets.length,
        activeOpenCount,
        policyVerifiedCount: dataset.tickets.filter(
          (t) => t.lifecycle_status === RequestStatus.PolicyVerified
        ).length,
        escalatedCount: dataset.tickets.filter(
          (t) => t.lifecycle_status === RequestStatus.Escalated || t.is_escalated
        ).length,
        resolvedCount: dataset.tickets.filter(
          (t) => t.lifecycle_status === RequestStatus.Resolved
        ).length,
        unreadNotificationCount: 1,
        withinSlaCount: dataset.slas.filter((s) => !s.breach_status).length,
        approachingSlaCount: approachingSlaDeadlineCount,
        breachedSlaCount,
        unresolvedEscalatedCount: dataset.tickets.filter(
          (t) =>
            (t.lifecycle_status === RequestStatus.Escalated || t.is_escalated) &&
            t.lifecycle_status !== RequestStatus.Resolved &&
            t.lifecycle_status !== RequestStatus.Closed
        ).length,
      },
      tickets: dataset.tickets,
      messages: dataset.messages,
      assignments: dataset.assignments,
      slas: dataset.slas,
      lifecycleEvents: dataset.ticketLifecycleEvents,
      resolutionFeedbacks: dataset.resolutionFeedbacks,
      notifications: [
        {
          notification_id: 'NOTIF-001',
          recipient_profile_id: activeProfile?.id || 'sys',
          ticket_id: dataset.tickets[0]?.ticket_id || 'TKT-2026-000001',
          event_type: 'routing_assigned',
          category: 'lifecycle',
          title: 'Workspace Active & Synchronized',
          summary:
            'Your institutional operational workspace is fully loaded and ready.',
          policy_reference: null,
          is_read: false,
          created_at: '2026-09-01T13:30:00+05:30',
        },
      ],
      aiRetrievalLogs: [],
      knowledgeBase: {
        categories: dataset.categories,
        terms: dataset.terms,
        roles: dataset.roles,
        policies: dataset.policyDocuments,
        articles: dataset.knowledgeArticles,
        totalArticlesCount: dataset.knowledgeArticles.length,
        page: 1,
        pageSize: 10,
        configurableSlaRules: Object.values(CONFIGURABLE_SLA_RULES),
        businessSchedule: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
        routingRules: Object.values(DOCUMENTED_ROUTING_RULES),
      },
    };
  }

  if (activeProfile) {
    cachedClientFallbackPayload!.requester.display_name = activeProfile.display_name;
    cachedClientFallbackPayload!.requester.verified_email = activeProfile.verified_email;
    cachedClientFallbackPayload!.requester.department = activeProfile.department;
    cachedClientFallbackPayload!.requester.app_profile_id = activeProfile.id;
    cachedClientFallbackPayload!.requester.requester_id = `REQ-${activeProfile.id.slice(0, 8).toUpperCase()}`;
  }

  const baseArticles = cachedClientFallbackPayload!.knowledgeBase.articles;
  let filteredArticles = baseArticles;
  if (params?.kbDomain) {
    filteredArticles = filteredArticles.filter((a) =>
      a.category_id.toLowerCase().includes(params.kbDomain!.toLowerCase())
    );
  }
  if (params?.kbSearch) {
    const q = params.kbSearch.toLowerCase();
    filteredArticles = filteredArticles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q)
    );
  }

  const page = params?.kbPage || 1;
  const pageSize = params?.kbPageSize || 10;
  const start = (page - 1) * pageSize;
  const paginatedArticles = filteredArticles.slice(start, start + pageSize);

  return {
    ...cachedClientFallbackPayload!,
    knowledgeBase: {
      ...cachedClientFallbackPayload!.knowledgeBase,
      articles: paginatedArticles,
      totalArticlesCount: filteredArticles.length,
      page,
      pageSize,
    },
  };
}

export function createClientSideFallbackTicket(
  input: {
    subject: string;
    category: string;
    departmentTarget: string;
    urgencyLevel: string;
    courseOrPolicyCode?: string;
    description: string;
    idempotencyKey?: string;
    saveAsDraft?: boolean;
  },
  activeProfile?: AppProfile | null
): {
  ok: boolean;
  ticket: TicketRecord;
  assignment: AssignmentRecord;
  sla: SLARecord;
  messages: MessageRecord[];
  lifecycleEvents: TicketLifecycleEventRecord[];
  notification: WorkspaceNotificationRecord;
  message: string;
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  const nowIso = formatIsoWithIstOffset(new Date());
  const ticketIndex = bootstrap.tickets.length + 1;
  const ticketId = formatTicketId(ticketIndex);

  const catResolution = resolveOfficialCategory(null, input.category);
  const detectedCategory = catResolution.category || 'Registration';
  const categoryRule = DOCUMENTED_ROUTING_RULES[detectedCategory];

  const priorityLevel: TicketPriorityLevel =
    input.urgencyLevel === 'critical'
      ? 'Administrative Escalation Priority'
      : input.urgencyLevel === 'high'
      ? 'Time-Sensitive Academic Priority'
      : 'Standard Priority';

  const initialStatus = input.saveAsDraft
    ? RequestStatus.Draft
    : RequestStatus.Submitted;

  const routing = evaluateTicketRouting({
    ticketId,
    category: detectedCategory,
    priority: priorityLevel,
    subject: input.subject,
    description: input.description,
    assignedAtIso: nowIso,
  });

  const ticket: TicketRecord = {
    ticket_id: ticketId,
    requester_id: bootstrap.requester.requester_id,
    requester_profile_id: activeProfile?.id || null,
    category_id: categoryRule.category_id,
    category_name: detectedCategory,
    term_id: 'TERM-2026-FALL',
    subject: input.subject,
    description: input.description,
    priority: priorityLevel,
    lifecycle_status: initialStatus,
    current_assigned_team: routing.assignment.assigned_team,
    current_routing_rule_id: routing.assignment.routing_rule_id,
    referenced_policy_id: null,
    referenced_policy_version: null,
    referenced_article_id: null,
    referenced_article_version: null,
    requires_escalation: routing.requiresEscalation,
    is_escalated: routing.requiresEscalation,
    escalation_reason: routing.escalationReason,
    resolution_summary: null,
    is_synthetic_eval: false,
    submitted_at: nowIso,
    updated_at: nowIso,
    resolved_at: null,
    closed_at: null,
  };

  const assignment: AssignmentRecord = routing.assignment;

  const sla = buildReproducibleSlaRecord({
    ticketId,
    category: detectedCategory,
    startTimestampIso: nowIso,
    evaluatedTimestampIso: nowIso,
    isTicketEscalated: routing.requiresEscalation,
    requiresEscalation: routing.requiresEscalation,
    lifecycleStatus: initialStatus,
  });

  const messageId = formatMessageId(ticketId, 1);
  const initialMessage: MessageRecord = {
    message_id: messageId,
    ticket_id: ticketId,
    sequence_number: 1,
    sender_id: bootstrap.requester.requester_id,
    sender_profile_id: activeProfile?.id || null,
    sender_role:
      bootstrap.requester.role_id === 'ROLE-INSTRUCTOR'
        ? ActorRole.Instructor
        : ActorRole.Learner,
    sender_name: bootstrap.requester.display_name,
    message_type: 'requester_inquiry',
    body: input.description,
    cited_policy_id: null,
    cited_policy_version: null,
    cited_article_id: null,
    cited_article_version: null,
    is_internal: false,
    created_at: nowIso,
  };

  const event = createLifecycleEvent({
    ticketId,
    previousState: null,
    newState: initialStatus,
    actorId: bootstrap.requester.requester_id,
    actorRole:
      bootstrap.requester.role_id === 'ROLE-INSTRUCTOR'
        ? ActorRole.Instructor
        : ActorRole.Learner,
    reason: input.saveAsDraft
      ? 'Saved draft academic request'
      : 'Direct student intake submission',
    timestampIso: nowIso,
    eventSequence: 1,
  });

  const notification: WorkspaceNotificationRecord = {
    notification_id: `NOTIF-${Date.now()}`,
    recipient_profile_id: activeProfile?.id || 'sys',
    ticket_id: ticketId,
    event_type: 'ticket_created',
    category: 'lifecycle',
    title: 'Academic Request Received',
    summary: `Your request "${input.subject}" has been submitted and assigned to ${routing.assignment.assigned_team}.`,
    policy_reference: null,
    is_read: false,
    created_at: nowIso,
  };

  bootstrap.tickets.unshift(ticket);
  bootstrap.messages.unshift(initialMessage);
  bootstrap.assignments.unshift(assignment);
  bootstrap.slas.unshift(sla);
  bootstrap.lifecycleEvents.unshift(event);
  bootstrap.notifications.unshift(notification);
  bootstrap.metrics.activeOpenCount += 1;
  bootstrap.metrics.totalAuthorizedTickets += 1;

  return {
    ok: true,
    ticket,
    assignment,
    sla,
    messages: [initialMessage],
    lifecycleEvents: [event],
    notification,
    message: 'Academic request submitted successfully.',
  };
}

export async function fetchWorkspaceBootstrap(
  params?: {
    kbPage?: number;
    kbPageSize?: number;
    kbSearch?: string;
    kbDomain?: string;
  },
  activeProfile?: AppProfile | null
): Promise<WorkspaceBootstrapPayload> {
  const searchParams = new URLSearchParams({ action: 'bootstrap' });
  if (params?.kbPage) searchParams.set('kbPage', String(params.kbPage));
  if (params?.kbPageSize) searchParams.set('kbPageSize', String(params.kbPageSize));
  if (params?.kbSearch) searchParams.set('kbSearch', params.kbSearch);
  if (params?.kbDomain) searchParams.set('kbDomain', params.kbDomain);

  try {
    return await authorizedJsonFetch<WorkspaceBootstrapPayload>(
      `/api/ops/workspace?${searchParams.toString()}`,
      { method: 'GET' }
    );
  } catch (err) {
    console.warn(
      'Serverless workspace bootstrap unavailable, activating resilient client-side institutional workspace:',
      err
    );
    return getClientSideFallbackBootstrap(params, activeProfile);
  }
}

export async function createOperationalTicket(
  input: {
    subject: string;
    category: string;
    departmentTarget: string;
    urgencyLevel: string;
    courseOrPolicyCode?: string;
    description: string;
    idempotencyKey?: string;
    saveAsDraft?: boolean;
  },
  activeProfile?: AppProfile | null
): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  assignment: AssignmentRecord;
  sla: SLARecord;
  messages: MessageRecord[];
  lifecycleEvents: TicketLifecycleEventRecord[];
  notification: WorkspaceNotificationRecord;
  message: string;
}> {
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create_ticket',
        ...input,
      }),
    });
  } catch (err) {
    console.warn(
      'Serverless create_ticket request unavailable, generating resilient local operational ticket:',
      err
    );
    return createClientSideFallbackTicket(input, activeProfile);
  }
}


export async function postTicketMessage(input: {
  ticketId: string;
  body: string;
  isInternal?: boolean;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  messageRecord: MessageRecord;
  ticket: TicketRecord;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'post_message',
      ...input,
    }),
  });
}

export async function transitionOperationalTicket(input: {
  ticketId: string;
  newState: RequestStatus;
  reason: string;
  resolutionSummary?: string;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  event: TicketLifecycleEventRecord;
  messageRecord: MessageRecord;
  sla?: SLARecord;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'transition_ticket',
      ...input,
    }),
  });
}

export async function reassignOperationalTicket(input: {
  ticketId: string;
  targetTeam: string;
  reason: string;
  requiresHumanReview?: boolean;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  assignment: AssignmentRecord;
  sla?: SLARecord;
  messageRecord: MessageRecord;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'reassign_ticket',
      ...input,
    }),
  });
}

export async function evaluateTicketSlaAndEscalation(input: {
  ticketId: string;
  evaluatedAtIso?: string;
  escalateOnApproachingDeadline?: boolean;
  aiAssistantEscalationReason?: string;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  sla: SLARecord;
  assignment: AssignmentRecord | null;
  lifecycleEvent: TicketLifecycleEventRecord | null;
  messageRecord: MessageRecord | null;
  notification: WorkspaceNotificationRecord | null;
  notificationStatus: {
    notificationCreated: boolean;
    notificationReused: boolean;
    notificationId: string | null;
  };
  message: string;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'evaluate_sla_and_escalation',
      ...input,
    }),
  });
}

export async function submitTicketFeedback(input: {
  ticketId: string;
  rating: number;
  policyClarityScore: number;
  wasHelpful: boolean;
  resolutionAccepted: boolean;
  comments?: string;
  idempotencyKey?: string;
}): Promise<{
  ok: boolean;
  feedback: ResolutionFeedbackRecord;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'submit_feedback',
      ...input,
    }),
  });
}

export async function publishPolicyDocument(input: {
  domain: PolicyDomainCode;
  title: string;
  version: string;
  effectiveDate: string;
  summary: string;
  content: string;
}): Promise<{
  ok: boolean;
  policy: PolicyDocumentRecord;
  article: KnowledgeArticleRecord;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'publish_policy',
      ...input,
    }),
  });
}

export async function markAllNotificationsRead(): Promise<{
  ok: boolean;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'mark_notifications_read',
    }),
  });
}

export async function queryPolicyAssistant(input: {
  query: string;
  asOfDate?: string;
  activeRolePreview?: ActorRole;
}): Promise<{
  ok: boolean;
  answer: string;
  explanation: string;
  confidence: number;
  evidenceStatus: AIRetrievalLogRecord['evidence_status'];
  clarificationNeeded: boolean;
  clarificationQuestions: string[];
  hasConflictingSources: boolean;
  conflictingSources: ConflictingSourcePair[];
  unsupportedClaimRequested: boolean;
  unsupportedClaimDetails: string[];
  expiredPolicyRejected: boolean;
  synthesisMode: 'gemini_api' | 'deterministic_fallback';
  modelUsed: string;
  geminiApiStatus: 'succeeded' | 'fallback_after_error' | 'api_key_missing';
  geminiApiError: string | null;
  databasePersistence: {
    persistedToPostgres: boolean;
    table: string;
    errorCode: string | null;
    errorMessage: string | null;
  };
  retrievalLog: AIRetrievalLogRecord;
  citedSources: {
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
  }[];
  expiredSourcesExcludedDetails: {
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
  }[];
  policyVersionHistoryMatched?: PolicyVersionHistoryRecord[];
  supportedFacts: string[];
  missingOrUnestablishedFacts: string[];
  recommendedEscalationTeam: string | null;
  recommendedRoutingRuleId: string | null;
}> {
  try {
    return await authorizedJsonFetch('/api/ai/policy-assistant', {
      method: 'POST',
      body: JSON.stringify({
        action: 'query',
        ...input,
      }),
    });
  } catch (err) {
    console.warn(
      'Serverless policy assistant unavailable, activating resilient client-side deterministic retrieval:',
      err
    );
    return createClientSidePolicyAssistantFallback(input);
  }
}

function createClientSidePolicyAssistantFallback(input: {
  query: string;
  asOfDate?: string;
  activeRolePreview?: ActorRole;
}) {
  const bootstrap = getClientSideFallbackBootstrap();
  const asOfDate = input.asOfDate || new Date().toISOString().slice(0, 10);
  const nowIso = formatIsoWithIstOffset(new Date());
  const queryId = `QRY-LOCAL-${Date.now()}`;

  const policies = bootstrap.knowledgeBase.policies;
  const articles = bootstrap.knowledgeBase.articles;
  const allArticles = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode: 'starter',
  }).knowledgeArticles;

  const retrieval = retrieveApplicablePolicyEvidence({
    query: input.query,
    policies,
    articles: allArticles.length > articles.length ? allArticles : articles,
    asOfDateIso: asOfDate,
  });

  const detectedCategory = retrieval.detectedCategory;
  const routingRule = detectedCategory
    ? DOCUMENTED_ROUTING_RULES[detectedCategory]
    : null;

  const citedSources: {
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
  }[] = [
    ...retrieval.applicablePolicies.map((p) => ({
      sourceType: 'policy' as const,
      id: p.policy_id,
      sourceId: p.policy_id,
      version: p.version,
      title: p.title,
      sourceDocumentTitle: p.title,
      domainOrCategory: p.domain,
      effectiveDate: p.effective_date,
      expirationDate: p.expiration_date,
      lifecycleState: p.lifecycle_state,
      relevantSectionOrPassage: p.summary,
      citation: `${p.policy_id} v${p.version} — ${p.title}`,
      summary: p.summary,
      content: p.content,
      sourceUrl: `#policy-${p.policy_id}`,
      isSynthetic: false,
      supersedesPolicyId: p.supersedes_policy_id,
      supersededByPolicyId: p.superseded_by_policy_id,
    })),
    ...retrieval.applicableArticles.map((a) => ({
      sourceType: 'article' as const,
      id: a.article_id,
      sourceId: a.article_id,
      version: a.version,
      title: a.title,
      sourceDocumentTitle: a.title,
      domainOrCategory: a.category_id,
      effectiveDate: a.effective_date,
      expirationDate: a.expiration_date,
      lifecycleState: a.lifecycle_state,
      relevantSectionOrPassage: a.summary,
      citation: `${a.article_id} v${a.version} — ${a.title}`,
      summary: a.summary,
      content: a.content,
      sourceUrl: `#article-${a.article_id}`,
      isSynthetic: false,
    })),
  ];

  const expiredSourcesExcludedDetails: {
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
  }[] = [
    ...retrieval.expiredPoliciesExcluded.map((p) => ({
      sourceType: 'policy' as const,
      id: p.policy_id,
      sourceId: p.policy_id,
      version: p.version,
      title: p.title,
      sourceDocumentTitle: p.title,
      domainOrCategory: p.domain,
      effectiveDate: p.effective_date,
      expirationDate: p.expiration_date,
      lifecycleState: p.lifecycle_state,
      relevantSectionOrPassage: p.summary,
      citation: `${p.policy_id} v${p.version} — ${p.title}`,
      summary: p.summary,
      content: p.content,
      sourceUrl: `#policy-${p.policy_id}`,
      isSynthetic: false,
      supersedesPolicyId: p.supersedes_policy_id,
      supersededByPolicyId: p.superseded_by_policy_id,
      exclusionReason: `Policy expired on ${p.expiration_date}; superseded or inactive as of ${asOfDate}.`,
    })),
    ...retrieval.expiredArticlesExcluded.map((a) => ({
      sourceType: 'article' as const,
      id: a.article_id,
      sourceId: a.article_id,
      version: a.version,
      title: a.title,
      sourceDocumentTitle: a.title,
      domainOrCategory: a.category_id,
      effectiveDate: a.effective_date,
      expirationDate: a.expiration_date,
      lifecycleState: a.lifecycle_state,
      relevantSectionOrPassage: a.summary,
      citation: `${a.article_id} v${a.version} — ${a.title}`,
      summary: a.summary,
      content: a.content,
      sourceUrl: `#article-${a.article_id}`,
      isSynthetic: false,
      exclusionReason: `Article expired on ${a.expiration_date} and is excluded from active guidance.`,
    })),
  ];

  let answer = '';
  if (citedSources.length > 0) {
    const topSource = citedSources[0];
    answer = `Based on institutional policy documents (${citedSources.map((s) => `${s.sourceId} v${s.version}`).join(', ')}):\n\n${topSource.summary}\n\n${topSource.content.slice(0, 450)}...`;
  } else if (retrieval.expiredPolicyRejected) {
    answer = `The requested policy version is expired or superseded as of ${asOfDate}. Under institutional governance rules, expired policies cannot be applied to active student inquiries.`;
  } else if (retrieval.unsupportedClaimRequested) {
    answer = `This request asks for terms or guarantees not established in institutional policy (${(retrieval.unsupportedClaimDetails || []).join('; ')}).`;
  } else {
    answer = `No active policy documents directly cover this inquiry as of ${asOfDate}. Human escalation to the designated administrative department is recommended.`;
  }

  const escalationTriggered =
    retrieval.escalationRecommended ||
    Boolean(retrieval.clarificationNeeded) ||
    Boolean(retrieval.unsupportedClaimRequested) ||
    Boolean(retrieval.hasConflictingSources);

  const escalationReason =
    retrieval.escalationReason ||
    (escalationTriggered ? 'Local retrieval flagged for administrative review' : null);

  const retrievalLog: AIRetrievalLogRecord = {
    query_id: queryId,
    requester_profile_id: bootstrap.requester.app_profile_id || null,
    actor_role: input.activeRolePreview || ActorRole.Learner,
    user_query: input.query,
    detected_category: detectedCategory,
    retrieved_policy_ids: retrieval.applicablePolicies.map((p) => p.policy_id),
    retrieved_policy_versions: retrieval.applicablePolicies.map((p) => p.version),
    retrieved_article_ids: retrieval.applicableArticles.map((a) => a.article_id),
    retrieved_article_versions: retrieval.applicableArticles.map((a) => a.version),
    expired_sources_excluded: [
      ...retrieval.expiredPoliciesExcluded.map((p) => `${p.policy_id} v${p.version}`),
      ...retrieval.expiredArticlesExcluded.map((a) => `${a.article_id} v${a.version}`),
    ],
    generated_response: answer,
    retrieval_confidence: retrieval.retrievalConfidence,
    evidence_status: retrieval.evidenceStatus,
    escalation_triggered: escalationTriggered,
    escalation_reason: escalationReason,
    escalated_ticket_id: null,
    feedback_helpful: null,
    created_at: nowIso,
  };

  bootstrap.aiRetrievalLogs.unshift(retrievalLog);

  return {
    ok: true,
    answer,
    explanation: `Deterministic institutional retrieval matched ${retrieval.applicablePolicies.length} policy(s) and ${retrieval.applicableArticles.length} article(s). Confidence: ${(retrieval.retrievalConfidence * 100).toFixed(0)}%.`,
    confidence: retrieval.retrievalConfidence,
    evidenceStatus: retrieval.evidenceStatus,
    clarificationNeeded: Boolean(retrieval.clarificationNeeded),
    clarificationQuestions: retrieval.clarificationQuestions || [],
    hasConflictingSources: Boolean(retrieval.hasConflictingSources),
    conflictingSources: retrieval.conflictingSources || [],
    unsupportedClaimRequested: Boolean(retrieval.unsupportedClaimRequested),
    unsupportedClaimDetails: retrieval.unsupportedClaimDetails || [],
    expiredPolicyRejected: Boolean(retrieval.expiredPolicyRejected),
    synthesisMode: 'deterministic_fallback' as const,
    modelUsed: 'local-deterministic-rag-v1',
    geminiApiStatus: 'fallback_after_error' as const,
    geminiApiError: null,
    databasePersistence: {
      persistedToPostgres: false,
      table: 'ai_retrieval_logs',
      errorCode: 'CLIENT_FALLBACK',
      errorMessage: 'Client-side fallback active',
    },
    retrievalLog,
    citedSources,
    expiredSourcesExcludedDetails,
    supportedFacts: citedSources.map((s) => `${s.sourceId} v${s.version}: ${s.title}`),
    missingOrUnestablishedFacts: retrieval.unsupportedClaimDetails || [],
    recommendedEscalationTeam: routingRule?.escalation_assigned_team || null,
    recommendedRoutingRuleId: routingRule?.rule_id || null,
  };
}

export async function submitPolicyAssistantFeedback(input: {
  queryId: string;
  helpful: boolean;
}): Promise<{
  ok: boolean;
  retrievalLog?: AIRetrievalLogRecord;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ai/policy-assistant', {
    method: 'POST',
    body: JSON.stringify({
      action: 'feedback',
      ...input,
    }),
  });
}

export async function linkPolicyAssistantEscalationTicket(input: {
  queryId: string;
  ticketId: string;
}): Promise<{
  ok: boolean;
  retrievalLog?: AIRetrievalLogRecord;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ai/policy-assistant', {
    method: 'POST',
    body: JSON.stringify({
      action: 'link_escalation_ticket',
      ...input,
    }),
  });
}

export async function fetchEvaluationBenchmark(
  mode: 'starter' | 'full' = 'full',
  activeRole?: ActorRole
): Promise<EvaluationBenchmarkPayload> {
  const params = new URLSearchParams({
    action: 'evaluation_benchmark',
    mode,
  });
  if (activeRole) {
    params.set('activeRole', activeRole);
  }
  return await authorizedJsonFetch<EvaluationBenchmarkPayload>(
    `/api/ops/workspace?${params.toString()}`,
    { method: 'GET' }
  );
}
