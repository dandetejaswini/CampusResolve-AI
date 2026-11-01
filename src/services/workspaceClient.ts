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
} from '../types/phase3';
import {
  ConfigurableBusinessSchedule,
  ConfigurableSlaRule,
  ConflictingSourcePair,
  DocumentedRoutingRule,
} from './workflowEngine';
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

async function authorizedJsonFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await resolveActiveBearerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json();
  if (!res.ok || data?.ok === false) {
    throw new Error(
      data?.message || `Workspace API error (HTTP ${res.status})`
    );
  }
  return data as T;
}

export async function fetchWorkspaceBootstrap(params?: {
  kbPage?: number;
  kbPageSize?: number;
  kbSearch?: string;
  kbDomain?: string;
}): Promise<WorkspaceBootstrapPayload> {
  const searchParams = new URLSearchParams({ action: 'bootstrap' });
  if (params?.kbPage) searchParams.set('kbPage', String(params.kbPage));
  if (params?.kbPageSize) searchParams.set('kbPageSize', String(params.kbPageSize));
  if (params?.kbSearch) searchParams.set('kbSearch', params.kbSearch);
  if (params?.kbDomain) searchParams.set('kbDomain', params.kbDomain);

  return await authorizedJsonFetch<WorkspaceBootstrapPayload>(
    `/api/ops/workspace?${searchParams.toString()}`,
    { method: 'GET' }
  );
}

export async function createOperationalTicket(input: {
  subject: string;
  category: string;
  departmentTarget: string;
  urgencyLevel: string;
  courseOrPolicyCode?: string;
  description: string;
}): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  assignment: AssignmentRecord;
  sla: SLARecord;
  messages: MessageRecord[];
  lifecycleEvents: TicketLifecycleEventRecord[];
  notification: WorkspaceNotificationRecord;
  message: string;
}> {
  return await authorizedJsonFetch('/api/ops/workspace', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_ticket',
      ...input,
    }),
  });
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
  return await authorizedJsonFetch('/api/ai/policy-assistant', {
    method: 'POST',
    body: JSON.stringify({
      action: 'query',
      ...input,
    }),
  });
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
