import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ActorRole, RequestStatus } from '../../src/types/domain.js';
import {
  AIRetrievalLogRecord,
  AssignmentRecord,
  CategoryRecord,
  KnowledgeArticleRecord,
  MessageRecord,
  OfficialCategoryName,
  PolicyArticleLinkRecord,
  PolicyDocumentRecord,
  PolicyDomainCode,
  RequesterRecord,
  ResolutionFeedbackRecord,
  RoleRecord,
  SLARecord,
  TermRecord,
  TicketArticleLinkRecord,
  TicketLifecycleEventRecord,
  TicketPolicyLinkRecord,
  TicketPriorityLevel,
  TicketRecord,
  WorkspaceNotificationRecord,
} from '../../src/types/phase3.js';
import {
  CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026,
  CONFIGURABLE_SLA_RULES,
  DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
  DOCUMENTED_ASSIGNMENT_TEAMS,
  DOCUMENTED_ROUTING_RULES,
  buildReproducibleSlaRecord,
  createLifecycleEvent,
  createReassignmentRecord,
  enrichSlaRecordWithOperationalMetrics,
  evaluateReassignmentAuthorization,
  evaluateTicketEscalationAndExceptions,
  evaluateTicketRouting,
  evaluateTransitionAuthorization,
  formatAssignmentId,
  formatFeedbackId,
  formatKnowledgeArticleId,
  formatMessageId,
  formatPolicyId,
  formatTicketId,
  isValidLifecycleTransition,
  resolveOfficialCategory,
  retrieveApplicablePolicyEvidence,
  toDbSlaRow,
  validateResolutionTransition,
  validateSlaConfiguration,
  validateTicketAssignmentAndRouting,
} from '../../src/services/workflowEngine.js';
import {
  DETERMINISTIC_SEED,
  generateDeterministicDataset,
} from '../../src/services/dataGenerator.js';
import {
  evaluateOperationalAnomaliesAgainstGroundTruth,
  runDatasetValidationSuite,
  verifyFixedSeedReproducibility,
} from '../../src/services/validationAndEvaluationEngine.js';

export interface VerifiedCallerIdentity {
  id: string;
  auth_provider: 'supabase_email' | 'firebase_google';
  provider_subject: string;
  verified_email: string;
  display_name: string;
  department: string;
  office_or_cohort: string | null;
  actor_role: ActorRole;
  account_status: string;
}

export interface InjectedWorkspaceTestContext {
  profile: VerifiedCallerIdentity;
  client: SupabaseClient;
  serviceRoleClient?: SupabaseClient | null;
}

// Idempotency & duplicate submission protection cache (Phase 5 Section 10)
const idempotencyResponseCache = new Map<
  string,
  { timestampMs: number; status: number; body: any }
>();

export function clearWorkspaceIdempotencyCache(): void {
  idempotencyResponseCache.clear();
}

/**
 * Maps a TypeScript TicketLifecycleEventRecord to remote PostgreSQL `public.ticket_lifecycle_events`
 * columns (`transition_reason`, `actor_profile_id`, `actor_display_name`, `recorded_at`).
 */
export function toDbLifecycleEventRow(
  ev: TicketLifecycleEventRecord,
  actorProfileId?: string | null,
  actorDisplayName?: string
): Record<string, unknown> {
  return {
    event_id: ev.event_id,
    ticket_id: ev.ticket_id,
    previous_state: ev.previous_state,
    new_state: ev.new_state,
    transition_reason: ev.reason,
    actor_profile_id: actorProfileId ?? null,
    actor_role: ev.actor_role,
    actor_display_name: actorDisplayName || ev.actor_id,
    recorded_at: ev.event_timestamp,
  };
}

/**
 * Normalizes a database row from `public.ticket_lifecycle_events` back into `TicketLifecycleEventRecord`.
 */
export function fromDbLifecycleEventRow(row: any): TicketLifecycleEventRecord {
  return {
    event_id: row.event_id,
    ticket_id: row.ticket_id,
    previous_state: row.previous_state ?? null,
    new_state: row.new_state,
    actor_id: row.actor_id || row.actor_display_name || 'SYSTEM',
    actor_role: row.actor_role,
    reason: row.reason || row.transition_reason || '',
    referenced_policy_id: row.referenced_policy_id ?? null,
    referenced_policy_version: row.referenced_policy_version ?? null,
    referenced_article_id: row.referenced_article_id ?? null,
    referenced_article_version: row.referenced_article_version ?? null,
    event_timestamp:
      row.event_timestamp || row.recorded_at || new Date().toISOString(),
  };
}

/**
 * Maps a TypeScript MessageRecord to remote PostgreSQL `public.messages` columns
 * (`sender_actor_id`, `sender_display_name`, `sent_at`, and constrained `message_type`).
 */
export function toDbMessageRow(msg: MessageRecord): Record<string, unknown> {
  const dbMessageType =
    msg.message_type === 'escalation_handoff'
      ? 'escalation_notice'
      : msg.message_type === 'resolution_summary'
      ? 'resolution_delivery'
      : msg.message_type;

  const policyCitation = msg.cited_policy_id
    ? `${msg.cited_policy_id}${
        msg.cited_policy_version ? ` v${msg.cited_policy_version}` : ''
      }`
    : null;

  return {
    message_id: msg.message_id,
    ticket_id: msg.ticket_id,
    sequence_number: msg.sequence_number,
    sender_actor_id: msg.sender_id,
    sender_profile_id: msg.sender_profile_id ?? null,
    sender_role: msg.sender_role,
    sender_display_name: msg.sender_name,
    message_type: dbMessageType,
    body: msg.body,
    policy_citation: policyCitation,
    cited_policy_id: msg.cited_policy_id ?? null,
    cited_policy_version: msg.cited_policy_version ?? null,
    cited_article_id: msg.cited_article_id ?? null,
    cited_article_version: msg.cited_article_version ?? null,
    is_internal: Boolean(msg.is_internal),
    sent_at: msg.created_at,
  };
}

/**
 * Normalizes a database row from `public.messages` back into `MessageRecord`.
 */
export function fromDbMessageRow(row: any): MessageRecord {
  const rawType = row.message_type;
  const normalizedType: MessageRecord['message_type'] =
    rawType === 'escalation_notice'
      ? 'escalation_handoff'
      : rawType === 'resolution_delivery'
      ? 'resolution_summary'
      : rawType;

  return {
    message_id: row.message_id,
    ticket_id: row.ticket_id,
    sequence_number: Number(row.sequence_number),
    sender_id: row.sender_id || row.sender_actor_id || 'SYSTEM',
    sender_profile_id: row.sender_profile_id ?? null,
    sender_role: row.sender_role,
    sender_name: row.sender_name || row.sender_display_name || 'System',
    message_type: normalizedType,
    body: row.body,
    cited_policy_id: row.cited_policy_id ?? null,
    cited_policy_version: row.cited_policy_version ?? null,
    cited_article_id: row.cited_article_id ?? null,
    cited_article_version: row.cited_article_version ?? null,
    is_internal: Boolean(row.is_internal),
    created_at: row.created_at || row.sent_at || new Date().toISOString(),
  };
}

export const REQUIRED_PHASE3_TABLES = [
  'roles',
  'terms',
  'requesters',
  'categories',
  'policy_documents',
  'policy_version_history',
  'knowledge_articles',
  'policy_article_links',
  'tickets',
  'ticket_policy_links',
  'ticket_article_links',
  'ticket_lifecycle_events',
  'messages',
  'assignments',
  'slas',
  'resolution_feedbacks',
  'ai_retrieval_logs',
  'workspace_notifications',
] as const;

let cachedReferenceBundle: ReturnType<typeof generateDeterministicDataset> | null =
  null;

function getDeterministicReferenceBundle() {
  if (!cachedReferenceBundle) {
    cachedReferenceBundle = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
      ticketCount: 50,
      knowledgeArticleCount: 200,
    });
  }
  return cachedReferenceBundle;
}

export function getReferenceCorpus(): {
  roles: RoleRecord[];
  terms: TermRecord[];
  categories: CategoryRecord[];
  policyDocuments: PolicyDocumentRecord[];
  knowledgeArticles: KnowledgeArticleRecord[];
  policyArticleLinks: PolicyArticleLinkRecord[];
} {
  const base = getDeterministicReferenceBundle();
  return {
    roles: base.roles,
    terms: base.terms,
    categories: base.categories,
    policyDocuments: base.policyDocuments,
    knowledgeArticles: base.knowledgeArticles,
    policyArticleLinks: base.policyArticleLinks,
  };
}

export function createScopedSupabaseClient(bearerToken: string): SupabaseClient {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://llotsqzeppiltosllxvx.supabase.co'
  ).trim();
  const supabaseKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  return createClient(supabaseUrl, supabaseKey, {
    accessToken: async () => bearerToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Creates a privileged server-side Supabase client using the server-only
 * SUPABASE_SERVICE_ROLE_KEY to perform audit log writes (e.g. ticket_lifecycle_events,
 * ai_retrieval_logs) that are strictly forbidden to browser/client-side tokens.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const serviceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Verifies the caller's Bearer token against Supabase `public.app_profiles` using RLS.
 */
export async function verifyAuthenticatedProfileFromHeaders(
  headers: Record<string, string | string[] | undefined>
): Promise<{
  verified: boolean;
  profile?: VerifiedCallerIdentity;
  bearerToken?: string;
  client?: SupabaseClient;
  errorMessage?: string;
}> {
  const authHeaderRaw =
    headers['authorization'] || headers['Authorization'];
  const authHeader = Array.isArray(authHeaderRaw)
    ? authHeaderRaw[0]
    : authHeaderRaw;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      verified: false,
      errorMessage: 'Missing Authorization Bearer token.',
    };
  }

  const bearerToken = authHeader.slice('Bearer '.length).trim();
  if (!bearerToken) {
    return {
      verified: false,
      errorMessage: 'Empty Authorization Bearer token.',
    };
  }

  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const supabaseKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    return {
      verified: false,
      errorMessage:
        'Supabase environment variables are not configured on the server.',
    };
  }

  try {
    const client = createScopedSupabaseClient(bearerToken);

    const { data, error } = await client
      .from('app_profiles')
      .select(
        'id, auth_provider, provider_subject, verified_email, display_name, department, office_or_cohort, actor_role, account_status'
      )
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return {
        verified: false,
        errorMessage:
          error?.message ||
          'Authenticated session does not match an active institutional profile in public.app_profiles.',
      };
    }

    if (data.account_status !== 'active') {
      return {
        verified: false,
        errorMessage: `Account status is '${data.account_status}'. Only active accounts may perform workspace operations.`,
      };
    }

    return {
      verified: true,
      profile: data as VerifiedCallerIdentity,
      bearerToken,
      client,
    };
  } catch (err) {
    return {
      verified: false,
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Failed to verify caller identity against Supabase.',
    };
  }
}

/**
 * Probes remote Supabase PostgreSQL to verify whether the Phase 3 schema migration
 * (`supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql`) is applied.
 * Never falls back to in-memory storage if remote tables are missing.
 */
export async function verifyRemotePhase3Schema(
  client: SupabaseClient
): Promise<{
  applied: boolean;
  missingTables: string[];
  errorCode: string | null;
  errorMessage: string | null;
}> {
  const probeTables = [...REQUIRED_PHASE3_TABLES];

  const checks = await Promise.all(
    probeTables.map(async (table) => {
      const res = await client.from(table).select('*').limit(1);
      const isMissing =
        res.status === 404 ||
        res.error?.code === 'PGRST205' ||
        res.error?.code === '42P01';
      return {
        table: `public.${table}`,
        isMissing,
        errorCode: res.error?.code ?? null,
        errorMessage: res.error?.message ?? null,
      };
    })
  );

  const missing = checks.filter((c) => c.isMissing);
  if (missing.length > 0) {
    return {
      applied: false,
      missingTables: missing.map((m) => m.table),
      errorCode: missing[0].errorCode || 'PGRST205',
      errorMessage:
        missing[0].errorMessage ||
        `Could not find Phase 3 tables (${missing.map((m) => m.table).join(', ')}) in the remote Supabase schema cache.`,
    };
  }

  return {
    applied: true,
    missingTables: [],
    errorCode: null,
    errorMessage: null,
  };
}

function buildSchemaNotAppliedResponse(schemaCheck: {
  missingTables: string[];
  errorCode: string | null;
  errorMessage: string | null;
}) {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    'https://llotsqzeppiltosllxvx.supabase.co'
  ).trim();
  return {
    status: 503,
    body: {
      ok: false,
      code: 'DATABASE_SCHEMA_NOT_APPLIED',
      persistenceStatus: 'remote_schema_missing',
      remoteSupabaseUrl: supabaseUrl,
      errorCode: schemaCheck.errorCode,
      missingTables: schemaCheck.missingTables,
      migrationFile:
        'supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql',
      message: `Remote PostgreSQL persistence is unavailable on ${supabaseUrl} because the Phase 3 SQL migration (supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql) has not yet been executed (${schemaCheck.errorCode}: ${schemaCheck.errorMessage}). Missing remote tables: ${schemaCheck.missingTables.join(', ')}. Silent in-memory fallback is disabled.`,
    },
  };
}

async function resolveDefaultDatabaseTermId(
  client: SupabaseClient
): Promise<string | null> {
  const { data } = await client
    .from('terms')
    .select('term_id')
    .eq('term_id', 'TERM-2026-FALL')
    .limit(1)
    .maybeSingle();
  return data?.term_id ?? null;
}

async function getOrProvisionRemoteRequester(
  client: SupabaseClient,
  profile: VerifiedCallerIdentity
): Promise<RequesterRecord> {
  const adminClient = createServiceRoleSupabaseClient();
  const rwClient = adminClient || client;

  const { data: existing, error: selectErr } = await client
    .from('requesters')
    .select('*')
    .eq('app_profile_id', profile.id)
    .limit(1)
    .maybeSingle();

  if (selectErr && !adminClient) {
    throw new Error(
      `Unable to load your requester profile (${selectErr.code}): ${selectErr.message}`
    );
  }

  let matchedExisting = existing;
  if (!matchedExisting && adminClient) {
    const { data: adminExisting } = await adminClient
      .from('requesters')
      .select('*')
      .eq('app_profile_id', profile.id)
      .limit(1)
      .maybeSingle();
    matchedExisting = adminExisting;
  }

  const nowIso = new Date().toISOString();

  if (matchedExisting) {
    if (
      matchedExisting.display_name !== profile.display_name ||
      matchedExisting.department !== profile.department
    ) {
      const { data: updated, error: updateErr } = await rwClient
        .from('requesters')
        .update({
          display_name: profile.display_name,
          department: profile.department,
          updated_at: nowIso,
        })
        .eq('requester_id', matchedExisting.requester_id)
        .select('*')
        .single();

      if (!updateErr && updated) {
        return {
          ...(updated as RequesterRecord),
          primary_term_id: updated.primary_term_id || 'TERM-2026-FALL',
        };
      }
    }
    return {
      ...(matchedExisting as RequesterRecord),
      primary_term_id: matchedExisting.primary_term_id || 'TERM-2026-FALL',
    };
  }

  const cleanHash = profile.id
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  const roleMap: Record<ActorRole, string> = {
    [ActorRole.Learner]: 'ROLE-LEARNER',
    [ActorRole.Instructor]: 'ROLE-INSTRUCTOR',
    [ActorRole.SupportStaff]: 'ROLE-SUPPORT_STAFF',
    [ActorRole.AcademicAdministrator]: 'ROLE-ACADEMIC_ADMIN',
    [ActorRole.PlatformAdministrator]: 'ROLE-PLATFORM_ADMIN',
  };

  const targetRoleId = roleMap[profile.actor_role] || 'ROLE-LEARNER';

  // Ensure canonical role exists if service-role client is available so FK on role_id never fails
  if (adminClient) {
    const { data: roleRow } = await adminClient
      .from('roles')
      .select('role_id')
      .eq('role_id', targetRoleId)
      .limit(1)
      .maybeSingle();

    if (!roleRow) {
      const bundle = generateDeterministicDataset({ seed: DETERMINISTIC_SEED });
      if (bundle.roles.length > 0) {
        await adminClient
          .from('roles')
          .upsert(bundle.roles, { onConflict: 'role_id' });
      }
    }
  }

  const dbTermId = await resolveDefaultDatabaseTermId(rwClient);

  const dbRowToInsert = {
    requester_id: `REQ-USR-${cleanHash}`,
    app_profile_id: profile.id,
    role_id: targetRoleId,
    primary_term_id: dbTermId,
    verified_email: profile.verified_email.toLowerCase(),
    display_name: profile.display_name,
    department: profile.department,
    program_or_unit: profile.office_or_cohort,
    account_status: 'active',
    is_synthetic_eval: false,
    effective_from: nowIso,
    effective_to: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data: inserted, error: insertErr } = await client
    .from('requesters')
    .insert(dbRowToInsert)
    .select('*')
    .single();

  if (!insertErr && inserted) {
    return {
      ...(inserted as RequesterRecord),
      primary_term_id: inserted.primary_term_id || 'TERM-2026-FALL',
    };
  }

  // Fallback via serviceRoleClient or upsert if RLS or duplicate requester_id occurred
  if (adminClient) {
    const { data: upserted, error: upsertErr } = await adminClient
      .from('requesters')
      .upsert(dbRowToInsert, { onConflict: 'requester_id' })
      .select('*')
      .single();

    if (!upsertErr && upserted) {
      return {
        ...(upserted as RequesterRecord),
        primary_term_id: upserted.primary_term_id || 'TERM-2026-FALL',
      };
    }
  }

  throw new Error(
    `Unable to provision requester record (${insertErr?.code || 'DB_ERR'}): ${insertErr?.message || 'Unknown database error'}`
  );
}

export function isTicketAuthorizedForCaller(
  ticket: TicketRecord,
  caller: VerifiedCallerIdentity
): boolean {
  if (ticket.is_synthetic_eval) {
    return false;
  }
  if (ticket.requester_profile_id === caller.id) {
    return true;
  }
  return (
    caller.actor_role === ActorRole.SupportStaff ||
    caller.actor_role === ActorRole.AcademicAdministrator ||
    caller.actor_role === ActorRole.PlatformAdministrator
  );
}

export async function processWorkspaceOperationRequest(
  method: string | undefined,
  query: Record<string, string | string[] | undefined>,
  body: any,
  headers: Record<string, string | string[] | undefined>,
  injectedContext?: InjectedWorkspaceTestContext
): Promise<{ status: number; body: any }> {
  let profile: VerifiedCallerIdentity;
  let client: SupabaseClient;
  let injectedServiceClient: SupabaseClient | null | undefined;

  if (injectedContext) {
    profile = injectedContext.profile;
    client = injectedContext.client;
    injectedServiceClient = injectedContext.serviceRoleClient;
    if (typeof (client as any).setAuthenticatedTestCaller === 'function') {
      (client as any).setAuthenticatedTestCaller(profile);
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
            'Valid authentication token required for workspace operations.',
        },
      };
    }
    profile = caller.profile;
    client = caller.client;
  }

  const upperMethod = (method || 'GET').toUpperCase();
  const action =
    (typeof query.action === 'string' ? query.action : body?.action) ||
    'bootstrap';

  // --------------------------------------------------------------------------
  // ACTION 2: EVALUATION & BENCHMARK VERIFICATION REPORT (GET)
  // Pure deterministic evaluation engine (seed 20261022) + 13 validation checks + 5 anomaly evaluation
  // Strictly restricted to authorized administrative/staff roles; never exposed to Learner/Instructor.
  // --------------------------------------------------------------------------
  if (upperMethod === 'GET' && action === 'evaluation_benchmark') {
    const requestedActiveRole =
      typeof query.activeRole === 'string' ? query.activeRole : null;
    const effectiveRole = requestedActiveRole || profile.actor_role;

    const isCallerOrdinaryRequester =
      (injectedContext &&
        (profile.actor_role === ActorRole.Learner ||
          profile.actor_role === ActorRole.Instructor)) ||
      effectiveRole === ActorRole.Learner ||
      effectiveRole === ActorRole.Instructor;

    if (isCallerOrdinaryRequester) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'FORBIDDEN_ROLE',
          message:
            'Ground-truth evaluation and benchmark reports are restricted to authorized administrative roles and cannot be exposed to ordinary learner or instructor actors.',
        },
      };
    }

    const mode = query.mode === 'starter' ? 'starter' : 'full';
    const dataset = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode,
    });
    const validationReport = runDatasetValidationSuite(dataset);
    const evaluationReport =
      evaluateOperationalAnomaliesAgainstGroundTruth(dataset);
    const reproducibilityReport = verifyFixedSeedReproducibility({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
    });

    return {
      status: 200,
      body: {
        ok: true,
        metadata: dataset.metadata,
        validationReport,
        evaluationReport,
        reproducibilityReport,
      },
    };
  }

  // --------------------------------------------------------------------------
  // PRE-FLIGHT REMOTE POSTGRESQL SCHEMA VERIFICATION (NO SILENT IN-MEMORY FALLBACK)
  // --------------------------------------------------------------------------
  const schemaCheck = await verifyRemotePhase3Schema(client);
  if (!schemaCheck.applied) {
    return buildSchemaNotAppliedResponse(schemaCheck);
  }

  const fallbackCorpus = getReferenceCorpus();

  // --------------------------------------------------------------------------
  // ACTION 1: BOOTSTRAP WORKSPACE DATA FROM REMOTE SUPABASE POSTGRESQL (GET)
  // --------------------------------------------------------------------------
  if (upperMethod === 'GET' && action === 'bootstrap') {
    try {
      const requester = await getOrProvisionRemoteRequester(client, profile);

      const [
        ticketsRes,
        messagesRes,
        assignmentsRes,
        slasRes,
        eventsRes,
        feedbacksRes,
        notificationsRes,
        aiLogsRes,
        rolesRes,
        termsRes,
        categoriesRes,
        policiesRes,
        articlesRes,
      ] = await Promise.all([
        client
          .from('tickets')
          .select('*')
          .eq('is_synthetic_eval', false)
          .order('submitted_at', { ascending: false }),
        client
          .from('messages')
          .select('*')
          .order('sequence_number', { ascending: true }),
        client
          .from('assignments')
          .select('*')
          .order('sequence_number', { ascending: true }),
        client.from('slas').select('*'),
        client
          .from('ticket_lifecycle_events')
          .select('*')
          .order('recorded_at', { ascending: true }),
        client.from('resolution_feedbacks').select('*'),
        client
          .from('workspace_notifications')
          .select('*')
          .eq('recipient_profile_id', profile.id)
          .order('created_at', { ascending: false }),
        client
          .from('ai_retrieval_logs')
          .select('*')
          .eq('requester_profile_id', profile.id)
          .order('created_at', { ascending: false }),
        client.from('roles').select('*'),
        client.from('terms').select('*'),
        client.from('categories').select('*'),
        client.from('policy_documents').select('*'),
        client.from('knowledge_articles').select('*'),
      ]);

      const authorizedTickets = ((ticketsRes.data || []) as TicketRecord[])
        .filter((t) => isTicketAuthorizedForCaller(t, profile))
        .map((t) => ({
          ...t,
          term_id: t.term_id || 'TERM-2026-FALL',
        }));
      const authorizedTicketIds = new Set(
        authorizedTickets.map((t) => t.ticket_id)
      );

      const isRequesterRole =
        profile.actor_role === ActorRole.Learner ||
        profile.actor_role === ActorRole.Instructor;

      const authorizedMessages = (messagesRes.data || [])
        .map((m) => fromDbMessageRow(m))
        .filter(
          (m) =>
            authorizedTicketIds.has(m.ticket_id) &&
            (!isRequesterRole || !m.is_internal)
        );
      const authorizedAssignments = (
        (assignmentsRes.data || []) as AssignmentRecord[]
      ).filter((a) => authorizedTicketIds.has(a.ticket_id));
      const authorizedEvents = (eventsRes.data || [])
        .map((e) => fromDbLifecycleEventRow(e))
        .filter((e) => authorizedTicketIds.has(e.ticket_id));
      const authorizedSlas = ((slasRes.data || []) as SLARecord[])
        .filter((s) => authorizedTicketIds.has(s.ticket_id))
        .map((s) => {
          const parentTicket = authorizedTickets.find(
            (t) => t.ticket_id === s.ticket_id
          );
          if (!parentTicket) return s;
          return enrichSlaRecordWithOperationalMetrics({
            sla: s,
            ticket: parentTicket,
            messages: authorizedMessages,
            lifecycleEvents: authorizedEvents,
          });
        });
      const authorizedFeedbacks = (
        (feedbacksRes.data || []) as ResolutionFeedbackRecord[]
      ).filter((f) => authorizedTicketIds.has(f.ticket_id));
      const userNotifications = (notificationsRes.data ||
        []) as WorkspaceNotificationRecord[];
      const userAiLogs = (aiLogsRes.data || []) as AIRetrievalLogRecord[];

      const activeRoles =
        rolesRes.data && rolesRes.data.length > 0
          ? (rolesRes.data as RoleRecord[])
          : fallbackCorpus.roles;
      const activeTerms =
        termsRes.data && termsRes.data.length > 0
          ? (termsRes.data as TermRecord[])
          : fallbackCorpus.terms;
      const activeCategories =
        categoriesRes.data && categoriesRes.data.length > 0
          ? (categoriesRes.data as CategoryRecord[])
          : fallbackCorpus.categories;
      const allPolicies = (policiesRes.data || []) as PolicyDocumentRecord[];
      const allArticles = (articlesRes.data || []) as KnowledgeArticleRecord[];

      // Pagination for Knowledge Base articles (default page 1, pageSize 25)
      const kbPage = Math.max(1, Number(query.kbPage) || 1);
      const kbPageSize = Math.min(
        50,
        Math.max(10, Number(query.kbPageSize) || 25)
      );
      const kbSearch = (
        typeof query.kbSearch === 'string' ? query.kbSearch : ''
      )
        .trim()
        .toLowerCase();
      const kbDomainFilter = (
        typeof query.kbDomain === 'string' ? query.kbDomain : 'all'
      ).trim();

      const filteredPolicies = allPolicies.filter((p) => {
        const domainMatch =
          kbDomainFilter === 'all' ||
          p.domain.toLowerCase() === kbDomainFilter.toLowerCase() ||
          p.category_id.toLowerCase() === kbDomainFilter.toLowerCase();
        const searchMatch =
          !kbSearch ||
          `${p.policy_id} ${p.title} ${p.summary} ${p.domain}`
            .toLowerCase()
            .includes(kbSearch);
        return domainMatch && searchMatch;
      });

      const filteredArticles = allArticles.filter((a) => {
        const domainMatch =
          kbDomainFilter === 'all' ||
          a.category_id.toLowerCase().includes(kbDomainFilter.toLowerCase()) ||
          a.primary_policy_id
            .toLowerCase()
            .includes(kbDomainFilter.toLowerCase());
        const searchMatch =
          !kbSearch ||
          `${a.article_id} ${a.title} ${a.summary} ${a.primary_policy_id}`
            .toLowerCase()
            .includes(kbSearch);
        return domainMatch && searchMatch;
      });

      const pagedArticles = filteredArticles.slice(
        (kbPage - 1) * kbPageSize,
        kbPage * kbPageSize
      );

      const metrics = {
        totalAuthorizedTickets: authorizedTickets.length,
        activeOpenCount: authorizedTickets.filter(
          (t) =>
            t.lifecycle_status !== RequestStatus.Resolved &&
            t.lifecycle_status !== RequestStatus.Closed
        ).length,
        policyVerifiedCount: authorizedTickets.filter(
          (t) => t.referenced_policy_id !== null
        ).length,
        escalatedCount: authorizedTickets.filter(
          (t) => t.lifecycle_status === RequestStatus.Escalated || t.is_escalated
        ).length,
        resolvedCount: authorizedTickets.filter(
          (t) =>
            t.lifecycle_status === RequestStatus.Resolved ||
            t.lifecycle_status === RequestStatus.Closed
        ).length,
        unreadNotificationCount: userNotifications.filter((n) => !n.is_read)
          .length,
        withinSlaCount: authorizedSlas.filter(
          (s) =>
            s.sla_status === 'within_sla' ||
            s.sla_status === 'resolved_within_sla'
        ).length,
        approachingSlaCount: authorizedSlas.filter(
          (s) => s.sla_status === 'approaching_deadline' || s.is_approaching_deadline
        ).length,
        breachedSlaCount: authorizedSlas.filter((s) => s.breach_status).length,
        unresolvedEscalatedCount: authorizedTickets.filter(
          (t) =>
            (t.lifecycle_status === RequestStatus.Escalated || t.is_escalated) &&
            t.lifecycle_status !== RequestStatus.Resolved &&
            t.lifecycle_status !== RequestStatus.Closed
        ).length,
      };

      return {
        status: 200,
        body: {
          ok: true,
          persistenceStatus: 'remote_postgresql_verified',
          requester,
          metrics,
          tickets: authorizedTickets,
          messages: authorizedMessages,
          assignments: authorizedAssignments,
          slas: authorizedSlas,
          lifecycleEvents: authorizedEvents,
          resolutionFeedbacks: authorizedFeedbacks,
          notifications: userNotifications,
          aiRetrievalLogs: userAiLogs,
          knowledgeBase: {
            categories: activeCategories,
            terms: activeTerms,
            roles: activeRoles,
            policies: filteredPolicies,
            articles: pagedArticles,
            totalArticlesCount: filteredArticles.length,
            page: kbPage,
            pageSize: kbPageSize,
            configurableSlaRules: Object.values(CONFIGURABLE_SLA_RULES),
            businessSchedule: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
            routingRules: Object.values(DOCUMENTED_ROUTING_RULES),
            documentedAssignmentTeams: DOCUMENTED_ASSIGNMENT_TEAMS,
          },
        },
      };
    } catch (err) {
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_OPERATION_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Failed reading operational data from remote Supabase PostgreSQL.',
        },
      };
    }
  }

  if (upperMethod !== 'POST') {
    return {
      status: 405,
      body: {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: `Unsupported method ${upperMethod} for action '${action}'.`,
      },
    };
  }

  // Idempotency key resolution (Phase 5 Section 10)
  const rawIdempotencyKey =
    (typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim()) ||
    (typeof headers['x-idempotency-key'] === 'string' &&
      headers['x-idempotency-key'].trim()) ||
    null;

  const cacheKey = rawIdempotencyKey
    ? `${profile.id}:${action}:${rawIdempotencyKey}`
    : null;

  if (cacheKey) {
    const cached = idempotencyResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestampMs < 300_000) {
      return {
        status: cached.status,
        body: {
          ...cached.body,
          idempotentReplay: true,
        },
      };
    }
  }

  const auditClient = injectedContext
    ? injectedServiceClient || client
    : createServiceRoleSupabaseClient() || client;

  // --------------------------------------------------------------------------
  // ACTION 3: CREATE TICKET IN REMOTE POSTGRESQL (POST action='create_ticket')
  // --------------------------------------------------------------------------
  if (action === 'create_ticket') {
    const subject = (body?.subject || '').trim();
    const rawCategory = (body?.category || '').trim();
    const priorityRaw = (body?.urgencyLevel || 'Standard Priority').trim();
    const description = (body?.description || '').trim();
    const courseOrPolicyCode = (body?.courseOrPolicyCode || '').trim();
    const saveAsDraft =
      body?.saveAsDraft === true ||
      body?.initialState === RequestStatus.Draft;

    if (subject.length < 5 || description.length < 25 || !rawCategory) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            'Subject (min 5 chars), category, and description (min 25 chars) are required.',
        },
      };
    }

    // Duplicate submission fingerprint check within 15s window
    const duplicateFingerprint = `${profile.id}:create_ticket:${subject.toLowerCase()}:${rawCategory.toLowerCase()}:${description.toLowerCase()}:${saveAsDraft}`;
    const existingFingerprint =
      idempotencyResponseCache.get(duplicateFingerprint);
    if (
      existingFingerprint &&
      Date.now() - existingFingerprint.timestampMs < 15_000
    ) {
      return {
        status: existingFingerprint.status,
        body: {
          ...existingFingerprint.body,
          idempotentReplay: true,
        },
      };
    }

    let createdTicketIdForRollback: string | null = null;

    try {
      const priority: TicketPriorityLevel =
        priorityRaw === 'Administrative Escalation Priority' ||
        priorityRaw === 'Time-Sensitive Academic Priority'
          ? priorityRaw
          : 'Standard Priority';

      const requester = await getOrProvisionRemoteRequester(client, profile);
      const dbTermId = await resolveDefaultDatabaseTermId(client);
      const nowIso = new Date().toISOString();

      const catRes = resolveOfficialCategory(
        rawCategory,
        `${subject} ${description} ${courseOrPolicyCode}`
      );
      const officialCat: OfficialCategoryName =
        catRes.category || 'Registration';
      const rule = DOCUMENTED_ROUTING_RULES[officialCat];

      const { data: dbPolicies } = await client
        .from('policy_documents')
        .select('*');
      const { data: dbArticles } = await client
        .from('knowledge_articles')
        .select('*');

      const policyPool = (dbPolicies || []) as PolicyDocumentRecord[];
      const articlePool = (dbArticles || []) as KnowledgeArticleRecord[];

      const retrieval = retrieveApplicablePolicyEvidence({
        query: `${officialCat} ${subject} ${description} ${courseOrPolicyCode}`,
        policies: policyPool,
        articles: articlePool,
        asOfDateIso: nowIso.slice(0, 10),
      });

      const citedPolicy =
        retrieval.applicablePolicies[0] ||
        policyPool.find(
          (p) =>
            p.category_id === rule.category_id && p.lifecycle_state === 'active'
        ) ||
        null;

      const citedArticle =
        retrieval.applicableArticles[0] ||
        (citedPolicy
          ? articlePool.find(
              (a) =>
                a.primary_policy_id === citedPolicy.policy_id &&
                a.lifecycle_state === 'published'
            )
          : null) ||
        null;

      const explicitlyReferencedExpired = policyPool.some(
        (p) =>
          p.lifecycle_state === 'expired' &&
          `${subject} ${description} ${courseOrPolicyCode}`
            .toLowerCase()
            .includes(p.policy_id.toLowerCase())
      );

      // Concurrency-safe ticket sequence allocation with up to 5 retries
      let ticketId = '';
      let ticket: TicketRecord | null = null;
      let routingDecision: ReturnType<typeof evaluateTicketRouting> | null =
        null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: latestTickets } = await client
          .from('tickets')
          .select('ticket_id')
          .eq('is_synthetic_eval', false)
          .order('ticket_id', { ascending: false })
          .limit(1);

        let nextTicketSeq = 100001 + attempt;
        if (latestTickets && latestTickets.length > 0) {
          const match = /^TKT-2026-(\d{6})$/.exec(latestTickets[0].ticket_id);
          if (match) {
            nextTicketSeq = Math.max(100001, Number(match[1]) + 1 + attempt);
          }
        }

        const candidateId = formatTicketId(nextTicketSeq);
        const candidateRouting = evaluateTicketRouting({
          ticketId: candidateId,
          category: catRes.category,
          priority,
          subject,
          description,
          hasExpiredPolicyReference: explicitlyReferencedExpired,
          hasAmbiguousPolicyCoverage:
            retrieval.evidenceStatus === 'unsupported_or_missing',
          assignedAtIso: nowIso,
        });

        const initialLifecycleStatus = saveAsDraft
          ? RequestStatus.Draft
          : candidateRouting.recommendedStatus;

        const candidateTicket: TicketRecord = {
          ticket_id: candidateId,
          requester_id: requester.requester_id,
          requester_profile_id: profile.id,
          category_id: rule.category_id,
          category_name: officialCat,
          term_id: requester.primary_term_id || 'TERM-2026-FALL',
          subject,
          description,
          priority,
          lifecycle_status: initialLifecycleStatus,
          current_assigned_team: candidateRouting.assignment.assigned_team,
          current_routing_rule_id: candidateRouting.assignment.routing_rule_id,
          referenced_policy_id: citedPolicy ? citedPolicy.policy_id : null,
          referenced_policy_version: citedPolicy ? citedPolicy.version : null,
          referenced_article_id: citedArticle ? citedArticle.article_id : null,
          referenced_article_version: citedArticle
            ? citedArticle.version
            : null,
          requires_escalation: candidateRouting.requiresEscalation,
          is_escalated:
            initialLifecycleStatus === RequestStatus.Escalated,
          escalation_reason: candidateRouting.escalationReason,
          resolution_summary: null,
          is_synthetic_eval: false,
          submitted_at: nowIso,
          updated_at: nowIso,
          resolved_at: null,
          closed_at: null,
        };

        const dbTicketRow = {
          ...candidateTicket,
          term_id: dbTermId,
        };

        const { error: ticketErr } = await client
          .from('tickets')
          .insert(dbTicketRow);

        if (!ticketErr) {
          ticketId = candidateId;
          ticket = candidateTicket;
          routingDecision = candidateRouting;
          createdTicketIdForRollback = candidateId;
          break;
        }

        if (ticketErr.code !== '23505' || attempt === 4) {
          throw new Error(
            `Failed inserting ticket into public.tickets (${ticketErr.code}): ${ticketErr.message}`
          );
        }
      }

      if (!ticket || !routingDecision) {
        throw new Error('Failed to allocate unique ticket sequence.');
      }

      if (ticket.referenced_policy_id && citedPolicy) {
        const polLink: TicketPolicyLinkRecord = {
          link_id: `TPL-${ticketId}-01`,
          ticket_id: ticketId,
          policy_id: citedPolicy.policy_id,
          policy_version: citedPolicy.version,
          applicability_status: 'applicable_current',
          linked_by_actor: requester.requester_id,
          linked_at: nowIso,
        };
        const { error: polLinkErr } = await client
          .from('ticket_policy_links')
          .insert(polLink);
        if (polLinkErr) {
          throw new Error(
            `Failed inserting ticket_policy_links (${polLinkErr.code}): ${polLinkErr.message}`
          );
        }
      }

      if (ticket.referenced_article_id && citedArticle) {
        const artLink: TicketArticleLinkRecord = {
          link_id: `TAL-${ticketId}-01`,
          ticket_id: ticketId,
          article_id: citedArticle.article_id,
          article_version: citedArticle.version,
          applicability_status: 'applicable_current',
          linked_by_actor: requester.requester_id,
          linked_at: nowIso,
        };
        const { error: artLinkErr } = await client
          .from('ticket_article_links')
          .insert(artLink);
        if (artLinkErr) {
          throw new Error(
            `Failed inserting ticket_article_links (${artLinkErr.code}): ${artLinkErr.message}`
          );
        }
      }

      const lifecycleEvents: TicketLifecycleEventRecord[] = [];
      if (saveAsDraft) {
        lifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: 1,
            previousState: null,
            newState: RequestStatus.Draft,
            actorId: requester.requester_id,
            actorRole: profile.actor_role,
            reason: `Request saved as draft by ${profile.display_name} (${requester.requester_id}).`,
            timestampIso: nowIso,
          })
        );
      } else {
        lifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: 1,
            previousState: null,
            newState: RequestStatus.Submitted,
            actorId: requester.requester_id,
            actorRole: profile.actor_role,
            reason: `Request submitted by ${profile.display_name} (${requester.requester_id}).`,
            timestampIso: nowIso,
          }),
          createLifecycleEvent({
            ticketId,
            eventSequence: 2,
            previousState: RequestStatus.Submitted,
            newState: routingDecision.recommendedStatus,
            actorId: 'SYSTEM-ROUTING-ENGINE',
            actorRole: ActorRole.SupportStaff,
            reason: routingDecision.assignment.assignment_reason,
            timestampIso: nowIso,
            referencedPolicyId: ticket.referenced_policy_id,
            referencedPolicyVersion: citedPolicy ? citedPolicy.version : null,
            referencedArticleId: ticket.referenced_article_id,
            referencedArticleVersion: citedArticle
              ? citedArticle.version
              : null,
          })
        );
      }

      const msg1: MessageRecord = {
        message_id: formatMessageId(ticketId, 1),
        ticket_id: ticketId,
        sequence_number: 1,
        sender_id: requester.requester_id,
        sender_profile_id: profile.id,
        sender_role: profile.actor_role,
        sender_name: profile.display_name,
        message_type: 'requester_inquiry',
        body: description,
        cited_policy_id: null,
        cited_policy_version: null,
        cited_article_id: null,
        cited_article_version: null,
        is_internal: false,
        created_at: nowIso,
      };

      const msg2: MessageRecord = {
        message_id: formatMessageId(ticketId, 2),
        ticket_id: ticketId,
        sequence_number: 2,
        sender_id: 'SYSTEM-ROUTER',
        sender_profile_id: null,
        sender_role: ActorRole.SupportStaff,
        sender_name: 'CampusResolve Routing Engine',
        message_type: 'system_routing_note',
        body: `Classified under official category '${officialCat}' (${rule.category_id}). Assigned to '${routingDecision.assignment.assigned_team}' via rule ${routingDecision.assignment.routing_rule_id}. ${routingDecision.assignment.assignment_reason}`,
        cited_policy_id: ticket.referenced_policy_id,
        cited_policy_version: citedPolicy ? citedPolicy.version : null,
        cited_article_id: ticket.referenced_article_id,
        cited_article_version: citedArticle ? citedArticle.version : null,
        is_internal: false,
        created_at: nowIso,
      };

      const msg3: MessageRecord = {
        message_id: formatMessageId(ticketId, 3),
        ticket_id: ticketId,
        sequence_number: 3,
        sender_id: `ACTOR-OPS-${rule.domain_code}`,
        sender_profile_id: null,
        sender_role: ActorRole.SupportStaff,
        sender_name: `${routingDecision.assignment.assigned_team} Automated Intake`,
        message_type: 'ai_grounded_reply',
        body:
          citedPolicy && citedArticle
            ? `Applicable Policy Context Attached: ${citedPolicy.policy_id} v${citedPolicy.version} (${citedPolicy.title}, ${citedPolicy.authoritative_section_ref}) and Knowledge Article ${citedArticle.article_id} v${citedArticle.version}. Policy Summary: ${citedPolicy.content}`
            : `Automated intake acknowledgement. Request logged under official challenge category '${officialCat}'. Assigned to '${routingDecision.assignment.assigned_team}' according to institutional routing rule ${routingDecision.assignment.routing_rule_id}. Request queued for departmental staff review.`,
        cited_policy_id: ticket.referenced_policy_id,
        cited_policy_version: citedPolicy ? citedPolicy.version : null,
        cited_article_id: ticket.referenced_article_id,
        cited_article_version: citedArticle ? citedArticle.version : null,
        is_internal: false,
        created_at: nowIso,
      };

      const messagesToCreate = saveAsDraft ? [msg1] : [msg1, msg2, msg3];

      const sla = buildReproducibleSlaRecord({
        ticketId,
        category: officialCat,
        startTimestampIso: nowIso,
        evaluatedTimestampIso: nowIso,
        isTicketEscalated: ticket.is_escalated,
        requiresEscalation: ticket.requires_escalation,
        calculationMode: 'business_hours_configured',
        firstResponseTimestampIso: saveAsDraft ? null : nowIso,
        lifecycleStatus: ticket.lifecycle_status,
      });

      const notif: WorkspaceNotificationRecord = {
        notification_id: `NTF-${ticketId}-01`,
        recipient_profile_id: profile.id,
        ticket_id: ticketId,
        event_type: ticket.is_escalated ? 'escalated' : 'ticket_created',
        category: ticket.is_escalated ? 'escalations' : 'lifecycle',
        title: saveAsDraft
          ? `${ticketId} Saved as Draft`
          : `${ticketId} Created & Routed to ${routingDecision.assignment.assigned_team}`,
        summary: citedPolicy
          ? `Classified under '${officialCat}' (${routingDecision.assignment.routing_rule_id}) with policy reference ${citedPolicy.policy_id} v${citedPolicy.version}. Current stage: ${ticket.lifecycle_status}.`
          : `Classified under '${officialCat}' (${routingDecision.assignment.routing_rule_id}). Queued for staff review. Current stage: ${ticket.lifecycle_status}.`,
        policy_reference: citedPolicy
          ? `${citedPolicy.policy_id} v${citedPolicy.version}`
          : null,
        is_read: false,
        created_at: nowIso,
      };

      const dbLifecycleRows = lifecycleEvents.map((ev) =>
        toDbLifecycleEventRow(
          ev,
          ev.actor_id === requester.requester_id ? profile.id : null,
          ev.actor_id === requester.requester_id
            ? profile.display_name
            : ev.actor_id
        )
      );
      const dbMessageRows = messagesToCreate.map((m) => toDbMessageRow(m));

      const [evRes, msgRes, asgRes, slaRes, notifRes] = await Promise.all([
        auditClient.from('ticket_lifecycle_events').insert(dbLifecycleRows),
        client.from('messages').insert(dbMessageRows),
        auditClient.from('assignments').insert(routingDecision.assignment),
        auditClient.from('slas').insert(toDbSlaRow(sla)),
        client.from('workspace_notifications').insert(notif),
      ]);

      for (const r of [evRes, msgRes, asgRes, slaRes, notifRes]) {
        if (r.error) {
          throw new Error(
            `Failed persisting child workflow record in remote PostgreSQL (${r.error.code}): ${r.error.message}`
          );
        }
      }

      const responsePayload = {
        status: 201,
        body: {
          ok: true,
          persistenceStatus: 'remote_postgresql_verified',
          ticket: {
            ...ticket,
            referenced_policy_id: citedPolicy ? citedPolicy.policy_id : null,
            referenced_article_id: citedArticle ? citedArticle.article_id : null,
          },
          assignment: routingDecision.assignment,
          sla,
          messages: messagesToCreate,
          lifecycleEvents,
          notification: notif,
          message: `Ticket ${ticketId} created in remote PostgreSQL and routed to ${routingDecision.assignment.assigned_team}.`,
        },
      };

      if (cacheKey) {
        idempotencyResponseCache.set(cacheKey, {
          timestampMs: Date.now(),
          ...responsePayload,
        });
      }
      idempotencyResponseCache.set(duplicateFingerprint, {
        timestampMs: Date.now(),
        ...responsePayload,
      });

      return responsePayload;
    } catch (err) {
      // Compensating rollback so partial failure never leaves orphan ticket records
      let rolledBack = false;
      if (createdTicketIdForRollback) {
        try {
          await Promise.all([
            auditClient
              .from('workspace_notifications')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
            auditClient
              .from('slas')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
            auditClient
              .from('assignments')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
            auditClient
              .from('messages')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
            auditClient
              .from('ticket_lifecycle_events')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
            auditClient
              .from('ticket_policy_links')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
            auditClient
              .from('ticket_article_links')
              .delete()
              .eq('ticket_id', createdTicketIdForRollback),
          ]);
          await auditClient
            .from('tickets')
            .delete()
            .eq('ticket_id', createdTicketIdForRollback);
          rolledBack = true;
        } catch {
          // Best-effort compensating rollback
        }
      }

      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          rolledBack,
          message:
            err instanceof Error
              ? err.message
              : 'Failed writing ticket workflow records to remote PostgreSQL.',
        },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION 4: POST MESSAGE ON TICKET IN REMOTE POSTGRESQL (POST action='post_message')
  // --------------------------------------------------------------------------
  if (action === 'post_message') {
    const ticketId = (body?.ticketId || '').trim();
    const messageBody = (body?.body || '').trim();

    if (!ticketId || messageBody.length < 5) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            'ticketId and non-empty message body (min 5 chars) are required.',
        },
      };
    }

    let insertedMessageIdForRollback: string | null = null;

    try {
      const { data: ticketRow, error: ticketErr } = await client
        .from('tickets')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('is_synthetic_eval', false)
        .maybeSingle();

      if (
        ticketErr ||
        !ticketRow ||
        !isTicketAuthorizedForCaller(ticketRow as TicketRecord, profile)
      ) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'FORBIDDEN_TICKET_ACCESS',
            message: 'You are not authorized to post messages to this ticket.',
          },
        };
      }

      const ticket = ticketRow as TicketRecord;
      const requester = await getOrProvisionRemoteRequester(client, profile);

      const isStaffOrAdmin =
        profile.actor_role === ActorRole.SupportStaff ||
        profile.actor_role === ActorRole.AcademicAdministrator ||
        profile.actor_role === ActorRole.PlatformAdministrator;

      const isInternalRequested = Boolean(
        body?.isInternal || body?.is_internal
      );

      if (isInternalRequested && !isStaffOrAdmin) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'FORBIDDEN_INTERNAL_NOTE',
            message:
              'Only support staff and administrators can create internal staff notes.',
          },
        };
      }

      const nowIso = new Date().toISOString();
      let newMsg: MessageRecord | null = null;
      let allocatedSeq = 1;

      // Concurrency-safe sequence number allocation with retry
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: existingMsgs } = await client
          .from('messages')
          .select('sequence_number')
          .eq('ticket_id', ticketId)
          .order('sequence_number', { ascending: false })
          .limit(1);

        const nextSeq =
          existingMsgs && existingMsgs.length > 0
            ? Number(existingMsgs[0].sequence_number) + 1 + attempt
            : 1 + attempt;

        const candidateMsg: MessageRecord = {
          message_id: formatMessageId(ticketId, nextSeq),
          ticket_id: ticketId,
          sequence_number: nextSeq,
          sender_id: requester.requester_id,
          sender_profile_id: profile.id,
          sender_role: profile.actor_role,
          sender_name: profile.display_name,
          message_type: isStaffOrAdmin ? 'staff_response' : 'requester_inquiry',
          body: messageBody,
          cited_policy_id: ticket.referenced_policy_id,
          cited_policy_version: ticket.referenced_policy_version,
          cited_article_id: ticket.referenced_article_id,
          cited_article_version: ticket.referenced_article_version,
          is_internal: isStaffOrAdmin && isInternalRequested,
          created_at: nowIso,
        };

        const { error: msgErr } = await client
          .from('messages')
          .insert(toDbMessageRow(candidateMsg));

        if (!msgErr) {
          newMsg = candidateMsg;
          allocatedSeq = nextSeq;
          insertedMessageIdForRollback = candidateMsg.message_id;
          break;
        }

        if (msgErr.code !== '23505' || attempt === 4) {
          throw new Error(
            `Failed inserting message into public.messages (${msgErr.code}): ${msgErr.message}`
          );
        }
      }

      if (!newMsg) {
        throw new Error('Failed to allocate unique message sequence number.');
      }

      const { error: updErr } = await client
        .from('tickets')
        .update({ updated_at: nowIso })
        .eq('ticket_id', ticketId);

      if (updErr) {
        throw new Error(
          `Failed updating ticket timestamp (${updErr.code}): ${updErr.message}`
        );
      }

      // Only notify requester when message is NOT an internal staff note
      if (ticket.requester_profile_id && !newMsg.is_internal) {
        const notifId = `NTF-${ticketId}-MSG-${String(allocatedSeq).padStart(3, '0')}`;
        const { error: notifErr } = await client
          .from('workspace_notifications')
          .upsert(
            {
              notification_id: notifId,
              recipient_profile_id: ticket.requester_profile_id,
              ticket_id: ticketId,
              event_type: 'message_posted',
              category: 'lifecycle',
              title: `New Correspondence on ${ticketId}`,
              summary: `${profile.display_name} (${profile.actor_role}) posted message ${newMsg.message_id} on "${ticket.subject}".`,
              policy_reference: ticket.referenced_policy_id
                ? `${ticket.referenced_policy_id} v${ticket.referenced_policy_version}`
                : null,
              is_read: false,
              created_at: nowIso,
            },
            { onConflict: 'notification_id' }
          );

        if (notifErr) {
          throw new Error(
            `Failed creating message notification (${notifErr.code}): ${notifErr.message}`
          );
        }
      }

      const responsePayload = {
        status: 201,
        body: {
          ok: true,
          messageRecord: newMsg,
          ticket: { ...ticket, updated_at: nowIso },
        },
      };

      if (cacheKey) {
        idempotencyResponseCache.set(cacheKey, {
          timestampMs: Date.now(),
          ...responsePayload,
        });
      }

      return responsePayload;
    } catch (err) {
      let rolledBack = false;
      if (insertedMessageIdForRollback) {
        try {
          await auditClient
            .from('messages')
            .delete()
            .eq('message_id', insertedMessageIdForRollback);
          rolledBack = true;
        } catch {
          // Best-effort rollback
        }
      }
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          rolledBack,
          message:
            err instanceof Error
              ? err.message
              : 'Failed writing message to remote PostgreSQL.',
        },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION 5: TRANSITION TICKET LIFECYCLE STATE IN REMOTE POSTGRESQL (POST action='transition_ticket')
  // --------------------------------------------------------------------------
  if (action === 'transition_ticket') {
    const ticketId = (body?.ticketId || '').trim();
    const targetState = body?.newState as RequestStatus;
    const reason = (body?.reason || '').trim();
    const resolutionSummary =
      typeof body?.resolutionSummary === 'string'
        ? body.resolutionSummary.trim()
        : null;

    if (!ticketId || !targetState || reason.length < 5) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            'ticketId, valid target newState, and transition reason (min 5 chars) are required.',
        },
      };
    }

    let originalTicketSnapshot: TicketRecord | null = null;
    let previousActiveAssignmentSnapshot: AssignmentRecord | null = null;
    let newlyInsertedAssignmentId: string | null = null;
    let newlyInsertedEventId: string | null = null;
    let newlyInsertedMessageId: string | null = null;

    try {
      const { data: ticketRow, error: ticketErr } = await client
        .from('tickets')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('is_synthetic_eval', false)
        .maybeSingle();

      if (
        ticketErr ||
        !ticketRow ||
        !isTicketAuthorizedForCaller(ticketRow as TicketRecord, profile)
      ) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'FORBIDDEN_TICKET_ACCESS',
            message: 'You are not authorized to transition this ticket.',
          },
        };
      }

      const ticket = ticketRow as TicketRecord;
      originalTicketSnapshot = { ...ticket };

      const requester = await getOrProvisionRemoteRequester(client, profile);
      const isTicketOwner =
        ticket.requester_profile_id === profile.id ||
        ticket.requester_id === requester.requester_id;

      // Validate state machine transition, role-based authorization, and resolution details
      const resolutionValidation = validateResolutionTransition({
        previousState: ticket.lifecycle_status,
        newState: targetState,
        actorRole: profile.actor_role,
        isTicketOwner,
        reason,
        resolutionSummary,
      });

      if (!resolutionValidation.valid) {
        const statusCode =
          resolutionValidation.code === 'INVALID_LIFECYCLE_TRANSITION' ||
          resolutionValidation.code === 'MISSING_RESOLUTION_DETAILS'
            ? 400
            : 403;
        return {
          status: statusCode,
          body: {
            ok: false,
            code: resolutionValidation.code,
            message: resolutionValidation.message,
          },
        };
      }

      const nowIso = new Date().toISOString();

      const { data: existingEvents } = await client
        .from('ticket_lifecycle_events')
        .select('event_id')
        .eq('ticket_id', ticketId);

      const nextEventSeq = (existingEvents?.length || 0) + 1;
      const prevState = ticket.lifecycle_status;

      const event = createLifecycleEvent({
        ticketId,
        eventSequence: nextEventSeq,
        previousState: prevState,
        newState: targetState,
        actorId: requester.requester_id,
        actorRole: profile.actor_role,
        reason,
        timestampIso: nowIso,
        referencedPolicyId: ticket.referenced_policy_id,
        referencedPolicyVersion: ticket.referenced_policy_version,
        referencedArticleId: ticket.referenced_article_id,
        referencedArticleVersion: ticket.referenced_article_version,
      });

      const updatedFields: Partial<TicketRecord> = {
        lifecycle_status: targetState,
        updated_at: nowIso,
      };

      if (targetState === RequestStatus.Escalated) {
        updatedFields.is_escalated = true;
        updatedFields.requires_escalation = true;
        updatedFields.escalation_reason = reason;

        const rule = DOCUMENTED_ROUTING_RULES[ticket.category_name];
        const { data: existingAsgs } = await client
          .from('assignments')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('sequence_number', { ascending: true });

        const asgList = (existingAsgs || []) as AssignmentRecord[];
        const prevActive = asgList.find((a) => a.is_active) || null;
        previousActiveAssignmentSnapshot = prevActive
          ? { ...prevActive }
          : null;

        if (prevActive) {
          const { error: deactErr } = await auditClient
            .from('assignments')
            .update({ is_active: false, unassigned_at: nowIso })
            .eq('assignment_id', prevActive.assignment_id);
          if (deactErr) {
            throw new Error(
              `Failed deactivating previous assignment (${deactErr.code}): ${deactErr.message}`
            );
          }
        }

        const newAsg: AssignmentRecord = {
          assignment_id: formatAssignmentId(ticketId, asgList.length + 1),
          ticket_id: ticketId,
          sequence_number: asgList.length + 1,
          assigned_team: rule.escalation_assigned_team,
          assigned_actor_id: `ACTOR-ESC-${rule.domain_code}`,
          assigned_actor_role: rule.escalation_actor_role,
          routing_rule_id: rule.rule_id,
          assignment_reason: `Escalation reassignment: ${reason}`,
          previous_assignment_id: prevActive?.assignment_id ?? null,
          previous_assigned_team: prevActive?.assigned_team ?? null,
          requires_human_review: true,
          is_active: true,
          assigned_at: nowIso,
          unassigned_at: null,
        };
        updatedFields.current_assigned_team = newAsg.assigned_team;
        const { error: newAsgErr } = await auditClient
          .from('assignments')
          .insert(newAsg);
        if (newAsgErr) {
          throw new Error(
            `Failed inserting escalation assignment (${newAsgErr.code}): ${newAsgErr.message}`
          );
        }
        newlyInsertedAssignmentId = newAsg.assignment_id;
      }

      if (targetState === RequestStatus.Resolved) {
        updatedFields.resolved_at = nowIso;
        updatedFields.resolution_summary =
          resolutionValidation.effectiveResolutionSummary;
      }
      if (targetState === RequestStatus.Closed) {
        updatedFields.closed_at = nowIso;
      }

      const { data: updatedTicketRow, error: updErr } = await client
        .from('tickets')
        .update(updatedFields)
        .eq('ticket_id', ticketId)
        .select('*')
        .single();

      if (updErr || !updatedTicketRow) {
        throw new Error(
          `Failed updating ticket state in public.tickets (${updErr?.code}): ${updErr?.message}`
        );
      }

      const updatedTicket: TicketRecord = {
        ...(updatedTicketRow as TicketRecord),
        term_id: updatedTicketRow.term_id || 'TERM-2026-FALL',
      };

      const { data: existingSlaRow } = await client
        .from('slas')
        .select('*')
        .eq('ticket_id', ticketId)
        .maybeSingle();

      const recomputedSla = buildReproducibleSlaRecord({
        ticketId,
        category: updatedTicket.category_name,
        startTimestampIso:
          existingSlaRow?.start_timestamp || updatedTicket.submitted_at,
        evaluatedTimestampIso: updatedTicket.resolved_at || nowIso,
        isTicketEscalated: updatedTicket.is_escalated,
        requiresEscalation: updatedTicket.requires_escalation,
        resolvedTimestampIso: updatedTicket.resolved_at,
        lifecycleStatus: updatedTicket.lifecycle_status,
      });

      const { error: slaUpdErr } = await auditClient
        .from('slas')
        .update(toDbSlaRow(recomputedSla))
        .eq('ticket_id', ticketId);
      if (slaUpdErr) {
        throw new Error(
          `Failed updating SLA record (${slaUpdErr.code}): ${slaUpdErr.message}`
        );
      }

      const { data: existingMsgs } = await client
        .from('messages')
        .select('sequence_number')
        .eq('ticket_id', ticketId)
        .order('sequence_number', { ascending: false })
        .limit(1);

      const nextMsgSeq =
        existingMsgs && existingMsgs.length > 0
          ? Number(existingMsgs[0].sequence_number) + 1
          : 1;

      const sysMsg: MessageRecord = {
        message_id: formatMessageId(ticketId, nextMsgSeq),
        ticket_id: ticketId,
        sequence_number: nextMsgSeq,
        sender_id: requester.requester_id,
        sender_profile_id: profile.id,
        sender_role: profile.actor_role,
        sender_name: profile.display_name,
        message_type:
          targetState === RequestStatus.Escalated
            ? 'escalation_handoff'
            : targetState === RequestStatus.Resolved
            ? 'resolution_summary'
            : 'system_routing_note',
        body: `Lifecycle Stage Transition (${prevState} -> ${targetState}): ${reason}`,
        cited_policy_id: updatedTicket.referenced_policy_id,
        cited_policy_version: updatedTicket.referenced_policy_version,
        cited_article_id: updatedTicket.referenced_article_id,
        cited_article_version: updatedTicket.referenced_article_version,
        is_internal: false,
        created_at: nowIso,
      };

      const [evInsRes, msgInsRes] = await Promise.all([
        auditClient
          .from('ticket_lifecycle_events')
          .insert(toDbLifecycleEventRow(event, profile.id, profile.display_name)),
        client.from('messages').insert(toDbMessageRow(sysMsg)),
      ]);

      if (evInsRes.error) {
        throw new Error(
          `Failed recording lifecycle event (${evInsRes.error.code}): ${evInsRes.error.message}`
        );
      }
      newlyInsertedEventId = event.event_id;

      if (msgInsRes.error) {
        throw new Error(
          `Failed recording transition message (${msgInsRes.error.code}): ${msgInsRes.error.message}`
        );
      }
      newlyInsertedMessageId = sysMsg.message_id;

      if (updatedTicket.requester_profile_id) {
        const notifId = `NTF-${ticketId}-EVT-${String(nextEventSeq).padStart(3, '0')}`;
        const { error: notifErr } = await client
          .from('workspace_notifications')
          .upsert(
            {
              notification_id: notifId,
              recipient_profile_id: updatedTicket.requester_profile_id,
              ticket_id: ticketId,
              event_type:
                targetState === RequestStatus.Escalated
                  ? 'escalated'
                  : targetState === RequestStatus.Resolved
                  ? 'resolved'
                  : 'policy_verified',
              category:
                targetState === RequestStatus.Escalated
                  ? 'escalations'
                  : targetState === RequestStatus.PolicyVerified
                  ? 'policy'
                  : 'lifecycle',
              title: `${ticketId} Transitioned to ${targetState.toUpperCase()}`,
              summary: `Updated from '${prevState}' to '${targetState}' by ${profile.display_name} (${profile.actor_role}). Reason: ${reason}`,
              policy_reference: updatedTicket.referenced_policy_id
                ? `${updatedTicket.referenced_policy_id} v${updatedTicket.referenced_policy_version}`
                : null,
              is_read: false,
              created_at: nowIso,
            },
            { onConflict: 'notification_id' }
          );

        if (notifErr) {
          throw new Error(
            `Failed recording transition notification (${notifErr.code}): ${notifErr.message}`
          );
        }
      }

      const responsePayload = {
        status: 200,
        body: {
          ok: true,
          ticket: updatedTicket,
          event,
          messageRecord: sysMsg,
          sla: recomputedSla,
        },
      };

      if (cacheKey) {
        idempotencyResponseCache.set(cacheKey, {
          timestampMs: Date.now(),
          ...responsePayload,
        });
      }

      return responsePayload;
    } catch (err) {
      // Compensating rollback so failed transitions never partially update the ticket
      let rolledBack = false;
      if (originalTicketSnapshot) {
        try {
          if (newlyInsertedMessageId) {
            await auditClient
              .from('messages')
              .delete()
              .eq('message_id', newlyInsertedMessageId);
          }
          if (newlyInsertedEventId) {
            await auditClient
              .from('ticket_lifecycle_events')
              .delete()
              .eq('event_id', newlyInsertedEventId);
          }
          if (newlyInsertedAssignmentId) {
            await auditClient
              .from('assignments')
              .delete()
              .eq('assignment_id', newlyInsertedAssignmentId);
          }
          if (previousActiveAssignmentSnapshot) {
            await auditClient
              .from('assignments')
              .update({
                is_active: true,
                unassigned_at: null,
              })
              .eq(
                'assignment_id',
                previousActiveAssignmentSnapshot.assignment_id
              );
          }
          await client
            .from('tickets')
            .update({
              lifecycle_status: originalTicketSnapshot.lifecycle_status,
              current_assigned_team:
                originalTicketSnapshot.current_assigned_team,
              is_escalated: originalTicketSnapshot.is_escalated,
              requires_escalation: originalTicketSnapshot.requires_escalation,
              escalation_reason: originalTicketSnapshot.escalation_reason,
              resolution_summary: originalTicketSnapshot.resolution_summary,
              resolved_at: originalTicketSnapshot.resolved_at,
              closed_at: originalTicketSnapshot.closed_at,
              updated_at: originalTicketSnapshot.updated_at,
            })
            .eq('ticket_id', originalTicketSnapshot.ticket_id);
          rolledBack = true;
        } catch {
          // Best-effort rollback
        }
      }

      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          rolledBack,
          message:
            err instanceof Error
              ? err.message
              : 'Failed transitioning ticket in remote PostgreSQL.',
        },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION 5B: REASSIGN TICKET IN REMOTE POSTGRESQL (POST action='reassign_ticket')
  // Phase 5 Section 4: Atomic reassignment via public.atomic_reassign_ticket_workflow RPC
  // --------------------------------------------------------------------------
  if (action === 'reassign_ticket') {
    const reassignAuth = evaluateReassignmentAuthorization(profile.actor_role);
    if (!reassignAuth.authorized) {
      return {
        status: 403,
        body: {
          ok: false,
          code: reassignAuth.code,
          message: reassignAuth.message,
        },
      };
    }

    const ticketId = (body?.ticketId || '').trim();
    const targetTeam = (body?.targetTeam || '').trim();
    const reason = (body?.reason || '').trim();

    if (!ticketId || !targetTeam || reason.length < 5) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            'ticketId, targetTeam, and reassignment reason (min 5 chars) are required.',
        },
      };
    }

    try {
      const { data: ticketRow, error: ticketErr } = await client
        .from('tickets')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('is_synthetic_eval', false)
        .maybeSingle();

      if (
        ticketErr ||
        !ticketRow ||
        !isTicketAuthorizedForCaller(ticketRow as TicketRecord, profile)
      ) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'FORBIDDEN_TICKET_ACCESS',
            message: 'You are not authorized to reassign this ticket.',
          },
        };
      }

      const ticket = ticketRow as TicketRecord;
      if (ticket.lifecycle_status === RequestStatus.Closed) {
        return {
          status: 400,
          body: {
            ok: false,
            code: 'TICKET_CLOSED',
            message: 'Closed tickets cannot be reassigned.',
          },
        };
      }

      // Map frontend reassignment payload to the 12 parameters of public.atomic_reassign_ticket_workflow
      const categoryRule = DOCUMENTED_ROUTING_RULES[ticket.category_name];
      let defaultActorId: string | null = null;
      let defaultActorRole: ActorRole = profile.actor_role;
      let defaultRoutingRuleId: string | null = null;
      let isEscalationQueue = false;

      if (categoryRule) {
        if (targetTeam === categoryRule.primary_assigned_team) {
          defaultActorId = `ACTOR-OPS-${categoryRule.domain_code}`;
          defaultActorRole = categoryRule.default_actor_role;
          defaultRoutingRuleId = categoryRule.rule_id;
          isEscalationQueue = false;
        } else if (targetTeam === categoryRule.escalation_assigned_team) {
          defaultActorId = `ACTOR-ESC-${categoryRule.domain_code}`;
          defaultActorRole = categoryRule.escalation_actor_role;
          defaultRoutingRuleId = categoryRule.rule_id;
          isEscalationQueue = true;
        }
      }

      const explicitActorId =
        typeof body?.assignedActorId === 'string' &&
        body.assignedActorId.trim() !== ''
          ? body.assignedActorId.trim()
          : null;
      const explicitActorRole =
        typeof body?.assignedActorRole === 'string' &&
        body.assignedActorRole.trim() !== ''
          ? (body.assignedActorRole.trim() as ActorRole)
          : null;
      const explicitRoutingRuleId =
        typeof body?.routingRuleId === 'string' &&
        body.routingRuleId.trim() !== ''
          ? body.routingRuleId.trim()
          : null;

      const resolvedAssignedActorId = explicitActorId ?? defaultActorId;
      const resolvedAssignedActorRole =
        explicitActorRole ??
        (explicitActorId === profile.id ? profile.actor_role : defaultActorRole);
      const resolvedRoutingRuleId =
        explicitRoutingRuleId ?? defaultRoutingRuleId;
      const resolvedRequiresHumanReview =
        typeof body?.requiresHumanReview === 'boolean'
          ? body.requiresHumanReview
          : isEscalationQueue;

      const rpcParams = {
        p_ticket_id: ticketId,
        p_new_assignment_id:
          typeof body?.newAssignmentId === 'string' &&
          body.newAssignmentId.trim() !== ''
            ? body.newAssignmentId.trim()
            : null,
        p_sequence_number:
          typeof body?.sequenceNumber === 'number'
            ? body.sequenceNumber
            : null,
        p_target_team: targetTeam,
        p_assigned_actor_id: resolvedAssignedActorId,
        p_assigned_actor_role: resolvedAssignedActorRole,
        p_routing_rule_id: resolvedRoutingRuleId,
        p_assignment_reason: reason,
        p_requires_human_review: resolvedRequiresHumanReview,
        p_message_id:
          typeof body?.messageId === 'string' && body.messageId.trim() !== ''
            ? body.messageId.trim()
            : null,
        p_message_seq:
          typeof body?.messageSeq === 'number' ? body.messageSeq : null,
        p_notification_id:
          typeof body?.notificationId === 'string' &&
          body.notificationId.trim() !== ''
            ? body.notificationId.trim()
            : null,
      };

      // Invoke the atomic PostgreSQL RPC exactly once using the user-scoped JWT client
      const { data: rpcData, error: rpcErr } = await client.rpc(
        'atomic_reassign_ticket_workflow',
        rpcParams
      );

      if (rpcErr || !rpcData || rpcData.ok !== true) {
        const rawMsg =
          rpcErr?.message ||
          'Atomic ticket reassignment RPC failed in remote PostgreSQL.';
        const prefixMatch = /^([A-Z0-9_]+):\s*(.*)$/.exec(rawMsg);
        const extractedCode = prefixMatch ? prefixMatch[1] : null;
        const sqlState = rpcErr?.code || '';

        if (
          extractedCode === 'UNAUTHORIZED_JWT' ||
          extractedCode === 'UNAUTHORIZED' ||
          sqlState === '28000'
        ) {
          return {
            status: 401,
            body: {
              ok: false,
              code: extractedCode || 'UNAUTHORIZED',
              message: rawMsg,
            },
          };
        }

        if (
          extractedCode === 'FORBIDDEN_REASSIGNMENT' ||
          extractedCode === 'FORBIDDEN_ESCALATED_REASSIGNMENT' ||
          extractedCode === 'FORBIDDEN_ACCOUNT_STATUS' ||
          sqlState === '42501'
        ) {
          return {
            status: 403,
            body: {
              ok: false,
              code: extractedCode || 'FORBIDDEN_REASSIGNMENT',
              message: rawMsg,
            },
          };
        }

        if (extractedCode === 'TICKET_NOT_FOUND' || sqlState === 'P0002') {
          return {
            status: 404,
            body: {
              ok: false,
              code: 'TICKET_NOT_FOUND',
              message: rawMsg,
            },
          };
        }

        if (
          extractedCode === 'DUPLICATE_ASSIGNMENT_ID' ||
          extractedCode === 'DUPLICATE_MESSAGE_ID' ||
          extractedCode === 'DUPLICATE_NOTIFICATION_ID' ||
          sqlState === '23505'
        ) {
          return {
            status: 409,
            body: {
              ok: false,
              code: extractedCode || 'DUPLICATE_RECORD_ID',
              message: rawMsg,
            },
          };
        }

        if (
          extractedCode === 'TICKET_CLOSED' ||
          extractedCode === 'INVALID_TARGET_TEAM' ||
          extractedCode === 'ROUTING_RULE_MISMATCH' ||
          extractedCode === 'NOOP_REASSIGNMENT' ||
          extractedCode === 'INVALID_ASSIGNED_ROLE' ||
          extractedCode === 'INVALID_ASSIGNED_ACTOR_ID' ||
          extractedCode === 'ASSIGNED_ACTOR_NOT_FOUND' ||
          extractedCode === 'INACTIVE_ASSIGNED_ACTOR' ||
          extractedCode === 'ASSIGNED_ACTOR_ROLE_MISMATCH' ||
          extractedCode === 'INVALID_ASSIGNMENT_REASON' ||
          sqlState === '22023'
        ) {
          return {
            status: 400,
            body: {
              ok: false,
              code: extractedCode || 'VALIDATION_ERROR',
              message: rawMsg,
            },
          };
        }

        return {
          status: 500,
          body: {
            ok: false,
            code: 'REMOTE_DATABASE_WRITE_FAILED',
            rolledBack: true,
            message: rawMsg,
          },
        };
      }

      // Re-fetch the updated ticket and newly inserted workflow records (no duplicate writes)
      const [
        updatedTicketRes,
        newAsgRes,
        newMsgRes,
        newEvtRes,
        newNotifRes,
      ] = await Promise.all([
        client
          .from('tickets')
          .select('*')
          .eq('ticket_id', ticketId)
          .single(),
        client
          .from('assignments')
          .select('*')
          .eq('assignment_id', rpcData.assignment_id)
          .single(),
        client
          .from('messages')
          .select('*')
          .eq('message_id', rpcData.message_id)
          .single(),
        client
          .from('ticket_lifecycle_events')
          .select('*')
          .eq('event_id', rpcData.event_id)
          .maybeSingle(),
        rpcData.notification_id
          ? client
              .from('workspace_notifications')
              .select('*')
              .eq('notification_id', rpcData.notification_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (updatedTicketRes.error || !updatedTicketRes.data) {
        throw new Error(
          `Failed re-fetching updated ticket ${ticketId} after atomic RPC (${updatedTicketRes.error?.code}): ${updatedTicketRes.error?.message}`
        );
      }
      if (newAsgRes.error || !newAsgRes.data) {
        throw new Error(
          `Failed re-fetching assignment ${rpcData.assignment_id} after atomic RPC (${newAsgRes.error?.code}): ${newAsgRes.error?.message}`
        );
      }
      if (newMsgRes.error || !newMsgRes.data) {
        throw new Error(
          `Failed re-fetching message ${rpcData.message_id} after atomic RPC (${newMsgRes.error?.code}): ${newMsgRes.error?.message}`
        );
      }

      const updatedTicket: TicketRecord = {
        ...(updatedTicketRes.data as TicketRecord),
        term_id: updatedTicketRes.data.term_id || 'TERM-2026-FALL',
      };
      const newAsg = newAsgRes.data as AssignmentRecord;
      const sysMsg = fromDbMessageRow(newMsgRes.data);
      const lifecycleEvent = newEvtRes.data
        ? fromDbLifecycleEventRow(newEvtRes.data)
        : null;
      const notification =
        (newNotifRes.data as WorkspaceNotificationRecord) || null;

      // Phase 7 Scenario 7: Reassignment during an active SLA preserves start_timestamp
      // and prior assignment history while refreshing evaluated_timestamp and remaining SLA time.
      const { data: existingSlaRow } = await client
        .from('slas')
        .select('*')
        .eq('ticket_id', ticketId)
        .maybeSingle();

      const reassignedSla = buildReproducibleSlaRecord({
        ticketId,
        category: updatedTicket.category_name,
        startTimestampIso:
          existingSlaRow?.start_timestamp || updatedTicket.submitted_at,
        evaluatedTimestampIso:
          updatedTicket.resolved_at ||
          newAsg.assigned_at ||
          new Date().toISOString(),
        isTicketEscalated:
          updatedTicket.is_escalated ||
          updatedTicket.lifecycle_status === RequestStatus.Escalated,
        requiresEscalation: updatedTicket.requires_escalation,
        resolvedTimestampIso: updatedTicket.resolved_at,
        lifecycleStatus: updatedTicket.lifecycle_status,
      });

      if (existingSlaRow) {
        await auditClient
          .from('slas')
          .update(toDbSlaRow(reassignedSla))
          .eq('ticket_id', ticketId);
      }

      const responsePayload = {
        status: 200,
        body: {
          ok: true,
          ticket: updatedTicket,
          assignment: newAsg,
          sla: reassignedSla,
          messageRecord: sysMsg,
          lifecycleEvent,
          notification,
          rpcResult: rpcData,
          message: `Ticket ${ticketId} reassigned to ${newAsg.assigned_team} (${newAsg.assignment_id}).`,
        },
      };

      if (cacheKey) {
        idempotencyResponseCache.set(cacheKey, {
          timestampMs: Date.now(),
          ...responsePayload,
        });
      }

      return responsePayload;
    } catch (err) {
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          rolledBack: true,
          message:
            err instanceof Error
              ? err.message
              : 'Failed reassigning ticket in remote PostgreSQL.',
        },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION 6: SUBMIT RESOLUTION FEEDBACK IN REMOTE POSTGRESQL (POST action='submit_feedback')
  // Phase 5 Section 8: Only requester of resolved/closed ticket may submit feedback
  // --------------------------------------------------------------------------
  if (action === 'submit_feedback') {
    const ticketId = (body?.ticketId || '').trim();
    const rating = Number(body?.rating);
    const policyClarityScore = Number(body?.policyClarityScore || rating);
    const wasHelpful = Boolean(body?.wasHelpful);
    const resolutionAccepted = Boolean(body?.resolutionAccepted);
    const comments = body?.comments ? String(body.comments).trim() : null;

    if (!ticketId || isNaN(rating) || rating < 1 || rating > 5) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'ticketId and rating between 1 and 5 are required.',
        },
      };
    }

    try {
      const { data: ticketRow, error: ticketErr } = await client
        .from('tickets')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('is_synthetic_eval', false)
        .maybeSingle();

      if (ticketErr || !ticketRow) {
        return {
          status: 404,
          body: {
            ok: false,
            code: 'TICKET_NOT_FOUND',
            message: 'Ticket not found or inaccessible.',
          },
        };
      }

      const ticket = ticketRow as TicketRecord;
      const requester = await getOrProvisionRemoteRequester(client, profile);

      // Strict ownership check: only the ticket's own requester can submit resolution feedback
      const isTicketOwner =
        ticket.requester_profile_id === profile.id ||
        ticket.requester_id === requester.requester_id;

      if (!isTicketOwner) {
        return {
          status: 403,
          body: {
            ok: false,
            code: 'FORBIDDEN_FEEDBACK_SUBMISSION',
            message:
              'Only the ticket requester who submitted the request may submit resolution feedback.',
          },
        };
      }

      // Strict lifecycle check: feedback can only be submitted on resolved or closed tickets
      if (
        ticket.lifecycle_status !== RequestStatus.Resolved &&
        ticket.lifecycle_status !== RequestStatus.Closed
      ) {
        return {
          status: 400,
          body: {
            ok: false,
            code: 'TICKET_NOT_RESOLVED',
            message: `Resolution feedback can only be submitted after a ticket is marked 'resolved' or 'closed' (current state: '${ticket.lifecycle_status}').`,
          },
        };
      }

      const nowIso = new Date().toISOString();
      const feedback: ResolutionFeedbackRecord = {
        feedback_id: formatFeedbackId(ticketId),
        ticket_id: ticketId,
        requester_id: requester.requester_id,
        rating,
        was_helpful: wasHelpful,
        resolution_accepted: resolutionAccepted,
        policy_clarity_score: Math.min(5, Math.max(1, policyClarityScore)),
        comments,
        submitted_at: nowIso,
      };

      const { error: fbErr } = await client
        .from('resolution_feedbacks')
        .upsert(feedback, { onConflict: 'ticket_id' });

      if (fbErr) {
        throw new Error(
          `Failed saving feedback in public.resolution_feedbacks (${fbErr.code}): ${fbErr.message}`
        );
      }

      if (ticket.requester_profile_id) {
        await client.from('workspace_notifications').upsert(
          {
            notification_id: `NTF-${ticketId}-FDB`,
            recipient_profile_id: ticket.requester_profile_id,
            ticket_id: ticketId,
            event_type: 'resolved',
            category: 'lifecycle',
            title: `Resolution Feedback Recorded for ${ticketId}`,
            summary: `Satisfaction rating ${rating}/5 (${resolutionAccepted ? 'Resolution Accepted' : 'Further Review Requested'}) recorded under ${feedback.feedback_id}.`,
            policy_reference: ticket.referenced_policy_id
              ? `${ticket.referenced_policy_id} v${ticket.referenced_policy_version}`
              : null,
            is_read: false,
            created_at: nowIso,
          },
          { onConflict: 'notification_id' }
        );
      }

      const responsePayload = {
        status: 200,
        body: {
          ok: true,
          feedback,
          message: `Resolution feedback ${feedback.feedback_id} recorded in remote PostgreSQL for ${ticketId}.`,
        },
      };

      if (cacheKey) {
        idempotencyResponseCache.set(cacheKey, {
          timestampMs: Date.now(),
          ...responsePayload,
        });
      }

      return responsePayload;
    } catch (err) {
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Failed saving feedback to remote PostgreSQL.',
        },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION 7: PUBLISH POLICY DOCUMENT IN REMOTE POSTGRESQL (POST action='publish_policy')
  // --------------------------------------------------------------------------
  if (action === 'publish_policy') {
    const canPublishActive =
      profile.actor_role === ActorRole.AcademicAdministrator ||
      profile.actor_role === ActorRole.PlatformAdministrator;
    const canProposeDraft =
      canPublishActive ||
      profile.actor_role === ActorRole.Instructor ||
      profile.actor_role === ActorRole.SupportStaff;

    if (!canProposeDraft) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'INSUFFICIENT_ROLE_PRIVILEGE',
          message: `Authoritative role '${profile.actor_role}' is not permitted to publish or propose policy documents.`,
        },
      };
    }

    const domain = (
      body?.domain || 'REG'
    ).trim().toUpperCase() as PolicyDomainCode;
    const title = (body?.title || '').trim();
    const version = (body?.version || '1.0').trim();
    const summary = (body?.summary || '').trim();
    const content = (body?.content || '').trim();
    const effectiveDate = (
      body?.effectiveDate || new Date().toISOString().slice(0, 10)
    ).trim();

    if (
      !['FINAID', 'REG', 'IT', 'ACCESS'].includes(domain) ||
      title.length < 5 ||
      content.length < 30
    ) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            'Valid domain (FINAID, REG, IT, ACCESS), title (min 5 chars), and content (min 30 chars) are required.',
        },
      };
    }

    try {
      const { data: domainPolicies } = await client
        .from('policy_documents')
        .select('policy_id')
        .eq('domain', domain);

      const nextPolSeq = (domainPolicies?.length || 12) + 1;
      const policyId = formatPolicyId(domain, nextPolSeq);
      const categoryIdMap: Record<
        PolicyDomainCode,
        CategoryRecord['category_id']
      > = {
        FINAID: 'CAT-FINAID',
        REG: 'CAT-REG',
        IT: 'CAT-IT',
        ACCESS: 'CAT-ACCESS',
      };

      const newPolicy: PolicyDocumentRecord = {
        policy_id: policyId,
        domain,
        category_id: categoryIdMap[domain],
        title,
        version: /^\d+\.\d+$/.test(version) ? version : '1.0',
        effective_date: effectiveDate,
        expiration_date: null,
        lifecycle_state: canPublishActive ? 'active' : 'draft',
        supersedes_policy_id: null,
        superseded_by_policy_id: null,
        summary:
          summary ||
          `[SYNTHETIC / USER-REGISTERED POLICY] ${title} (${policyId} v${version}).`,
        content,
        authoritative_section_ref: 'Section 1.0',
        source_name: `Registered by ${profile.display_name} (${profile.actor_role})`,
        source_url: `https://synthetic-policy.campusresolve.edu/policies/${policyId.toLowerCase()}`,
        dataset_or_doc_version: `2026.10-custom-v${version}`,
        retrieval_date: new Date().toISOString().slice(0, 10),
        license_terms: 'CC0-1.0 Synthetic Demonstration & Evaluation Corpus',
        attribution: `Submitted by ${profile.verified_email} in CampusResolve AI workspace.`,
        transformations_performed: 'Validated schema and version metadata.',
        discarded_fields: null,
        is_synthetic_policy: true,
        published_by_profile_id: profile.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: existingArticles } = await client
        .from('knowledge_articles')
        .select('article_id');
      const nextKbSeq = (existingArticles?.length || 200) + 1;
      const articleId = formatKnowledgeArticleId(nextKbSeq);
      const newArticle: KnowledgeArticleRecord = {
        article_id: articleId,
        category_id: categoryIdMap[domain],
        primary_policy_id: policyId,
        primary_policy_version: newPolicy.version,
        title: `Operational Guidance: ${title} (${policyId})`,
        version: newPolicy.version,
        effective_date: effectiveDate,
        expiration_date: null,
        lifecycle_state: canPublishActive ? 'published' : 'draft',
        summary: newPolicy.summary,
        content: newPolicy.content,
        tags: [domain.toLowerCase(), policyId.toLowerCase()],
        source_url: `https://synthetic-kb.campusresolve.edu/articles/${articleId.toLowerCase()}`,
        dataset_or_doc_version: `2026.10-custom-kb-v${newPolicy.version}`,
        retrieval_date: new Date().toISOString().slice(0, 10),
        license_terms: 'CC0-1.0 Synthetic Demonstration & Evaluation Corpus',
        attribution: `Linked article for ${policyId}.`,
        transformations_performed: 'Auto-linked to parent PolicyDocument.',
        discarded_fields: null,
        is_synthetic_article: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: polErr } = await client
        .from('policy_documents')
        .insert(newPolicy);
      if (polErr) {
        throw new Error(
          `Failed inserting policy into public.policy_documents (${polErr.code}): ${polErr.message}`
        );
      }

      await client.from('policy_version_history').insert({
        history_id: `PVH-${policyId}-v${newPolicy.version}`,
        policy_id: policyId,
        version: newPolicy.version,
        effective_date: effectiveDate,
        expiration_date: null,
        lifecycle_state: newPolicy.lifecycle_state,
        change_summary: newPolicy.summary,
        authoritative_section_ref: newPolicy.authoritative_section_ref,
        recorded_at: new Date().toISOString(),
      });

      const { error: artErr } = await client
        .from('knowledge_articles')
        .insert(newArticle);
      if (artErr) {
        throw new Error(
          `Failed inserting article into public.knowledge_articles (${artErr.code}): ${artErr.message}`
        );
      }

      await client.from('policy_article_links').insert({
        link_id: `LNK-POL-KB-CUSTOM-${nextKbSeq}`,
        policy_id: policyId,
        policy_version: newPolicy.version,
        article_id: articleId,
        article_version: newArticle.version,
        relationship_type: 'primary_governance',
        created_at: new Date().toISOString(),
      });

      return {
        status: 201,
        body: {
          ok: true,
          policy: newPolicy,
          article: newArticle,
          message: `Registered ${policyId} (v${newPolicy.version}, state: ${newPolicy.lifecycle_state}) and linked Knowledge Article ${articleId} in remote PostgreSQL.`,
        },
      };
    } catch (err) {
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Failed publishing policy to remote PostgreSQL.',
        },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION 8: MARK NOTIFICATIONS READ IN REMOTE POSTGRESQL (POST action='mark_notifications_read')
  // --------------------------------------------------------------------------
  if (action === 'mark_notifications_read') {
    const { error } = await client
      .from('workspace_notifications')
      .update({ is_read: true })
      .eq('recipient_profile_id', profile.id);

    if (error) {
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          message: `Failed updating notifications in remote PostgreSQL (${error.code}): ${error.message}`,
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        message: 'Notifications marked as read in remote PostgreSQL.',
      },
    };
  }

  // --------------------------------------------------------------------------
  // ACTION 9: EVALUATE SLA & ESCALATION ENGINEERING IN REMOTE POSTGRESQL (POST action='evaluate_sla_and_escalation')
  // Phase 7 Sections 2–6: Evaluates SLA deadlines, approaching thresholds, routing & assignment integrity,
  // executes traceable escalations without auto-resolving tickets, and prevents duplicate notifications.
  // --------------------------------------------------------------------------
  if (action === 'evaluate_sla_and_escalation') {
    const isStaffOrAdmin =
      profile.actor_role === ActorRole.SupportStaff ||
      profile.actor_role === ActorRole.AcademicAdministrator ||
      profile.actor_role === ActorRole.PlatformAdministrator;

    if (!isStaffOrAdmin) {
      return {
        status: 403,
        body: {
          ok: false,
          code: 'FORBIDDEN_SLA_EVALUATION',
          message: `Role '${profile.actor_role}' is not authorized to trigger operational SLA and escalation remediation.`,
        },
      };
    }

    const ticketId = (body?.ticketId || '').trim();
    if (!ticketId) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'ticketId is required for SLA and escalation evaluation.',
        },
      };
    }

    // Validate optional custom SLA configuration before mutating (Scenario 9)
    if (body?.customSlaRule || body?.customSchedule || body?.approachingThresholdRatio !== undefined) {
      const cfgCheck = validateSlaConfiguration({
        category: body?.category || 'Registration',
        customRule: body?.customSlaRule,
        schedule: body?.customSchedule,
        approachingThresholdRatio: body?.approachingThresholdRatio,
      });
      if (!cfgCheck.valid) {
        return {
          status: 400,
          body: {
            ok: false,
            code: cfgCheck.code,
            message: cfgCheck.message,
          },
        };
      }
    }

    try {
      const { data: ticketRow, error: ticketErr } = await client
        .from('tickets')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('is_synthetic_eval', false)
        .maybeSingle();

      if (ticketErr || !ticketRow) {
        return {
          status: 404,
          body: {
            ok: false,
            code: 'TICKET_NOT_FOUND',
            message: `Ticket ${ticketId} not found in remote PostgreSQL.`,
          },
        };
      }

      const ticket = ticketRow as TicketRecord;
      const evaluatedAtIso =
        typeof body?.evaluatedAtIso === 'string' &&
        !isNaN(Date.parse(body.evaluatedAtIso))
          ? new Date(Date.parse(body.evaluatedAtIso)).toISOString()
          : new Date().toISOString();

      const [slaRes, asgRes, evtRes, msgRes, notifRes] = await Promise.all([
        client.from('slas').select('*').eq('ticket_id', ticketId).maybeSingle(),
        client
          .from('assignments')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('sequence_number', { ascending: true }),
        client
          .from('ticket_lifecycle_events')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('recorded_at', { ascending: true }),
        client
          .from('messages')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('sequence_number', { ascending: true }),
        ticket.requester_profile_id
          ? client
              .from('workspace_notifications')
              .select('*')
              .eq('recipient_profile_id', ticket.requester_profile_id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const existingSla = (slaRes.data as SLARecord | null) ?? null;
      const existingAssignments = (asgRes.data || []) as AssignmentRecord[];
      const existingEvents = (evtRes.data || []).map((e) =>
        fromDbLifecycleEventRow(e)
      );
      const existingMessages = (msgRes.data || []).map((m) =>
        fromDbMessageRow(m)
      );
      const existingNotifications = (notifRes.data ||
        []) as WorkspaceNotificationRecord[];

      const evalResult = evaluateTicketEscalationAndExceptions({
        ticket,
        sla: existingSla,
        assignments: existingAssignments,
        lifecycleEvents: existingEvents,
        messages: existingMessages,
        notifications: existingNotifications,
        evaluatedAtIso,
        schedule: body?.customSchedule,
        customSlaRule: body?.customSlaRule,
        approachingThresholdRatio: body?.approachingThresholdRatio,
        escalateOnApproachingDeadline: Boolean(
          body?.escalateOnApproachingDeadline
        ),
        aiAssistantEscalationReason:
          typeof body?.aiAssistantEscalationReason === 'string'
            ? body.aiAssistantEscalationReason
            : null,
      });

      // Always persist the updated SLA evaluation metrics in public.slas
      if (existingSla) {
        await auditClient
          .from('slas')
          .update(toDbSlaRow(evalResult.sla))
          .eq('ticket_id', ticketId);
      } else {
        await auditClient.from('slas').insert(toDbSlaRow(evalResult.sla));
      }

      let updatedTicket: TicketRecord = {
        ...ticket,
        term_id: ticket.term_id || 'TERM-2026-FALL',
      };
      let newAssignmentRecord: AssignmentRecord | null = null;
      let newLifecycleEvent: TicketLifecycleEventRecord | null = null;
      let newMessageRecord: MessageRecord | null = null;
      let notificationRecord: WorkspaceNotificationRecord | null = null;
      let notificationCreated = false;
      let notificationReused = false;

      // Scenario 8: If duplicate escalation condition is detected, reuse existing notification without duplicate writes
      if (evalResult.duplicateEscalationPrevented) {
        const triggerKey = evalResult.primaryTriggerCode || 'escalated';
        const deterministicNotifId = `NTF-${ticketId}-ESC-${triggerKey
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 16)}`;
        notificationRecord =
          existingNotifications.find(
            (n) =>
              n.notification_id === deterministicNotifId ||
              (n.ticket_id === ticketId && n.event_type === 'escalated')
          ) || null;
        notificationReused = Boolean(notificationRecord);
      } else if (evalResult.shouldEscalateNow) {
        const requester = await getOrProvisionRemoteRequester(client, profile);
        const prevActive =
          existingAssignments.find((a) => a.is_active) || null;

        // Deactivate any active assignment row while preserving full assignment history
        if (prevActive) {
          await auditClient
            .from('assignments')
            .update({ is_active: false, unassigned_at: evaluatedAtIso })
            .eq('assignment_id', prevActive.assignment_id);
        }

        const nextAsgSeq =
          existingAssignments.length > 0
            ? Math.max(...existingAssignments.map((a) => a.sequence_number)) + 1
            : 1;

        const escalationReasonText =
          evalResult.combinedEscalationReason ||
          'Escalated by Phase 7 SLA and escalation rule evaluation.';

        newAssignmentRecord = {
          assignment_id: formatAssignmentId(ticketId, nextAsgSeq),
          ticket_id: ticketId,
          sequence_number: nextAsgSeq,
          assigned_team: evalResult.recommendedAssignedTeam,
          assigned_actor_id: evalResult.recommendedAssignedActorId,
          assigned_actor_role: evalResult.recommendedAssignedActorRole,
          routing_rule_id: evalResult.recommendedRoutingRuleId,
          assignment_reason: escalationReasonText,
          previous_assignment_id: prevActive?.assignment_id ?? null,
          previous_assigned_team: prevActive?.assigned_team ?? null,
          requires_human_review: true,
          is_active: true,
          assigned_at: evaluatedAtIso,
          unassigned_at: null,
        };

        const { error: insAsgErr } = await auditClient
          .from('assignments')
          .insert(newAssignmentRecord);
        if (insAsgErr) {
          throw new Error(
            `Failed inserting escalation assignment (${insAsgErr.code}): ${insAsgErr.message}`
          );
        }

        // Update ticket to Escalated (NEVER auto-resolve!)
        const { data: updTicketData, error: updTicketErr } = await client
          .from('tickets')
          .update({
            lifecycle_status: RequestStatus.Escalated,
            is_escalated: true,
            requires_escalation: true,
            escalation_reason: escalationReasonText,
            current_assigned_team: evalResult.recommendedAssignedTeam,
            current_routing_rule_id: evalResult.recommendedRoutingRuleId,
            updated_at: evaluatedAtIso,
          })
          .eq('ticket_id', ticketId)
          .select('*')
          .single();

        if (updTicketErr || !updTicketData) {
          throw new Error(
            `Failed updating ticket during escalation (${updTicketErr?.code}): ${updTicketErr?.message}`
          );
        }

        updatedTicket = {
          ...(updTicketData as TicketRecord),
          term_id: updTicketData.term_id || 'TERM-2026-FALL',
        };

        const nextEvtSeq = existingEvents.length + 1;
        newLifecycleEvent = {
          event_id: `EVT-${ticketId}-${String(nextEvtSeq).padStart(3, '0')}`,
          ticket_id: ticketId,
          previous_state: ticket.lifecycle_status,
          new_state: RequestStatus.Escalated,
          actor_id: requester.requester_id,
          actor_role: profile.actor_role,
          reason: escalationReasonText,
          referenced_policy_id: updatedTicket.referenced_policy_id,
          referenced_policy_version: updatedTicket.referenced_policy_version,
          referenced_article_id: updatedTicket.referenced_article_id,
          referenced_article_version: updatedTicket.referenced_article_version,
          event_timestamp: evaluatedAtIso,
        };

        const nextMsgSeq =
          existingMessages.length > 0
            ? Math.max(...existingMessages.map((m) => m.sequence_number)) + 1
            : 1;

        newMessageRecord = {
          message_id: formatMessageId(ticketId, nextMsgSeq),
          ticket_id: ticketId,
          sequence_number: nextMsgSeq,
          sender_id: requester.requester_id,
          sender_profile_id: profile.id,
          sender_role: profile.actor_role,
          sender_name: profile.display_name,
          message_type: 'escalation_handoff',
          body: `SLA & Escalation Rule Triggered (${evalResult.primaryTriggerCode || 'escalated'}): Routed to ${evalResult.recommendedAssignedTeam} (${evalResult.recommendedRoutingRuleId}). ${escalationReasonText}`,
          cited_policy_id: updatedTicket.referenced_policy_id,
          cited_policy_version: updatedTicket.referenced_policy_version,
          cited_article_id: updatedTicket.referenced_article_id,
          cited_article_version: updatedTicket.referenced_article_version,
          is_internal: false,
          created_at: evaluatedAtIso,
        };

        await Promise.all([
          auditClient
            .from('ticket_lifecycle_events')
            .insert(
              toDbLifecycleEventRow(
                newLifecycleEvent,
                profile.id,
                profile.display_name
              )
            ),
          client.from('messages').insert(toDbMessageRow(newMessageRecord)),
        ]);

        if (updatedTicket.requester_profile_id) {
          const triggerKey = evalResult.primaryTriggerCode || 'escalated';
          const deterministicNotifId = `NTF-${ticketId}-ESC-${triggerKey
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 16)}`;

          const alreadyExists = existingNotifications.find(
            (n) => n.notification_id === deterministicNotifId
          );

          if (alreadyExists) {
            notificationRecord = alreadyExists;
            notificationCreated = false;
            notificationReused = true;
          } else {
            const notifPayload: WorkspaceNotificationRecord = {
              notification_id: deterministicNotifId,
              recipient_profile_id: updatedTicket.requester_profile_id,
              ticket_id: ticketId,
              event_type: 'escalated',
              category: 'escalations',
              title: `${ticketId} Escalated to ${evalResult.recommendedAssignedTeam}`,
              summary: escalationReasonText,
              policy_reference: updatedTicket.referenced_policy_id
                ? `${updatedTicket.referenced_policy_id} v${updatedTicket.referenced_policy_version}`
                : null,
              is_read: false,
              created_at: evaluatedAtIso,
            };

            const { error: notifInsErr } = await client
              .from('workspace_notifications')
              .upsert(notifPayload, { onConflict: 'notification_id' });
            if (!notifInsErr) {
              notificationRecord = notifPayload;
              notificationCreated = true;
              notificationReused = false;
            }
          }
        }
      } else if (
        evalResult.isApproachingDeadline &&
        !evalResult.isBreached &&
        updatedTicket.requester_profile_id
      ) {
        // Scenario 1: Record approaching-deadline warning notification idempotently without duplicating
        const approachingNotifId = `NTF-${ticketId}-SLA-APPROACHING`;
        const existingApproachingNotif = existingNotifications.find(
          (n) => n.notification_id === approachingNotifId
        );

        if (existingApproachingNotif) {
          notificationRecord = existingApproachingNotif;
          notificationCreated = false;
          notificationReused = true;
        } else {
          const approachingReason =
            evalResult.triggers.find(
              (t) => t.trigger_code === 'approaching_sla_deadline'
            )?.reason ||
            `Ticket ${ticketId} is approaching its configured SLA deadline (${evalResult.sla.remaining_business_minutes} business minutes remaining).`;
          const notifPayload: WorkspaceNotificationRecord = {
            notification_id: approachingNotifId,
            recipient_profile_id: updatedTicket.requester_profile_id,
            ticket_id: ticketId,
            event_type: 'routing_assigned',
            category: 'escalations',
            title: `${ticketId} Approaching Configurable SLA Deadline`,
            summary: `[approaching_sla_deadline] ${approachingReason}`,
            policy_reference: updatedTicket.referenced_policy_id
              ? `${updatedTicket.referenced_policy_id} v${updatedTicket.referenced_policy_version}`
              : null,
            is_read: false,
            created_at: evaluatedAtIso,
          };

          const { error: notifErr } = await client
            .from('workspace_notifications')
            .upsert(notifPayload, { onConflict: 'notification_id' });
          if (!notifErr) {
            notificationRecord = notifPayload;
            notificationCreated = true;
            notificationReused = false;
          }
        }
      }

      const responsePayload = {
        status: 200,
        body: {
          ok: true,
          ticket: updatedTicket,
          sla: evalResult.sla,
          evaluation: evalResult,
          assignment: newAssignmentRecord,
          lifecycleEvent: newLifecycleEvent,
          messageRecord: newMessageRecord,
          notification: notificationRecord,
          notificationStatus: {
            notificationCreated,
            notificationReused,
            notificationId: notificationRecord?.notification_id ?? null,
          },
          message: evalResult.duplicateEscalationPrevented
            ? `Ticket ${ticketId} is already escalated for '${evalResult.primaryTriggerCode}'; duplicate escalation and duplicate notification were prevented.`
            : evalResult.shouldEscalateNow
            ? `Ticket ${ticketId} escalated to ${evalResult.recommendedAssignedTeam} (${evalResult.primaryTriggerCode}).`
            : `SLA and escalation evaluation completed for ${ticketId} (sla_status: ${evalResult.sla.sla_status}).`,
        },
      };

      if (cacheKey) {
        idempotencyResponseCache.set(cacheKey, {
          timestampMs: Date.now(),
          ...responsePayload,
        });
      }

      return responsePayload;
    } catch (err) {
      return {
        status: 500,
        body: {
          ok: false,
          code: 'REMOTE_DATABASE_WRITE_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Failed evaluating SLA and escalation in remote PostgreSQL.',
        },
      };
    }
  }

  return {
    status: 400,
    body: {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `Unsupported workspace action '${action}'.`,
    },
  };
}

export default async function handler(req: any, res: any) {
  try {
    let parsedBody = req.body;
    if (typeof parsedBody === 'string' && parsedBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        parsedBody = undefined;
      }
    }
    const result = await processWorkspaceOperationRequest(
      req.method,
      req.query || {},
      parsedBody,
      req.headers || {}
    );
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({
      ok: false,
      code: 'SERVER_ERROR',
      message:
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while processing the workspace request.',
    });
  }
}

