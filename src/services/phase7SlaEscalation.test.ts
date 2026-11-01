import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026,
  DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
  DOCUMENTED_ROUTING_RULES,
  UNMAPPED_HUMAN_REVIEW_ROUTING,
  buildReproducibleSlaRecord,
  calculateDueTimestampByBusinessMinutes,
  calculateElapsedBusinessMinutes,
  createReassignmentRecord,
  enrichSlaRecordWithOperationalMetrics,
  evaluateReassignmentAuthorization,
  evaluateTicketEscalationAndExceptions,
  evaluateTicketRouting,
  evaluateTransitionAuthorization,
  toDbSlaRow,
  validateResolutionTransition,
  validateSlaConfiguration,
  validateTicketAssignmentAndRouting,
} from './workflowEngine';
import { ActorRole, RequestStatus } from '../types/domain';
import {
  AssignmentRecord,
  MessageRecord,
  TicketLifecycleEventRecord,
  TicketRecord,
} from '../types/phase3';

function createBaseTicket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    ticket_id: 'TKT-2026-000701',
    requester_id: 'REQ-2026-000001',
    requester_profile_id: 'USR-LEARNER-01',
    category_id: 'CAT-FINAID',
    category_name: 'Financial Aid',
    term_id: 'TERM-2026-FALL',
    subject: 'Fall 2026 Pell Grant Disbursement Hold',
    description:
      'My Pell Grant disbursement shows an administrative verification hold on my student account.',
    priority: 'Standard Priority',
    lifecycle_status: RequestStatus.UnderReview,
    current_assigned_team:
      DOCUMENTED_ROUTING_RULES['Financial Aid'].primary_assigned_team,
    current_routing_rule_id: DOCUMENTED_ROUTING_RULES['Financial Aid'].rule_id,
    referenced_policy_id: 'POL-FINAID-2026-001',
    referenced_policy_version: '2.0',
    referenced_article_id: 'KB-000001',
    referenced_article_version: '1.0',
    requires_escalation: false,
    is_escalated: false,
    escalation_reason: null,
    resolution_summary: null,
    is_synthetic_eval: false,
    submitted_at: '2026-10-19T08:00:00.000Z', // Monday 08:00 UTC
    updated_at: '2026-10-19T09:00:00.000Z',
    resolved_at: null,
    closed_at: null,
    ...overrides,
  };
}

function createBaseAssignment(
  overrides: Partial<AssignmentRecord> = {}
): AssignmentRecord {
  return {
    assignment_id: 'ASG-TKT-2026-000701-01',
    ticket_id: 'TKT-2026-000701',
    sequence_number: 1,
    assigned_team:
      DOCUMENTED_ROUTING_RULES['Financial Aid'].primary_assigned_team,
    assigned_actor_id: 'ACTOR-OPS-FINAID',
    assigned_actor_role: ActorRole.SupportStaff,
    routing_rule_id: DOCUMENTED_ROUTING_RULES['Financial Aid'].rule_id,
    assignment_reason: 'Initial automated category routing',
    previous_assignment_id: null,
    previous_assigned_team: null,
    requires_human_review: false,
    is_active: true,
    assigned_at: '2026-10-19T08:00:00.000Z',
    unassigned_at: null,
    ...overrides,
  };
}

describe('Phase 7 — SLA and Escalation Engineering Verification Suite', () => {
  describe('1. SLA Calculation & Business-Hour / Holiday Boundaries', () => {
    it('calculates SLA start, due, response, resolution, remaining, overdue times, and calculation_history accurately', () => {
      // Financial Aid target: 1,080 business minutes (2 business days of 540 mins = Wednesday 08:00 / Tuesday 17:00 UTC from Monday 08:00 UTC)
      const startIso = '2026-10-19T08:00:00.000Z'; // Monday 08:00 UTC
      const evaluatedIso = '2026-10-19T12:00:00.000Z'; // Monday 12:00 UTC (240 mins elapsed)
      const firstResponseIso = '2026-10-19T09:30:00.000Z'; // Monday 09:30 UTC (90 mins response)

      const sla = buildReproducibleSlaRecord({
        ticketId: 'TKT-2026-000701',
        category: 'Financial Aid',
        startTimestampIso: startIso,
        evaluatedTimestampIso: evaluatedIso,
        firstResponseTimestampIso: firstResponseIso,
        resolvedTimestampIso: null,
        isTicketEscalated: false,
        requiresEscalation: false,
      });

      assert.equal(sla.sla_id, 'SLA-TKT-2026-000701');
      assert.equal(sla.start_timestamp, startIso);
      assert.equal(sla.due_timestamp, '2026-10-20T17:00:00.000Z');
      assert.equal(sla.target_business_minutes, 1080);
      assert.equal(sla.elapsed_business_minutes, 240);
      assert.equal(sla.elapsed_wall_clock_minutes, 240);
      assert.equal(sla.remaining_business_minutes, 840);
      assert.equal(sla.overdue_business_minutes, 0);
      assert.equal(sla.first_response_timestamp, firstResponseIso);
      assert.equal(sla.actual_response_business_minutes, 90);
      assert.equal(sla.actual_response_wall_clock_minutes, 90);
      assert.equal(sla.resolved_timestamp, null);
      assert.equal(sla.resolution_business_minutes, null);
      assert.equal(sla.sla_status, 'within_sla');
      assert.equal(sla.breach_status, false);
      assert.equal(sla.is_approaching_deadline, false);
      assert.equal(sla.rule_classification, 'PROPOSED_CONFIGURABLE_RULE');
      assert.equal(sla.configuration_valid, true);
      assert.ok(Array.isArray(sla.calculation_history));
      assert.ok((sla.calculation_history?.length ?? 0) >= 4);

      // Verify toDbSlaRow strips computed-only fields while preserving all 16 public.slas columns
      const dbRow = toDbSlaRow(sla);
      assert.equal(dbRow.sla_id, 'SLA-TKT-2026-000701');
      assert.equal(dbRow.breach_status, false);
      assert.equal('sla_status' in dbRow, false);
      assert.equal('calculation_history' in dbRow, false);
    });

    it('excludes overnight hours, weekends, and configured academic holidays accurately', () => {
      const holidaySchedule = {
        ...DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
        schedule_code: 'MON_FRI_0800_1700_UTC_WITH_HOLIDAYS',
        holiday_dates_utc: [...CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026],
      };

      // Wednesday 2026-11-25 15:00 UTC -> Monday 2026-11-30 10:00 UTC
      // Note: 2026-11-26 (Thu) and 2026-11-27 (Fri) are in CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026,
      // and 2026-11-28 (Sat) & 2026-11-29 (Sun) are weekend days!
      // Expected business minutes:
      // - Wed 2026-11-25 15:00..17:00 = 120 mins
      // - Thu 2026-11-26 = 0 mins (Holiday!)
      // - Fri 2026-11-27 = 0 mins (Holiday!)
      // - Sat/Sun = 0 mins (Weekend!)
      // - Mon 2026-11-30 08:00..10:00 = 120 mins
      // Total = 240 business minutes
      const startIso = '2026-11-25T15:00:00.000Z';
      const endIso = '2026-11-30T10:00:00.000Z';

      const elapsedBizWithHoliday = calculateElapsedBusinessMinutes(
        startIso,
        endIso,
        holidaySchedule
      );
      const elapsedBizWithoutHoliday = calculateElapsedBusinessMinutes(
        startIso,
        endIso,
        DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
      );
      const wallClock = Math.round(
        (Date.parse(endIso) - Date.parse(startIso)) / 60000
      );

      assert.equal(elapsedBizWithHoliday, 240);
      assert.equal(elapsedBizWithoutHoliday, 1320); // includes 540 mins on Thu + 540 mins on Fri
      assert.equal(wallClock, 6900);

      // Verify due timestamp skips both Thursday/Friday holidays and Saturday/Sunday weekend
      const dueWithHoliday = calculateDueTimestampByBusinessMinutes(
        startIso,
        240,
        holidaySchedule
      );
      assert.equal(dueWithHoliday, endIso);
    });

    it('distinguishes resolved_within_sla vs resolved_after_breach when a ticket is resolved', () => {
      const startIso = '2026-10-19T08:00:00.000Z'; // Monday 08:00 UTC
      // IT target is 240 business mins (due Monday 12:00 UTC)
      const resolvedWithinIso = '2026-10-19T11:15:00.000Z'; // 195 mins (< 240)
      const slaWithin = buildReproducibleSlaRecord({
        ticketId: 'TKT-IT-1',
        category: 'IT',
        startTimestampIso: startIso,
        evaluatedTimestampIso: '2026-10-20T10:00:00.000Z',
        firstResponseTimestampIso: '2026-10-19T08:30:00.000Z',
        resolvedTimestampIso: resolvedWithinIso,
        isTicketEscalated: false,
        requiresEscalation: false,
        lifecycleStatus: RequestStatus.Resolved,
      });

      assert.equal(slaWithin.sla_status, 'resolved_within_sla');
      assert.equal(slaWithin.breach_status, false);
      assert.equal(slaWithin.resolution_business_minutes, 195);
      assert.equal(slaWithin.overdue_business_minutes, 0);

      // Resolved Tuesday 10:00 UTC (660 business mins > 240 target)
      const resolvedLateIso = '2026-10-20T10:00:00.000Z';
      const slaLate = buildReproducibleSlaRecord({
        ticketId: 'TKT-IT-2',
        category: 'IT',
        startTimestampIso: startIso,
        evaluatedTimestampIso: resolvedLateIso,
        firstResponseTimestampIso: '2026-10-19T09:00:00.000Z',
        resolvedTimestampIso: resolvedLateIso,
        isTicketEscalated: true,
        requiresEscalation: true,
        lifecycleStatus: RequestStatus.Resolved,
      });

      assert.equal(slaLate.sla_status, 'resolved_after_breach');
      assert.equal(slaLate.breach_status, true);
      assert.equal(slaLate.resolution_business_minutes, 660);
      assert.equal(slaLate.overdue_business_minutes, 420);
    });
  });

  describe('2. Ten Mandatory Phase 7 Exception & Escalation Scenarios', () => {
    it('Scenario 1: Ticket approaching its configured SLA deadline triggers approaching_sla_deadline warning', () => {
      // Financial Aid target = 1,080 mins; approaching threshold = 75% = 810 mins (Tuesday 12:30 UTC)
      const ticket = createBaseTicket();
      const assignment = createBaseAssignment();
      const evaluatedIso = '2026-10-20T13:30:00.000Z'; // 870 business mins elapsed (80.6% of 1080)

      const sla = buildReproducibleSlaRecord({
        ticketId: ticket.ticket_id,
        category: ticket.category_name,
        startTimestampIso: ticket.submitted_at,
        evaluatedTimestampIso: evaluatedIso,
        isTicketEscalated: false,
        requiresEscalation: false,
      });

      assert.equal(sla.sla_status, 'approaching_deadline');
      assert.equal(sla.is_approaching_deadline, true);
      assert.equal(
        sla.approaching_threshold_business_minutes,
        Math.ceil(1080 * DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO)
      );
      assert.equal(sla.remaining_business_minutes, 210);

      const evaluation = evaluateTicketEscalationAndExceptions({
        ticket,
        sla,
        assignments: [assignment],
        messages: [],
        lifecycleEvents: [],
        evaluatedAtIso: evaluatedIso,
      });

      assert.ok(
        evaluation.triggers.some(
          (t) => t.trigger_code === 'approaching_sla_deadline'
        )
      );
      assert.equal(evaluation.isApproachingDeadline, true);
      assert.equal(evaluation.sla.remaining_business_minutes, 210);
    });

    it('Scenario 2: Ticket exceeding its SLA deadline triggers sla_breached and recommends escalation to committee', () => {
      const ticket = createBaseTicket();
      const assignment = createBaseAssignment();
      // Evaluated Wednesday 11:00 UTC -> 1,260 business mins elapsed (> 1,080 target, 180 mins overdue)
      const evaluatedIso = '2026-10-21T11:00:00.000Z';

      const sla = buildReproducibleSlaRecord({
        ticketId: ticket.ticket_id,
        category: ticket.category_name,
        startTimestampIso: ticket.submitted_at,
        evaluatedTimestampIso: evaluatedIso,
        isTicketEscalated: false,
        requiresEscalation: false,
      });

      assert.equal(sla.sla_status, 'breached');
      assert.equal(sla.breach_status, true);
      assert.equal(sla.overdue_business_minutes, 180);

      const evaluation = evaluateTicketEscalationAndExceptions({
        ticket,
        sla,
        assignments: [assignment],
        messages: [],
        lifecycleEvents: [],
        evaluatedAtIso: evaluatedIso,
      });

      assert.ok(
        evaluation.triggers.some((t) => t.trigger_code === 'sla_breached')
      );
      assert.equal(evaluation.shouldEscalateNow, true);
      assert.equal(evaluation.primaryTriggerCode, 'sla_breached');
      assert.equal(
        evaluation.recommendedAssignedTeam,
        DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team
      );
      assert.ok(
        evaluation.combinedEscalationReason?.includes('SLA deadline breached')
      );
    });

    it('Scenario 3: Ticket unresolved after an escalation is tracked as unresolved_post_escalation and NEVER auto-resolved', () => {
      const escalatedTicket = createBaseTicket({
        lifecycle_status: RequestStatus.Escalated,
        is_escalated: true,
        requires_escalation: true,
        escalation_reason:
          '[sla_breached] Ticket TKT-2026-000701 exceeded SLA target of 1080 business minutes.',
        current_assigned_team:
          DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team,
      });
      const assignment = createBaseAssignment({
        assigned_team:
          DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team,
        assigned_actor_id: 'ACTOR-ESC-FINAID',
        assigned_actor_role: ActorRole.AcademicAdministrator,
      });
      const evaluatedIso = '2026-10-21T15:00:00.000Z';

      const sla = buildReproducibleSlaRecord({
        ticketId: escalatedTicket.ticket_id,
        category: escalatedTicket.category_name,
        startTimestampIso: escalatedTicket.submitted_at,
        evaluatedTimestampIso: evaluatedIso,
        isTicketEscalated: true,
        requiresEscalation: true,
      });

      const evaluation = evaluateTicketEscalationAndExceptions({
        ticket: escalatedTicket,
        sla,
        assignments: [assignment],
        messages: [],
        lifecycleEvents: [],
        evaluatedAtIso: evaluatedIso,
      });

      assert.ok(
        evaluation.triggers.some(
          (t) => t.trigger_code === 'unresolved_post_escalation'
        )
      );
      assert.equal(evaluation.isUnresolvedPostEscalation, true);
      // Escalated ticket must remain Escalated (never auto-resolved)
      assert.equal(evaluation.recommendedStatus, RequestStatus.Escalated);
      assert.equal(escalatedTicket.lifecycle_status, RequestStatus.Escalated);
      assert.equal(escalatedTicket.resolved_at, null);
    });

    it('Scenario 4: Ticket assigned to an unauthorized or mismatched team is detected and flagged for remediation', () => {
      // Financial Aid ticket wrongly routed to IT team
      const misroutedTicket = createBaseTicket({
        current_assigned_team:
          DOCUMENTED_ROUTING_RULES.IT.primary_assigned_team,
      });
      const misroutedAssignment = createBaseAssignment({
        assigned_team: DOCUMENTED_ROUTING_RULES.IT.primary_assigned_team,
      });

      const routingValidation = validateTicketAssignmentAndRouting({
        ticket: misroutedTicket,
        assignments: [misroutedAssignment],
      });

      assert.equal(routingValidation.valid, false);
      assert.equal(routingValidation.code, 'UNAUTHORIZED_TEAM_ROUTING');
      assert.equal(
        routingValidation.expectedPrimaryTeam,
        DOCUMENTED_ROUTING_RULES['Financial Aid'].primary_assigned_team
      );

      // Also verify evaluateReassignmentAuthorization rejects Learners and Instructors
      const learnerAuthCheck = evaluateReassignmentAuthorization(
        ActorRole.Learner
      );
      assert.equal(learnerAuthCheck.authorized, false);
      assert.equal(learnerAuthCheck.code, 'FORBIDDEN_REASSIGNMENT');
    });

    it('Scenario 5: Ticket with no valid assignment or invalid assignee role (Learner/Instructor) is rejected', () => {
      const unassignedTicket = createBaseTicket({
        current_assigned_team: '',
      });

      const missingValidation = validateTicketAssignmentAndRouting({
        ticket: unassignedTicket,
        assignments: [],
      });

      assert.equal(missingValidation.valid, false);
      assert.equal(missingValidation.code, 'MISSING_OR_INVALID_ASSIGNMENT');

      // Verify a ticket assigned to a Learner actor role is flagged as INVALID_ASSIGNED_ROLE
      const learnerAssignedTicket = createBaseTicket();
      const learnerAssignment = createBaseAssignment({
        assigned_actor_id: 'USR-LEARNER-99',
        assigned_actor_role: ActorRole.Learner,
      });

      const roleValidation = validateTicketAssignmentAndRouting({
        ticket: learnerAssignedTicket,
        assignments: [learnerAssignment],
      });

      assert.equal(roleValidation.valid, false);
      assert.equal(roleValidation.code, 'INVALID_ASSIGNED_ROLE');
    });

    it('Scenario 6: Ticket requiring human review or AI Policy Assistant escalation follows documented review path', () => {
      // Unmapped category falls back to UNMAPPED_HUMAN_REVIEW_ROUTING
      const unmappedDecision = evaluateTicketRouting({
        ticketId: 'TKT-2026-000799',
        category: null,
        priority: 'Standard Priority',
        subject: 'Parking citation appeal',
        description: 'Requesting review of campus lot B ticket.',
        assignedAtIso: '2026-10-19T08:00:00.000Z',
      });

      assert.equal(unmappedDecision.assignment.requires_human_review, true);
      assert.equal(
        unmappedDecision.assignment.assigned_team,
        UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team
      );

      const humanReviewTicket = createBaseTicket({
        requires_escalation: true,
        escalation_reason:
          'Policy exception petition requiring human committee review.',
      });
      const assignment = createBaseAssignment({
        requires_human_review: true,
      });
      const sla = buildReproducibleSlaRecord({
        ticketId: humanReviewTicket.ticket_id,
        category: humanReviewTicket.category_name,
        startTimestampIso: humanReviewTicket.submitted_at,
        evaluatedTimestampIso: '2026-10-19T10:00:00.000Z',
        isTicketEscalated: false,
        requiresEscalation: true,
      });

      const evaluation = evaluateTicketEscalationAndExceptions({
        ticket: humanReviewTicket,
        sla,
        assignments: [assignment],
        messages: [],
        lifecycleEvents: [],
        evaluatedAtIso: '2026-10-19T10:00:00.000Z',
        aiAssistantEscalationReason:
          '[AI Policy Assistant Escalation] Student requested retroactive deadline waiver requiring administrative review.',
      });

      assert.ok(
        evaluation.triggers.some(
          (t) => t.trigger_code === 'ai_policy_assistant_escalation'
        )
      );
      assert.equal(evaluation.shouldEscalateNow, true);
    });

    it('Scenario 7: Reassignment during an active SLA preserves start_timestamp and assignment lineage', () => {
      const initialAssignment = createBaseAssignment();
      const reassignedRecord = createReassignmentRecord({
        ticketId: 'TKT-2026-000701',
        category: 'Financial Aid',
        targetTeam:
          DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team,
        reason:
          'Escalating financial aid verification hold to committee review',
        assignedAtIso: '2026-10-19T11:00:00.000Z',
        previousAssignment: initialAssignment,
        sequenceNumber: 2,
        actorRole: ActorRole.SupportStaff,
      });

      assert.equal(reassignedRecord.sequence_number, 2);
      assert.equal(
        reassignedRecord.previous_assignment_id,
        initialAssignment.assignment_id
      );
      assert.equal(
        reassignedRecord.previous_assigned_team,
        initialAssignment.assigned_team
      );
      assert.equal(reassignedRecord.is_active, true);

      const ticket = createBaseTicket({
        current_assigned_team: reassignedRecord.assigned_team,
      });

      const initialSla = buildReproducibleSlaRecord({
        ticketId: ticket.ticket_id,
        category: ticket.category_name,
        startTimestampIso: ticket.submitted_at,
        evaluatedTimestampIso: '2026-10-19T08:00:00.000Z',
        isTicketEscalated: false,
        requiresEscalation: false,
      });

      const staffMessages: MessageRecord[] = [
        {
          message_id: 'MSG-TKT-2026-000701-001',
          ticket_id: ticket.ticket_id,
          sequence_number: 1,
          sender_id: 'ACTOR-OPS-FINAID',
          sender_profile_id: null,
          sender_role: ActorRole.SupportStaff,
          sender_name: 'Financial Aid Support Specialist',
          message_type: 'staff_response',
          body: 'Initial verification completed; forwarding to committee.',
          cited_policy_id: 'POL-FINAID-2026-001',
          cited_policy_version: '2.0',
          cited_article_id: null,
          cited_article_version: null,
          created_at: '2026-10-19T09:15:00.000Z',
        },
      ];

      const enrichedAfterReassignment = enrichSlaRecordWithOperationalMetrics({
        sla: initialSla,
        ticket,
        messages: staffMessages,
        evaluatedAtIso: '2026-10-19T11:30:00.000Z',
      });

      // SLA start_timestamp and due_timestamp must NOT be reset on reassignment
      assert.equal(
        enrichedAfterReassignment.start_timestamp,
        ticket.submitted_at
      );
      assert.equal(
        enrichedAfterReassignment.due_timestamp,
        initialSla.due_timestamp
      );
      assert.equal(enrichedAfterReassignment.elapsed_business_minutes, 210);
      assert.equal(
        enrichedAfterReassignment.actual_response_business_minutes,
        75
      );
    });

    it('Scenario 8: Duplicate escalation processing is detected and prevented (duplicateEscalationPrevented = true)', () => {
      const primaryTrigger = 'sla_breached';
      const escalationTeam =
        DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team;
      const alreadyEscalatedTicket = createBaseTicket({
        lifecycle_status: RequestStatus.Escalated,
        is_escalated: true,
        requires_escalation: true,
        escalation_reason:
          '[sla_breached] Ticket TKT-2026-000701 exceeded SLA target of 1080 business minutes.',
        current_assigned_team: escalationTeam,
      });

      const assignment = createBaseAssignment({
        assigned_team: escalationTeam,
        assigned_actor_id: 'ACTOR-ESC-FINAID',
        assigned_actor_role: ActorRole.AcademicAdministrator,
      });

      const existingEscalationEvents: TicketLifecycleEventRecord[] = [
        {
          event_id: 'EVT-TKT-2026-000701-002',
          ticket_id: alreadyEscalatedTicket.ticket_id,
          previous_state: RequestStatus.UnderReview,
          new_state: RequestStatus.Escalated,
          actor_id: 'ACTOR-ESC-FINAID',
          actor_role: ActorRole.AcademicAdministrator,
          reason: `[${primaryTrigger}] Ticket TKT-2026-000701 exceeded SLA target of 1080 business minutes.`,
          referenced_policy_id: 'POL-FINAID-2026-001',
          referenced_policy_version: '2.0',
          referenced_article_id: null,
          referenced_article_version: null,
          event_timestamp: '2026-10-21T10:00:00.000Z',
        },
      ];

      const evaluatedIso = '2026-10-21T14:00:00.000Z';
      const sla = buildReproducibleSlaRecord({
        ticketId: alreadyEscalatedTicket.ticket_id,
        category: alreadyEscalatedTicket.category_name,
        startTimestampIso: alreadyEscalatedTicket.submitted_at,
        evaluatedTimestampIso: evaluatedIso,
        isTicketEscalated: true,
        requiresEscalation: true,
      });

      const evaluation = evaluateTicketEscalationAndExceptions({
        ticket: alreadyEscalatedTicket,
        sla,
        assignments: [assignment],
        messages: [],
        lifecycleEvents: existingEscalationEvents,
        evaluatedAtIso: evaluatedIso,
      });

      assert.equal(evaluation.duplicateEscalationPrevented, true);
      assert.equal(evaluation.shouldEscalateNow, false);
      assert.ok(evaluation.deduplicationSignature?.includes('ESC-DEDUP-'));
    });

    it('Scenario 9: Invalid or missing SLA configuration fails safely with structured error codes', () => {
      const badCategoryCheck = validateSlaConfiguration({
        category: 'Unknown Category',
        startTimestampIso: '2026-10-19T08:00:00.000Z',
        evaluatedTimestampIso: '2026-10-19T10:00:00.000Z',
      });
      assert.equal(badCategoryCheck.valid, false);
      assert.equal(badCategoryCheck.code, 'INVALID_SLA_CATEGORY');

      const badScheduleCheck = validateSlaConfiguration({
        category: 'IT',
        startTimestampIso: '2026-10-19T08:00:00.000Z',
        evaluatedTimestampIso: '2026-10-19T10:00:00.000Z',
        schedule: {
          ...DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
          workday_start_hour_utc: 18,
          workday_end_hour_utc: 8,
        },
      });
      assert.equal(badScheduleCheck.valid, false);
      assert.equal(badScheduleCheck.code, 'INVALID_BUSINESS_SCHEDULE');

      const badThresholdCheck = validateSlaConfiguration({
        category: 'IT',
        startTimestampIso: '2026-10-19T08:00:00.000Z',
        evaluatedTimestampIso: '2026-10-19T10:00:00.000Z',
        approachingThresholdRatio: 1.5,
      });
      assert.equal(badThresholdCheck.valid, false);
      assert.equal(badThresholdCheck.code, 'INVALID_APPROACHING_THRESHOLD');
    });

    it('Scenario 10: Invalid lifecycle transitions and unauthorized resolution attempts are rejected', () => {
      // Submitted -> Closed directly is not permitted in the state machine
      const invalidTransition = evaluateTransitionAuthorization({
        actorRole: ActorRole.SupportStaff,
        previousState: RequestStatus.Submitted,
        newState: RequestStatus.Closed,
        isTicketOwner: false,
      });
      assert.equal(invalidTransition.authorized, false);
      assert.equal(invalidTransition.code, 'INVALID_LIFECYCLE_TRANSITION');

      // Learner cannot transition a ticket from Submitted -> UnderReview
      const unauthorizedRole = evaluateTransitionAuthorization({
        actorRole: ActorRole.Learner,
        previousState: RequestStatus.Submitted,
        newState: RequestStatus.UnderReview,
        isTicketOwner: true,
      });
      assert.equal(unauthorizedRole.authorized, false);
      assert.equal(unauthorizedRole.code, 'INSUFFICIENT_ROLE_FOR_TRANSITION');

      // SupportStaff cannot resolve an Escalated ticket without Academic/Platform Admin adjudication
      const escalatedResolutionBySupport = evaluateTransitionAuthorization({
        actorRole: ActorRole.SupportStaff,
        previousState: RequestStatus.Escalated,
        newState: RequestStatus.Resolved,
        isTicketOwner: false,
      });
      assert.equal(escalatedResolutionBySupport.authorized, false);
      assert.equal(
        escalatedResolutionBySupport.code,
        'ESCALATION_ADJUDICATION_REQUIRED'
      );

      // Resolving a ticket without a substantive resolution summary (< 10 chars) is rejected
      const missingResolutionDetails = validateResolutionTransition({
        previousState: RequestStatus.Escalated,
        newState: RequestStatus.Resolved,
        actorRole: ActorRole.AcademicAdministrator,
        isTicketOwner: false,
        reason: 'Done',
        resolutionSummary: 'Short',
      });
      assert.equal(missingResolutionDetails.valid, false);
      assert.equal(
        missingResolutionDetails.code,
        'MISSING_RESOLUTION_DETAILS'
      );
    });
  });
});
