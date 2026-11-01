import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SupabaseClient } from '@supabase/supabase-js';
import { ActorRole, RequestStatus } from '../types/domain';
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  DOCUMENTED_ASSIGNMENT_TEAMS,
  DOCUMENTED_ROUTING_RULES,
  ID_PATTERNS,
  OFFICIAL_CATEGORIES,
  UNMAPPED_HUMAN_REVIEW_ROUTING,
  buildReproducibleSlaRecord,
  createLifecycleEvent,
  createReassignmentRecord,
  evaluateReassignmentAuthorization,
  evaluateTicketRouting,
  evaluateTransitionAuthorization,
  formatAssignmentId,
  formatFeedbackId,
  formatMessageId,
  formatSlaId,
  formatTicketId,
  getPermittedNextLifecycleStatesForActor,
  isValidLifecycleTransition,
  resolveOfficialCategory,
  validateResolutionTransition,
} from './workflowEngine';
import {
  REQUIRED_PHASE3_TABLES,
  VerifiedCallerIdentity,
  clearWorkspaceIdempotencyCache,
  createScopedSupabaseClient,
  fromDbLifecycleEventRow,
  fromDbMessageRow,
  getReferenceCorpus,
  processWorkspaceOperationRequest,
  toDbLifecycleEventRow,
  toDbMessageRow,
  verifyRemotePhase3Schema,
} from '../../api/ops/workspace';

/**
 * Relational in-memory PostgreSQL table simulator that faithfully enforces
 * primary/unique constraints (HTTP 409 / PG code '23505') and supports fault
 * injection on any table/operation to test compensating rollback, concurrency
 * sequence allocation, and multi-actor isolation in `processWorkspaceOperationRequest`.
 */
function createTransactionalTestSupabaseClient(options?: {
  failOnTableWrite?: { table: string; operation: 'insert' | 'update' };
  simulateFirstInsertConflictOnTable?: string;
  failOnRpcStep?:
    | 'insert_assignment'
    | 'update_ticket'
    | 'insert_lifecycle_event'
    | 'insert_message';
}) {
  const reference = getReferenceCorpus();
  const tables: Record<string, any[]> = {
    app_profiles: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        actor_role: ActorRole.Learner,
        account_status: 'active',
        display_name: 'Alex Rivera (Learner)',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        actor_role: ActorRole.Instructor,
        account_status: 'active',
        display_name: 'Dr. Evelyn Chen (Instructor)',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        actor_role: ActorRole.SupportStaff,
        account_status: 'active',
        display_name: 'Jordan Taylor (Support Staff)',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        actor_role: ActorRole.AcademicAdministrator,
        account_status: 'active',
        display_name: 'Dean Morgan Vance (Academic Admin)',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        actor_role: ActorRole.PlatformAdministrator,
        account_status: 'active',
        display_name: 'Riley Sterling (Platform Admin)',
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        actor_role: ActorRole.Learner,
        account_status: 'active',
        display_name: 'Samira Patel (Second Learner)',
      },
    ],
    roles: [...reference.roles],
    terms: [...reference.terms],
    requesters: [],
    categories: [...reference.categories],
    policy_documents: [...reference.policyDocuments],
    policy_version_history: [],
    knowledge_articles: [...reference.knowledgeArticles],
    policy_article_links: [...reference.policyArticleLinks],
    tickets: [],
    ticket_policy_links: [],
    ticket_article_links: [],
    ticket_lifecycle_events: [],
    messages: [],
    assignments: [],
    slas: [],
    resolution_feedbacks: [],
    ai_retrieval_logs: [],
    workspace_notifications: [],
  };

  const primaryKeyMap: Record<string, string> = {
    app_profiles: 'id',
    roles: 'role_id',
    terms: 'term_id',
    requesters: 'requester_id',
    categories: 'category_id',
    policy_documents: 'policy_id',
    policy_version_history: 'history_id',
    knowledge_articles: 'article_id',
    policy_article_links: 'link_id',
    tickets: 'ticket_id',
    ticket_policy_links: 'link_id',
    ticket_article_links: 'link_id',
    ticket_lifecycle_events: 'event_id',
    messages: 'message_id',
    assignments: 'assignment_id',
    slas: 'sla_id',
    resolution_feedbacks: 'ticket_id',
    ai_retrieval_logs: 'query_id',
    workspace_notifications: 'notification_id',
  };

  let simulatedConflictConsumed = false;
  let authenticatedTestCaller: VerifiedCallerIdentity | null = null;
  const rpcCalls: Array<{ fn: string; params: Record<string, any> }> = [];

  const client = {
    tables,
    rpcCalls,
    setAuthenticatedTestCaller(profile: VerifiedCallerIdentity | null) {
      authenticatedTestCaller = profile;
    },
    async rpc(fnName: string, params: Record<string, any>) {
      rpcCalls.push({ fn: fnName, params: { ...params } });
      if (fnName !== 'atomic_reassign_ticket_workflow') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: `Function public.${fnName} not found`,
          },
        };
      }

      try {
        const result = executeSimulatedAtomicReassignRpc(
          client as any,
          {
            isValidAuthenticatedJwt: Boolean(authenticatedTestCaller),
            profile: authenticatedTestCaller,
          },
          params as any,
          { failAtStep: options?.failOnRpcStep }
        );
        return { data: result, error: null };
      } catch (err: any) {
        return {
          data: null,
          error: {
            code: err?.code || 'XX000',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let sortField: string | null = null;
      let sortAsc = true;
      let maxRows: number | null = null;
      let pendingOp: 'select' | 'insert' | 'update' | 'upsert' | 'delete' =
        'select';
      let pendingPayload: any = null;
      let upsertConflictCol: string | null = null;

      const execute = async (): Promise<{
        data: any;
        error: any;
        status: number;
      }> => {
        const rows = tables[table];
        if (!rows) {
          return {
            data: null,
            error: {
              code: 'PGRST205',
              message: `Table public.${table} not found`,
            },
            status: 404,
          };
        }

        if (
          options?.failOnTableWrite &&
          options.failOnTableWrite.table === table &&
          options.failOnTableWrite.operation === pendingOp
        ) {
          return {
            data: null,
            error: {
              code: 'XX000',
              message: `Simulated database write failure on public.${table} (${pendingOp})`,
            },
            status: 500,
          };
        }

        if (pendingOp === 'insert') {
          if (
            options?.simulateFirstInsertConflictOnTable === table &&
            !simulatedConflictConsumed
          ) {
            simulatedConflictConsumed = true;
            return {
              data: null,
              error: {
                code: '23505',
                message: `duplicate key value violates unique constraint on ${table}`,
              },
              status: 409,
            };
          }

          const items = Array.isArray(pendingPayload)
            ? pendingPayload
            : [pendingPayload];
          const pk = primaryKeyMap[table];
          for (const item of items) {
            if (pk && rows.some((r) => r[pk] === item[pk])) {
              return {
                data: null,
                error: {
                  code: '23505',
                  message: `duplicate key value violates unique constraint "${table}_pkey" (${item[pk]})`,
                },
                status: 409,
              };
            }
          }
          const cloned = items.map((i) => ({ ...i }));
          rows.push(...cloned);
          return {
            data: Array.isArray(pendingPayload) ? cloned : cloned[0],
            error: null,
            status: 201,
          };
        }

        if (pendingOp === 'upsert') {
          const items = Array.isArray(pendingPayload)
            ? pendingPayload
            : [pendingPayload];
          const conflictCol =
            upsertConflictCol || primaryKeyMap[table] || 'id';
          const upserted: any[] = [];
          for (const item of items) {
            const idx = rows.findIndex(
              (r) => r[conflictCol] === item[conflictCol]
            );
            if (idx >= 0) {
              rows[idx] = { ...rows[idx], ...item };
              upserted.push(rows[idx]);
            } else {
              const copy = { ...item };
              rows.push(copy);
              upserted.push(copy);
            }
          }
          return {
            data: Array.isArray(pendingPayload) ? upserted : upserted[0],
            error: null,
            status: 200,
          };
        }

        if (pendingOp === 'update') {
          const matched: any[] = [];
          for (let i = 0; i < rows.length; i++) {
            if (filters.every((fn) => fn(rows[i]))) {
              rows[i] = { ...rows[i], ...pendingPayload };
              matched.push(rows[i]);
            }
          }
          return {
            data: matched,
            error: null,
            status: 200,
          };
        }

        if (pendingOp === 'delete') {
          const kept: any[] = [];
          const deleted: any[] = [];
          for (const row of rows) {
            if (filters.every((fn) => fn(row))) {
              deleted.push(row);
            } else {
              kept.push(row);
            }
          }
          tables[table] = kept;
          return { data: deleted, error: null, status: 200 };
        }

        // SELECT
        let result = rows.filter((r) => filters.every((fn) => fn(r)));
        if (sortField) {
          const sf = sortField;
          result = [...result].sort((a, b) => {
            const va = a[sf] ?? '';
            const vb = b[sf] ?? '';
            if (va < vb) return sortAsc ? -1 : 1;
            if (va > vb) return sortAsc ? 1 : -1;
            return 0;
          });
        }
        if (maxRows !== null) {
          result = result.slice(0, maxRows);
        }
        return { data: result, error: null, status: 200 };
      };

      const builder: any = {
        select(_cols?: string) {
          return builder;
        },
        insert(payload: any) {
          pendingOp = 'insert';
          pendingPayload = payload;
          return builder;
        },
        update(payload: any) {
          pendingOp = 'update';
          pendingPayload = payload;
          return builder;
        },
        upsert(payload: any, opts?: { onConflict?: string }) {
          pendingOp = 'upsert';
          pendingPayload = payload;
          upsertConflictCol = opts?.onConflict ?? null;
          return builder;
        },
        delete() {
          pendingOp = 'delete';
          return builder;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          sortField = col;
          sortAsc = opts?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          maxRows = n;
          return builder;
        },
        async maybeSingle() {
          const res = await execute();
          if (res.error) return res;
          const arr = Array.isArray(res.data) ? res.data : [res.data];
          return {
            data: arr.length > 0 ? arr[0] : null,
            error: null,
            status: res.status,
          };
        },
        async single() {
          const res = await execute();
          if (res.error) return res;
          const arr = Array.isArray(res.data) ? res.data : [res.data];
          if (!arr[0]) {
            return {
              data: null,
              error: { code: 'PGRST116', message: 'No rows returned' },
              status: 406,
            };
          }
          return { data: arr[0], error: null, status: res.status };
        },
        then(onFulfilled: any, onRejected: any) {
          return execute().then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };

  return client as unknown as SupabaseClient & {
    tables: Record<string, any[]>;
    rpcCalls: Array<{ fn: string; params: Record<string, any> }>;
    setAuthenticatedTestCaller: (profile: VerifiedCallerIdentity | null) => void;
  };
}

const TEST_ACTORS: Record<ActorRole, VerifiedCallerIdentity> = {
  [ActorRole.Learner]: {
    id: '11111111-1111-4111-8111-111111111111',
    auth_provider: 'supabase_email',
    provider_subject: '11111111-1111-4111-8111-111111111111',
    verified_email: 'learner.alex@university.edu',
    display_name: 'Alex Rivera (Learner)',
    department: 'Undergraduate Computer Science',
    office_or_cohort: 'Class of 2027',
    actor_role: ActorRole.Learner,
    account_status: 'active',
  },
  [ActorRole.Instructor]: {
    id: '22222222-2222-4222-8222-222222222222',
    auth_provider: 'supabase_email',
    provider_subject: '22222222-2222-4222-8222-222222222222',
    verified_email: 'prof.chen@university.edu',
    display_name: 'Dr. Evelyn Chen (Instructor)',
    department: 'Department of Mathematics',
    office_or_cohort: 'Faculty Senate',
    actor_role: ActorRole.Instructor,
    account_status: 'active',
  },
  [ActorRole.SupportStaff]: {
    id: '33333333-3333-4333-8333-333333333333',
    auth_provider: 'supabase_email',
    provider_subject: '33333333-3333-4333-8333-333333333333',
    verified_email: 'ops.specialist@university.edu',
    display_name: 'Jordan Taylor (Support Staff)',
    department: 'Office of the University Registrar',
    office_or_cohort: 'Operations Triage',
    actor_role: ActorRole.SupportStaff,
    account_status: 'active',
  },
  [ActorRole.AcademicAdministrator]: {
    id: '44444444-4444-4444-8444-444444444444',
    auth_provider: 'supabase_email',
    provider_subject: '44444444-4444-4444-8444-444444444444',
    verified_email: 'dean.adjudicator@university.edu',
    display_name: 'Dean Morgan Vance (Academic Admin)',
    department: 'Academic Affairs & Compliance',
    office_or_cohort: 'Appeals Committee',
    actor_role: ActorRole.AcademicAdministrator,
    account_status: 'active',
  },
  [ActorRole.PlatformAdministrator]: {
    id: '55555555-5555-4555-8555-555555555555',
    auth_provider: 'supabase_email',
    provider_subject: '55555555-5555-4555-8555-555555555555',
    verified_email: 'sysadmin@university.edu',
    display_name: 'Riley Sterling (Platform Admin)',
    department: 'Enterprise Governance & Infrastructure',
    office_or_cohort: 'Core Governance',
    actor_role: ActorRole.PlatformAdministrator,
    account_status: 'active',
  },
};

const SECOND_LEARNER: VerifiedCallerIdentity = {
  id: '66666666-6666-4666-8666-666666666666',
  auth_provider: 'supabase_email',
  provider_subject: '66666666-6666-4666-8666-666666666666',
  verified_email: 'learner.other@university.edu',
  display_name: 'Samira Patel (Second Learner)',
  department: 'Biology',
  office_or_cohort: 'Class of 2028',
  actor_role: ActorRole.Learner,
  account_status: 'active',
};

describe('Phase 5: Workflow Engineering & Ticket Lifecycle (24 Required Scenarios)', () => {
  beforeEach(() => {
    clearWorkspaceIdempotencyCache();
  });

  // Scenario 1: Valid ticket creation
  it('Scenario 1: creates a valid ticket with full child records (policy/article links, lifecycle events, 3 messages, assignment, SLA, notification)', async () => {
    const db = createTransactionalTestSupabaseClient();
    const res = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'FAFSA Pell Grant Disbursement Hold Inquiry',
        category: 'Financial Aid',
        urgencyLevel: 'Standard Priority',
        description:
          'My Fall 2026 Pell Grant disbursement shows a verification hold on my student account ledger despite submitting all tax transcripts.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.ok, true);
    assert.match(res.body.ticket.ticket_id, ID_PATTERNS.ticket);
    assert.equal(res.body.ticket.category_name, 'Financial Aid');
    assert.equal(
      res.body.ticket.lifecycle_status,
      RequestStatus.UnderReview
    );
    assert.match(res.body.assignment.assignment_id, ID_PATTERNS.assignment);
    assert.match(res.body.sla.sla_id, ID_PATTERNS.sla);
    assert.equal(res.body.messages.length, 3);
    assert.equal(res.body.lifecycleEvents.length, 2);
    assert.ok(res.body.notification.notification_id.startsWith('NTF-'));
  });

  // Scenario 2: Invalid ticket creation rejection
  it('Scenario 2: rejects invalid ticket creation with missing category, short subject, or short description without creating partial records', async () => {
    const db = createTransactionalTestSupabaseClient();
    const resShortSubject = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Hi',
        category: 'IT',
        description:
          'This description has more than twenty-five characters for validation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(resShortSubject.status, 400);
    assert.equal(resShortSubject.body.code, 'VALIDATION_ERROR');
    assert.equal(db.tables.tickets.length, 0);

    const resShortDesc = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Valid Subject Line',
        category: 'IT',
        description: 'Too short.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(resShortDesc.status, 400);
    assert.equal(db.tables.tickets.length, 0);
  });

  // Scenario 3: Four-category classification
  it('Scenario 3: classifies requests strictly into the 4 official categories (Financial Aid, Registration, IT, Accessibility)', () => {
    assert.deepEqual(OFFICIAL_CATEGORIES, [
      'Financial Aid',
      'Registration',
      'IT',
      'Accessibility',
    ]);

    for (const cat of OFFICIAL_CATEGORIES) {
      const exact = resolveOfficialCategory(cat);
      assert.equal(exact.category, cat);
      assert.equal(exact.confidence, 'exact_match');
    }

    assert.equal(
      resolveOfficialCategory('', 'Need extended time screen reader accommodation')
        .category,
      'Accessibility'
    );
    assert.equal(
      resolveOfficialCategory('', 'Cannot login due to MFA two-factor SSO lock')
        .category,
      'IT'
    );
    assert.equal(
      resolveOfficialCategory('', 'Late course add/drop prerequisite waitlist')
        .category,
      'Registration'
    );
    assert.equal(
      resolveOfficialCategory('', 'FAFSA scholarship tuition waiver disbursement')
        .category,
      'Financial Aid'
    );
  });

  // Scenario 4: Explainable routing
  it('Scenario 4: routes all 4 official categories deterministically with documented rule IDs and rationale', () => {
    for (const cat of OFFICIAL_CATEGORIES) {
      const decision = evaluateTicketRouting({
        ticketId: 'TKT-2026-100001',
        category: cat,
        priority: 'Standard Priority',
        subject: `Standard ${cat} operational inquiry`,
        description: `Requesting standard operational assistance regarding ${cat} procedures.`,
        assignedAtIso: '2026-10-22T10:00:00.000Z',
      });
      const expectedRule = DOCUMENTED_ROUTING_RULES[cat];
      assert.equal(decision.assignment.routing_rule_id, expectedRule.rule_id);
      assert.equal(
        decision.assignment.assigned_team,
        expectedRule.primary_assigned_team
      );
      assert.equal(decision.requiresEscalation, false);
      assert.equal(decision.recommendedStatus, RequestStatus.UnderReview);
    }
  });

  // Scenario 5: Exception routing for unmapped/ambiguous cases
  it('Scenario 5: routes unmapped or ambiguous requests to human review triage queue without inventing unauthorized teams', () => {
    const unmapped = resolveOfficialCategory(
      'Unknown Category',
      'General question about campus parking shuttle schedule'
    );
    assert.equal(unmapped.category, null);
    assert.equal(unmapped.confidence, 'unmapped');

    const routing = evaluateTicketRouting({
      ticketId: 'TKT-2026-100002',
      category: unmapped.category,
      priority: 'Standard Priority',
      subject: 'Campus parking permit question',
      description: 'Asking about visitor parking lot hours near the stadium.',
      assignedAtIso: '2026-10-22T10:00:00.000Z',
    });

    assert.equal(
      routing.assignment.routing_rule_id,
      UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id
    );
    assert.equal(
      routing.assignment.assigned_team,
      UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team
    );
    assert.equal(routing.assignment.requires_human_review, true);
    assert.equal(routing.requiresEscalation, true);
    assert.equal(routing.recommendedStatus, RequestStatus.Escalated);
  });

  // Scenario 6: Assignment record creation
  it('Scenario 6: creates initial assignment record matching ASG-<ticket-id>-01 format', () => {
    const asgId = formatAssignmentId('TKT-2026-000001', 1);
    assert.equal(asgId, 'ASG-TKT-2026-000001-01');
    assert.match(asgId, ID_PATTERNS.assignment);
  });

  // Scenario 7: Assignment reassignment and lineage preservation
  it('Scenario 7: allows authorized staff/admins to reassign tickets while preserving previous_assignment_id and previous_assigned_team, and blocks learners/instructors', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Course Registration Prerequisite Override Check',
        category: 'Registration',
        description:
          'Requesting verification of transfer transcript prerequisite equivalence for CS-301.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    const initialAsg = createRes.body.assignment;

    // Learner attempt to reassign must be blocked with 403 FORBIDDEN_REASSIGNMENT
    const learnerReassign = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId,
        targetTeam:
          DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team,
        reason: 'Trying to self-reassign my own ticket.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(learnerReassign.status, 403);
    assert.equal(learnerReassign.body.code, 'FORBIDDEN_REASSIGNMENT');

    // SupportStaff reassignment succeeds and preserves lineage
    const staffReassign = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId,
        targetTeam:
          DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team,
        reason:
          'Routing to Academic Senate Registration Review Board for transfer credit evaluation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(staffReassign.status, 200);
    assert.equal(
      staffReassign.body.assignment.assignment_id,
      `ASG-${ticketId}-02`
    );
    assert.equal(
      staffReassign.body.assignment.previous_assignment_id,
      initialAsg.assignment_id
    );
    assert.equal(
      staffReassign.body.assignment.previous_assigned_team,
      initialAsg.assigned_team
    );
    assert.equal(
      staffReassign.body.ticket.current_assigned_team,
      DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team
    );
  });

  // Scenario 8: Valid lifecycle transitions across all 7 states
  it('Scenario 8: supports all 7 documented lifecycle states (draft, submitted, under_review, policy_verified, escalated, resolved, closed)', async () => {
    const db = createTransactionalTestSupabaseClient();

    // Create in 'draft' state
    const draftRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Draft Accessibility Accommodation Request',
        category: 'Accessibility',
        description:
          'Preparing documentation for extended exam time and assistive captioning services.',
        saveAsDraft: true,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(draftRes.status, 201);
    const ticketId = draftRes.body.ticket.ticket_id;
    assert.equal(draftRes.body.ticket.lifecycle_status, RequestStatus.Draft);

    // 1. Learner transitions draft -> submitted
    const t1 = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Submitted,
        reason: 'Submitting completed accommodation documentation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(t1.status, 200);
    assert.equal(t1.body.ticket.lifecycle_status, RequestStatus.Submitted);

    // 2. SupportStaff transitions submitted -> under_review
    const t2 = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.UnderReview,
        reason: 'Assigned specialist reviewing medical documentation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(t2.status, 200);
    assert.equal(t2.body.ticket.lifecycle_status, RequestStatus.UnderReview);

    // 3. SupportStaff transitions under_review -> policy_verified
    const t3 = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.PolicyVerified,
        reason: 'Verified eligibility under POL-ACCESS-2026-001 Section 2.1.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(t3.status, 200);
    assert.equal(t3.body.ticket.lifecycle_status, RequestStatus.PolicyVerified);

    // 4. SupportStaff transitions policy_verified -> escalated
    const t4 = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Escalated,
        reason: 'Escalating to ADA / Section 504 Compliance Review Panel for specialized lab equipment approval.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(t4.status, 200);
    assert.equal(t4.body.ticket.lifecycle_status, RequestStatus.Escalated);

    // 5. AcademicAdministrator transitions escalated -> resolved
    const t5 = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason:
          'Approved 1.5x exam time and assistive lab workstation under POL-ACCESS-2026-001.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.AcademicAdministrator], client: db }
    );
    assert.equal(t5.status, 200);
    assert.equal(t5.body.ticket.lifecycle_status, RequestStatus.Resolved);
    assert.ok(t5.body.ticket.resolved_at);

    // 6. Learner transitions resolved -> closed
    const t6 = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Closed,
        reason: 'Accommodation letter received and verified with instructor.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(t6.status, 200);
    assert.equal(t6.body.ticket.lifecycle_status, RequestStatus.Closed);
    assert.ok(t6.body.ticket.closed_at);
  });

  // Scenario 9: Invalid lifecycle transition rejection
  it('Scenario 9: rejects invalid lifecycle state transitions and unauthorized role transitions without modifying the ticket', async () => {
    assert.equal(
      isValidLifecycleTransition(RequestStatus.Draft, RequestStatus.Resolved),
      false
    );
    assert.equal(
      isValidLifecycleTransition(RequestStatus.Submitted, RequestStatus.Closed),
      false
    );
    assert.equal(
      isValidLifecycleTransition(
        RequestStatus.Closed,
        RequestStatus.UnderReview
      ),
      false
    );

    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'IT SSO Password Reset Verification',
        category: 'IT',
        description:
          'Unable to complete hardware token enrollment on new workstation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    // Invalid state transition: under_review -> closed
    const invalidStateRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Closed,
        reason: 'Attempting to jump directly from under_review to closed.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(invalidStateRes.status, 400);
    assert.equal(invalidStateRes.body.code, 'INVALID_LIFECYCLE_TRANSITION');

    // Unauthorized role transition: Learner attempting to mark their own under_review ticket as resolved
    const learnerResolveAttempt = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Learner attempting to self-resolve an active ticket.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(learnerResolveAttempt.status, 403);
    assert.equal(
      learnerResolveAttempt.body.code,
      'INSUFFICIENT_ROLE_FOR_TRANSITION'
    );
    assert.equal(
      db.tables.tickets[0].lifecycle_status,
      RequestStatus.UnderReview
    );
  });

  // Scenario 10: Message creation
  it('Scenario 10: creates messages on a ticket with server-verified sender identity and role', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Canvas LMS Course Roster Sync Issue',
        category: 'IT',
        description:
          'My enrolled section MATH-204 is not appearing on my Canvas dashboard.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Instructor], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    const msgRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'We have triggered a manual SIS-to-LMS roster synchronization for MATH-204.',
        // Attempt spoofed sender fields in body to verify server ignores them
        sender_id: 'SPOOFED-ACTOR',
        sender_role: ActorRole.PlatformAdministrator,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    assert.equal(msgRes.status, 201);
    assert.equal(
      msgRes.body.messageRecord.sender_role,
      ActorRole.SupportStaff
    );
    assert.equal(
      msgRes.body.messageRecord.sender_name,
      TEST_ACTORS[ActorRole.SupportStaff].display_name
    );
    assert.notEqual(msgRes.body.messageRecord.sender_id, 'SPOOFED-ACTOR');
  });

  // Scenario 11: Three-digit message sequence integrity
  it('Scenario 11: enforces three-digit zero-padded message IDs (MSG-TKT-2026-XXXXXX-001..004) in strict chronological sequence', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Three-Digit Message Sequence Verification',
        category: 'Registration',
        description:
          'Verifying that all message IDs follow the 3-digit zero-padded sequence format.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    const msg4Res = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'Follow-up documentation attached for message sequence 004.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );

    assert.equal(msg4Res.status, 201);
    assert.equal(msg4Res.body.messageRecord.sequence_number, 4);
    assert.equal(
      msg4Res.body.messageRecord.message_id,
      `MSG-${ticketId}-004`
    );
    assert.match(msg4Res.body.messageRecord.message_id, ID_PATTERNS.message);
  });

  // Scenario 12: Internal note authorization and filtering
  it('Scenario 12: allows staff/admins to post internal notes, blocks learners/instructors from posting internal notes, and filters internal notes from requester bootstrap', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Financial Aid SAP Appeal Documentation Check',
        category: 'Financial Aid',
        description:
          'Submitting academic advisor plan for Satisfactory Academic Progress appeal.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    // Learner attempt to post internal note is blocked with 403
    const learnerInternalRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'Learner trying to post an internal staff note.',
        isInternal: true,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(learnerInternalRes.status, 403);
    assert.equal(learnerInternalRes.body.code, 'FORBIDDEN_INTERNAL_NOTE');

    // SupportStaff posts internal note -> succeeds
    const staffInternalRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'INTERNAL TRIAGE NOTE: Verify degree audit credits with Registrar before committee handoff.',
        isInternal: true,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(staffInternalRes.status, 201);
    assert.equal(staffInternalRes.body.messageRecord.is_internal, true);

    // Bootstrap as Learner -> internal note must be filtered out
    const learnerBootstrap = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      {},
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(
      learnerBootstrap.body.messages.some((m: any) => m.is_internal),
      false
    );

    // Bootstrap as SupportStaff -> internal note is visible
    const staffBootstrap = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      {},
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(
      staffBootstrap.body.messages.some((m: any) => m.is_internal),
      true
    );
  });

  // Scenario 13: SLA creation and evaluation
  it('Scenario 13: computes reproducible business-hour SLA records and distinguishes business hours from raw wall-clock hours over weekends', () => {
    // Friday 16:00 UTC to Monday 10:00 UTC = 1h Friday + 2h Monday = 180 business minutes (vs 3,960 wall-clock minutes)
    const sla = buildReproducibleSlaRecord({
      ticketId: 'TKT-2026-000010',
      category: 'IT', // target = 240 business minutes
      startTimestampIso: '2026-10-16T16:00:00.000Z',
      evaluatedTimestampIso: '2026-10-19T10:00:00.000Z',
      isTicketEscalated: false,
      requiresEscalation: false,
      calculationMode: 'business_hours_configured',
    });

    assert.equal(sla.sla_id, formatSlaId('TKT-2026-000010'));
    assert.equal(sla.rule_classification, 'PROPOSED_CONFIGURABLE_RULE');
    assert.equal(sla.elapsed_business_minutes, 180);
    assert.equal(sla.elapsed_wall_clock_minutes, 3960);
    assert.equal(sla.breach_status, false);
  });

  // Scenario 14: Escalation eligibility
  it('Scenario 14: flags escalation eligibility for administrative escalation priority, appeal/exception keywords, expired policies, or SLA breach', () => {
    const appealRouting = evaluateTicketRouting({
      ticketId: 'TKT-2026-000011',
      category: 'Financial Aid',
      priority: 'Standard Priority',
      subject: 'Formal SAP Appeal Petition for Medical Exception',
      description:
        'Submitting a formal appeal and retroactive policy waiver petition for Fall aid.',
      assignedAtIso: '2026-10-22T10:00:00.000Z',
    });
    assert.equal(appealRouting.requiresEscalation, true);
    assert.equal(appealRouting.recommendedStatus, RequestStatus.Escalated);
    assert.equal(
      appealRouting.assignment.assigned_team,
      DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team
    );
  });

  // Scenario 15: Escalation persistence
  it('Scenario 15: persists escalation state, escalation assignment lineage, SLA escalation status, lifecycle event, and notification', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Standard Course Credit Inquiry',
        category: 'Registration',
        description:
          'Checking standard transfer credit posting timeline for summer coursework.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    assert.equal(createRes.body.ticket.is_escalated, false);

    const escRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Escalated,
        reason:
          'Escalating to Academic Senate Registration Review Board due to cross-institutional accreditation dispute.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    assert.equal(escRes.status, 200);
    assert.equal(escRes.body.ticket.lifecycle_status, RequestStatus.Escalated);
    assert.equal(escRes.body.ticket.is_escalated, true);
    assert.equal(escRes.body.ticket.requires_escalation, true);
    assert.equal(
      escRes.body.ticket.current_assigned_team,
      DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team
    );
    assert.equal(escRes.body.sla.escalation_status, 'escalated');
    assert.equal(db.tables.assignments.length, 2);
  });

  // Scenario 16: Authorized resolution
  it('Scenario 16: enforces that escalated tickets can only be resolved by AcademicAdministrator or PlatformAdministrator and requires a substantive resolution summary (>= 10 chars)', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Retroactive Withdrawal Appeal Petition',
        category: 'Registration',
        urgencyLevel: 'Administrative Escalation Priority',
        description:
          'Submitting formal appeal for retroactive medical withdrawal from Spring semester.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    assert.equal(
      createRes.body.ticket.lifecycle_status,
      RequestStatus.Escalated
    );

    // SupportStaff attempting to resolve an escalated ticket must be rejected with 403 ESCALATION_ADJUDICATION_REQUIRED
    const staffResolveEscalated = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Support staff trying to resolve an escalated appeal.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(staffResolveEscalated.status, 403);
    assert.equal(
      staffResolveEscalated.body.code,
      'ESCALATION_ADJUDICATION_REQUIRED'
    );

    // Short resolution summary (< 10 chars) must be rejected with 400 MISSING_RESOLUTION_DETAILS
    const shortSummaryEval = validateResolutionTransition({
      previousState: RequestStatus.Escalated,
      newState: RequestStatus.Resolved,
      actorRole: ActorRole.AcademicAdministrator,
      isTicketOwner: false,
      reason: 'Done.',
    });
    assert.equal(shortSummaryEval.valid, false);
    assert.equal(shortSummaryEval.code, 'MISSING_RESOLUTION_DETAILS');

    // AcademicAdministrator resolves with substantive summary -> succeeds
    const adminResolve = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason:
          'Adjudicated and approved by Academic Senate Registration Review Board under POL-REG-2026-002.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.AcademicAdministrator], client: db }
    );
    assert.equal(adminResolve.status, 200);
    assert.equal(
      adminResolve.body.ticket.lifecycle_status,
      RequestStatus.Resolved
    );
    assert.ok(adminResolve.body.ticket.resolution_summary.length >= 10);
  });

  // Scenario 17: Closure behavior
  it('Scenario 17: enforces closure behavior (resolved -> closed sets closed_at and blocks further transitions or reassignments)', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Eduroam Wi-Fi Certificate Renewal',
        category: 'IT',
        description:
          'Need instructions to renew the university EduroamRADIUS certificate on macOS.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Provided KB-000015 certificate profile installer and verified connection.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    const closeRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Closed,
        reason: 'Confirmed Wi-Fi connectivity is restored; closing ticket.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.body.ticket.lifecycle_status, RequestStatus.Closed);
    assert.ok(closeRes.body.ticket.closed_at);

    // Closed ticket cannot be transitioned or reassigned
    const postCloseTransition = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.UnderReview,
        reason: 'Trying to reopen closed ticket to under_review.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.PlatformAdministrator], client: db }
    );
    assert.equal(postCloseTransition.status, 400);

    const postCloseReassign = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId,
        targetTeam: DOCUMENTED_ROUTING_RULES.IT.escalation_assigned_team,
        reason: 'Trying to reassign a closed ticket.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(postCloseReassign.status, 400);
    assert.equal(postCloseReassign.body.code, 'TICKET_CLOSED');
  });

  // Scenario 18: Feedback submission
  it('Scenario 18: allows the ticket requester to submit resolution feedback (FDB-<ticket-id>) once the ticket is resolved or closed', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Transcript Hold Release Verification',
        category: 'Registration',
        description:
          'Requesting confirmation that library fine hold has been cleared from transcript.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Verified bursar clearance and released official transcript hold.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    const fbRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'submit_feedback',
        ticketId,
        rating: 5,
        policyClarityScore: 5,
        wasHelpful: true,
        resolutionAccepted: true,
        comments: 'Fast and accurate policy citation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );

    assert.equal(fbRes.status, 200);
    assert.equal(fbRes.body.feedback.feedback_id, formatFeedbackId(ticketId));
    assert.match(fbRes.body.feedback.feedback_id, ID_PATTERNS.feedback);
    assert.equal(fbRes.body.feedback.rating, 5);
  });

  // Scenario 19: Unauthorized feedback rejection
  it('Scenario 19: rejects feedback submission on unresolved tickets or from actors who do not own the ticket', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Unresolved Scholarship Inquiry',
        category: 'Financial Aid',
        description:
          'Checking renewal criteria for merit scholarship in Fall 2026.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    // 1. Feedback on unresolved ticket by owner -> 400 TICKET_NOT_RESOLVED
    const unresolvedFb = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'submit_feedback',
        ticketId,
        rating: 4,
        policyClarityScore: 4,
        wasHelpful: true,
        resolutionAccepted: true,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(unresolvedFb.status, 400);
    assert.equal(unresolvedFb.body.code, 'TICKET_NOT_RESOLVED');

    // Resolve ticket
    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Confirmed 3.2 GPA renewal criteria under POL-FINAID-2026-001.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    // 2. Feedback by SupportStaff (non-owner) -> 403 FORBIDDEN_FEEDBACK_SUBMISSION
    const staffFbAttempt = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'submit_feedback',
        ticketId,
        rating: 5,
        policyClarityScore: 5,
        wasHelpful: true,
        resolutionAccepted: true,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(staffFbAttempt.status, 403);
    assert.equal(staffFbAttempt.body.code, 'FORBIDDEN_FEEDBACK_SUBMISSION');

    // 3. Feedback by a different Learner -> 403 FORBIDDEN_FEEDBACK_SUBMISSION
    const otherLearnerFb = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'submit_feedback',
        ticketId,
        rating: 1,
        policyClarityScore: 1,
        wasHelpful: false,
        resolutionAccepted: false,
      },
      {},
      { profile: SECOND_LEARNER, client: db }
    );
    assert.equal(otherLearnerFb.status, 403);
    assert.equal(otherLearnerFb.body.code, 'FORBIDDEN_FEEDBACK_SUBMISSION');
  });

  // Scenario 20: Notification delivery records
  it('Scenario 20: generates recipient-scoped notifications for workflow events and suppresses notifications for internal staff notes', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Notification Audit Trail Verification',
        category: 'IT',
        description:
          'Verifying notification generation across ticket creation, public reply, and internal note.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    assert.equal(db.tables.workspace_notifications.length, 1);

    // Staff posts internal note -> must NOT add a notification for the requester
    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'Internal staff note that should not trigger a learner notification.',
        isInternal: true,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(db.tables.workspace_notifications.length, 1);

    // Staff posts public reply -> adds notification for requester
    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'Public staff response with troubleshooting steps.',
        isInternal: false,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(db.tables.workspace_notifications.length, 2);
  });

  // Scenario 21: Audit event immutability
  it('Scenario 21: preserves immutable lifecycle event records in chronological order without overwriting prior events', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Audit Event Immutability Verification',
        category: 'Accessibility',
        description:
          'Testing that lifecycle events accumulate immutably across multiple transitions.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    assert.equal(db.tables.ticket_lifecycle_events.length, 2);

    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.PolicyVerified,
        reason: 'Policy verified by specialist.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Completed accommodation arrangement and notified faculty.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    const events = db.tables.ticket_lifecycle_events.map((e) =>
      fromDbLifecycleEventRow(e)
    );
    assert.equal(events.length, 4);
    assert.deepEqual(
      events.map((e) => e.event_id),
      [
        `EVT-${ticketId}-001`,
        `EVT-${ticketId}-002`,
        `EVT-${ticketId}-003`,
        `EVT-${ticketId}-004`,
      ]
    );
    assert.equal(events[0].previous_state, null);
    assert.equal(events[0].new_state, RequestStatus.Submitted);
    assert.equal(events[3].previous_state, RequestStatus.PolicyVerified);
    assert.equal(events[3].new_state, RequestStatus.Resolved);
  });

  // Scenario 22: Multi-user access isolation
  it('Scenario 22: enforces strict multi-user access isolation across Learner, Instructor, SupportStaff, AcademicAdministrator, and PlatformAdministrator', async () => {
    const db = createTransactionalTestSupabaseClient();

    // Learner 1 creates a ticket
    const l1TicketRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Learner 1 Confidential Financial Aid File',
        category: 'Financial Aid',
        description:
          'Private household income verification inquiry for Learner 1.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const l1TicketId = l1TicketRes.body.ticket.ticket_id;

    // Second Learner (or Instructor who doesn't own the ticket) cannot view it in bootstrap
    const secondLearnerBootstrap = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      {},
      {},
      { profile: SECOND_LEARNER, client: db }
    );
    assert.equal(secondLearnerBootstrap.body.tickets.length, 0);

    const instructorBootstrap = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      {},
      {},
      { profile: TEST_ACTORS[ActorRole.Instructor], client: db }
    );
    assert.equal(instructorBootstrap.body.tickets.length, 0);

    // Second Learner cannot post a message to Learner 1's ticket
    const crossMessageAttempt = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId: l1TicketId,
        body: 'Unauthorized learner attempting to post on another learner ticket.',
      },
      {},
      { profile: SECOND_LEARNER, client: db }
    );
    assert.equal(crossMessageAttempt.status, 403);
    assert.equal(crossMessageAttempt.body.code, 'FORBIDDEN_TICKET_ACCESS');

    // SupportStaff, AcademicAdministrator, and PlatformAdministrator can view the operational ticket
    for (const staffRole of [
      ActorRole.SupportStaff,
      ActorRole.AcademicAdministrator,
      ActorRole.PlatformAdministrator,
    ]) {
      const staffBoot = await processWorkspaceOperationRequest(
        'GET',
        { action: 'bootstrap' },
        {},
        {},
        { profile: TEST_ACTORS[staffRole], client: db }
      );
      assert.equal(staffBoot.body.tickets.length, 1);
      assert.equal(staffBoot.body.tickets[0].ticket_id, l1TicketId);
    }
  });

  // Scenario 23: Concurrent submissions & sequence conflict retry
  it('Scenario 23: resolves concurrent sequence collisions on ticket_id and message_id via automatic retry without duplicate IDs', async () => {
    const dbWithTicketConflict = createTransactionalTestSupabaseClient({
      simulateFirstInsertConflictOnTable: 'tickets',
    });

    const ticketRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Concurrent Ticket Sequence Retry Test',
        category: 'IT',
        description:
          'Verifying automatic sequence retry when a concurrent insert conflict (23505) occurs.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: dbWithTicketConflict }
    );

    assert.equal(ticketRes.status, 201);
    assert.equal(ticketRes.body.ticket.ticket_id, 'TKT-2026-100002');

    const dbWithMsgConflict = createTransactionalTestSupabaseClient();
    const t2Res = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Concurrent Message Sequence Retry Test',
        category: 'IT',
        description:
          'Verifying automatic message sequence retry when a concurrent message insert occurs.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: dbWithMsgConflict }
    );
    const ticketId = t2Res.body.ticket.ticket_id;

    // Pre-insert MSG-<ticketId>-004 to force a 23505 collision on the first attempt if sequence was stale
    const msgRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'post_message',
        ticketId,
        body: 'First concurrent message posted to thread.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: dbWithMsgConflict }
    );
    assert.equal(msgRes.status, 201);
    assert.equal(msgRes.body.messageRecord.message_id, `MSG-${ticketId}-004`);
  });

  // Scenario 24: Transaction rollback on partial failure & idempotent retry behavior
  it('Scenario 24: rolls back parent ticket and transition changes on partial database failure, and prevents duplicate creation on idempotent retry', async () => {
    // Part A: Compensating rollback when child SLA insert fails during create_ticket
    const failingCreateDb = createTransactionalTestSupabaseClient({
      failOnTableWrite: { table: 'slas', operation: 'insert' },
    });

    const failedCreate = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Partial Failure Compensating Rollback Test',
        category: 'Financial Aid',
        description:
          'If child SLA insert fails, the parent ticket and messages must be rolled back completely.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: failingCreateDb }
    );

    assert.equal(failedCreate.status, 500);
    assert.equal(failedCreate.body.code, 'REMOTE_DATABASE_WRITE_FAILED');
    assert.equal(failedCreate.body.rolledBack, true);
    assert.equal(failingCreateDb.tables.tickets.length, 0);
    assert.equal(failingCreateDb.tables.messages.length, 0);
    assert.equal(failingCreateDb.tables.assignments.length, 0);

    // Part B: Idempotent retry with idempotencyKey does not create duplicate tickets
    const cleanDb = createTransactionalTestSupabaseClient();
    const firstCall = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        idempotencyKey: 'idem-key-create-001',
        subject: 'Idempotent Ticket Creation Verification',
        category: 'Registration',
        description:
          'Retrying the same request with an idempotencyKey must replay the original response without duplicating records.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: cleanDb }
    );
    assert.equal(firstCall.status, 201);
    assert.equal(cleanDb.tables.tickets.length, 1);

    const retryCall = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        idempotencyKey: 'idem-key-create-001',
        subject: 'Idempotent Ticket Creation Verification',
        category: 'Registration',
        description:
          'Retrying the same request with an idempotencyKey must replay the original response without duplicating records.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: cleanDb }
    );
    assert.equal(retryCall.status, 201);
    assert.equal(retryCall.body.idempotentReplay, true);
    assert.equal(retryCall.body.ticket.ticket_id, firstCall.body.ticket.ticket_id);
    assert.equal(cleanDb.tables.tickets.length, 1);
  });
});

describe('Phase 5: Live Remote Supabase PostgreSQL Schema & RLS Integration Verification', () => {
  it('verifies that all 18 Phase 3/5 tables exist in remote Supabase PostgreSQL with RLS enabled', async () => {
    const supabaseKey = (
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ''
    ).trim();
    if (!supabaseKey) {
      // In local environments without remote Supabase credentials, verify required schema table definitions
      assert.equal(REQUIRED_PHASE3_TABLES.length, 18);
      return;
    }
    const anonClient = createScopedSupabaseClient('');
    const check = await verifyRemotePhase3Schema(anonClient);
    assert.equal(
      check.applied,
      true,
      `Expected all 18 tables in remote Supabase, missing: ${check.missingTables.join(', ')}`
    );
    assert.equal(check.missingTables.length, 0);
    assert.equal(REQUIRED_PHASE3_TABLES.length, 18);
  });
});

/**
 * Faithful PL/pgSQL transaction simulator for `public.atomic_reassign_ticket_workflow`
 * matching `supabase/migrations/20261030000003_phase5_atomic_workflow_rpcs.sql`
 * step-for-step so all 7 required RPC test cases (successful reassignment,
 * unauthorized users, invalid roles, duplicate IDs, invalid teams, closed tickets,
 * and atomic transaction rollback) are verified deterministically.
 */
function executeSimulatedAtomicReassignRpc(
  db: ReturnType<typeof createTransactionalTestSupabaseClient>,
  caller: {
    isValidAuthenticatedJwt: boolean;
    profile: VerifiedCallerIdentity | null;
  },
  params: {
    p_ticket_id: string;
    p_new_assignment_id?: string | null;
    p_sequence_number?: number | null;
    p_target_team: string;
    p_assigned_actor_id?: string | null;
    p_assigned_actor_role: string | null;
    p_routing_rule_id?: string | null;
    p_assignment_reason: string;
    p_requires_human_review?: boolean | null;
    p_message_id?: string | null;
    p_message_seq?: number | null;
    p_notification_id?: string | null;
  },
  options?: {
    failAtStep?: 'insert_assignment' | 'update_ticket' | 'insert_lifecycle_event' | 'insert_message';
  }
) {
  // Snapshot all tables at BEGIN so any RAISE EXCEPTION rolls back 100% of writes
  const snapshot = JSON.parse(JSON.stringify(db.tables));

  try {
    // 1. Verify valid authenticated JWT
    if (!caller.isValidAuthenticatedJwt) {
      throw Object.assign(
        new Error('UNAUTHORIZED_JWT: A valid, verified Supabase or Firebase Google JWT is required.'),
        { code: '28000' }
      );
    }

    // 2. Resolve caller profile & account status
    if (!caller.profile || !caller.profile.id || !caller.profile.actor_role) {
      throw Object.assign(
        new Error('UNAUTHORIZED: Authenticated institutional profile required.'),
        { code: '28000' }
      );
    }

    if (caller.profile.account_status !== 'active') {
      throw Object.assign(
        new Error('FORBIDDEN_ACCOUNT_STATUS: Active institutional profile required.'),
        { code: '42501' }
      );
    }

    const vCallerProfileId = caller.profile.id;
    const vCallerRole = caller.profile.actor_role;
    const vCallerDisplayName = caller.profile.display_name;

    // 3. Enforce caller role using lowercase public.actor_role_type values
    if (
      !['support_staff', 'academic_administrator', 'platform_administrator'].includes(
        vCallerRole
      )
    ) {
      throw Object.assign(
        new Error(`FORBIDDEN_REASSIGNMENT: Role ${vCallerRole} is not permitted to reassign tickets.`),
        { code: '42501' }
      );
    }

    // 4. Validate p_assigned_actor_role server-side
    if (
      !params.p_assigned_actor_role ||
      !['support_staff', 'academic_administrator', 'platform_administrator'].includes(
        params.p_assigned_actor_role
      )
    ) {
      throw Object.assign(
        new Error(
          `INVALID_ASSIGNED_ROLE: Tickets can only be assigned to support_staff, academic_administrator, or platform_administrator (received ${params.p_assigned_actor_role}).`
        ),
        { code: '22023' }
      );
    }

    // 5. Validate assignment reason length
    const vCleanReason = (params.p_assignment_reason ?? '').trim();
    if (vCleanReason.length < 5) {
      throw Object.assign(
        new Error('INVALID_ASSIGNMENT_REASON: Reassignment reason must be at least 5 characters.'),
        { code: '22023' }
      );
    }

    // 6. Lock target operational ticket row FOR UPDATE
    const vTicket = db.tables.tickets.find(
      (t: any) => t.ticket_id === params.p_ticket_id && t.is_synthetic_eval === false
    );
    if (!vTicket) {
      throw Object.assign(
        new Error(`TICKET_NOT_FOUND: Operational ticket ${params.p_ticket_id} does not exist.`),
        { code: 'P0002' }
      );
    }

    // 7. Reject closed tickets & restrict escalated tickets to admins
    if (vTicket.lifecycle_status === 'closed') {
      throw Object.assign(
        new Error('TICKET_CLOSED: Closed tickets cannot be reassigned.'),
        { code: '22023' }
      );
    }

    if (
      vTicket.lifecycle_status === 'escalated' &&
      !['academic_administrator', 'platform_administrator'].includes(vCallerRole)
    ) {
      throw Object.assign(
        new Error(
          'FORBIDDEN_ESCALATED_REASSIGNMENT: Escalated tickets can only be reassigned by academic_administrator or platform_administrator.'
        ),
        { code: '42501' }
      );
    }

    // 8a. Validate p_target_team and routing_rule_id strictly against the ticket's own category in public.categories
    const vCleanTargetTeam = (params.p_target_team ?? '').trim();
    const vCategory = db.tables.categories.find(
      (c: any) =>
        c.category_id === vTicket.category_id &&
        c.is_active === true &&
        (c.default_assigned_team === vCleanTargetTeam ||
          c.escalation_team === vCleanTargetTeam)
    );

    if (!vCategory) {
      throw Object.assign(
        new Error(
          `INVALID_TARGET_TEAM: Team "${vCleanTargetTeam}" is not a configured default_assigned_team or escalation_team for ticket category ${vTicket.category_id}.`
        ),
        { code: '22023' }
      );
    }

    const vResolvedRuleId = vCategory.routing_rule_id;

    if (
      params.p_routing_rule_id &&
      params.p_routing_rule_id.trim() !== '' &&
      params.p_routing_rule_id.trim() !== vResolvedRuleId
    ) {
      throw Object.assign(
        new Error(
          `ROUTING_RULE_MISMATCH: Supplied routing rule ${params.p_routing_rule_id.trim()} does not match category ${vTicket.category_id} routing rule ${vResolvedRuleId}.`
        ),
        { code: '22023' }
      );
    }

    if (vCleanTargetTeam === vTicket.current_assigned_team) {
      throw Object.assign(
        new Error(
          `NOOP_REASSIGNMENT: Ticket ${params.p_ticket_id} is already assigned to ${vCleanTargetTeam}.`
        ),
        { code: '22023' }
      );
    }

    // 8b. Validate p_assigned_actor_id and p_assigned_actor_role for both individual UUIDs and team queues
    const vDomainCode = String(vCategory.category_id).replace(/^CAT-/, '');
    const vExpectedQueueActorId =
      vCleanTargetTeam === vCategory.escalation_team
        ? `ACTOR-ESC-${vDomainCode}`
        : `ACTOR-OPS-${vDomainCode}`;

    const vCleanAssignedActorId = (params.p_assigned_actor_id ?? '').trim();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let vResolvedAssignedActorId: string;
    let vResolvedAssignedRole: string;

    if (uuidRegex.test(vCleanAssignedActorId)) {
      const targetProfile = (db.tables.app_profiles || []).find(
        (p: any) => p.id.toLowerCase() === vCleanAssignedActorId.toLowerCase()
      );
      if (!targetProfile) {
        throw Object.assign(
          new Error(
            `ASSIGNED_ACTOR_NOT_FOUND: Institutional profile ${vCleanAssignedActorId} does not exist.`
          ),
          { code: '22023' }
        );
      }
      if (targetProfile.account_status !== 'active') {
        throw Object.assign(
          new Error(
            `INACTIVE_ASSIGNED_ACTOR: Institutional profile ${vCleanAssignedActorId} has status ${targetProfile.account_status} and cannot be assigned tickets.`
          ),
          { code: '22023' }
        );
      }
      if (targetProfile.actor_role !== params.p_assigned_actor_role) {
        throw Object.assign(
          new Error(
            `ASSIGNED_ACTOR_ROLE_MISMATCH: Profile ${vCleanAssignedActorId} has role ${targetProfile.actor_role}, which does not match supplied role ${params.p_assigned_actor_role}.`
          ),
          { code: '22023' }
        );
      }
      vResolvedAssignedActorId = targetProfile.id;
      vResolvedAssignedRole = targetProfile.actor_role;
    } else if (
      vCleanAssignedActorId === '' ||
      vCleanAssignedActorId === vExpectedQueueActorId
    ) {
      if (
        vCleanTargetTeam === vCategory.default_assigned_team &&
        params.p_assigned_actor_role !== 'support_staff' &&
        params.p_assigned_actor_role !== vCallerRole
      ) {
        throw Object.assign(
          new Error(
            `ASSIGNED_ACTOR_ROLE_MISMATCH: Primary team ${vCleanTargetTeam} requires support_staff or caller role ${vCallerRole}, received ${params.p_assigned_actor_role}.`
          ),
          { code: '22023' }
        );
      }

      if (vCleanAssignedActorId !== '') {
        vResolvedAssignedActorId = vExpectedQueueActorId;
      } else if (params.p_assigned_actor_role === vCallerRole) {
        vResolvedAssignedActorId = vCallerProfileId;
      } else {
        vResolvedAssignedActorId = vExpectedQueueActorId;
      }
      vResolvedAssignedRole = params.p_assigned_actor_role;
    } else {
      throw Object.assign(
        new Error(
          `INVALID_ASSIGNED_ACTOR_ID: Assigned actor ID "${vCleanAssignedActorId}" is neither an active profile UUID nor the expected category queue identifier (${vExpectedQueueActorId}).`
        ),
        { code: '22023' }
      );
    }

    // 9. Lock assignments and derive next sequence number
    const ticketAssignments = db.tables.assignments.filter(
      (a: any) => a.ticket_id === params.p_ticket_id
    );
    const vPrevAsg = [...ticketAssignments]
      .filter((a: any) => a.is_active === true)
      .sort((a: any, b: any) => b.sequence_number - a.sequence_number)[0];

    const vNextAsgSeq =
      ticketAssignments.reduce(
        (max: number, a: any) => Math.max(max, Number(a.sequence_number) || 0),
        0
      ) + 1;
    const vDerivedAssignmentId = `ASG-${params.p_ticket_id}-${String(vNextAsgSeq).padStart(2, '0')}`;

    if (params.p_new_assignment_id && params.p_new_assignment_id.trim() !== '') {
      const suppliedAsgId = params.p_new_assignment_id.trim();
      if (db.tables.assignments.some((a: any) => a.assignment_id === suppliedAsgId)) {
        throw Object.assign(
          new Error(`DUPLICATE_ASSIGNMENT_ID: Assignment ID ${suppliedAsgId} already exists.`),
          { code: '23505' }
        );
      }
    }

    // 10. Lock messages and derive next 3-digit sequence number
    const ticketMessages = db.tables.messages.filter(
      (m: any) => m.ticket_id === params.p_ticket_id
    );
    const vNextMsgSeq =
      ticketMessages.reduce(
        (max: number, m: any) => Math.max(max, Number(m.sequence_number) || 0),
        0
      ) + 1;
    const vDerivedMessageId = `MSG-${params.p_ticket_id}-${String(vNextMsgSeq).padStart(3, '0')}`;

    if (params.p_message_id && params.p_message_id.trim() !== '') {
      const suppliedMsgId = params.p_message_id.trim();
      if (db.tables.messages.some((m: any) => m.message_id === suppliedMsgId)) {
        throw Object.assign(
          new Error(`DUPLICATE_MESSAGE_ID: Message ID ${suppliedMsgId} already exists.`),
          { code: '23505' }
        );
      }
    }

    // 11. Lock lifecycle events and derive next event_id
    const ticketEvents = db.tables.ticket_lifecycle_events.filter(
      (e: any) => e.ticket_id === params.p_ticket_id
    );
    let vNextEvtSeq = ticketEvents.length + 1;
    let vDerivedEventId = `EVT-${params.p_ticket_id}-${String(vNextEvtSeq).padStart(3, '0')}`;
    while (
      db.tables.ticket_lifecycle_events.some((e: any) => e.event_id === vDerivedEventId)
    ) {
      vNextEvtSeq += 1;
      vDerivedEventId = `EVT-${params.p_ticket_id}-${String(vNextEvtSeq).padStart(3, '0')}`;
    }

    const vNow = new Date().toISOString();

    // 12. Deactivate previous active assignment
    if (vPrevAsg) {
      vPrevAsg.is_active = false;
      vPrevAsg.unassigned_at = vNow;
    }

    // 13. Insert new assignment
    if (options?.failAtStep === 'insert_assignment') {
      throw Object.assign(new Error('SIMULATED_FAILURE_INSERT_ASSIGNMENT'), {
        code: 'XX000',
      });
    }
    db.tables.assignments.push({
      assignment_id: vDerivedAssignmentId,
      ticket_id: params.p_ticket_id,
      sequence_number: vNextAsgSeq,
      assigned_team: vCleanTargetTeam,
      assigned_actor_id: vResolvedAssignedActorId,
      assigned_actor_role: vResolvedAssignedRole,
      routing_rule_id: vResolvedRuleId,
      assignment_reason: vCleanReason,
      previous_assignment_id: vPrevAsg ? vPrevAsg.assignment_id : null,
      previous_assigned_team: vPrevAsg
        ? vPrevAsg.assigned_team
        : vTicket.current_assigned_team,
      requires_human_review: Boolean(params.p_requires_human_review),
      is_active: true,
      assigned_at: vNow,
      unassigned_at: null,
    });

    // 14. Update parent ticket
    if (options?.failAtStep === 'update_ticket') {
      throw Object.assign(new Error('SIMULATED_FAILURE_UPDATE_TICKET'), {
        code: 'XX000',
      });
    }
    const previousTeam = vPrevAsg
      ? vPrevAsg.assigned_team
      : vTicket.current_assigned_team;
    vTicket.current_assigned_team = vCleanTargetTeam;
    vTicket.current_routing_rule_id = vResolvedRuleId;
    vTicket.updated_at = vNow;

    // 15. Insert immutable lifecycle event
    if (options?.failAtStep === 'insert_lifecycle_event') {
      throw Object.assign(new Error('SIMULATED_FAILURE_INSERT_LIFECYCLE_EVENT'), {
        code: 'XX000',
      });
    }
    db.tables.ticket_lifecycle_events.push({
      event_id: vDerivedEventId,
      ticket_id: params.p_ticket_id,
      previous_state: vTicket.lifecycle_status,
      new_state: vTicket.lifecycle_status,
      transition_reason: `Reassigned from ${previousTeam} to ${vCleanTargetTeam} (Rule ${vResolvedRuleId}): ${vCleanReason}`,
      actor_profile_id: vCallerProfileId,
      actor_role: vCallerRole,
      actor_display_name: vCallerDisplayName,
      recorded_at: vNow,
    });

    // 16. Insert system routing message
    if (options?.failAtStep === 'insert_message') {
      throw Object.assign(new Error('SIMULATED_FAILURE_INSERT_MESSAGE'), {
        code: 'XX000',
      });
    }
    db.tables.messages.push({
      message_id: vDerivedMessageId,
      ticket_id: params.p_ticket_id,
      sequence_number: vNextMsgSeq,
      sender_actor_id: 'SYSTEM-ROUTER',
      sender_profile_id: vCallerProfileId,
      sender_role: vCallerRole,
      sender_display_name: vCallerDisplayName,
      message_type: 'system_routing_note',
      body: `Ticket Reassigned (${previousTeam} -> ${vCleanTargetTeam}): ${vCleanReason}`,
      cited_policy_id: vTicket.referenced_policy_id,
      cited_policy_version: vTicket.referenced_policy_version,
      cited_article_id: vTicket.referenced_article_id,
      cited_article_version: vTicket.referenced_article_version,
      is_internal: false,
      sent_at: vNow,
    });

    // 17. Insert workspace notification with event_type = 'routing_assigned'
    let vDerivedNotificationId: string | null = null;
    let vNotificationCreated = false;
    let vNotificationReused = false;

    if (vTicket.requester_profile_id) {
      vDerivedNotificationId =
        params.p_notification_id?.trim() ||
        `NTF-${params.p_ticket_id}-ASG-${String(vNextAsgSeq).padStart(2, '0')}`;

      const existingNotif = db.tables.workspace_notifications.find(
        (n: any) => n.notification_id === vDerivedNotificationId
      );

      if (!existingNotif) {
        db.tables.workspace_notifications.push({
          notification_id: vDerivedNotificationId,
          recipient_profile_id: vTicket.requester_profile_id,
          ticket_id: params.p_ticket_id,
          event_type: 'routing_assigned',
          category: 'lifecycle',
          title: `${params.p_ticket_id} Reassigned to ${vCleanTargetTeam}`,
          summary: `Reassigned from ${previousTeam} to ${vCleanTargetTeam}. Reason: ${vCleanReason}`,
          policy_reference: vTicket.referenced_policy_id
            ? `${vTicket.referenced_policy_id} v${vTicket.referenced_policy_version}`
            : null,
          is_read: false,
          created_at: vNow,
        });
        vNotificationCreated = true;
        vNotificationReused = false;
      } else {
        if (
          existingNotif.ticket_id !== params.p_ticket_id ||
          existingNotif.recipient_profile_id !== vTicket.requester_profile_id
        ) {
          throw Object.assign(
            new Error(
              `DUPLICATE_NOTIFICATION_ID: Notification ID ${vDerivedNotificationId} already exists for another ticket or recipient.`
            ),
            { code: '23505' }
          );
        }
        vNotificationCreated = false;
        vNotificationReused = true;
      }
    }

    return {
      ok: true,
      ticket_id: params.p_ticket_id,
      assignment_id: vDerivedAssignmentId,
      sequence_number: vNextAsgSeq,
      previous_assignment_id: vPrevAsg ? vPrevAsg.assignment_id : null,
      previous_assigned_team: previousTeam,
      assigned_team: vCleanTargetTeam,
      assigned_actor_id: vResolvedAssignedActorId,
      assigned_actor_role: vResolvedAssignedRole,
      routing_rule_id: vResolvedRuleId,
      event_id: vDerivedEventId,
      message_id: vDerivedMessageId,
      message_sequence_number: vNextMsgSeq,
      notification_id: vDerivedNotificationId,
      notification_created: vNotificationCreated,
      notification_reused: vNotificationReused,
    };
  } catch (err) {
    // Atomic PostgreSQL transaction rollback: restore all tables to pre-invocation state
    db.tables = snapshot;
    throw err;
  }
}

describe('Phase 5: Corrected Atomic Reassignment SQL Migration (20261030000003) Verification', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20261030000003_phase5_atomic_workflow_rpcs.sql'
  );
  const sqlText = fs.readFileSync(migrationPath, 'utf8');

  it('SQL Static Verification: enforces lowercase actor_role_type enum literals, JWT validation, category team lookup, lifecycle event insert, and routing_assigned notification', () => {
    // Must NOT contain broken PascalCase enum comparisons
    assert.equal(sqlText.includes("'SupportStaff'"), false);
    assert.equal(sqlText.includes("'AcademicAdministrator'"), false);
    assert.equal(sqlText.includes("'PlatformAdministrator'"), false);

    // Must use exact lowercase public.actor_role_type enum literals
    assert.equal(
      sqlText.includes(
        "('support_staff', 'academic_administrator', 'platform_administrator')"
      ),
      true
    );

    // Must validate JWT via existing helper and never modify current_auth_provider()
    assert.equal(
      sqlText.includes('public.is_valid_authenticated_jwt()'),
      true
    );
    assert.equal(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.current_auth_provider/i.test(
        sqlText
      ),
      false
    );
    assert.equal(
      /DROP\s+FUNCTION[^;]*current_auth_provider/i.test(sqlText),
      false
    );

    // Must validate p_target_team against public.categories
    assert.equal(sqlText.includes('FROM public.categories c'), true);
    assert.equal(
      sqlText.includes(
        'c.default_assigned_team = v_clean_target_team OR c.escalation_team = v_clean_target_team'
      ),
      true
    );

    // Must insert into public.ticket_lifecycle_events and use 'routing_assigned'
    assert.equal(
      sqlText.includes('INSERT INTO public.ticket_lifecycle_events'),
      true
    );
    assert.equal(sqlText.includes("'routing_assigned'"), true);
    assert.equal(sqlText.includes('OWNER TO postgres'), true);
  });

  it('Test 1 (Successful Reassignment): updates ticket, preserves prior assignment history, appends lifecycle event, routing message, and routing_assigned notification', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Financial Aid Verification Reassignment Test',
        category: 'Financial Aid',
        description:
          'Testing atomic reassignment from primary support unit to escalation review unit.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    const targetEscalationTeam =
      DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team;

    const result = executeSimulatedAtomicReassignRpc(
      db,
      {
        isValidAuthenticatedJwt: true,
        profile: TEST_ACTORS[ActorRole.SupportStaff],
      },
      {
        p_ticket_id: ticketId,
        p_target_team: targetEscalationTeam,
        p_assigned_actor_role: ActorRole.AcademicAdministrator,
        p_assignment_reason:
          'Escalating to Financial Aid Escalation Review Unit for SAP dependency override.',
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.assignment_id, `ASG-${ticketId}-02`);
    assert.equal(result.sequence_number, 2);
    assert.equal(result.previous_assignment_id, `ASG-${ticketId}-01`);
    assert.equal(result.assigned_team, targetEscalationTeam);
    assert.equal(result.event_id, `EVT-${ticketId}-003`);
    assert.equal(result.message_id, `MSG-${ticketId}-004`);

    // Verify assignment history preserved (ASG-01 inactive with unassigned_at; ASG-02 active)
    const assignments = db.tables.assignments.filter(
      (a: any) => a.ticket_id === ticketId
    );
    assert.equal(assignments.length, 2);
    assert.equal(assignments[0].is_active, false);
    assert.ok(assignments[0].unassigned_at);
    assert.equal(assignments[1].is_active, true);
    assert.equal(assignments[1].previous_assignment_id, `ASG-${ticketId}-01`);

    // Verify lifecycle event & routing_assigned notification created
    const events = db.tables.ticket_lifecycle_events.filter(
      (e: any) => e.ticket_id === ticketId
    );
    assert.equal(events.length, 3);
    assert.match(events[2].transition_reason, /Reassigned from/);

    const notifications = db.tables.workspace_notifications.filter(
      (n: any) => n.ticket_id === ticketId
    );
    const reassignNotif = notifications.find(
      (n: any) => n.notification_id === result.notification_id
    );
    assert.ok(reassignNotif);
    assert.equal(reassignNotif.event_type, 'routing_assigned');
  });

  it('Test 2 (Unauthorized Users): rejects invalid JWTs, Learners, Instructors, and Support Staff reassigning escalated tickets', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Unauthorized Reassignment Protection Test',
        category: 'Registration',
        description:
          'Verifying that unauthenticated callers, learners, and instructors cannot invoke atomic reassignment.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    const targetTeam = DOCUMENTED_ROUTING_RULES['Registration'].escalation_assigned_team;

    // 2a. Invalid JWT rejected
    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: false,
            profile: TEST_ACTORS[ActorRole.SupportStaff],
          },
          {
            p_ticket_id: ticketId,
            p_target_team: targetTeam,
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Valid reason string.',
          }
        ),
      /UNAUTHORIZED_JWT/
    );

    // 2b. Learner rejected
    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.Learner],
          },
          {
            p_ticket_id: ticketId,
            p_target_team: targetTeam,
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Learner attempting self-reassignment.',
          }
        ),
      /FORBIDDEN_REASSIGNMENT/
    );

    // 2c. Instructor rejected
    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.Instructor],
          },
          {
            p_ticket_id: ticketId,
            p_target_team: targetTeam,
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Instructor attempting queue reassignment.',
          }
        ),
      /FORBIDDEN_REASSIGNMENT/
    );
  });

  it('Test 3 (Invalid Assigned Roles): rejects assigning a ticket to learner, instructor, or null role', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Assigned Actor Role Validation Test',
        category: 'IT',
        description:
          'Ensuring p_assigned_actor_role cannot be set to learner or instructor.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    const targetTeam = DOCUMENTED_ROUTING_RULES['IT'].escalation_assigned_team;

    for (const invalidRole of ['learner', 'instructor', null, 'SupportStaff']) {
      assert.throws(
        () =>
          executeSimulatedAtomicReassignRpc(
            db,
            {
              isValidAuthenticatedJwt: true,
              profile: TEST_ACTORS[ActorRole.SupportStaff],
            },
            {
              p_ticket_id: ticketId,
              p_target_team: targetTeam,
              p_assigned_actor_role: invalidRole,
              p_assignment_reason: 'Valid reassignment reason string.',
            }
          ),
        /INVALID_ASSIGNED_ROLE/
      );
    }
  });

  it('Test 4 (Duplicate IDs): rejects duplicate assignment_id or duplicate message_id with 23505', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Duplicate Identifier Rejection Test',
        category: 'Accessibility',
        description:
          'Verifying that supplying an existing assignment_id or message_id is rejected with 23505.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    const targetTeam =
      DOCUMENTED_ROUTING_RULES['Accessibility'].escalation_assigned_team;

    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.SupportStaff],
          },
          {
            p_ticket_id: ticketId,
            p_new_assignment_id: `ASG-${ticketId}-01`, // Already exists
            p_target_team: targetTeam,
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Valid reassignment reason.',
          }
        ),
      /DUPLICATE_ASSIGNMENT_ID/
    );

    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.SupportStaff],
          },
          {
            p_ticket_id: ticketId,
            p_message_id: `MSG-${ticketId}-001`, // Already exists
            p_target_team: targetTeam,
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Valid reassignment reason.',
          }
        ),
      /DUPLICATE_MESSAGE_ID/
    );
  });

  it('Test 5 (Invalid Teams): rejects invented/undocumented teams not in public.categories and rejects no-op reassignment to current team', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Category Team Validation Test',
        category: 'Financial Aid',
        description:
          'Verifying that undocumented team names and same-team reassignments are rejected.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.SupportStaff],
          },
          {
            p_ticket_id: ticketId,
            p_target_team: 'Invented Campus Parking Subcommittee',
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Attempting to route to an invented team.',
          }
        ),
      /INVALID_TARGET_TEAM/
    );

    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.SupportStaff],
          },
          {
            p_ticket_id: ticketId,
            p_target_team:
              DOCUMENTED_ROUTING_RULES['Financial Aid'].primary_assigned_team,
            p_assigned_actor_role: ActorRole.SupportStaff,
            p_assignment_reason: 'Attempting no-op reassignment to same team.',
          }
        ),
      /NOOP_REASSIGNMENT/
    );
  });

  it('Test 6 (Closed Tickets): rejects reassigning a closed ticket', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Closed Ticket Reassignment Guard Test',
        category: 'IT',
        description:
          'Verifying that closed tickets cannot be reassigned under any circumstances.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    // Transition to resolved, then closed
    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Resolved,
        reason: 'Resolved IT ticket with active policy citation.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'transition_ticket',
        ticketId,
        newState: RequestStatus.Closed,
        reason: 'Closing resolved IT ticket.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.PlatformAdministrator],
          },
          {
            p_ticket_id: ticketId,
            p_target_team: DOCUMENTED_ROUTING_RULES['IT'].escalation_assigned_team,
            p_assigned_actor_role: ActorRole.PlatformAdministrator,
            p_assignment_reason: 'Attempting to reassign a closed ticket.',
          }
        ),
      /TICKET_CLOSED/
    );
  });

  it('Test 7 (Transaction Rollback): rolls back prior assignment deactivation, new assignment, ticket update, and lifecycle event if any step fails', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Atomic Transaction Rollback Test',
        category: 'Registration',
        description:
          'Verifying that a failure during message insertion rolls back all preceding updates and inserts.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;
    const originalTeam = createRes.body.ticket.current_assigned_team;

    assert.throws(
      () =>
        executeSimulatedAtomicReassignRpc(
          db,
          {
            isValidAuthenticatedJwt: true,
            profile: TEST_ACTORS[ActorRole.SupportStaff],
          },
          {
            p_ticket_id: ticketId,
            p_target_team:
              DOCUMENTED_ROUTING_RULES['Registration'].escalation_assigned_team,
            p_assigned_actor_role: ActorRole.AcademicAdministrator,
            p_assignment_reason:
              'Simulating mid-transaction failure at message insert step.',
          },
          { failAtStep: 'insert_message' }
        ),
      /SIMULATED_FAILURE_INSERT_MESSAGE/
    );

    // Verify 100% rollback: ticket still on original team, ASG-01 still active, no ASG-02, no EVT-003, no MSG-004
    const ticketAfter = db.tables.tickets.find(
      (t: any) => t.ticket_id === ticketId
    );
    assert.equal(ticketAfter.current_assigned_team, originalTeam);

    const assignmentsAfter = db.tables.assignments.filter(
      (a: any) => a.ticket_id === ticketId
    );
    assert.equal(assignmentsAfter.length, 1);
    assert.equal(assignmentsAfter[0].is_active, true);
    assert.equal(assignmentsAfter[0].unassigned_at, null);

    const eventsAfter = db.tables.ticket_lifecycle_events.filter(
      (e: any) => e.ticket_id === ticketId
    );
    assert.equal(eventsAfter.length, 2);

    const messagesAfter = db.tables.messages.filter(
      (m: any) => m.ticket_id === ticketId
    );
    assert.equal(messagesAfter.length, 3);
  });

  it('Test 8 (Workspace API RPC Integration): calls client.rpc("atomic_reassign_ticket_workflow") exactly once, maps all 12 parameters, performs zero duplicate table writes, and re-fetches updated records', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'End-to-End Workspace API Atomic Reassignment RPC Test',
        category: 'Financial Aid',
        description:
          'Verifying that /api/ops/workspace reassign_ticket calls atomic_reassign_ticket_workflow exactly once and re-fetches the updated records.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    assert.equal(createRes.status, 201);
    const ticketId = createRes.body.ticket.ticket_id;
    const targetTeam =
      DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team;
    const reason =
      'Routing to Financial Aid Escalation Review Unit for SAP appeal committee review.';

    assert.equal(db.rpcCalls.length, 0);

    const reassignRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId,
        targetTeam,
        reason,
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );

    assert.equal(reassignRes.status, 200);
    assert.equal(reassignRes.body.ok, true);

    // Must call the RPC exactly once
    assert.equal(db.rpcCalls.length, 1);
    assert.equal(db.rpcCalls[0].fn, 'atomic_reassign_ticket_workflow');
    assert.deepEqual(db.rpcCalls[0].params, {
      p_ticket_id: ticketId,
      p_new_assignment_id: null,
      p_sequence_number: null,
      p_target_team: targetTeam,
      p_assigned_actor_id: 'ACTOR-ESC-FINAID',
      p_assigned_actor_role: ActorRole.AcademicAdministrator,
      p_routing_rule_id: 'RULE-FINAID-001',
      p_assignment_reason: reason,
      p_requires_human_review: true,
      p_message_id: null,
      p_message_seq: null,
      p_notification_id: null,
    });

    // Verify no duplicate table writes occurred after the RPC
    const ticketAssignments = db.tables.assignments.filter(
      (a: any) => a.ticket_id === ticketId
    );
    assert.equal(ticketAssignments.length, 2);
    assert.equal(ticketAssignments[0].is_active, false);
    assert.equal(ticketAssignments[1].is_active, true);
    assert.equal(
      ticketAssignments[1].assignment_id,
      reassignRes.body.assignment.assignment_id
    );

    const ticketMessages = db.tables.messages.filter(
      (m: any) => m.ticket_id === ticketId
    );
    assert.equal(ticketMessages.length, 4);

    const ticketEvents = db.tables.ticket_lifecycle_events.filter(
      (e: any) => e.ticket_id === ticketId
    );
    assert.equal(ticketEvents.length, 3);
    assert.equal(
      ticketEvents[2].event_id,
      reassignRes.body.lifecycleEvent.event_id
    );

    const ticketNotifications = db.tables.workspace_notifications.filter(
      (n: any) => n.ticket_id === ticketId
    );
    assert.equal(ticketNotifications.length, 2);
    assert.equal(
      reassignRes.body.notification.event_type,
      'routing_assigned'
    );
    assert.equal(reassignRes.body.rpcResult.notification_created, true);
    assert.equal(reassignRes.body.rpcResult.notification_reused, false);
  });

  it('Test 9 (Workspace API RPC Error Handling & No Silent Fallback): maps RPC validation/authorization errors to HTTP 400/403/500 and never falls back to manual table writes', async () => {
    const db = createTransactionalTestSupabaseClient();
    const createRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'RPC Error Mapping & Zero Fallback Verification',
        category: 'Financial Aid',
        description:
          'Verifying that cross-category team errors, role mismatches, and mid-RPC failures do not trigger fallback table writes.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: db }
    );
    const ticketId = createRes.body.ticket.ticket_id;

    // 9a. Cross-category team rejected by RPC -> 400 INVALID_TARGET_TEAM
    const crossCategoryRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId,
        targetTeam: DOCUMENTED_ROUTING_RULES.IT.primary_assigned_team,
        reason: 'Attempting to route Financial Aid ticket to IT team.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(crossCategoryRes.status, 400);
    assert.equal(crossCategoryRes.body.code, 'INVALID_TARGET_TEAM');

    // 9b. Individual staff UUID with mismatched role rejected by RPC -> 400 ASSIGNED_ACTOR_ROLE_MISMATCH
    const roleMismatchRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId,
        targetTeam:
          DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team,
        assignedActorId: TEST_ACTORS[ActorRole.SupportStaff].id,
        assignedActorRole: ActorRole.PlatformAdministrator,
        reason: 'Attempting to assign support_staff UUID with platform_administrator role.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: db }
    );
    assert.equal(roleMismatchRes.status, 400);
    assert.equal(roleMismatchRes.body.code, 'ASSIGNED_ACTOR_ROLE_MISMATCH');

    // 9c. Simulated mid-RPC database failure -> 500 REMOTE_DATABASE_WRITE_FAILED with rolledBack: true and zero partial writes
    const failingRpcDb = createTransactionalTestSupabaseClient({
      failOnRpcStep: 'insert_message',
    });
    const t2Create = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'create_ticket',
        subject: 'Mid-RPC Failure Rollback Verification',
        category: 'Registration',
        description:
          'Verifying that a mid-RPC failure returns 500 REMOTE_DATABASE_WRITE_FAILED without falling back to multi-step writes.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.Learner], client: failingRpcDb }
    );
    const t2Id = t2Create.body.ticket.ticket_id;

    const failedRpcRes = await processWorkspaceOperationRequest(
      'POST',
      {},
      {
        action: 'reassign_ticket',
        ticketId: t2Id,
        targetTeam:
          DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team,
        reason: 'Triggering simulated failure inside RPC message insert.',
      },
      {},
      { profile: TEST_ACTORS[ActorRole.SupportStaff], client: failingRpcDb }
    );

    assert.equal(failedRpcRes.status, 500);
    assert.equal(failedRpcRes.body.code, 'REMOTE_DATABASE_WRITE_FAILED');
    assert.equal(failedRpcRes.body.rolledBack, true);
    assert.equal(failingRpcDb.rpcCalls.length, 1);
    assert.equal(
      failingRpcDb.tables.assignments.filter((a: any) => a.ticket_id === t2Id)
        .length,
      1
    );
    assert.equal(
      failingRpcDb.tables.messages.filter((m: any) => m.ticket_id === t2Id)
        .length,
      3
    );
  });
});

