import { ActorRole, RequestStatus } from '../types/domain.js';
import {
  AIEvidenceStatus,
  AssignmentRecord,
  CategoryRecord,
  EscalationTriggerCode,
  KnowledgeArticleRecord,
  MessageRecord,
  OfficialCategoryName,
  PolicyDocumentRecord,
  PolicyDomainCode,
  SLACalculationHistoryStep,
  SLACalculationMode,
  SLAEscalationStatus,
  SLAOperationalStatus,
  SLARecord,
  SLARuleClassification,
  TicketLifecycleEventRecord,
  TicketPriorityLevel,
  TicketRecord,
  WorkspaceNotificationRecord,
} from '../types/phase3.js';

// ============================================================================
// 1. EXACT ID FORMATTERS & VALIDATORS (Section 6)
// ============================================================================

export const ID_PATTERNS = {
  ticket: /^TKT-2026-[0-9]{6}$/,
  message: /^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$/,
  knowledgeArticle: /^KB-[0-9]{6}$/,
  policy: /^POL-(FINAID|REG|IT|ACCESS)-2026-[0-9]{3}$/,
  sla: /^SLA-TKT-2026-[0-9]{6}$/,
  requester: /^REQ-(2026-[0-9]{6}|USR-[A-Z0-9]+)$/,
  assignment: /^ASG-TKT-2026-[0-9]{6}-[0-9]{2}$/,
  feedback: /^FDB-TKT-2026-[0-9]{6}$/,
  anomaly: /^ANM-2026-[0-9]{6}$/,
} as const;

export function formatTicketId(sequenceNumber: number): string {
  return `TKT-2026-${String(sequenceNumber).padStart(6, '0')}`;
}

export function formatMessageId(ticketId: string, messageSeq: number): string {
  return `MSG-${ticketId}-${String(messageSeq).padStart(3, '0')}`;
}

export function formatKnowledgeArticleId(sequenceNumber: number): string {
  return `KB-${String(sequenceNumber).padStart(6, '0')}`;
}

export function formatPolicyId(
  domain: PolicyDomainCode,
  sequenceNumber: number
): string {
  return `POL-${domain}-2026-${String(sequenceNumber).padStart(3, '0')}`;
}

export function formatSlaId(ticketId: string): string {
  return `SLA-${ticketId}`;
}

export function formatRequesterId(sequenceNumber: number): string {
  return `REQ-2026-${String(sequenceNumber).padStart(6, '0')}`;
}

export function formatAssignmentId(
  ticketId: string,
  assignmentSeq: number
): string {
  return `ASG-${ticketId}-${String(assignmentSeq).padStart(2, '0')}`;
}

export function formatFeedbackId(ticketId: string): string {
  return `FDB-${ticketId}`;
}

export function formatAnomalyId(sequenceNumber: number): string {
  return `ANM-2026-${String(sequenceNumber).padStart(6, '0')}`;
}

// ============================================================================
// 2. OFFICIAL CATEGORIES & DOCUMENTED ROUTING ENGINE (Sections 7 & 10)
// ============================================================================

export const OFFICIAL_CATEGORIES: readonly OfficialCategoryName[] = [
  'Financial Aid',
  'Registration',
  'IT',
  'Accessibility',
] as const;

export interface DocumentedRoutingRule {
  rule_id: string;
  category_id: CategoryRecord['category_id'];
  category_name: OfficialCategoryName;
  domain_code: PolicyDomainCode;
  primary_assigned_team: string;
  escalation_assigned_team: string;
  default_actor_role: ActorRole;
  escalation_actor_role: ActorRole;
  rule_description: string;
}

export const DOCUMENTED_ROUTING_RULES: Record<
  OfficialCategoryName,
  DocumentedRoutingRule
> = {
  'Financial Aid': {
    rule_id: 'RULE-FINAID-001',
    category_id: 'CAT-FINAID',
    category_name: 'Financial Aid',
    domain_code: 'FINAID',
    primary_assigned_team: 'Office of Financial Aid & Scholarships',
    escalation_assigned_team:
      'Financial Aid Appeals & Compliance Review Committee',
    default_actor_role: ActorRole.SupportStaff,
    escalation_actor_role: ActorRole.AcademicAdministrator,
    rule_description:
      'Routes Financial Aid disbursement, SAP appeal, scholarship eligibility, and emergency aid inquiries to the Office of Financial Aid & Scholarships; escalates appeals and policy exceptions to the Financial Aid Appeals & Compliance Review Committee.',
  },
  Registration: {
    rule_id: 'RULE-REG-001',
    category_id: 'CAT-REG',
    category_name: 'Registration',
    domain_code: 'REG',
    primary_assigned_team: 'Office of the University Registrar',
    escalation_assigned_team: 'Academic Senate Registration Review Board',
    default_actor_role: ActorRole.SupportStaff,
    escalation_actor_role: ActorRole.AcademicAdministrator,
    rule_description:
      'Routes course enrollment, add/drop deadlines, late withdrawal petitions, credit overload, and degree audit requests to the Office of the University Registrar; escalates retroactive petitions to the Academic Senate Registration Review Board.',
  },
  IT: {
    rule_id: 'RULE-IT-001',
    category_id: 'CAT-IT',
    category_name: 'IT',
    domain_code: 'IT',
    primary_assigned_team: 'Campus IT Operations & Identity Desk',
    escalation_assigned_team:
      'Information Security & Infrastructure Escalation Unit',
    default_actor_role: ActorRole.SupportStaff,
    escalation_actor_role: ActorRole.PlatformAdministrator,
    rule_description:
      'Routes SSO authentication, MFA reset, LMS access, institutional email provisioning, and lab software licensing requests to the Campus IT Operations & Identity Desk; escalates security or multi-system outages to Information Security & Infrastructure Escalation Unit.',
  },
  Accessibility: {
    rule_id: 'RULE-ACCESS-001',
    category_id: 'CAT-ACCESS',
    category_name: 'Accessibility',
    domain_code: 'ACCESS',
    primary_assigned_team: 'Disability & Accessibility Services Office',
    escalation_assigned_team: 'ADA / Section 504 Compliance Review Panel',
    default_actor_role: ActorRole.SupportStaff,
    escalation_actor_role: ActorRole.AcademicAdministrator,
    rule_description:
      'Routes exam accommodation letters, assistive technology requests, captioning, and physical classroom access adjustments to the Disability & Accessibility Services Office; escalates accommodation disputes or urgent compliance barriers to the ADA / Section 504 Compliance Review Panel.',
  },
};

export const UNMAPPED_HUMAN_REVIEW_ROUTING = {
  rule_id: 'RULE-EXCEPTION-HUMAN-TRIAGE',
  assigned_team: 'Support Staff Intake Triage Queue (Human Review Required)',
  assigned_actor_role: ActorRole.SupportStaff,
  reason:
    'No deterministic category routing rule matched or request contains cross-domain ambiguity; flagged for manual triage review without inventing an unauthorized destination.',
};

/**
 * Normalizes or classifies a user-provided category label or request text into one of the
 * 4 official categories ('Financial Aid', 'Registration', 'IT', 'Accessibility'), or returns
 * null if the category cannot be deterministically established.
 */
export function resolveOfficialCategory(
  rawCategoryInput?: string | null,
  subjectAndDescription?: string
): {
  category: OfficialCategoryName | null;
  categoryId: CategoryRecord['category_id'] | null;
  domainCode: PolicyDomainCode | null;
  confidence: 'exact_match' | 'mapped_alias' | 'keyword_inferred' | 'unmapped';
} {
  const trimmed = (rawCategoryInput || '').trim();

  if (
    trimmed === 'Financial Aid' ||
    trimmed === 'Registration' ||
    trimmed === 'IT' ||
    trimmed === 'Accessibility'
  ) {
    const rule = DOCUMENTED_ROUTING_RULES[trimmed];
    return {
      category: trimmed,
      categoryId: rule.category_id,
      domainCode: rule.domain_code,
      confidence: 'exact_match',
    };
  }

  const lowerCat = trimmed.toLowerCase();
  const combinedText = `${trimmed} ${subjectAndDescription || ''}`.toLowerCase();

  // Map Phase 1 role preview category labels or keywords to the 4 official categories
  if (
    lowerCat.includes('financial') ||
    lowerCat.includes('scholarship') ||
    lowerCat.includes('fafsa') ||
    lowerCat.includes('tuition') ||
    lowerCat.includes('aid')
  ) {
    return {
      category: 'Financial Aid',
      categoryId: 'CAT-FINAID',
      domainCode: 'FINAID',
      confidence: 'mapped_alias',
    };
  }

  if (
    lowerCat.includes('registration') ||
    lowerCat.includes('enrollment') ||
    lowerCat.includes('course schedule') ||
    lowerCat.includes('deadline') ||
    lowerCat.includes('syllabus') ||
    lowerCat.includes('curriculum') ||
    lowerCat.includes('assessment')
  ) {
    return {
      category: 'Registration',
      categoryId: 'CAT-REG',
      domainCode: 'REG',
      confidence: 'mapped_alias',
    };
  }

  if (
    lowerCat.includes('accessibility') ||
    lowerCat.includes('accommodation') ||
    lowerCat.includes('disability') ||
    lowerCat.includes('assistive') ||
    lowerCat.includes('ada')
  ) {
    return {
      category: 'Accessibility',
      categoryId: 'CAT-ACCESS',
      domainCode: 'ACCESS',
      confidence: 'mapped_alias',
    };
  }

  if (
    lowerCat.includes('it') ||
    lowerCat.includes('technical') ||
    lowerCat.includes('indexing') ||
    lowerCat.includes('system') ||
    lowerCat.includes('sso') ||
    lowerCat.includes('mfa') ||
    lowerCat.includes('portal')
  ) {
    return {
      category: 'IT',
      categoryId: 'CAT-IT',
      domainCode: 'IT',
      confidence: 'mapped_alias',
    };
  }

  // Keyword inference from subject & description
  if (
    /\b(fafsa|pell|scholarship|disbursement|stipend|financial aid|tuition waiver|satisfactory academic progress|sap)\b/.test(
      combinedText
    )
  ) {
    return {
      category: 'Financial Aid',
      categoryId: 'CAT-FINAID',
      domainCode: 'FINAID',
      confidence: 'keyword_inferred',
    };
  }
  if (
    /\b(accommodation|disability|screen reader|extended time|captioning|accessibility|section 504|braille)\b/.test(
      combinedText
    )
  ) {
    return {
      category: 'Accessibility',
      categoryId: 'CAT-ACCESS',
      domainCode: 'ACCESS',
      confidence: 'keyword_inferred',
    };
  }
  if (
    /\b(mfa|two-factor|password|sso|canvas|lms|vpn|wifi|eduroam|account locked|software license)\b/.test(
      combinedText
    )
  ) {
    return {
      category: 'IT',
      categoryId: 'CAT-IT',
      domainCode: 'IT',
      confidence: 'keyword_inferred',
    };
  }
  if (
    /\b(add\/drop|withdraw|withdrawal|waitlist|prerequisite|transcript|enrollment|registrar|credit overload|late drop|drop a course|drop or withdraw)\b/.test(
      combinedText
    )
  ) {
    return {
      category: 'Registration',
      categoryId: 'CAT-REG',
      domainCode: 'REG',
      confidence: 'keyword_inferred',
    };
  }

  return {
    category: null,
    categoryId: null,
    domainCode: null,
    confidence: 'unmapped',
  };
}

export interface RoutingEvaluationInput {
  ticketId: string;
  category: OfficialCategoryName | null;
  priority: TicketPriorityLevel;
  subject: string;
  description: string;
  hasExpiredPolicyReference?: boolean;
  hasAmbiguousPolicyCoverage?: boolean;
  assignedAtIso: string;
  previousAssignment?: AssignmentRecord | null;
  sequenceNumber?: number;
}

export interface RoutingDecisionResult {
  assignment: AssignmentRecord;
  requiresEscalation: boolean;
  escalationReason: string | null;
  recommendedStatus: RequestStatus;
}

/**
 * Evaluates deterministic routing and escalation conditions (Sections 9 & 10).
 * Never invents an undocumented destination.
 */
export function evaluateTicketRouting(
  input: RoutingEvaluationInput
): RoutingDecisionResult {
  const seq = input.sequenceNumber ?? 1;
  const assignmentId = formatAssignmentId(input.ticketId, seq);
  const combined = `${input.subject} ${input.description}`.toLowerCase();

  // Check mandatory escalation triggers
  const hasExceptionOrAppealKeyword =
    /\b(exception|appeal|retroactive|waiver petition|ombuds|formal grievance|emergency override|legal compliance|statutory deadline)\b/.test(
      combined
    );
  const isAdminEscalationPriority =
    input.priority === 'Administrative Escalation Priority';

  const escalationReasons: string[] = [];
  if (isAdminEscalationPriority) {
    escalationReasons.push(
      'Request submitted with Administrative Escalation Priority.'
    );
  }
  if (hasExceptionOrAppealKeyword) {
    escalationReasons.push(
      'Request text contains policy exception, formal appeal, or retroactive petition criteria requiring administrative review.'
    );
  }
  if (input.hasExpiredPolicyReference) {
    escalationReasons.push(
      'Request references an expired or superseded policy version requiring human verification.'
    );
  }
  if (input.hasAmbiguousPolicyCoverage) {
    escalationReasons.push(
      'Applicable policy coverage is ambiguous or unestablished; human escalation required.'
    );
  }

  const requiresEscalation = escalationReasons.length > 0;
  const escalationReason =
    escalationReasons.length > 0 ? escalationReasons.join(' ') : null;

  if (!input.category || !DOCUMENTED_ROUTING_RULES[input.category]) {
    const assignment: AssignmentRecord = {
      assignment_id: assignmentId,
      ticket_id: input.ticketId,
      sequence_number: seq,
      assigned_team: UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team,
      assigned_actor_id: 'ACTOR-TRIAGE-QUEUE',
      assigned_actor_role: UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_actor_role,
      routing_rule_id: UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id,
      assignment_reason: UNMAPPED_HUMAN_REVIEW_ROUTING.reason,
      previous_assignment_id: input.previousAssignment?.assignment_id ?? null,
      previous_assigned_team: input.previousAssignment?.assigned_team ?? null,
      requires_human_review: true,
      is_active: true,
      assigned_at: input.assignedAtIso,
      unassigned_at: null,
    };

    return {
      assignment,
      requiresEscalation: true,
      escalationReason:
        escalationReason || UNMAPPED_HUMAN_REVIEW_ROUTING.reason,
      recommendedStatus: RequestStatus.Escalated,
    };
  }

  const rule = DOCUMENTED_ROUTING_RULES[input.category];
  const targetTeam = requiresEscalation
    ? rule.escalation_assigned_team
    : rule.primary_assigned_team;
  const targetRole = requiresEscalation
    ? rule.escalation_actor_role
    : rule.default_actor_role;

  const assignment: AssignmentRecord = {
    assignment_id: assignmentId,
    ticket_id: input.ticketId,
    sequence_number: seq,
    assigned_team: targetTeam,
    assigned_actor_id: requiresEscalation
      ? `ACTOR-ESC-${rule.domain_code}`
      : `ACTOR-OPS-${rule.domain_code}`,
    assigned_actor_role: targetRole,
    routing_rule_id: rule.rule_id,
    assignment_reason: requiresEscalation
      ? `Routed to ${targetTeam} under ${rule.rule_id} due to escalation trigger: ${escalationReason}`
      : `Routed to ${targetTeam} under documented rule ${rule.rule_id} for category '${input.category}'.`,
    previous_assignment_id: input.previousAssignment?.assignment_id ?? null,
    previous_assigned_team: input.previousAssignment?.assigned_team ?? null,
    requires_human_review: requiresEscalation,
    is_active: true,
    assigned_at: input.assignedAtIso,
    unassigned_at: null,
  };

  return {
    assignment,
    requiresEscalation,
    escalationReason,
    recommendedStatus: requiresEscalation
      ? RequestStatus.Escalated
      : RequestStatus.UnderReview,
  };
}

// ============================================================================
// 3. LIFECYCLE STATE TRANSITION VALIDATION & AUDIT TRAIL (Section 9)
// ============================================================================

export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<
  RequestStatus,
  readonly RequestStatus[]
> = {
  [RequestStatus.Draft]: [RequestStatus.Submitted],
  [RequestStatus.Submitted]: [
    RequestStatus.UnderReview,
    RequestStatus.PolicyVerified,
    RequestStatus.Escalated,
  ],
  [RequestStatus.UnderReview]: [
    RequestStatus.PolicyVerified,
    RequestStatus.Escalated,
    RequestStatus.Resolved,
  ],
  [RequestStatus.PolicyVerified]: [
    RequestStatus.UnderReview,
    RequestStatus.Escalated,
    RequestStatus.Resolved,
  ],
  [RequestStatus.Escalated]: [
    RequestStatus.UnderReview,
    RequestStatus.PolicyVerified,
    RequestStatus.Resolved,
  ],
  [RequestStatus.Resolved]: [RequestStatus.Closed, RequestStatus.Escalated],
  [RequestStatus.Closed]: [],
};

export function isValidLifecycleTransition(
  previousState: RequestStatus | null,
  newState: RequestStatus
): boolean {
  if (previousState === null) {
    return (
      newState === RequestStatus.Draft || newState === RequestStatus.Submitted
    );
  }
  return ALLOWED_LIFECYCLE_TRANSITIONS[previousState]?.includes(newState) ?? false;
}

export interface TransitionAuthorizationEvaluation {
  authorized: boolean;
  code:
    | 'AUTHORIZED'
    | 'INVALID_LIFECYCLE_TRANSITION'
    | 'FORBIDDEN_CROSS_REQUESTER_TRANSITION'
    | 'INSUFFICIENT_ROLE_FOR_TRANSITION'
    | 'ESCALATION_ADJUDICATION_REQUIRED';
  message: string;
}

/**
 * Evaluates both state-machine validity and role-based workflow authorization
 * for a requested ticket lifecycle transition (Phase 5 Sections 2, 7, 8, 11).
 */
export function evaluateTransitionAuthorization(params: {
  actorRole: ActorRole;
  previousState: RequestStatus;
  newState: RequestStatus;
  isTicketOwner: boolean;
}): TransitionAuthorizationEvaluation {
  const { actorRole, previousState, newState, isTicketOwner } = params;

  if (!isValidLifecycleTransition(previousState, newState)) {
    return {
      authorized: false,
      code: 'INVALID_LIFECYCLE_TRANSITION',
      message: `Documented lifecycle rules do not permit transitioning from '${previousState}' to '${newState}'.`,
    };
  }

  const isRequesterRole =
    actorRole === ActorRole.Learner || actorRole === ActorRole.Instructor;

  if (isRequesterRole) {
    if (!isTicketOwner) {
      return {
        authorized: false,
        code: 'FORBIDDEN_CROSS_REQUESTER_TRANSITION',
        message: `Role '${actorRole}' may only perform lifecycle actions on their own tickets.`,
      };
    }

    const requesterAllowed =
      (previousState === RequestStatus.Draft &&
        newState === RequestStatus.Submitted) ||
      (previousState === RequestStatus.Resolved &&
        (newState === RequestStatus.Closed ||
          newState === RequestStatus.Escalated));

    if (!requesterAllowed) {
      return {
        authorized: false,
        code: 'INSUFFICIENT_ROLE_FOR_TRANSITION',
        message: `Role '${actorRole}' is not authorized to transition a ticket from '${previousState}' to '${newState}'. Only Support Staff and Administrators may triage, verify policy, escalate active operational tickets, or mark tickets resolved.`,
      };
    }

    return {
      authorized: true,
      code: 'AUTHORIZED',
      message: `Requester transition from '${previousState}' to '${newState}' is authorized.`,
    };
  }

  // SupportStaff cannot clear, de-escalate, or resolve an already-escalated ticket;
  // Escalation adjudication requires AcademicAdministrator or PlatformAdministrator.
  if (
    previousState === RequestStatus.Escalated &&
    actorRole === ActorRole.SupportStaff
  ) {
    return {
      authorized: false,
      code: 'ESCALATION_ADJUDICATION_REQUIRED',
      message: `Ticket is currently in 'escalated' state. Only AcademicAdministrator or PlatformAdministrator roles are authorized to adjudicate, de-escalate, or resolve an escalated ticket.`,
    };
  }

  return {
    authorized: true,
    code: 'AUTHORIZED',
    message: `Role '${actorRole}' is authorized to transition from '${previousState}' to '${newState}'.`,
  };
}

/**
 * Returns the list of next lifecycle states that are both valid in the state machine
 * and permitted for the given actor role and ownership status.
 */
export function getPermittedNextLifecycleStatesForActor(
  currentState: RequestStatus,
  actorRole: ActorRole,
  isTicketOwner: boolean
): RequestStatus[] {
  const candidates = ALLOWED_LIFECYCLE_TRANSITIONS[currentState] || [];
  return candidates.filter(
    (nextState) =>
      evaluateTransitionAuthorization({
        actorRole,
        previousState: currentState,
        newState: nextState,
        isTicketOwner,
      }).authorized
  );
}

/**
 * Validates resolution requirements (Phase 5 Section 8):
 * A ticket cannot be marked `resolved` without required resolution details and an authorized actor.
 */
export function validateResolutionTransition(params: {
  previousState: RequestStatus;
  newState: RequestStatus;
  actorRole: ActorRole;
  isTicketOwner: boolean;
  reason: string;
  resolutionSummary?: string | null;
}): {
  valid: boolean;
  code: string;
  message: string;
  effectiveResolutionSummary: string;
} {
  const authEval = evaluateTransitionAuthorization({
    actorRole: params.actorRole,
    previousState: params.previousState,
    newState: params.newState,
    isTicketOwner: params.isTicketOwner,
  });

  if (!authEval.authorized) {
    return {
      valid: false,
      code: authEval.code,
      message: authEval.message,
      effectiveResolutionSummary: '',
    };
  }

  const effectiveSummary = (
    params.resolutionSummary?.trim() || params.reason.trim()
  ).trim();

  if (
    params.newState === RequestStatus.Resolved &&
    effectiveSummary.length < 10
  ) {
    return {
      valid: false,
      code: 'MISSING_RESOLUTION_DETAILS',
      message:
        'A ticket cannot be marked resolved without a substantive resolution summary (minimum 10 characters).',
      effectiveResolutionSummary: '',
    };
  }

  return {
    valid: true,
    code: 'VALID',
    message: 'Resolution transition validated.',
    effectiveResolutionSummary: effectiveSummary,
  };
}

export const DOCUMENTED_ASSIGNMENT_TEAMS: readonly string[] = [
  DOCUMENTED_ROUTING_RULES['Financial Aid'].primary_assigned_team,
  DOCUMENTED_ROUTING_RULES['Financial Aid'].escalation_assigned_team,
  DOCUMENTED_ROUTING_RULES.Registration.primary_assigned_team,
  DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team,
  DOCUMENTED_ROUTING_RULES.IT.primary_assigned_team,
  DOCUMENTED_ROUTING_RULES.IT.escalation_assigned_team,
  DOCUMENTED_ROUTING_RULES.Accessibility.primary_assigned_team,
  DOCUMENTED_ROUTING_RULES.Accessibility.escalation_assigned_team,
  UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team,
] as const;

export function evaluateReassignmentAuthorization(actorRole: ActorRole): {
  authorized: boolean;
  code: 'AUTHORIZED' | 'FORBIDDEN_REASSIGNMENT';
  message: string;
} {
  if (
    actorRole === ActorRole.SupportStaff ||
    actorRole === ActorRole.AcademicAdministrator ||
    actorRole === ActorRole.PlatformAdministrator
  ) {
    return {
      authorized: true,
      code: 'AUTHORIZED',
      message: `Role '${actorRole}' is authorized to reassign tickets.`,
    };
  }

  return {
    authorized: false,
    code: 'FORBIDDEN_REASSIGNMENT',
    message: `Role '${actorRole}' is not authorized to assign tickets to themselves or modify assigned teams.`,
  };
}

export function createReassignmentRecord(params: {
  ticketId: string;
  category: OfficialCategoryName;
  targetTeam: string;
  reason: string;
  assignedAtIso: string;
  previousAssignment: AssignmentRecord | null;
  sequenceNumber: number;
  actorRole: ActorRole;
  requiresHumanReview?: boolean;
}): AssignmentRecord {
  const auth = evaluateReassignmentAuthorization(params.actorRole);
  if (!auth.authorized) {
    throw new Error(`${auth.code}: ${auth.message}`);
  }

  const trimmedTeam = params.targetTeam.trim();
  const trimmedReason = params.reason.trim();
  if (!trimmedTeam || trimmedReason.length < 5) {
    throw new Error(
      'VALIDATION_ERROR: Reassignment requires a targetTeam and a reason of at least 5 characters.'
    );
  }

  // Match documented rule or human triage rule
  let matchedRuleId = DOCUMENTED_ROUTING_RULES[params.category].rule_id;
  let matchedActorRole: ActorRole = ActorRole.SupportStaff;
  let matchedActorId = `ACTOR-OPS-${DOCUMENTED_ROUTING_RULES[params.category].domain_code}`;
  let isEscalationTeam = false;

  for (const rule of Object.values(DOCUMENTED_ROUTING_RULES)) {
    if (rule.primary_assigned_team === trimmedTeam) {
      matchedRuleId = rule.rule_id;
      matchedActorRole = rule.default_actor_role;
      matchedActorId = `ACTOR-OPS-${rule.domain_code}`;
      break;
    }
    if (rule.escalation_assigned_team === trimmedTeam) {
      matchedRuleId = rule.rule_id;
      matchedActorRole = rule.escalation_actor_role;
      matchedActorId = `ACTOR-ESC-${rule.domain_code}`;
      isEscalationTeam = true;
      break;
    }
  }

  if (trimmedTeam === UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team) {
    matchedRuleId = UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id;
    matchedActorRole = UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_actor_role;
    matchedActorId = 'ACTOR-TRIAGE-QUEUE';
    isEscalationTeam = true;
  }

  return {
    assignment_id: formatAssignmentId(params.ticketId, params.sequenceNumber),
    ticket_id: params.ticketId,
    sequence_number: params.sequenceNumber,
    assigned_team: trimmedTeam,
    assigned_actor_id: matchedActorId,
    assigned_actor_role: matchedActorRole,
    routing_rule_id: matchedRuleId,
    assignment_reason: trimmedReason,
    previous_assignment_id: params.previousAssignment?.assignment_id ?? null,
    previous_assigned_team: params.previousAssignment?.assigned_team ?? null,
    requires_human_review:
      params.requiresHumanReview ??
      (isEscalationTeam ||
        Boolean(params.previousAssignment?.requires_human_review)),
    is_active: true,
    assigned_at: params.assignedAtIso,
    unassigned_at: null,
  };
}

export function createLifecycleEvent(params: {
  ticketId: string;
  eventSequence: number;
  previousState: RequestStatus | null;
  newState: RequestStatus;
  actorId: string;
  actorRole: ActorRole;
  reason: string;
  timestampIso: string;
  referencedPolicyId?: string | null;
  referencedPolicyVersion?: string | null;
  referencedArticleId?: string | null;
  referencedArticleVersion?: string | null;
}): TicketLifecycleEventRecord {
  if (!isValidLifecycleTransition(params.previousState, params.newState)) {
    throw new Error(
      `INVALID_LIFECYCLE_TRANSITION: Cannot transition ticket ${params.ticketId} from '${params.previousState}' to '${params.newState}'.`
    );
  }

  return {
    event_id: `EVT-${params.ticketId}-${String(params.eventSequence).padStart(3, '0')}`,
    ticket_id: params.ticketId,
    previous_state: params.previousState,
    new_state: params.newState,
    actor_id: params.actorId,
    actor_role: params.actorRole,
    reason: params.reason,
    referenced_policy_id: params.referencedPolicyId ?? null,
    referenced_policy_version: params.referencedPolicyVersion ?? null,
    referenced_article_id: params.referencedArticleId ?? null,
    referenced_article_version: params.referencedArticleVersion ?? null,
    event_timestamp: params.timestampIso,
  };
}


// ============================================================================
// 4. CONFIGURABLE SLA RULES, BUSINESS-HOUR ENGINE & ESCALATION ENGINEERING (Phase 7)
// ============================================================================

export interface ConfigurableBusinessSchedule {
  schedule_code: string;
  classification: SLARuleClassification;
  description: string;
  workday_start_hour_utc: number; // e.g. 8 (08:00 UTC)
  workday_end_hour_utc: number; // e.g. 17 (17:00 UTC -> 9 hours = 540 min/day)
  working_days_of_week: readonly number[]; // 1=Mon .. 5=Fri
  timezone_name?: string; // PROPOSED_CONFIGURABLE_RULE (default 'UTC')
  holiday_dates_utc?: readonly string[]; // PROPOSED_CONFIGURABLE_RULE (array of 'YYYY-MM-DD' excluded dates)
}

/**
 * Proposed configurable holiday calendar for optional operating-calendar exclusion.
 * Explicitly classified as a PROPOSED_CONFIGURABLE_RULE (not an official YottaFlex requirement).
 */
export const CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026: readonly string[] = [
  '2026-01-01', // New Year's Day (Configurable Holiday Assumption)
  '2026-01-19', // MLK Jr. Academic Holiday (Configurable Holiday Assumption)
  '2026-05-25', // Memorial Day Recess (Configurable Holiday Assumption)
  '2026-07-03', // Independence Day Observed (Configurable Holiday Assumption)
  '2026-09-07', // Labor Day Recess (Configurable Holiday Assumption)
  '2026-11-26', // Thanksgiving Recess Day 1 (Configurable Holiday Assumption)
  '2026-11-27', // Thanksgiving Recess Day 2 (Configurable Holiday Assumption)
  '2026-12-25', // Winter Institutional Closure (Configurable Holiday Assumption)
] as const;

/**
 * Proposed configurable approaching-deadline threshold ratio (75% of target business minutes elapsed,
 * i.e. <= 25% of target business minutes remaining).
 * Explicitly classified as a PROPOSED_CONFIGURABLE_RULE (not an official YottaFlex requirement).
 */
export const DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO = 0.75;

export const DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE: ConfigurableBusinessSchedule =
  {
    schedule_code: 'SCHED-CONFIG-MON-FRI-0800-1700-UTC',
    classification: 'PROPOSED_CONFIGURABLE_RULE',
    description:
      'Configurable institutional business schedule (Monday–Friday, 08:00–17:00 UTC, 540 business minutes per day; excludes weekends and configured holiday dates). Explicitly marked as a proposed configurable schedule rather than a hardcoded institutional regulation.',
    workday_start_hour_utc: 8,
    workday_end_hour_utc: 17,
    working_days_of_week: [1, 2, 3, 4, 5],
    timezone_name: 'UTC',
    holiday_dates_utc: [],
  };

export interface ConfigurableSlaRule {
  sla_rule_id: string;
  category_name: OfficialCategoryName;
  classification: SLARuleClassification;
  target_business_minutes: number;
  approaching_threshold_ratio?: number;
  schedule_code: string;
  rule_note: string;
}

export const CONFIGURABLE_SLA_RULES: Record<
  OfficialCategoryName,
  ConfigurableSlaRule
> = {
  'Financial Aid': {
    sla_rule_id: 'SLA-RULE-FINAID-CFG-01',
    category_name: 'Financial Aid',
    classification: 'PROPOSED_CONFIGURABLE_RULE',
    target_business_minutes: 1080, // 2 configurable business days (18 business hours)
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note:
      'Proposed configurable target: 1,080 business minutes (2 business days under 08:00–17:00 UTC Mon–Fri schedule; approaching threshold at 75% / 810 business minutes).',
  },
  Registration: {
    sla_rule_id: 'SLA-RULE-REG-CFG-01',
    category_name: 'Registration',
    classification: 'PROPOSED_CONFIGURABLE_RULE',
    target_business_minutes: 540, // 1 configurable business day (9 business hours)
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note:
      'Proposed configurable target: 540 business minutes (1 business day under 08:00–17:00 UTC Mon–Fri schedule; approaching threshold at 75% / 405 business minutes).',
  },
  IT: {
    sla_rule_id: 'SLA-RULE-IT-CFG-01',
    category_name: 'IT',
    classification: 'PROPOSED_CONFIGURABLE_RULE',
    target_business_minutes: 240, // 4 configurable business hours
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note:
      'Proposed configurable target: 240 business minutes (4 business hours under 08:00–17:00 UTC Mon–Fri schedule; approaching threshold at 75% / 180 business minutes).',
  },
  Accessibility: {
    sla_rule_id: 'SLA-RULE-ACCESS-CFG-01',
    category_name: 'Accessibility',
    classification: 'PROPOSED_CONFIGURABLE_RULE',
    target_business_minutes: 540, // 1 configurable business day (9 business hours)
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note:
      'Proposed configurable target: 540 business minutes (1 business day under 08:00–17:00 UTC Mon–Fri schedule; approaching threshold at 75% / 405 business minutes).',
  },
};

export interface SlaConfigurationValidationResult {
  valid: boolean;
  code:
    | 'VALID'
    | 'INVALID_SLA_CATEGORY'
    | 'INVALID_SLA_TARGET_MINUTES'
    | 'INVALID_BUSINESS_SCHEDULE'
    | 'INVALID_SLA_TIMESTAMPS'
    | 'INVALID_APPROACHING_THRESHOLD';
  message: string;
}

/**
 * Phase 7 Exception Scenario 9: Validates SLA rule, business schedule, threshold, and timestamps
 * so invalid or missing SLA configurations fail safely with a deterministic diagnostic.
 */
export function validateSlaConfiguration(params: {
  category?: string | null;
  customRule?: Partial<ConfigurableSlaRule> | null;
  schedule?: Partial<ConfigurableBusinessSchedule> | null;
  startTimestampIso?: string | null;
  evaluatedTimestampIso?: string | null;
  approachingThresholdRatio?: number | null;
}): SlaConfigurationValidationResult {
  const category = params.category as OfficialCategoryName | undefined;
  const baseRule =
    category && OFFICIAL_CATEGORIES.includes(category)
      ? CONFIGURABLE_SLA_RULES[category]
      : null;

  if (!baseRule && !params.customRule) {
    return {
      valid: false,
      code: 'INVALID_SLA_CATEGORY',
      message: `Invalid or missing SLA category '${String(params.category ?? '')}'. Must be one of the 4 official categories (${OFFICIAL_CATEGORIES.join(', ')}) or provide a valid custom SLA rule.`,
    };
  }

  const targetMinutes =
    params.customRule?.target_business_minutes !== undefined
      ? params.customRule.target_business_minutes
      : baseRule?.target_business_minutes;

  if (
    typeof targetMinutes !== 'number' ||
    !Number.isFinite(targetMinutes) ||
    targetMinutes <= 0
  ) {
    return {
      valid: false,
      code: 'INVALID_SLA_TARGET_MINUTES',
      message: `Invalid SLA target_business_minutes (${String(targetMinutes)}). Must be a positive finite integer.`,
    };
  }

  const sched = params.schedule ?? DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;
  const startHour = sched.workday_start_hour_utc;
  const endHour = sched.workday_end_hour_utc;
  const workingDays = sched.working_days_of_week;

  if (
    typeof startHour !== 'number' ||
    typeof endHour !== 'number' ||
    !Number.isFinite(startHour) ||
    !Number.isFinite(endHour) ||
    startHour < 0 ||
    endHour > 24 ||
    startHour >= endHour ||
    !Array.isArray(workingDays) ||
    workingDays.length === 0 ||
    workingDays.some((d) => typeof d !== 'number' || d < 0 || d > 6)
  ) {
    return {
      valid: false,
      code: 'INVALID_BUSINESS_SCHEDULE',
      message:
        'Invalid business schedule configuration: workday_start_hour_utc must be < workday_end_hour_utc within [0, 24], and working_days_of_week must contain at least one valid weekday [0..6].',
    };
  }

  if (params.startTimestampIso !== undefined) {
    const startMs = Date.parse(String(params.startTimestampIso || ''));
    if (isNaN(startMs)) {
      return {
        valid: false,
        code: 'INVALID_SLA_TIMESTAMPS',
        message: `Invalid SLA start_timestamp '${String(params.startTimestampIso)}'.`,
      };
    }
    if (params.evaluatedTimestampIso !== undefined) {
      const evalMs = Date.parse(String(params.evaluatedTimestampIso || ''));
      if (isNaN(evalMs) || evalMs < startMs) {
        return {
          valid: false,
          code: 'INVALID_SLA_TIMESTAMPS',
          message: `Invalid SLA evaluated_timestamp '${String(params.evaluatedTimestampIso)}' (must be a valid ISO timestamp >= start_timestamp '${String(params.startTimestampIso)}').`,
        };
      }
    }
  }

  const ratio =
    params.approachingThresholdRatio ??
    params.customRule?.approaching_threshold_ratio ??
    baseRule?.approaching_threshold_ratio ??
    DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO;

  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    return {
      valid: false,
      code: 'INVALID_APPROACHING_THRESHOLD',
      message: `Invalid approaching_threshold_ratio (${String(ratio)}). Must be strictly between 0 and 1 (e.g. 0.75).`,
    };
  }

  return {
    valid: true,
    code: 'VALID',
    message: 'SLA configuration is valid.',
  };
}

/**
 * Formats a UTC Date object into 'YYYY-MM-DD' for holiday calendar lookup.
 */
function formatUtcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Deterministically computes elapsed business minutes between two UTC timestamps
 * under a configurable business schedule (including optional holiday exclusions).
 */
export function calculateElapsedBusinessMinutes(
  startIso: string,
  endIso: string,
  schedule: ConfigurableBusinessSchedule = DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
): number {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
    return 0;
  }

  const holidaySet = new Set(schedule.holiday_dates_utc ?? []);

  let totalBusinessMinutes = 0;
  const cursor = new Date(startMs);
  cursor.setUTCHours(0, 0, 0, 0);

  const endDayBound = new Date(endMs);
  endDayBound.setUTCHours(23, 59, 59, 999);

  while (cursor.getTime() <= endDayBound.getTime()) {
    const dayOfWeek = cursor.getUTCDay(); // 0=Sun .. 6=Sat
    const dateKey = formatUtcDateKey(cursor);
    const isHoliday = holidaySet.has(dateKey);

    if (schedule.working_days_of_week.includes(dayOfWeek) && !isHoliday) {
      const windowStartMs = Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
        schedule.workday_start_hour_utc,
        0,
        0,
        0
      );
      const windowEndMs = Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
        schedule.workday_end_hour_utc,
        0,
        0,
        0
      );

      const overlapStart = Math.max(startMs, windowStartMs);
      const overlapEnd = Math.min(endMs, windowEndMs);

      if (overlapEnd > overlapStart) {
        totalBusinessMinutes += Math.round((overlapEnd - overlapStart) / 60000);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return totalBusinessMinutes;
}

/**
 * Deterministically computes the due timestamp by advancing `targetBusinessMinutes`
 * along the configured business schedule (skipping weekends and configured holidays).
 */
export function calculateDueTimestampByBusinessMinutes(
  startIso: string,
  targetBusinessMinutes: number,
  schedule: ConfigurableBusinessSchedule = DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
): string {
  let remainingMinutes = Math.max(1, Math.round(targetBusinessMinutes));
  let cursorMs = Date.parse(startIso);
  if (isNaN(cursorMs)) {
    return new Date().toISOString();
  }

  const holidaySet = new Set(schedule.holiday_dates_utc ?? []);

  // Safeguard max 180 calendar days iteration
  for (let i = 0; i < 180 && remainingMinutes > 0; i++) {
    const cursorDate = new Date(cursorMs);
    const dayOfWeek = cursorDate.getUTCDay();
    const dateKey = formatUtcDateKey(cursorDate);
    const isHoliday = holidaySet.has(dateKey);

    const windowStartMs = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate(),
      schedule.workday_start_hour_utc,
      0,
      0,
      0
    );
    const windowEndMs = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate(),
      schedule.workday_end_hour_utc,
      0,
      0,
      0
    );

    if (
      schedule.working_days_of_week.includes(dayOfWeek) &&
      !isHoliday &&
      cursorMs < windowEndMs
    ) {
      const effectiveStartMs = Math.max(cursorMs, windowStartMs);
      const availableMinutesToday = Math.floor(
        (windowEndMs - effectiveStartMs) / 60000
      );

      if (remainingMinutes <= availableMinutesToday) {
        return new Date(
          effectiveStartMs + remainingMinutes * 60000
        ).toISOString();
      }

      remainingMinutes -= availableMinutesToday;
    }

    // Advance cursor to workday_start_hour_utc of the next calendar day
    const nextDay = new Date(windowStartMs);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    cursorMs = nextDay.getTime();
  }

  return new Date(cursorMs).toISOString();
}

export interface BuildSlaRecordInput {
  ticketId: string;
  category: OfficialCategoryName;
  startTimestampIso: string;
  evaluatedTimestampIso: string;
  isTicketEscalated: boolean;
  requiresEscalation: boolean;
  calculationMode?: SLACalculationMode;
  ruleClassification?: SLARuleClassification;
  schedule?: ConfigurableBusinessSchedule;
  customRule?: Partial<ConfigurableSlaRule>;
  approachingThresholdRatio?: number;
  firstResponseTimestampIso?: string | null;
  resolvedTimestampIso?: string | null;
  lifecycleStatus?: RequestStatus;
}

/**
 * Strips Phase 7 derived runtime fields from an SLARecord so inserts and updates
 * to `public.slas` in Supabase PostgreSQL only include existing database columns.
 */
export function toDbSlaRow(sla: SLARecord): Omit<
  SLARecord,
  | 'sla_status'
  | 'is_approaching_deadline'
  | 'approaching_threshold_ratio'
  | 'approaching_threshold_business_minutes'
  | 'remaining_business_minutes'
  | 'remaining_wall_clock_minutes'
  | 'overdue_business_minutes'
  | 'overdue_wall_clock_minutes'
  | 'first_response_timestamp'
  | 'actual_response_business_minutes'
  | 'actual_response_wall_clock_minutes'
  | 'resolved_timestamp'
  | 'resolution_business_minutes'
  | 'resolution_wall_clock_minutes'
  | 'holiday_dates_excluded_utc'
  | 'timezone_name'
  | 'configuration_valid'
  | 'configuration_error_code'
  | 'configuration_error_message'
  | 'calculation_history'
> {
  return {
    sla_id: sla.sla_id,
    ticket_id: sla.ticket_id,
    sla_rule_id: sla.sla_rule_id,
    applicable_category: sla.applicable_category,
    rule_classification: sla.rule_classification,
    target_business_minutes: sla.target_business_minutes,
    start_timestamp: sla.start_timestamp,
    due_timestamp: sla.due_timestamp,
    evaluated_timestamp: sla.evaluated_timestamp,
    elapsed_wall_clock_minutes: sla.elapsed_wall_clock_minutes,
    elapsed_business_minutes: sla.elapsed_business_minutes,
    calculation_mode: sla.calculation_mode,
    business_schedule_code: sla.business_schedule_code,
    breach_status: sla.breach_status,
    escalation_status: sla.escalation_status,
    calculation_explanation: sla.calculation_explanation,
    created_at: sla.created_at,
    ...(sla.updated_at ? { updated_at: sla.updated_at } : {}),
  };
}

/**
 * Builds a reproducible SLARecord (`SLA-<ticket-id>`) with full Phase 7 calculation metrics,
 * approaching-deadline detection, response & resolution times, remaining/overdue durations,
 * and step-by-step calculation history.
 */
export function buildReproducibleSlaRecord(
  input: BuildSlaRecordInput
): SLARecord {
  const schedule = input.schedule ?? DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;
  const configValidation = validateSlaConfiguration({
    category: input.category,
    customRule: input.customRule,
    schedule,
    startTimestampIso: input.startTimestampIso,
    evaluatedTimestampIso: input.evaluatedTimestampIso,
    approachingThresholdRatio: input.approachingThresholdRatio,
  });

  const fallbackCategory: OfficialCategoryName = OFFICIAL_CATEGORIES.includes(
    input.category
  )
    ? input.category
    : 'Registration';
  const baseRule = CONFIGURABLE_SLA_RULES[fallbackCategory];
  const targetBusinessMinutes =
    input.customRule?.target_business_minutes &&
    input.customRule.target_business_minutes > 0
      ? input.customRule.target_business_minutes
      : baseRule.target_business_minutes;
  const slaRuleId = input.customRule?.sla_rule_id || baseRule.sla_rule_id;

  const mode: SLACalculationMode =
    input.calculationMode ?? 'business_hours_configured';
  const classification: SLARuleClassification =
    input.ruleClassification ??
    input.customRule?.classification ??
    baseRule.classification;

  const approachingRatio =
    input.approachingThresholdRatio ??
    input.customRule?.approaching_threshold_ratio ??
    baseRule.approaching_threshold_ratio ??
    DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO;
  const safeApproachingRatio =
    typeof approachingRatio === 'number' &&
    approachingRatio > 0 &&
    approachingRatio < 1
      ? approachingRatio
      : DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO;
  const approachingThresholdMinutes = Math.ceil(
    targetBusinessMinutes * safeApproachingRatio
  );

  const rawStartMs = Date.parse(input.startTimestampIso);
  const startMs = isNaN(rawStartMs) ? Date.now() : rawStartMs;
  const startIso = new Date(startMs).toISOString();

  // If the ticket is resolved, cap the SLA evaluation clock at resolved_at unless explicitly evaluating a later point
  const resolvedIso = input.resolvedTimestampIso || null;
  const resolvedMs = resolvedIso ? Date.parse(resolvedIso) : NaN;
  const effectiveEvalIso =
    !isNaN(resolvedMs) && resolvedMs >= startMs
      ? resolvedIso!
      : input.evaluatedTimestampIso;

  const rawEvalMs = Date.parse(effectiveEvalIso);
  const evalMs = isNaN(rawEvalMs) ? startMs : Math.max(startMs, rawEvalMs);
  const evalIso = new Date(evalMs).toISOString();

  const elapsedWallClockMinutes = Math.round((evalMs - startMs) / 60000);
  const elapsedBusinessMinutes = configValidation.valid
    ? calculateElapsedBusinessMinutes(startIso, evalIso, schedule)
    : 0;

  const dueTimestamp = configValidation.valid
    ? calculateDueTimestampByBusinessMinutes(
        startIso,
        targetBusinessMinutes,
        schedule
      )
    : startIso;
  const dueMs = Date.parse(dueTimestamp);

  // When calculationMode === 'wall_clock_24x7', the SLA clock erroneously compares raw 24x7 wall-clock
  // elapsed minutes against target_business_minutes (Anomaly Scenario 4: SLA clock ignores business hours).
  const observedElapsedForBreach =
    mode === 'wall_clock_24x7'
      ? elapsedWallClockMinutes
      : elapsedBusinessMinutes;

  const breachStatus = configValidation.valid
    ? observedElapsedForBreach > targetBusinessMinutes
    : false;

  const isResolvedOrClosed =
    Boolean(resolvedIso && !isNaN(resolvedMs)) ||
    input.lifecycleStatus === RequestStatus.Resolved ||
    input.lifecycleStatus === RequestStatus.Closed;

  const remainingBusinessMinutes = isResolvedOrClosed
    ? 0
    : Math.max(0, targetBusinessMinutes - observedElapsedForBreach);

  const remainingWallClockMinutes = isResolvedOrClosed
    ? 0
    : Math.max(0, Math.round((dueMs - evalMs) / 60000));

  const overdueBusinessMinutes = breachStatus
    ? Math.max(0, observedElapsedForBreach - targetBusinessMinutes)
    : 0;

  const overdueWallClockMinutes = breachStatus
    ? Math.max(0, Math.round((evalMs - dueMs) / 60000))
    : 0;

  const isApproachingDeadline =
    configValidation.valid &&
    !breachStatus &&
    !isResolvedOrClosed &&
    observedElapsedForBreach >= approachingThresholdMinutes;

  // Actual first response metrics (where recorded)
  let firstResponseTimestamp: string | null = null;
  let actualResponseBusinessMinutes: number | null = null;
  let actualResponseWallClockMinutes: number | null = null;
  if (input.firstResponseTimestampIso) {
    const respMs = Date.parse(input.firstResponseTimestampIso);
    if (!isNaN(respMs) && respMs >= startMs) {
      firstResponseTimestamp = new Date(respMs).toISOString();
      actualResponseWallClockMinutes = Math.round((respMs - startMs) / 60000);
      actualResponseBusinessMinutes = configValidation.valid
        ? calculateElapsedBusinessMinutes(
            startIso,
            firstResponseTimestamp,
            schedule
          )
        : 0;
    }
  }

  // Resolution time metrics (where recorded)
  let resolvedTimestamp: string | null = null;
  let resolutionBusinessMinutes: number | null = null;
  let resolutionWallClockMinutes: number | null = null;
  if (!isNaN(resolvedMs) && resolvedMs >= startMs) {
    resolvedTimestamp = new Date(resolvedMs).toISOString();
    resolutionWallClockMinutes = Math.round((resolvedMs - startMs) / 60000);
    resolutionBusinessMinutes = configValidation.valid
      ? calculateElapsedBusinessMinutes(startIso, resolvedTimestamp, schedule)
      : 0;
  }

  let slaStatus: SLAOperationalStatus = 'within_sla';
  if (!configValidation.valid) {
    slaStatus = 'invalid_configuration';
  } else if (isResolvedOrClosed) {
    slaStatus = breachStatus ? 'resolved_after_breach' : 'resolved_within_sla';
  } else if (breachStatus) {
    slaStatus = 'breached';
  } else if (isApproachingDeadline) {
    slaStatus = 'approaching_deadline';
  }

  // Preserve exact escalation_status semantics for existing benchmark checks while supporting pending_escalation
  let escalationStatus: SLAEscalationStatus = 'not_required';
  if (input.isTicketEscalated) {
    escalationStatus = 'escalated';
  } else if (input.requiresEscalation || breachStatus) {
    escalationStatus = 'escalation_missed';
  } else if (isApproachingDeadline) {
    escalationStatus = 'pending_escalation';
  }

  const calculationHistory: SLACalculationHistoryStep[] = [
    {
      step_index: 1,
      step_code: 'SLA_CLOCK_INITIALIZED',
      recorded_at: startIso,
      description: `SLA clock anchored at ticket submission (${startIso}) under rule ${slaRuleId} (${classification}, target=${targetBusinessMinutes} business minutes).`,
    },
    {
      step_index: 2,
      step_code: 'OPERATING_CALENDAR_APPLIED',
      recorded_at: startIso,
      description: `Applied configurable schedule ${schedule.schedule_code} (timezone=${schedule.timezone_name || 'UTC'}, hours=${schedule.workday_start_hour_utc}:00-${schedule.workday_end_hour_utc}:00, holidays_excluded=${(schedule.holiday_dates_utc || []).length}) -> due_timestamp=${dueTimestamp}.`,
    },
  ];

  if (firstResponseTimestamp !== null) {
    calculationHistory.push({
      step_index: calculationHistory.length + 1,
      step_code: 'FIRST_RESPONSE_RECORDED',
      recorded_at: firstResponseTimestamp,
      description: `First staff/system response recorded at ${firstResponseTimestamp} (${actualResponseBusinessMinutes} business mins / ${actualResponseWallClockMinutes} wall-clock mins).`,
    });
  }

  if (resolvedTimestamp !== null) {
    calculationHistory.push({
      step_index: calculationHistory.length + 1,
      step_code: 'RESOLUTION_RECORDED',
      recorded_at: resolvedTimestamp,
      description: `Ticket resolution recorded at ${resolvedTimestamp} (${resolutionBusinessMinutes} business mins / ${resolutionWallClockMinutes} wall-clock mins).`,
    });
  }

  calculationHistory.push({
    step_index: calculationHistory.length + 1,
    step_code: 'SLA_STATUS_EVALUATED',
    recorded_at: evalIso,
    description: !configValidation.valid
      ? `Configuration validation failed (${configValidation.code}): ${configValidation.message}`
      : `Evaluated at ${evalIso} (${mode}): elapsed_business=${elapsedBusinessMinutes}m, remaining_business=${remainingBusinessMinutes}m, overdue_business=${overdueBusinessMinutes}m, approaching_threshold=${approachingThresholdMinutes}m (${Math.round(safeApproachingRatio * 100)}%) -> sla_status=${slaStatus}, breach_status=${breachStatus}, escalation_status=${escalationStatus}.`,
  });

  const calculationExplanation = !configValidation.valid
    ? `INVALID_SLA_CONFIGURATION (${configValidation.code}): ${configValidation.message}`
    : mode === 'business_hours_configured'
    ? `Calculated under ${schedule.schedule_code} (${classification}): start=${startIso}, evaluated=${evalIso}, elapsed_business_minutes=${elapsedBusinessMinutes}m (wall_clock=${elapsedWallClockMinutes}m) vs target=${targetBusinessMinutes}m (approaching_at=${approachingThresholdMinutes}m, remaining=${remainingBusinessMinutes}m, overdue=${overdueBusinessMinutes}m) -> sla_status=${slaStatus}, breach_status=${breachStatus}.`
    : `ANOMALY_MODE (wall_clock_24x7): SLA clock ignored business schedule ${schedule.schedule_code} and compared raw wall_clock=${elapsedWallClockMinutes}m directly against target=${targetBusinessMinutes}m (true business elapsed=${elapsedBusinessMinutes}m) -> observed breach_status=${breachStatus}.`;

  return {
    sla_id: formatSlaId(input.ticketId),
    ticket_id: input.ticketId,
    sla_rule_id: slaRuleId,
    applicable_category: fallbackCategory,
    rule_classification: classification,
    target_business_minutes: targetBusinessMinutes,
    start_timestamp: startIso,
    due_timestamp: dueTimestamp,
    evaluated_timestamp: evalIso,
    elapsed_wall_clock_minutes: elapsedWallClockMinutes,
    elapsed_business_minutes: elapsedBusinessMinutes,
    calculation_mode: mode,
    business_schedule_code: schedule.schedule_code,
    breach_status: breachStatus,
    escalation_status: escalationStatus,
    calculation_explanation: calculationExplanation,
    created_at: evalIso,
    sla_status: slaStatus,
    is_approaching_deadline: isApproachingDeadline,
    approaching_threshold_ratio: safeApproachingRatio,
    approaching_threshold_business_minutes: approachingThresholdMinutes,
    remaining_business_minutes: remainingBusinessMinutes,
    remaining_wall_clock_minutes: remainingWallClockMinutes,
    overdue_business_minutes: overdueBusinessMinutes,
    overdue_wall_clock_minutes: overdueWallClockMinutes,
    first_response_timestamp: firstResponseTimestamp,
    actual_response_business_minutes: actualResponseBusinessMinutes,
    actual_response_wall_clock_minutes: actualResponseWallClockMinutes,
    resolved_timestamp: resolvedTimestamp,
    resolution_business_minutes: resolutionBusinessMinutes,
    resolution_wall_clock_minutes: resolutionWallClockMinutes,
    holiday_dates_excluded_utc: [...(schedule.holiday_dates_utc || [])],
    timezone_name: schedule.timezone_name || 'UTC',
    configuration_valid: configValidation.valid,
    configuration_error_code: configValidation.valid
      ? null
      : configValidation.code,
    configuration_error_message: configValidation.valid
      ? null
      : configValidation.message,
    calculation_history: calculationHistory,
  };
}

/**
 * Enriches an existing database SLARecord with live Phase 7 operational metrics
 * (remaining time, overdue duration, actual response time, resolution time, approaching deadline,
 * SLA operational status, and calculation history) without losing stored SLA fields.
 */
export function enrichSlaRecordWithOperationalMetrics(params: {
  sla: SLARecord;
  ticket: TicketRecord;
  messages?: MessageRecord[];
  lifecycleEvents?: TicketLifecycleEventRecord[];
  evaluatedAtIso?: string;
  schedule?: ConfigurableBusinessSchedule;
}): SLARecord {
  const { sla, ticket, messages = [], lifecycleEvents = [] } = params;
  const schedule = params.schedule ?? DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;

  // Determine first staff/system response timestamp from messages or lifecycle events
  const staffMsg = messages
    .filter(
      (m) =>
        m.ticket_id === ticket.ticket_id &&
        (m.message_type === 'staff_response' ||
          m.message_type === 'ai_grounded_reply' ||
          m.message_type === 'resolution_summary')
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];

  const firstReviewEvent = lifecycleEvents
    .filter(
      (e) =>
        e.ticket_id === ticket.ticket_id &&
        e.previous_state !== null &&
        e.new_state !== RequestStatus.Draft &&
        e.new_state !== RequestStatus.Submitted
    )
    .sort(
      (a, b) => Date.parse(a.event_timestamp) - Date.parse(b.event_timestamp)
    )[0];

  const firstResponseTimestampIso =
    staffMsg?.created_at || firstReviewEvent?.event_timestamp || null;

  const evalTimestamp =
    ticket.resolved_at ||
    params.evaluatedAtIso ||
    sla.evaluated_timestamp ||
    new Date().toISOString();

  const recomputed = buildReproducibleSlaRecord({
    ticketId: ticket.ticket_id,
    category: sla.applicable_category || ticket.category_name,
    startTimestampIso: sla.start_timestamp || ticket.submitted_at,
    evaluatedTimestampIso: evalTimestamp,
    isTicketEscalated:
      ticket.is_escalated ||
      ticket.lifecycle_status === RequestStatus.Escalated,
    requiresEscalation: ticket.requires_escalation,
    calculationMode: sla.calculation_mode,
    ruleClassification: sla.rule_classification,
    schedule,
    customRule: {
      sla_rule_id: sla.sla_rule_id,
      target_business_minutes: sla.target_business_minutes,
      classification: sla.rule_classification,
    },
    firstResponseTimestampIso,
    resolvedTimestampIso: ticket.resolved_at,
    lifecycleStatus: ticket.lifecycle_status,
  });

  return {
    ...recomputed,
    sla_id: sla.sla_id,
    created_at: sla.created_at,
    updated_at: sla.updated_at,
  };
}

export interface AssignmentRoutingValidationResult {
  valid: boolean;
  code:
    | 'VALID'
    | 'MISSING_OR_INVALID_ASSIGNMENT'
    | 'UNAUTHORIZED_TEAM_ROUTING'
    | 'INVALID_ASSIGNED_ROLE'
    | 'ROUTING_RULE_MISMATCH'
    | 'HUMAN_REVIEW_REQUIRED';
  message: string;
  activeAssignment: AssignmentRecord | null;
  expectedPrimaryTeam: string;
  expectedEscalationTeam: string;
  expectedRoutingRuleId: string;
  requiresHumanReview: boolean;
}

/**
 * Phase 7 Section 4 & Scenarios 4, 5, 6:
 * Validates that a ticket has a valid active assignment, an authorized institutional team
 * matching its category (or human-review queue), a valid routing rule ID, and an authorized
 * assignee actor role (`SupportStaff`, `AcademicAdministrator`, or `PlatformAdministrator`).
 */
export function validateTicketAssignmentAndRouting(params: {
  ticket: Pick<
    TicketRecord,
    | 'ticket_id'
    | 'category_name'
    | 'current_assigned_team'
    | 'current_routing_rule_id'
    | 'lifecycle_status'
    | 'is_escalated'
  >;
  assignments: AssignmentRecord[];
}): AssignmentRoutingValidationResult {
  const { ticket, assignments } = params;
  const ticketAssignments = assignments
    .filter((a) => a.ticket_id === ticket.ticket_id)
    .sort((a, b) => a.sequence_number - b.sequence_number);

  const activeAssignments = ticketAssignments.filter((a) => a.is_active);
  const activeAssignment =
    activeAssignments[activeAssignments.length - 1] ?? null;

  const isOfficialCat = OFFICIAL_CATEGORIES.includes(ticket.category_name);
  const categoryRule = isOfficialCat
    ? DOCUMENTED_ROUTING_RULES[ticket.category_name]
    : null;

  const expectedPrimaryTeam = categoryRule
    ? categoryRule.primary_assigned_team
    : UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
  const expectedEscalationTeam = categoryRule
    ? categoryRule.escalation_assigned_team
    : UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
  const expectedRoutingRuleId = categoryRule
    ? categoryRule.rule_id
    : UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id;

  // Scenario 6: Unmapped category requires human review path
  if (!categoryRule) {
    return {
      valid: false,
      code: 'HUMAN_REVIEW_REQUIRED',
      message: `Ticket ${ticket.ticket_id} has unmapped category '${String(ticket.category_name)}'; must follow human-review triage path (${UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team}).`,
      activeAssignment,
      expectedPrimaryTeam,
      expectedEscalationTeam,
      expectedRoutingRuleId,
      requiresHumanReview: true,
    };
  }

  // Scenario 5: Missing or invalid assignment
  if (
    !activeAssignment ||
    activeAssignments.length !== 1 ||
    !activeAssignment.assigned_team ||
    !activeAssignment.assigned_team.trim() ||
    !ticket.current_assigned_team ||
    !ticket.current_assigned_team.trim()
  ) {
    return {
      valid: false,
      code: 'MISSING_OR_INVALID_ASSIGNMENT',
      message: !activeAssignment
        ? `Ticket ${ticket.ticket_id} has no active assignment record.`
        : activeAssignments.length > 1
        ? `Ticket ${ticket.ticket_id} has ${activeAssignments.length} concurrent active assignments; exactly 1 active assignment is permitted.`
        : `Ticket ${ticket.ticket_id} is missing a valid assigned_team value.`,
      activeAssignment,
      expectedPrimaryTeam,
      expectedEscalationTeam,
      expectedRoutingRuleId,
      requiresHumanReview: true,
    };
  }

  // Validate assigned actor role (Learners and Instructors may NEVER be assigned tickets)
  const validAssigneeRoles: readonly ActorRole[] = [
    ActorRole.SupportStaff,
    ActorRole.AcademicAdministrator,
    ActorRole.PlatformAdministrator,
  ];
  if (!validAssigneeRoles.includes(activeAssignment.assigned_actor_role)) {
    return {
      valid: false,
      code: 'INVALID_ASSIGNED_ROLE',
      message: `Assignment ${activeAssignment.assignment_id} on ticket ${ticket.ticket_id} assigns role '${activeAssignment.assigned_actor_role}', which is unauthorized to receive operational ticket assignments.`,
      activeAssignment,
      expectedPrimaryTeam,
      expectedEscalationTeam,
      expectedRoutingRuleId,
      requiresHumanReview: true,
    };
  }

  // Scenario 6: Assigned to human review triage queue explicitly
  if (
    activeAssignment.assigned_team ===
      UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team ||
    activeAssignment.requires_human_review
  ) {
    const isHumanTriageQueue =
      activeAssignment.assigned_team ===
      UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
    const isCategoryValidTeam =
      activeAssignment.assigned_team === categoryRule.primary_assigned_team ||
      activeAssignment.assigned_team === categoryRule.escalation_assigned_team;

    if (!isHumanTriageQueue && !isCategoryValidTeam) {
      return {
        valid: false,
        code: 'UNAUTHORIZED_TEAM_ROUTING',
        message: `Ticket ${ticket.ticket_id} (category '${ticket.category_name}') is assigned to unauthorized team '${activeAssignment.assigned_team}'. Expected '${categoryRule.primary_assigned_team}' or '${categoryRule.escalation_assigned_team}'.`,
        activeAssignment,
        expectedPrimaryTeam,
        expectedEscalationTeam,
        expectedRoutingRuleId,
        requiresHumanReview: true,
      };
    }

    if (isHumanTriageQueue) {
      return {
        valid: true,
        code: 'HUMAN_REVIEW_REQUIRED',
        message: `Ticket ${ticket.ticket_id} is routed to ${UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team} for manual human review.`,
        activeAssignment,
        expectedPrimaryTeam,
        expectedEscalationTeam,
        expectedRoutingRuleId: UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id,
        requiresHumanReview: true,
      };
    }
  }

  // Scenario 4: Check that assigned_team belongs to this category's documented primary or escalation team
  const isValidCategoryTeam =
    activeAssignment.assigned_team === categoryRule.primary_assigned_team ||
    activeAssignment.assigned_team === categoryRule.escalation_assigned_team;
  const isTicketTeamSynced =
    ticket.current_assigned_team === activeAssignment.assigned_team;

  if (
    !DOCUMENTED_ASSIGNMENT_TEAMS.includes(activeAssignment.assigned_team) ||
    !isValidCategoryTeam ||
    !isTicketTeamSynced
  ) {
    return {
      valid: false,
      code: 'UNAUTHORIZED_TEAM_ROUTING',
      message: !isTicketTeamSynced
        ? `Ticket ${ticket.ticket_id} current_assigned_team ('${ticket.current_assigned_team}') is out of sync with active assignment '${activeAssignment.assigned_team}'.`
        : `Ticket ${ticket.ticket_id} (category '${ticket.category_name}') is routed to unauthorized or cross-category team '${activeAssignment.assigned_team}'. Expected '${categoryRule.primary_assigned_team}' or '${categoryRule.escalation_assigned_team}'.`,
      activeAssignment,
      expectedPrimaryTeam,
      expectedEscalationTeam,
      expectedRoutingRuleId,
      requiresHumanReview: true,
    };
  }

  // Check routing_rule_id integrity
  if (
    activeAssignment.routing_rule_id !== categoryRule.rule_id ||
    ticket.current_routing_rule_id !== categoryRule.rule_id
  ) {
    return {
      valid: false,
      code: 'ROUTING_RULE_MISMATCH',
      message: `Ticket ${ticket.ticket_id} routing rule '${activeAssignment.routing_rule_id}' does not match category '${ticket.category_name}' rule '${categoryRule.rule_id}'.`,
      activeAssignment,
      expectedPrimaryTeam,
      expectedEscalationTeam,
      expectedRoutingRuleId,
      requiresHumanReview: true,
    };
  }

  return {
    valid: true,
    code: 'VALID',
    message: `Assignment ${activeAssignment.assignment_id} and routing rule ${categoryRule.rule_id} validated for category '${ticket.category_name}'.`,
    activeAssignment,
    expectedPrimaryTeam,
    expectedEscalationTeam,
    expectedRoutingRuleId,
    requiresHumanReview: activeAssignment.requires_human_review,
  };
}

export interface EscalationEvaluationTrigger {
  trigger_code: EscalationTriggerCode;
  rule_classification: SLARuleClassification;
  reason: string;
  requires_immediate_escalation: boolean;
}

export interface TicketEscalationEvaluationResult {
  ticketId: string;
  evaluatedAtIso: string;
  sla: SLARecord;
  routingValidation: AssignmentRoutingValidationResult;
  triggers: EscalationEvaluationTrigger[];
  primaryTriggerCode: EscalationTriggerCode | null;
  shouldEscalateNow: boolean;
  isApproachingDeadline: boolean;
  isBreached: boolean;
  isUnresolvedPostEscalation: boolean;
  duplicateEscalationPrevented: boolean;
  deduplicationSignature: string | null;
  recommendedStatus: RequestStatus;
  recommendedAssignedTeam: string;
  recommendedAssignedActorId: string;
  recommendedAssignedActorRole: ActorRole;
  recommendedRoutingRuleId: string;
  combinedEscalationReason: string | null;
}

/**
 * Phase 7 Sections 3, 4, 5, 6:
 * Deterministic Escalation & Exception Evaluation Engine covering:
 * - Approaching SLA deadlines (Scenario 1)
 * - Breached SLAs (Scenario 2)
 * - Unresolved requests after escalation (Scenario 3 — NEVER auto-resolves!)
 * - Unauthorized team routing (Scenario 4)
 * - Missing or invalid assignments (Scenario 5)
 * - Requests requiring human review & AI Policy Assistant escalations (Scenario 6)
 * - Reassignment during active SLA preservation (Scenario 7)
 * - Duplicate escalation & notification deduplication (Scenario 8)
 * - Invalid or missing SLA configuration (Scenario 9)
 */
export function evaluateTicketEscalationAndExceptions(params: {
  ticket: TicketRecord;
  sla?: SLARecord | null;
  assignments: AssignmentRecord[];
  lifecycleEvents?: TicketLifecycleEventRecord[];
  messages?: MessageRecord[];
  notifications?: WorkspaceNotificationRecord[];
  evaluatedAtIso?: string;
  schedule?: ConfigurableBusinessSchedule;
  customSlaRule?: Partial<ConfigurableSlaRule>;
  approachingThresholdRatio?: number;
  escalateOnApproachingDeadline?: boolean;
  aiAssistantEscalationReason?: string | null;
}): TicketEscalationEvaluationResult {
  const {
    ticket,
    assignments,
    lifecycleEvents = [],
    messages = [],
    notifications = [],
  } = params;
  const evaluatedAtIso = params.evaluatedAtIso || new Date().toISOString();
  const schedule = params.schedule ?? DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;

  // 1. Compute or enrich SLA record
  const sla = buildReproducibleSlaRecord({
    ticketId: ticket.ticket_id,
    category: ticket.category_name,
    startTimestampIso: params.sla?.start_timestamp || ticket.submitted_at,
    evaluatedTimestampIso: ticket.resolved_at || evaluatedAtIso,
    isTicketEscalated:
      ticket.is_escalated ||
      ticket.lifecycle_status === RequestStatus.Escalated,
    requiresEscalation: ticket.requires_escalation,
    calculationMode:
      params.sla?.calculation_mode ?? 'business_hours_configured',
    ruleClassification: params.sla?.rule_classification,
    schedule,
    customRule:
      params.customSlaRule ??
      (params.sla
        ? {
            sla_rule_id: params.sla.sla_rule_id,
            target_business_minutes: params.sla.target_business_minutes,
            classification: params.sla.rule_classification,
          }
        : undefined),
    approachingThresholdRatio: params.approachingThresholdRatio,
    firstResponseTimestampIso:
      messages
        .filter(
          (m) =>
            m.ticket_id === ticket.ticket_id &&
            (m.message_type === 'staff_response' ||
              m.message_type === 'ai_grounded_reply' ||
              m.message_type === 'resolution_summary')
        )
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
        ?.created_at || null,
    resolvedTimestampIso: ticket.resolved_at,
    lifecycleStatus: ticket.lifecycle_status,
  });

  // 2. Validate current assignment & routing
  const routingValidation = validateTicketAssignmentAndRouting({
    ticket,
    assignments,
  });

  const isTerminal =
    ticket.lifecycle_status === RequestStatus.Resolved ||
    ticket.lifecycle_status === RequestStatus.Closed;

  const triggers: EscalationEvaluationTrigger[] = [];

  // Scenario 2: SLA Breached
  if (sla.breach_status && !isTerminal) {
    triggers.push({
      trigger_code: 'sla_breached',
      rule_classification: 'PROPOSED_CONFIGURABLE_RULE',
      reason: `SLA deadline breached under ${sla.sla_rule_id} (${sla.business_schedule_code}): elapsed ${sla.elapsed_business_minutes} business minutes exceeds target ${sla.target_business_minutes} business minutes by ${sla.overdue_business_minutes} business minutes.`,
      requires_immediate_escalation: true,
    });
  }

  // Scenario 1: Approaching SLA deadline
  if (sla.is_approaching_deadline && !sla.breach_status && !isTerminal) {
    triggers.push({
      trigger_code: 'approaching_sla_deadline',
      rule_classification: 'PROPOSED_CONFIGURABLE_RULE',
      reason: `Ticket is approaching its configured SLA deadline under ${sla.sla_rule_id}: ${sla.elapsed_business_minutes} of ${sla.target_business_minutes} business minutes elapsed (${sla.remaining_business_minutes} business minutes remaining; threshold=${sla.approaching_threshold_business_minutes}m).`,
      requires_immediate_escalation: Boolean(
        params.escalateOnApproachingDeadline
      ),
    });
  }

  // Scenario 5: Missing or invalid assignment / invalid assignee role
  if (
    routingValidation.code === 'MISSING_OR_INVALID_ASSIGNMENT' ||
    routingValidation.code === 'INVALID_ASSIGNED_ROLE'
  ) {
    triggers.push({
      trigger_code: 'missing_or_invalid_assignment',
      rule_classification: 'CONFIRMED_CHALLENGE_REQUIREMENT',
      reason: routingValidation.message,
      requires_immediate_escalation: !isTerminal,
    });
  }

  // Scenario 4: Unauthorized team routing or routing rule mismatch
  if (
    routingValidation.code === 'UNAUTHORIZED_TEAM_ROUTING' ||
    routingValidation.code === 'ROUTING_RULE_MISMATCH'
  ) {
    triggers.push({
      trigger_code: 'unauthorized_team_routing',
      rule_classification: 'CONFIRMED_CHALLENGE_REQUIREMENT',
      reason: routingValidation.message,
      requires_immediate_escalation: !isTerminal,
    });
  }

  // Scenario 6: Human review required / AI Policy Assistant escalation
  if (params.aiAssistantEscalationReason) {
    triggers.push({
      trigger_code: 'ai_policy_assistant_escalation',
      rule_classification: 'CONFIRMED_CHALLENGE_REQUIREMENT',
      reason: params.aiAssistantEscalationReason,
      requires_immediate_escalation: !isTerminal,
    });
  }

  if (
    routingValidation.code === 'HUMAN_REVIEW_REQUIRED' ||
    (ticket.requires_escalation &&
      !ticket.is_escalated &&
      triggers.length === 0)
  ) {
    triggers.push({
      trigger_code: 'human_review_required',
      rule_classification: 'CONFIRMED_CHALLENGE_REQUIREMENT',
      reason:
        ticket.escalation_reason ||
        routingValidation.message ||
        'Ticket flagged as requiring human review and escalation.',
      requires_immediate_escalation: !isTerminal,
    });
  }

  // Scenario 3: Ticket unresolved after an escalation
  const isAlreadyEscalated =
    ticket.lifecycle_status === RequestStatus.Escalated || ticket.is_escalated;
  const isUnresolvedPostEscalation = isAlreadyEscalated && !isTerminal;

  if (isUnresolvedPostEscalation) {
    triggers.push({
      trigger_code: 'unresolved_post_escalation',
      rule_classification: 'CONFIRMED_CHALLENGE_REQUIREMENT',
      reason: sla.breach_status
        ? `Ticket ${ticket.ticket_id} remains unresolved in 'escalated' stage and has exceeded its SLA target by ${sla.overdue_business_minutes} business minutes. Requires AcademicAdministrator or PlatformAdministrator adjudication (never auto-resolved).`
        : `Ticket ${ticket.ticket_id} is currently in 'escalated' stage awaiting AcademicAdministrator or PlatformAdministrator adjudication (${sla.remaining_business_minutes} business minutes remaining; never auto-resolved).`,
      requires_immediate_escalation: false,
    });
  }

  const isOfficialCat = OFFICIAL_CATEGORIES.includes(ticket.category_name);
  const categoryRule = isOfficialCat
    ? DOCUMENTED_ROUTING_RULES[ticket.category_name]
    : null;

  const immediateTriggers = triggers.filter(
    (t) => t.requires_immediate_escalation
  );
  const primaryTriggerCode =
    immediateTriggers[0]?.trigger_code ?? triggers[0]?.trigger_code ?? null;

  const recommendedAssignedTeam = categoryRule
    ? categoryRule.escalation_assigned_team
    : UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
  const recommendedAssignedActorRole = categoryRule
    ? categoryRule.escalation_actor_role
    : UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_actor_role;
  const recommendedAssignedActorId = categoryRule
    ? `ACTOR-ESC-${categoryRule.domain_code}`
    : 'ACTOR-TRIAGE-QUEUE';
  const recommendedRoutingRuleId = categoryRule
    ? categoryRule.rule_id
    : UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id;

  const combinedReason =
    immediateTriggers.length > 0
      ? immediateTriggers.map((t) => `[${t.trigger_code}] ${t.reason}`).join(' ')
      : triggers.length > 0
      ? triggers.map((t) => `[${t.trigger_code}] ${t.reason}`).join(' ')
      : ticket.escalation_reason;

  // Scenario 8: Duplicate escalation prevention
  // If the ticket is already in 'escalated' state, already assigned to the recommended escalation team
  // with a valid routing rule, and no routing remediation is needed, then re-processing the same
  // escalation condition is prevented from creating duplicate assignments, events, or notifications.
  const alreadyProperlyEscalatedAndRouted =
    ticket.lifecycle_status === RequestStatus.Escalated &&
    ticket.is_escalated &&
    routingValidation.valid &&
    routingValidation.activeAssignment?.assigned_team ===
      recommendedAssignedTeam;

  const matchingExistingNotification = notifications.find(
    (n) =>
      n.ticket_id === ticket.ticket_id &&
      n.event_type === 'escalated' &&
      primaryTriggerCode &&
      n.summary.includes(primaryTriggerCode)
  );

  const matchingExistingEvent = lifecycleEvents.find(
    (e) =>
      e.ticket_id === ticket.ticket_id &&
      e.new_state === RequestStatus.Escalated &&
      primaryTriggerCode &&
      e.reason.includes(primaryTriggerCode)
  );

  const duplicateEscalationPrevented =
    !isTerminal &&
    alreadyProperlyEscalatedAndRouted &&
    (immediateTriggers.length > 0 ||
      isUnresolvedPostEscalation ||
      Boolean(matchingExistingNotification) ||
      Boolean(matchingExistingEvent));

  const shouldEscalateNow =
    !isTerminal &&
    !duplicateEscalationPrevented &&
    (immediateTriggers.length > 0 ||
      (isAlreadyEscalated && !routingValidation.valid));

  // IMPORTANT: Never auto-resolve an escalated ticket!
  const recommendedStatus = isTerminal
    ? ticket.lifecycle_status
    : shouldEscalateNow || isAlreadyEscalated
    ? RequestStatus.Escalated
    : ticket.lifecycle_status;

  const deduplicationSignature = primaryTriggerCode
    ? `ESC-DEDUP-${ticket.ticket_id}-${primaryTriggerCode}-${recommendedAssignedTeam}`
    : null;

  return {
    ticketId: ticket.ticket_id,
    evaluatedAtIso,
    sla: {
      ...sla,
      escalation_status:
        recommendedStatus === RequestStatus.Escalated || ticket.is_escalated
          ? 'escalated'
          : sla.escalation_status,
    },
    routingValidation,
    triggers,
    primaryTriggerCode,
    shouldEscalateNow,
    isApproachingDeadline: Boolean(sla.is_approaching_deadline),
    isBreached: sla.breach_status,
    isUnresolvedPostEscalation,
    duplicateEscalationPrevented,
    deduplicationSignature,
    recommendedStatus,
    recommendedAssignedTeam,
    recommendedAssignedActorId,
    recommendedAssignedActorRole,
    recommendedRoutingRuleId,
    combinedEscalationReason: combinedReason || null,
  };
}

// ============================================================================
// 5. POLICY & KNOWLEDGE BASE RETRIEVAL ENGINE (Sections 8 & 12)
// ============================================================================

export interface PolicyApplicabilityEvaluation {
  isApplicable: boolean;
  reason:
    | 'applicable_active'
    | 'expired_by_date'
    | 'superseded_version'
    | 'not_yet_effective'
    | 'inactive_lifecycle';
}

export function evaluateSourceApplicability(
  source: {
    lifecycle_state: string;
    effective_date: string;
    expiration_date: string | null;
    superseded_by_policy_id?: string | null;
  },
  asOfDateIso: string
): PolicyApplicabilityEvaluation {
  const refDate = asOfDateIso.slice(0, 10);
  const isStateActive =
    source.lifecycle_state === 'active' ||
    source.lifecycle_state === 'published';

  if (source.expiration_date && source.expiration_date < refDate) {
    return { isApplicable: false, reason: 'expired_by_date' };
  }
  if (
    source.lifecycle_state === 'superseded' ||
    Boolean(source.superseded_by_policy_id)
  ) {
    return {
      isApplicable: false,
      reason:
        source.lifecycle_state === 'expired'
          ? 'expired_by_date'
          : 'superseded_version',
    };
  }
  if (!isStateActive) {
    return {
      isApplicable: false,
      reason:
        source.lifecycle_state === 'expired'
          ? 'expired_by_date'
          : 'inactive_lifecycle',
    };
  }
  if (source.effective_date > refDate) {
    return { isApplicable: false, reason: 'not_yet_effective' };
  }

  return { isApplicable: true, reason: 'applicable_active' };
}

export interface ConflictingSourcePair {
  sourceAId: string;
  sourceAVersion: string;
  sourceATitle: string;
  sourceAEffectiveDate: string;
  sourceAClaim: string;
  sourceBId: string;
  sourceBVersion: string;
  sourceBTitle: string;
  sourceBEffectiveDate: string;
  sourceBClaim: string;
  conflictSummary: string;
}

/**
 * Detects whether two or more applicable (active/published) sources retrieved for a query
 * contain conflicting versions, deadlines, or policy clauses on the same topic.
 */
export function detectConflictingPolicySources(params: {
  applicablePolicies: PolicyDocumentRecord[];
  applicableArticles: KnowledgeArticleRecord[];
}): ConflictingSourcePair[] {
  const conflicts: ConflictingSourcePair[] = [];
  const { applicablePolicies, applicableArticles } = params;

  const extractSignificantSubjectTokens = (title: string): string[] => {
    const ignore = new Set([
      'policy',
      'policies',
      'and',
      'the',
      'for',
      'with',
      'institutional',
      'academic',
      'university',
      'campus',
      'legacy',
      'current',
      'active',
      'procedure',
      'rules',
    ]);
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !ignore.has(w));
  };

  // 1. Check Policy-to-Policy conflicts among active applicable policies
  for (let i = 0; i < applicablePolicies.length; i++) {
    for (let j = i + 1; j < applicablePolicies.length; j++) {
      const polA = applicablePolicies[i];
      const polB = applicablePolicies[j];

      const sameCategoryOrDomain =
        polA.category_id === polB.category_id || polA.domain === polB.domain;
      const hasSupersessionLink =
        polA.supersedes_policy_id === polB.policy_id ||
        polB.supersedes_policy_id === polA.policy_id ||
        polA.superseded_by_policy_id === polB.policy_id ||
        polB.superseded_by_policy_id === polA.policy_id;

      if (!sameCategoryOrDomain || hasSupersessionLink) {
        continue;
      }

      const tokensA = extractSignificantSubjectTokens(polA.title);
      const tokensB = new Set(extractSignificantSubjectTokens(polB.title));
      const sharedTitleTokens = tokensA.filter((t) => tokensB.has(t));

      const sectionMajorA = (
        polA.authoritative_section_ref.match(/Section\s+[0-9]+/i)?.[0] || ''
      ).toLowerCase();
      const sectionMajorB = (
        polB.authoritative_section_ref.match(/Section\s+[0-9]+/i)?.[0] || ''
      ).toLowerCase();
      const sameMajorSection =
        Boolean(sectionMajorA) && sectionMajorA === sectionMajorB;

      if (
        (sharedTitleTokens.length >= 2 || sameMajorSection) &&
        polA.content.trim() !== polB.content.trim()
      ) {
        conflicts.push({
          sourceAId: polA.policy_id,
          sourceAVersion: polA.version,
          sourceATitle: polA.title,
          sourceAEffectiveDate: polA.effective_date,
          sourceAClaim: `${polA.authoritative_section_ref}: ${polA.content}`,
          sourceBId: polB.policy_id,
          sourceBVersion: polB.version,
          sourceBTitle: polB.title,
          sourceBEffectiveDate: polB.effective_date,
          sourceBClaim: `${polB.authoritative_section_ref}: ${polB.content}`,
          conflictSummary: `Active policy ${polA.policy_id} (v${polA.version}, effective ${polA.effective_date}) and active policy ${polB.policy_id} (v${polB.version}, effective ${polB.effective_date}) both govern overlapping subject matter (${
            sharedTitleTokens.join(', ') || sectionMajorA
          }) with differing provisions. CampusResolve AI will not choose arbitrarily between conflicting active policies.`,
        });
      }
    }
  }

  // 2. Check Policy-to-Article version or rule conflicts
  for (const art of applicableArticles) {
    const matchedPol = applicablePolicies.find(
      (p) => p.policy_id === art.primary_policy_id
    );
    if (matchedPol && art.primary_policy_version !== matchedPol.version) {
      conflicts.push({
        sourceAId: matchedPol.policy_id,
        sourceAVersion: matchedPol.version,
        sourceATitle: matchedPol.title,
        sourceAEffectiveDate: matchedPol.effective_date,
        sourceAClaim: `${matchedPol.authoritative_section_ref}: ${matchedPol.content}`,
        sourceBId: art.article_id,
        sourceBVersion: art.version,
        sourceBTitle: art.title,
        sourceBEffectiveDate: art.effective_date,
        sourceBClaim: `References ${art.primary_policy_id} v${art.primary_policy_version}: ${art.content}`,
        conflictSummary: `Published knowledge article ${art.article_id} (v${art.version}) cites policy version v${art.primary_policy_version}, which conflicts with active policy ${matchedPol.policy_id} (v${matchedPol.version}, effective ${matchedPol.effective_date}). Human verification is required.`,
      });
    }
  }

  return conflicts;
}

/**
 * Checks whether the user query asks for a specific unsupported fact (such as a dollar fee,
 * monetary fine, cash stipend, or guarantee) that is not established in the retrieved active sources.
 */
export function detectUnsupportedFactRequest(params: {
  query: string;
  applicablePolicies: PolicyDocumentRecord[];
  applicableArticles: KnowledgeArticleRecord[];
}): {
  unsupportedClaimRequested: boolean;
  unsupportedClaimDetails: string[];
} {
  const { query, applicablePolicies, applicableArticles } = params;
  if (applicablePolicies.length === 0 && applicableArticles.length === 0) {
    return { unsupportedClaimRequested: false, unsupportedClaimDetails: [] };
  }

  const normalizedQuery = query.toLowerCase();
  const combinedEvidence = [
    ...applicablePolicies.map((p) => `${p.title} ${p.summary} ${p.content}`),
    ...applicableArticles.map((a) => `${a.title} ${a.summary} ${a.content}`),
  ]
    .join(' ')
    .toLowerCase();

  const details: string[] = [];

  const unsupportedPatterns: {
    regex: RegExp;
    evidenceRegex: RegExp;
    description: string;
  }[] = [
    {
      regex:
        /\b(dollar|dollars|usd|filing fee|processing fee|late fee|application fee|fine|fines|monetary penalty|cost|price|charge|cash stipend|reimbursement|refund amount|hourly wage)\b|\$[0-9]+/i,
      evidenceRegex:
        /\b(dollar|dollars|filing fee|processing fee|late fee|application fee|monetary penalty|reimbursement|refund)\b|\$[0-9]+/i,
      description:
        'Monetary fees, fines, dollar amounts, or cash reimbursements are not established in the retrieved active policy documents.',
    },
    {
      regex:
        /\b(guaranteed approval|automatic approval|automatic waiver|100%\s+guaranteed|private hotel|medical scribe|personal laptop giveaway|free macbook|visa sponsorship|legal representation)\b/i,
      evidenceRegex:
        /\b(guaranteed approval|automatic waiver|medical scribe|visa sponsorship|legal representation)\b/i,
      description:
        'Automatic approval guarantees or unscheduled supplemental services requested in the question are not supported by the active institutional policy text.',
    },
  ];

  for (const check of unsupportedPatterns) {
    if (check.regex.test(normalizedQuery)) {
      const presentInEvidence = check.evidenceRegex.test(combinedEvidence);
      if (!presentInEvidence) {
        details.push(check.description);
      }
    }
  }

  return {
    unsupportedClaimRequested: details.length > 0,
    unsupportedClaimDetails: details,
  };
}

/**
 * Detects whether a user question is underspecified or has multiple policy interpretations
 * requiring focused clarification questions.
 */
export function detectQueryAmbiguityAndClarifications(params: {
  query: string;
  detectedCategory: OfficialCategoryName | null;
  categoryScores: Record<OfficialCategoryName, number>;
  applicablePolicies: PolicyDocumentRecord[];
  isUnsupportedTopic: boolean;
}): {
  clarificationNeeded: boolean;
  clarificationQuestions: string[];
} {
  const {
    query,
    detectedCategory,
    categoryScores,
    applicablePolicies,
    isUnsupportedTopic,
  } = params;

  if (isUnsupportedTopic) {
    return { clarificationNeeded: false, clarificationQuestions: [] };
  }

  const normalizedQuery = query.trim().toLowerCase();
  const questions: string[] = [];

  // Count how many distinct categories have positive keyword matches
  const matchedCategories = (
    Object.entries(categoryScores) as [OfficialCategoryName, number][]
  )
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1]);

  // 1. Multi-category ambiguity (query spans 2+ official domains closely)
  if (
    matchedCategories.length >= 2 &&
    matchedCategories[0][1] - matchedCategories[1][1] <= 2
  ) {
    questions.push(
      `Your question touches on both ${matchedCategories[0][0]} and ${matchedCategories[1][0]}. Are you asking primarily about ${matchedCategories[0][0]} rules or ${matchedCategories[1][0]} procedures?`
    );
  }

  // 2. Generic / underspecified policy inquiry without a clear domain or specific policy identifier
  const hasExplicitSourceId = /\b(pol-|kb-)[a-z0-9-]+\b/i.test(normalizedQuery);
  const asksGenericRuleQuestion =
    /\b(deadline|appeal|override|waiver|petition|form|how many days|when is|eligible|eligibility|request|drop|withdraw|status|policy|rule)\b/i.test(
      normalizedQuery
    );

  if (!detectedCategory && !hasExplicitSourceId && asksGenericRuleQuestion) {
    questions.push(
      'Which institutional domain does your question concern: Financial Aid (SAP appeals or disbursement), Registration (add/drop, withdrawal, or credit overload), IT (SSO/MFA or LMS access), or Accessibility (exam accommodations or captioning)?'
    );
    questions.push(
      'Are you asking about a standard within-deadline request or a post-deadline exception/appeal?'
    );
  }

  // 3. Domain-specific conditional ambiguity when key policy parameters are omitted
  if (detectedCategory === 'Registration' && !hasExplicitSourceId) {
    const mentionsDropOrWithdraw = /\b(drop|withdraw|withdrawal|leave)\b/i.test(
      normalizedQuery
    );
    const specifiesTiming =
      /\b(week\s*[0-9]+|10\s*business\s*days|first\s*10|retroactive|after\s*week|before\s*week|add\/drop\s*window|census)\b/i.test(
        normalizedQuery
      );
    if (mentionsDropOrWithdraw && !specifiesTiming) {
      questions.push(
        'Are you requesting to drop a course within the first 10 business days of the term (no W grade), withdraw through Week 8 (with a W grade), or petition for a retroactive withdrawal after Week 8?'
      );
    }
  }

  if (detectedCategory === 'Financial Aid' && !hasExplicitSourceId) {
    const mentionsGenericAid =
      /\b(financial aid|aid|disbursement|grant|scholarship)\b/i.test(
        normalizedQuery
      ) &&
      !/\b(sap|satisfactory academic progress|appeal|gpa|pace|census|proration|half-time|full-time|6 credit|12 credit|10 days)\b/i.test(
        normalizedQuery
      );
    if (mentionsGenericAid) {
      questions.push(
        'Are you inquiring about Satisfactory Academic Progress (SAP) appeal eligibility (2.0 GPA / 67% pace within 15 business days) or term aid disbursement timing and census-date credit proration (12 credits full-time vs. 6 credits half-time)?'
      );
    }
  }

  // 4. Multiple active policies in the same domain matched with identical top relevance
  if (
    questions.length === 0 &&
    applicablePolicies.length >= 2 &&
    !hasExplicitSourceId &&
    normalizedQuery.split(/\s+/).length <= 8
  ) {
    questions.push(
      `Multiple active policies matched your question (${applicablePolicies
        .map((p) => `${p.policy_id} v${p.version}: "${p.title}"`)
        .join(' and ')}). Which specific policy topic applies to your situation?`
    );
  }

  return {
    clarificationNeeded: questions.length > 0,
    clarificationQuestions: questions,
  };
}

export interface RetrievalCandidateResult {
  detectedCategory: OfficialCategoryName | null;
  applicablePolicies: PolicyDocumentRecord[];
  applicableArticles: KnowledgeArticleRecord[];
  expiredPoliciesExcluded: PolicyDocumentRecord[];
  expiredArticlesExcluded: KnowledgeArticleRecord[];
  retrievalConfidence: number;
  evidenceStatus: AIEvidenceStatus;
  escalationRecommended: boolean;
  escalationReason: string | null;
  hasConflictingSources?: boolean;
  conflictingSources?: ConflictingSourcePair[];
  clarificationNeeded?: boolean;
  clarificationQuestions?: string[];
  unsupportedClaimRequested?: boolean;
  unsupportedClaimDetails?: string[];
  expiredPolicyRejected?: boolean;
}

/**
 * Searches the PolicyDocument and KnowledgeArticle corpus, enforces effective-date
 * and lifecycle applicability, isolates expired/superseded sources, detects conflicting
 * sources, identifies ambiguous or unsupported-fact queries, and scores relevance.
 */
export function retrieveApplicablePolicyEvidence(params: {
  query: string;
  policies: PolicyDocumentRecord[];
  articles: KnowledgeArticleRecord[];
  asOfDateIso?: string;
}): RetrievalCandidateResult {
  const asOfDate = params.asOfDateIso || new Date().toISOString().slice(0, 10);
  const normalizedQuery = params.query.trim().toLowerCase();
  const STOP_WORDS = new Set([
    'what',
    'when',
    'where',
    'which',
    'who',
    'whom',
    'whose',
    'why',
    'how',
    'does',
    'did',
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'have',
    'has',
    'had',
    'are',
    'was',
    'were',
    'will',
    'would',
    'could',
    'should',
    'can',
    'may',
    'university',
    'campus',
    'policy',
    'policies',
    'rule',
    'rules',
    'still',
    'apply',
    'current',
    'about',
    'into',
    'after',
    'before',
    'under',
    'over',
    'between',
  ]);
  const queryTokens = normalizedQuery
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));

  const catResolution = resolveOfficialCategory(null, normalizedQuery);
  const detectedCategory = catResolution.category;

  const categoryScores: Record<OfficialCategoryName, number> = {
    'Financial Aid': 0,
    Registration: 0,
    IT: 0,
    Accessibility: 0,
  };
  if (
    /\b(fafsa|pell|scholarship|disbursement|stipend|financial aid|tuition|sap|gpa|pace)\b/.test(
      normalizedQuery
    )
  ) {
    categoryScores['Financial Aid'] += 4;
  }
  if (
    /\b(add\/drop|withdraw|withdrawal|waitlist|prerequisite|transcript|enrollment|registrar|credit overload|late drop|course)\b/.test(
      normalizedQuery
    )
  ) {
    categoryScores.Registration += 4;
  }
  if (
    /\b(mfa|two-factor|password|sso|canvas|lms|vpn|wifi|eduroam|account locked|software license|fido2|totp)\b/.test(
      normalizedQuery
    )
  ) {
    categoryScores.IT += 4;
  }
  if (
    /\b(accommodation|disability|screen reader|extended time|captioning|accessibility|section 504|braille|proctored|cart)\b/.test(
      normalizedQuery
    )
  ) {
    categoryScores.Accessibility += 4;
  }

  const scoredPolicies: {
    policy: PolicyDocumentRecord;
    score: number;
    applicable: boolean;
  }[] = [];

  for (const policy of params.policies) {
    const hay =
      `${policy.policy_id} ${policy.title} ${policy.summary} ${policy.content} ${policy.domain}`.toLowerCase();
    let score = 0;
    if (
      detectedCategory &&
      DOCUMENTED_ROUTING_RULES[detectedCategory].category_id ===
        policy.category_id
    ) {
      score += 4;
    }
    for (const token of queryTokens) {
      if (hay.includes(token)) {
        score += 2;
      }
    }
    if (normalizedQuery.includes(policy.policy_id.toLowerCase())) {
      score += 15;
    }

    if (score > 0) {
      const app = evaluateSourceApplicability(policy, asOfDate);
      scoredPolicies.push({ policy, score, applicable: app.isApplicable });
    }
  }

  // If the query explicitly matched an expired/superseded policy that has a known active
  // superseding policy in the corpus, ensure the active superseding policy is also candidate-scored
  for (const item of [...scoredPolicies]) {
    if (!item.applicable && item.policy.superseded_by_policy_id) {
      const superseding = params.policies.find(
        (p) => p.policy_id === item.policy.superseded_by_policy_id
      );
      if (superseding) {
        const app = evaluateSourceApplicability(superseding, asOfDate);
        const existing = scoredPolicies.find(
          (sp) => sp.policy.policy_id === superseding.policy_id
        );
        if (!existing) {
          scoredPolicies.push({
            policy: superseding,
            score: Math.max(8, item.score - 2),
            applicable: app.isApplicable,
          });
        }
      }
    }
  }

  const scoredArticles: {
    article: KnowledgeArticleRecord;
    score: number;
    applicable: boolean;
  }[] = [];

  for (const article of params.articles) {
    const hay =
      `${article.article_id} ${article.title} ${article.summary} ${article.content} ${article.tags.join(' ')}`.toLowerCase();
    let score = 0;
    if (
      detectedCategory &&
      DOCUMENTED_ROUTING_RULES[detectedCategory].category_id ===
        article.category_id
    ) {
      score += 3;
    }
    for (const token of queryTokens) {
      if (hay.includes(token)) {
        score += 2;
      }
    }
    if (normalizedQuery.includes(article.article_id.toLowerCase())) {
      score += 15;
    }

    if (score > 0) {
      const app = evaluateSourceApplicability(article, asOfDate);
      // Also check that the article's governing policy is not expired
      const parentPol = params.policies.find(
        (p) => p.policy_id === article.primary_policy_id
      );
      const parentExpired = parentPol
        ? !evaluateSourceApplicability(parentPol, asOfDate).isApplicable
        : false;
      scoredArticles.push({
        article,
        score,
        applicable: app.isApplicable && !parentExpired,
      });
    }
  }

  scoredPolicies.sort((a, b) => b.score - a.score);
  scoredArticles.sort((a, b) => b.score - a.score);

  const applicablePolicies = scoredPolicies
    .filter((p) => p.applicable)
    .slice(0, 3)
    .map((p) => p.policy);

  const expiredPoliciesExcluded = scoredPolicies
    .filter((p) => !p.applicable)
    .slice(0, 3)
    .map((p) => p.policy);

  const applicableArticles = scoredArticles
    .filter((a) => a.applicable)
    .slice(0, 4)
    .map((a) => a.article);

  const expiredArticlesExcluded = scoredArticles
    .filter((a) => !a.applicable)
    .slice(0, 3)
    .map((a) => a.article);

  const topScore = Math.max(
    scoredPolicies.find((p) => p.applicable)?.score ?? 0,
    scoredArticles.find((a) => a.applicable)?.score ?? 0
  );

  // Check if query asks explicitly about an expired policy ID or legacy v1.0 rule
  const explicitlyReferencesExpiredPolicy =
    expiredPoliciesExcluded.some((ep) =>
      normalizedQuery.includes(ep.policy_id.toLowerCase())
    ) ||
    /\b(v1\.0|version 1\.0|expired policy|legacy policy|10 calendar days|14 calendar days|sms text codes|through week 3)\b/i.test(
      normalizedQuery
    );

  // Check if query asks for unsupported topics outside the 4 institutional domains
  const isUnsupportedTopic =
    /\b(parking|dining hall|meal transfer|football|stadium|dormitory|roommate|alumni donation|shuttle|study abroad visa|gym membership|library late book|pet policy|campus bookstore discount)\b/.test(
      normalizedQuery
    ) ||
    (!detectedCategory &&
      topScore < 4 &&
      expiredPoliciesExcluded.length === 0 &&
      expiredArticlesExcluded.length === 0);

  // Check if query requests an exception, retroactive petition, appeal adjudication, waiver, or dispute
  const isExceptionOrEscalationRequest =
    /\b(exception|waive|waiver|override|retroactive|second-level|special circumstance|dispute|lawsuit|grievance|extenuating|missed the deadline|after week 8|late drop petition|emergency override|emergency statutory|account compromise|privilege anomaly|denied|denial|appeal my|request an appeal|grant me)\b/.test(
      normalizedQuery
    );

  const ambiguityCheck = detectQueryAmbiguityAndClarifications({
    query: params.query,
    detectedCategory,
    categoryScores,
    applicablePolicies,
    isUnsupportedTopic,
  });

  if (
    isUnsupportedTopic ||
    (applicablePolicies.length === 0 && applicableArticles.length === 0)
  ) {
    if (
      !isUnsupportedTopic &&
      (expiredPoliciesExcluded.length > 0 || expiredArticlesExcluded.length > 0)
    ) {
      return {
        detectedCategory,
        applicablePolicies: [],
        applicableArticles: [],
        expiredPoliciesExcluded,
        expiredArticlesExcluded,
        retrievalConfidence: 0.25,
        evidenceStatus: 'expired_only',
        escalationRecommended: true,
        escalationReason:
          'Only expired, superseded, or not-yet-effective policy/article versions matched the query. Expired versions are rejected as current guidance and must be reviewed by an institutional officer.',
        hasConflictingSources: false,
        conflictingSources: [],
        clarificationNeeded: false,
        clarificationQuestions: [],
        unsupportedClaimRequested: false,
        unsupportedClaimDetails: [],
        expiredPolicyRejected: true,
      };
    }

    // If the query is vague/underspecified across domains rather than an out-of-scope topic, return clarification questions
    if (ambiguityCheck.clarificationNeeded && !isUnsupportedTopic) {
      return {
        detectedCategory,
        applicablePolicies: [],
        applicableArticles: [],
        expiredPoliciesExcluded,
        expiredArticlesExcluded,
        retrievalConfidence: 0.3,
        evidenceStatus: 'partial_or_ambiguous',
        escalationRecommended: true,
        escalationReason:
          'Query is underspecified across multiple institutional policy domains; clarification is required before providing a definitive policy determination.',
        hasConflictingSources: false,
        conflictingSources: [],
        clarificationNeeded: true,
        clarificationQuestions: ambiguityCheck.clarificationQuestions,
        unsupportedClaimRequested: false,
        unsupportedClaimDetails: [],
        expiredPolicyRejected: false,
      };
    }

    return {
      detectedCategory,
      applicablePolicies: [],
      applicableArticles: [],
      expiredPoliciesExcluded,
      expiredArticlesExcluded,
      retrievalConfidence: 0.0,
      evidenceStatus: 'unsupported_or_missing',
      escalationRecommended: true,
      escalationReason:
        'No applicable policy document or knowledge article in the repository covers this inquiry. Escalation to human review is required.',
      hasConflictingSources: false,
      conflictingSources: [],
      clarificationNeeded: false,
      clarificationQuestions: [],
      unsupportedClaimRequested: false,
      unsupportedClaimDetails: [],
      expiredPolicyRejected: false,
    };
  }

  // Check for conflicting active policy/article sources
  const conflictingSources = detectConflictingPolicySources({
    applicablePolicies,
    applicableArticles,
  });
  const hasConflictingSources = conflictingSources.length > 0;

  // Check for unsupported factual claims within a covered domain
  const unsupportedFactCheck = detectUnsupportedFactRequest({
    query: params.query,
    applicablePolicies,
    applicableArticles,
  });

  const confidence = Math.min(0.98, Number((0.45 + topScore * 0.05).toFixed(3)));

  if (hasConflictingSources) {
    return {
      detectedCategory,
      applicablePolicies,
      applicableArticles,
      expiredPoliciesExcluded,
      expiredArticlesExcluded,
      retrievalConfidence: Math.min(0.55, confidence),
      evidenceStatus: 'partial_or_ambiguous',
      escalationRecommended: true,
      escalationReason: `Conflicting active policy sources detected (${conflictingSources
        .map(
          (c) =>
            `${c.sourceAId} v${c.sourceAVersion} vs. ${c.sourceBId} v${c.sourceBVersion}`
        )
        .join('; ')}). Human adjudication is required to resolve the policy conflict.`,
      hasConflictingSources: true,
      conflictingSources,
      clarificationNeeded: ambiguityCheck.clarificationNeeded,
      clarificationQuestions: ambiguityCheck.clarificationQuestions,
      unsupportedClaimRequested: unsupportedFactCheck.unsupportedClaimRequested,
      unsupportedClaimDetails: unsupportedFactCheck.unsupportedClaimDetails,
      expiredPolicyRejected: explicitlyReferencesExpiredPolicy,
    };
  }

  if (unsupportedFactCheck.unsupportedClaimRequested) {
    return {
      detectedCategory,
      applicablePolicies,
      applicableArticles,
      expiredPoliciesExcluded,
      expiredArticlesExcluded,
      retrievalConfidence: Math.min(0.62, confidence),
      evidenceStatus: 'partial_or_ambiguous',
      escalationRecommended: true,
      escalationReason: `Query requests specific facts or guarantees not established in the active policy corpus (${unsupportedFactCheck.unsupportedClaimDetails.join(
        ' '
      )}). Human review is recommended.`,
      hasConflictingSources: false,
      conflictingSources: [],
      clarificationNeeded: ambiguityCheck.clarificationNeeded,
      clarificationQuestions: ambiguityCheck.clarificationQuestions,
      unsupportedClaimRequested: true,
      unsupportedClaimDetails: unsupportedFactCheck.unsupportedClaimDetails,
      expiredPolicyRejected: explicitlyReferencesExpiredPolicy,
    };
  }

  if (
    isExceptionOrEscalationRequest ||
    ambiguityCheck.clarificationNeeded ||
    topScore < 6
  ) {
    const reason = ambiguityCheck.clarificationNeeded
      ? 'Query is ambiguous or missing key situational parameters required to determine which policy provision applies; see clarification questions or escalate for human review.'
      : 'Query involves a policy exception, formal appeal, retroactive petition, or boundary condition where automated determination is not permitted without human adjudicator review.';

    return {
      detectedCategory,
      applicablePolicies,
      applicableArticles,
      expiredPoliciesExcluded,
      expiredArticlesExcluded,
      retrievalConfidence: Math.min(0.74, confidence),
      evidenceStatus: 'partial_or_ambiguous',
      escalationRecommended: true,
      escalationReason: reason,
      hasConflictingSources: false,
      conflictingSources: [],
      clarificationNeeded: ambiguityCheck.clarificationNeeded,
      clarificationQuestions: ambiguityCheck.clarificationQuestions,
      unsupportedClaimRequested: false,
      unsupportedClaimDetails: [],
      expiredPolicyRejected: explicitlyReferencesExpiredPolicy,
    };
  }

  return {
    detectedCategory,
    applicablePolicies,
    applicableArticles,
    expiredPoliciesExcluded,
    expiredArticlesExcluded,
    retrievalConfidence: confidence,
    evidenceStatus: 'supported',
    escalationRecommended: false,
    escalationReason: null,
    hasConflictingSources: false,
    conflictingSources: [],
    clarificationNeeded: false,
    clarificationQuestions: [],
    unsupportedClaimRequested: false,
    unsupportedClaimDetails: [],
    expiredPolicyRejected: explicitlyReferencesExpiredPolicy,
  };
}

