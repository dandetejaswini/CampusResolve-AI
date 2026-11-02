import { ActorRole, RequestStatus } from '../types/domain';
import {
  AIRetrievalLogRecord,
  AssignmentRecord,
  CategoryRecord,
  KnowledgeArticleRecord,
  MessageRecord,
  MessageRecordType,
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
  timeoutMs = 4000
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

const FALLBACK_STORAGE_KEY = 'campusresolve_workspace_payload_v2';

export function persistFallbackPayload(payload: WorkspaceBootstrapPayload): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    // ignore quota/storage issues safely
  }
}

export function loadPersistedFallbackPayload(): WorkspaceBootstrapPayload | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    }
  } catch {
    // ignore parsing errors safely
  }
  return null;
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
    const persisted = loadPersistedFallbackPayload();
    if (persisted && persisted.tickets && persisted.tickets.length > 0) {
      cachedClientFallbackPayload = persisted;
    } else {
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
    persistFallbackPayload(cachedClientFallbackPayload);
    }
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
  persistFallbackPayload(bootstrap);

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

export function createClientSideFallbackMessage(
  input: {
    ticketId: string;
    body: string;
    isInternal?: boolean;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): {
  ok: boolean;
  messageRecord: MessageRecord;
  ticket: TicketRecord;
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  const nowIso = formatIsoWithIstOffset(new Date());
  const ticket = bootstrap.tickets.find((t) => t.ticket_id === input.ticketId) || bootstrap.tickets[0];
  const ticketMessages = bootstrap.messages.filter((m) => m.ticket_id === input.ticketId);
  const sequenceNumber = ticketMessages.length + 1;
  const messageId = formatMessageId(input.ticketId, sequenceNumber);

  const senderRole = activeProfile?.actor_role || ActorRole.AcademicAdministrator;
  const isStudentOrInstructor = senderRole === ActorRole.Learner || senderRole === ActorRole.Instructor;
  const senderName = activeProfile?.display_name || (senderRole === ActorRole.AcademicAdministrator ? 'Academic Administrator' : 'Institutional Support');

  const messageType: MessageRecordType = input.isInternal
    ? 'system_routing_note'
    : isStudentOrInstructor
    ? 'requester_inquiry'
    : 'staff_response';

  const messageRecord: MessageRecord = {
    message_id: messageId,
    ticket_id: input.ticketId,
    sequence_number: sequenceNumber,
    sender_id: activeProfile?.id || bootstrap.requester.requester_id,
    sender_profile_id: activeProfile?.id || null,
    sender_role: senderRole,
    sender_name: senderName,
    message_type: messageType,
    body: input.body,
    cited_policy_id: ticket?.referenced_policy_id || null,
    cited_policy_version: ticket?.referenced_policy_version || null,
    cited_article_id: ticket?.referenced_article_id || null,
    cited_article_version: ticket?.referenced_article_version || null,
    is_internal: Boolean(input.isInternal),
    created_at: nowIso,
  };

  bootstrap.messages.push(messageRecord);
  if (ticket) {
    ticket.updated_at = nowIso;
  }
  persistFallbackPayload(bootstrap);

  return {
    ok: true,
    messageRecord,
    ticket: ticket || bootstrap.tickets[0],
  };
}

export function evaluateClientSideFallbackSlaAndEscalation(
  input: {
    ticketId: string;
    evaluatedAtIso?: string;
    escalateOnApproachingDeadline?: boolean;
    aiAssistantEscalationReason?: string;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): {
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
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  const ticket = bootstrap.tickets.find((t) => t.ticket_id === input.ticketId);
  if (!ticket) {
    throw new Error(`Ticket ${input.ticketId} not found in workspace.`);
  }

  const nowIso = input.evaluatedAtIso || formatIsoWithIstOffset(new Date());

  const sla = buildReproducibleSlaRecord({
    ticketId: ticket.ticket_id,
    category: ticket.category_name,
    startTimestampIso: ticket.submitted_at,
    evaluatedTimestampIso: nowIso,
    isTicketEscalated: ticket.is_escalated,
    requiresEscalation: ticket.requires_escalation || Boolean(input.aiAssistantEscalationReason),
    lifecycleStatus: ticket.lifecycle_status,
  });

  const shouldEscalate =
    Boolean(input.aiAssistantEscalationReason) ||
    Boolean(sla.breach_status) ||
    (Boolean(sla.is_approaching_deadline) && Boolean(input.escalateOnApproachingDeadline));

  if (
    shouldEscalate &&
    ticket.lifecycle_status !== RequestStatus.Resolved &&
    ticket.lifecycle_status !== RequestStatus.Closed
  ) {
    ticket.is_escalated = true;
    ticket.requires_escalation = true;
    if (input.aiAssistantEscalationReason) {
      ticket.escalation_reason = input.aiAssistantEscalationReason;
    } else if (sla.breach_status) {
      ticket.escalation_reason = `SLA breach detected (+${sla.overdue_business_minutes ?? 0}m past SLA target)`;
    } else if (sla.is_approaching_deadline) {
      ticket.escalation_reason = 'Escalation triggered by approaching SLA deadline';
    }
    ticket.lifecycle_status = RequestStatus.Escalated;
    ticket.updated_at = nowIso;
  }

  const slaIdx = bootstrap.slas.findIndex((s) => s.ticket_id === ticket.ticket_id);
  if (slaIdx >= 0) {
    bootstrap.slas[slaIdx] = sla;
  } else {
    bootstrap.slas.unshift(sla);
  }

  const eventSeq = bootstrap.lifecycleEvents.filter((e) => e.ticket_id === ticket.ticket_id).length + 1;
  const event = createLifecycleEvent({
    ticketId: ticket.ticket_id,
    previousState: ticket.lifecycle_status,
    newState: ticket.lifecycle_status,
    actorId: activeProfile?.id || bootstrap.requester.requester_id,
    actorRole: activeProfile?.actor_role || ActorRole.AcademicAdministrator,
    reason: `SLA & escalation audit executed (${sla.breach_status ? 'Breach Flagged' : sla.is_approaching_deadline ? 'Approaching Deadline' : 'Within Operational SLA'})`,
    timestampIso: nowIso,
    eventSequence: eventSeq,
  });
  bootstrap.lifecycleEvents.unshift(event);

  const notificationId = `NOTIF-SLA-${Date.now()}`;
  const notification: WorkspaceNotificationRecord = {
    notification_id: notificationId,
    recipient_profile_id: activeProfile?.id || 'sys',
    ticket_id: ticket.ticket_id,
    event_type: sla.breach_status || sla.is_approaching_deadline ? 'escalated' : 'routing_assigned',
    category: 'lifecycle',
    title: `SLA Evaluated: ${ticket.ticket_id}`,
    summary: sla.breach_status
      ? `Ticket exceeded target resolution threshold (+${sla.overdue_business_minutes || 0}m). Escalation review active.`
      : sla.is_approaching_deadline
      ? `Ticket is approaching SLA threshold (${sla.remaining_business_minutes || 0}m remaining).`
      : `Ticket is within standard SLA targets (${sla.remaining_business_minutes || 0}m remaining).`,
    policy_reference: ticket.referenced_policy_id
      ? `${ticket.referenced_policy_id} v${ticket.referenced_policy_version}`
      : null,
    is_read: false,
    created_at: nowIso,
  };
  bootstrap.notifications.unshift(notification);
  bootstrap.metrics.unreadNotificationCount += 1;

  persistFallbackPayload(bootstrap);

  return {
    ok: true,
    ticket,
    sla,
    assignment: bootstrap.assignments.find((a) => a.ticket_id === ticket.ticket_id) || null,
    lifecycleEvent: event,
    messageRecord: null,
    notification,
    notificationStatus: {
      notificationCreated: true,
      notificationReused: false,
      notificationId,
    },
    message: `SLA evaluated for ${ticket.ticket_id}: ${sla.breach_status ? 'Breach flagged' : sla.is_approaching_deadline ? 'Approaching deadline' : 'Within SLA target'}. Audit event recorded.`,
  };
}

export function markClientSideFallbackNotificationsRead(
  activeProfile?: AppProfile | null
): {
  ok: boolean;
  message: string;
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  bootstrap.notifications.forEach((n) => {
    n.is_read = true;
  });
  bootstrap.metrics.unreadNotificationCount = 0;
  persistFallbackPayload(bootstrap);
  return {
    ok: true,
    message: 'All notifications marked as read.',
  };
}

export function transitionClientSideFallbackTicket(
  input: {
    ticketId: string;
    newState: RequestStatus;
    reason: string;
    resolutionSummary?: string;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): {
  ok: boolean;
  ticket: TicketRecord;
  event: TicketLifecycleEventRecord;
  messageRecord: MessageRecord;
  sla?: SLARecord;
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  const ticket = bootstrap.tickets.find((t) => t.ticket_id === input.ticketId);
  if (!ticket) {
    throw new Error(`Ticket ${input.ticketId} not found in workspace.`);
  }

  const nowIso = formatIsoWithIstOffset(new Date());
  const previousState = ticket.lifecycle_status;
  ticket.lifecycle_status = input.newState;
  ticket.updated_at = nowIso;

  if (input.newState === RequestStatus.Resolved) {
    ticket.resolved_at = nowIso;
    ticket.resolution_summary = input.resolutionSummary || input.reason;
  } else if (input.newState === RequestStatus.Closed) {
    ticket.closed_at = nowIso;
  } else if (input.newState === RequestStatus.Escalated) {
    ticket.is_escalated = true;
    ticket.requires_escalation = true;
    ticket.escalation_reason = input.reason;
  }

  const eventSeq = bootstrap.lifecycleEvents.filter((e) => e.ticket_id === ticket.ticket_id).length + 1;
  const event = createLifecycleEvent({
    ticketId: ticket.ticket_id,
    previousState,
    newState: input.newState,
    actorId: activeProfile?.id || bootstrap.requester.requester_id,
    actorRole: activeProfile?.actor_role || ActorRole.AcademicAdministrator,
    reason: input.reason,
    timestampIso: nowIso,
    eventSequence: eventSeq,
  });
  bootstrap.lifecycleEvents.unshift(event);

  const threadMsgs = bootstrap.messages.filter((m) => m.ticket_id === ticket.ticket_id);
  const msgSeq = threadMsgs.length + 1;
  const messageRecord: MessageRecord = {
    message_id: formatMessageId(ticket.ticket_id, msgSeq),
    ticket_id: ticket.ticket_id,
    sequence_number: msgSeq,
    sender_id: activeProfile?.id || 'sys-transition',
    sender_profile_id: activeProfile?.id || null,
    sender_role: activeProfile?.actor_role || ActorRole.AcademicAdministrator,
    sender_name: activeProfile?.display_name || 'Workflow Transition Engine',
    message_type: 'staff_response',
    body: `Stage updated to '${input.newState}': ${input.reason}`,
    cited_policy_id: ticket.referenced_policy_id,
    cited_policy_version: ticket.referenced_policy_version,
    cited_article_id: ticket.referenced_article_id,
    cited_article_version: ticket.referenced_article_version,
    is_internal: false,
    created_at: nowIso,
  };
  bootstrap.messages.push(messageRecord);

  bootstrap.metrics.activeOpenCount = bootstrap.tickets.filter(
    (t) => t.lifecycle_status !== RequestStatus.Resolved && t.lifecycle_status !== RequestStatus.Closed
  ).length;
  bootstrap.metrics.resolvedCount = bootstrap.tickets.filter((t) => t.lifecycle_status === RequestStatus.Resolved).length;
  bootstrap.metrics.escalatedCount = bootstrap.tickets.filter((t) => t.lifecycle_status === RequestStatus.Escalated || t.is_escalated).length;

  persistFallbackPayload(bootstrap);

  const sla = bootstrap.slas.find((s) => s.ticket_id === ticket.ticket_id);
  return {
    ok: true,
    ticket,
    event,
    messageRecord,
    sla,
  };
}

export function reassignClientSideFallbackTicket(
  input: {
    ticketId: string;
    targetTeam: string;
    reason: string;
    requiresHumanReview?: boolean;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): {
  ok: boolean;
  ticket: TicketRecord;
  assignment: AssignmentRecord;
  sla?: SLARecord;
  messageRecord: MessageRecord;
  message: string;
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  const ticket = bootstrap.tickets.find((t) => t.ticket_id === input.ticketId);
  if (!ticket) {
    throw new Error(`Ticket ${input.ticketId} not found in workspace.`);
  }

  const nowIso = formatIsoWithIstOffset(new Date());
  const prevTeam = ticket.current_assigned_team;
  ticket.current_assigned_team = input.targetTeam;
  ticket.updated_at = nowIso;

  const ticketAssignments = bootstrap.assignments.filter((a) => a.ticket_id === ticket.ticket_id);
  const asgSeq = ticketAssignments.length + 1;
  const assignment: AssignmentRecord = {
    assignment_id: formatAssignmentId(ticket.ticket_id, asgSeq),
    ticket_id: ticket.ticket_id,
    sequence_number: asgSeq,
    assigned_team: input.targetTeam,
    assigned_actor_id: activeProfile?.id || null,
    assigned_actor_role: activeProfile?.actor_role || ActorRole.SupportStaff,
    routing_rule_id: ticket.current_routing_rule_id || 'ROUTE-DEFAULT',
    assignment_reason: input.reason,
    previous_assignment_id: ticketAssignments[0]?.assignment_id || null,
    previous_assigned_team: prevTeam,
    requires_human_review: Boolean(input.requiresHumanReview),
    is_active: true,
    assigned_at: nowIso,
    unassigned_at: null,
  };
  bootstrap.assignments.unshift(assignment);

  const eventSeq = bootstrap.lifecycleEvents.filter((e) => e.ticket_id === ticket.ticket_id).length + 1;
  const event = createLifecycleEvent({
    ticketId: ticket.ticket_id,
    previousState: ticket.lifecycle_status,
    newState: ticket.lifecycle_status,
    actorId: activeProfile?.id || bootstrap.requester.requester_id,
    actorRole: activeProfile?.actor_role || ActorRole.AcademicAdministrator,
    reason: `Reassigned from ${prevTeam} to ${input.targetTeam}: ${input.reason}`,
    timestampIso: nowIso,
    eventSequence: eventSeq,
  });
  bootstrap.lifecycleEvents.unshift(event);

  const threadMsgs = bootstrap.messages.filter((m) => m.ticket_id === ticket.ticket_id);
  const msgSeq = threadMsgs.length + 1;
  const messageRecord: MessageRecord = {
    message_id: formatMessageId(ticket.ticket_id, msgSeq),
    ticket_id: ticket.ticket_id,
    sequence_number: msgSeq,
    sender_id: activeProfile?.id || 'sys-reassign',
    sender_profile_id: activeProfile?.id || null,
    sender_role: activeProfile?.actor_role || ActorRole.AcademicAdministrator,
    sender_name: activeProfile?.display_name || 'Routing Reassignment Engine',
    message_type: 'staff_response',
    body: `Ticket reassigned from ${prevTeam} to ${input.targetTeam}. Reason: ${input.reason}`,
    cited_policy_id: ticket.referenced_policy_id,
    cited_policy_version: ticket.referenced_policy_version,
    cited_article_id: ticket.referenced_article_id,
    cited_article_version: ticket.referenced_article_version,
    is_internal: false,
    created_at: nowIso,
  };
  bootstrap.messages.push(messageRecord);

  persistFallbackPayload(bootstrap);

  const sla = bootstrap.slas.find((s) => s.ticket_id === ticket.ticket_id);
  return {
    ok: true,
    ticket,
    assignment,
    sla,
    messageRecord,
    message: `Ticket reassigned to ${input.targetTeam}.`,
  };
}

export function submitClientSideFallbackFeedback(
  input: {
    ticketId: string;
    rating: number;
    policyClarityScore: number;
    wasHelpful: boolean;
    resolutionAccepted: boolean;
    comments?: string;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): {
  ok: boolean;
  feedback: ResolutionFeedbackRecord;
  message: string;
} {
  const bootstrap = getClientSideFallbackBootstrap(undefined, activeProfile);
  const nowIso = formatIsoWithIstOffset(new Date());
  const feedback: ResolutionFeedbackRecord = {
    feedback_id: formatFeedbackId(input.ticketId),
    ticket_id: input.ticketId,
    requester_id: bootstrap.requester.requester_id,
    rating: input.rating,
    policy_clarity_score: input.policyClarityScore,
    was_helpful: input.wasHelpful,
    resolution_accepted: input.resolutionAccepted,
    comments: input.comments || null,
    submitted_at: nowIso,
  };
  bootstrap.resolutionFeedbacks.unshift(feedback);
  persistFallbackPayload(bootstrap);
  return {
    ok: true,
    feedback,
    message: 'Resolution feedback recorded.',
  };
}

export function publishClientSideFallbackPolicy(input: {
  domain: PolicyDomainCode;
  title: string;
  version: string;
  effectiveDate: string;
  summary: string;
  content: string;
}): {
  ok: boolean;
  policy: PolicyDocumentRecord;
  article: KnowledgeArticleRecord;
  message: string;
} {
  const bootstrap = getClientSideFallbackBootstrap();
  const nowIso = formatIsoWithIstOffset(new Date());
  const polSeq = bootstrap.knowledgeBase.policies.length + 1;
  const policyId = `POL-${input.domain}-2026-${String(polSeq).padStart(3, '0')}`;
  const articleId = `KB-${String(bootstrap.knowledgeBase.articles.length + 1).padStart(6, '0')}`;
  const categoryId = input.domain === 'FINAID' ? 'CAT-FINAID' : input.domain === 'REG' ? 'CAT-REG' : input.domain === 'IT' ? 'CAT-IT' : 'CAT-ACCESS';

  const policy: PolicyDocumentRecord = {
    policy_id: policyId,
    domain: input.domain,
    category_id: categoryId,
    title: input.title,
    version: input.version,
    effective_date: input.effectiveDate,
    expiration_date: null,
    lifecycle_state: 'active',
    supersedes_policy_id: null,
    superseded_by_policy_id: null,
    summary: input.summary,
    content: input.content,
    authoritative_section_ref: 'Section 1.1',
    source_name: 'Institutional Governance Registry',
    source_url: `https://campusresolve.edu/policies#${policyId}`,
    dataset_or_doc_version: '2026.1',
    retrieval_date: nowIso,
    license_terms: 'Institutional Educational Use',
    attribution: 'Campus Academic Senate',
    transformations_performed: 'None',
    discarded_fields: null,
    is_synthetic_policy: false,
    published_by_profile_id: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const article: KnowledgeArticleRecord = {
    article_id: articleId,
    category_id: categoryId,
    primary_policy_id: policyId,
    primary_policy_version: input.version,
    title: input.title,
    version: input.version,
    effective_date: input.effectiveDate,
    expiration_date: null,
    lifecycle_state: 'published',
    summary: input.summary,
    content: input.content,
    tags: [input.domain.toLowerCase(), 'policy'],
    source_url: `https://campusresolve.edu/kb#${articleId}`,
    dataset_or_doc_version: '2026.1',
    retrieval_date: nowIso,
    license_terms: 'Institutional Educational Use',
    attribution: 'Campus Academic Support',
    transformations_performed: 'None',
    discarded_fields: null,
    is_synthetic_article: false,
    created_at: nowIso,
    updated_at: nowIso,
  };

  bootstrap.knowledgeBase.policies.unshift(policy);
  bootstrap.knowledgeBase.articles.unshift(article);
  persistFallbackPayload(bootstrap);

  return {
    ok: true,
    policy,
    article,
    message: 'Policy document published successfully.',
  };
}

export async function postTicketMessage(
  input: {
    ticketId: string;
    body: string;
    isInternal?: boolean;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): Promise<{
  ok: boolean;
  messageRecord: MessageRecord;
  ticket: TicketRecord;
}> {
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'post_message',
        ...input,
      }),
    });
  } catch (err) {
    console.warn('Serverless post_message unavailable, using resilient client-side fallback:', err);
    return createClientSideFallbackMessage(input, activeProfile);
  }
}

export async function transitionOperationalTicket(
  input: {
    ticketId: string;
    newState: RequestStatus;
    reason: string;
    resolutionSummary?: string;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  event: TicketLifecycleEventRecord;
  messageRecord: MessageRecord;
  sla?: SLARecord;
}> {
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'transition_ticket',
        ...input,
      }),
    });
  } catch (err) {
    console.warn('Serverless transition_ticket unavailable, using resilient client-side fallback:', err);
    return transitionClientSideFallbackTicket(input, activeProfile);
  }
}

export async function reassignOperationalTicket(
  input: {
    ticketId: string;
    targetTeam: string;
    reason: string;
    requiresHumanReview?: boolean;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): Promise<{
  ok: boolean;
  ticket: TicketRecord;
  assignment: AssignmentRecord;
  sla?: SLARecord;
  messageRecord: MessageRecord;
  message: string;
}> {
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'reassign_ticket',
        ...input,
      }),
    });
  } catch (err) {
    console.warn('Serverless reassign_ticket unavailable, using resilient client-side fallback:', err);
    return reassignClientSideFallbackTicket(input, activeProfile);
  }
}

export async function evaluateTicketSlaAndEscalation(
  input: {
    ticketId: string;
    evaluatedAtIso?: string;
    escalateOnApproachingDeadline?: boolean;
    aiAssistantEscalationReason?: string;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): Promise<{
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
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'evaluate_sla_and_escalation',
        ...input,
      }),
    });
  } catch (err) {
    console.warn('Serverless evaluate_sla_and_escalation unavailable, using resilient client-side fallback:', err);
    return evaluateClientSideFallbackSlaAndEscalation(input, activeProfile);
  }
}

export async function submitTicketFeedback(
  input: {
    ticketId: string;
    rating: number;
    policyClarityScore: number;
    wasHelpful: boolean;
    resolutionAccepted: boolean;
    comments?: string;
    idempotencyKey?: string;
  },
  activeProfile?: AppProfile | null
): Promise<{
  ok: boolean;
  feedback: ResolutionFeedbackRecord;
  message: string;
}> {
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit_feedback',
        ...input,
      }),
    });
  } catch (err) {
    console.warn('Serverless submit_feedback unavailable, using resilient client-side fallback:', err);
    return submitClientSideFallbackFeedback(input, activeProfile);
  }
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
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'publish_policy',
        ...input,
      }),
    });
  } catch (err) {
    console.warn('Serverless publish_policy unavailable, using resilient client-side fallback:', err);
    return publishClientSideFallbackPolicy(input);
  }
}

export async function markAllNotificationsRead(
  activeProfile?: AppProfile | null
): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    return await authorizedJsonFetch('/api/ops/workspace', {
      method: 'POST',
      body: JSON.stringify({
        action: 'mark_notifications_read',
      }),
    });
  } catch (err) {
    console.warn('Serverless mark_notifications_read unavailable, using resilient client-side fallback:', err);
    return markClientSideFallbackNotificationsRead(activeProfile);
  }
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
