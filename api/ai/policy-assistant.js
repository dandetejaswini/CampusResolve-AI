// server-api/ai/policy-assistant.ts
import { GoogleGenAI, Type } from "@google/genai";

// src/services/workflowEngine.ts
function formatTicketId(sequenceNumber) {
  return `TKT-2026-${String(sequenceNumber).padStart(6, "0")}`;
}
function formatMessageId(ticketId, messageSeq) {
  return `MSG-${ticketId}-${String(messageSeq).padStart(3, "0")}`;
}
function formatKnowledgeArticleId(sequenceNumber) {
  return `KB-${String(sequenceNumber).padStart(6, "0")}`;
}
function formatPolicyId(domain, sequenceNumber) {
  return `POL-${domain}-2026-${String(sequenceNumber).padStart(3, "0")}`;
}
function formatSlaId(ticketId) {
  return `SLA-${ticketId}`;
}
function formatRequesterId(sequenceNumber) {
  return `REQ-2026-${String(sequenceNumber).padStart(6, "0")}`;
}
function formatAssignmentId(ticketId, assignmentSeq) {
  return `ASG-${ticketId}-${String(assignmentSeq).padStart(2, "0")}`;
}
function formatFeedbackId(ticketId) {
  return `FDB-${ticketId}`;
}
function formatAnomalyId(sequenceNumber) {
  return `ANM-2026-${String(sequenceNumber).padStart(6, "0")}`;
}
var OFFICIAL_CATEGORIES = [
  "Financial Aid",
  "Registration",
  "IT",
  "Accessibility"
];
var DOCUMENTED_ROUTING_RULES = {
  "Financial Aid": {
    rule_id: "RULE-FINAID-001",
    category_id: "CAT-FINAID",
    category_name: "Financial Aid",
    domain_code: "FINAID",
    primary_assigned_team: "Office of Financial Aid & Scholarships",
    escalation_assigned_team: "Financial Aid Appeals & Compliance Review Committee",
    default_actor_role: "support_staff" /* SupportStaff */,
    escalation_actor_role: "academic_administrator" /* AcademicAdministrator */,
    rule_description: "Routes Financial Aid disbursement, SAP appeal, scholarship eligibility, and emergency aid inquiries to the Office of Financial Aid & Scholarships; escalates appeals and policy exceptions to the Financial Aid Appeals & Compliance Review Committee."
  },
  Registration: {
    rule_id: "RULE-REG-001",
    category_id: "CAT-REG",
    category_name: "Registration",
    domain_code: "REG",
    primary_assigned_team: "Office of the University Registrar",
    escalation_assigned_team: "Academic Senate Registration Review Board",
    default_actor_role: "support_staff" /* SupportStaff */,
    escalation_actor_role: "academic_administrator" /* AcademicAdministrator */,
    rule_description: "Routes course enrollment, add/drop deadlines, late withdrawal petitions, credit overload, and degree audit requests to the Office of the University Registrar; escalates retroactive petitions to the Academic Senate Registration Review Board."
  },
  IT: {
    rule_id: "RULE-IT-001",
    category_id: "CAT-IT",
    category_name: "IT",
    domain_code: "IT",
    primary_assigned_team: "Campus IT Operations & Identity Desk",
    escalation_assigned_team: "Information Security & Infrastructure Escalation Unit",
    default_actor_role: "support_staff" /* SupportStaff */,
    escalation_actor_role: "platform_administrator" /* PlatformAdministrator */,
    rule_description: "Routes SSO authentication, MFA reset, LMS access, institutional email provisioning, and lab software licensing requests to the Campus IT Operations & Identity Desk; escalates security or multi-system outages to Information Security & Infrastructure Escalation Unit."
  },
  Accessibility: {
    rule_id: "RULE-ACCESS-001",
    category_id: "CAT-ACCESS",
    category_name: "Accessibility",
    domain_code: "ACCESS",
    primary_assigned_team: "Disability & Accessibility Services Office",
    escalation_assigned_team: "ADA / Section 504 Compliance Review Panel",
    default_actor_role: "support_staff" /* SupportStaff */,
    escalation_actor_role: "academic_administrator" /* AcademicAdministrator */,
    rule_description: "Routes exam accommodation letters, assistive technology requests, captioning, and physical classroom access adjustments to the Disability & Accessibility Services Office; escalates accommodation disputes or urgent compliance barriers to the ADA / Section 504 Compliance Review Panel."
  }
};
var UNMAPPED_HUMAN_REVIEW_ROUTING = {
  rule_id: "RULE-EXCEPTION-HUMAN-TRIAGE",
  assigned_team: "Support Staff Intake Triage Queue (Human Review Required)",
  assigned_actor_role: "support_staff" /* SupportStaff */,
  reason: "No deterministic category routing rule matched or request contains cross-domain ambiguity; flagged for manual triage review without inventing an unauthorized destination."
};
function resolveOfficialCategory(rawCategoryInput, subjectAndDescription) {
  const trimmed = (rawCategoryInput || "").trim();
  if (trimmed === "Financial Aid" || trimmed === "Registration" || trimmed === "IT" || trimmed === "Accessibility") {
    const rule = DOCUMENTED_ROUTING_RULES[trimmed];
    return {
      category: trimmed,
      categoryId: rule.category_id,
      domainCode: rule.domain_code,
      confidence: "exact_match"
    };
  }
  const lowerCat = trimmed.toLowerCase();
  const combinedText = `${trimmed} ${subjectAndDescription || ""}`.toLowerCase();
  if (lowerCat.includes("financial") || lowerCat.includes("scholarship") || lowerCat.includes("fafsa") || lowerCat.includes("tuition") || lowerCat.includes("aid")) {
    return {
      category: "Financial Aid",
      categoryId: "CAT-FINAID",
      domainCode: "FINAID",
      confidence: "mapped_alias"
    };
  }
  if (lowerCat.includes("registration") || lowerCat.includes("enrollment") || lowerCat.includes("course schedule") || lowerCat.includes("deadline") || lowerCat.includes("syllabus") || lowerCat.includes("curriculum") || lowerCat.includes("assessment")) {
    return {
      category: "Registration",
      categoryId: "CAT-REG",
      domainCode: "REG",
      confidence: "mapped_alias"
    };
  }
  if (lowerCat.includes("accessibility") || lowerCat.includes("accommodation") || lowerCat.includes("disability") || lowerCat.includes("assistive") || lowerCat.includes("ada")) {
    return {
      category: "Accessibility",
      categoryId: "CAT-ACCESS",
      domainCode: "ACCESS",
      confidence: "mapped_alias"
    };
  }
  if (lowerCat.includes("it") || lowerCat.includes("technical") || lowerCat.includes("indexing") || lowerCat.includes("system") || lowerCat.includes("sso") || lowerCat.includes("mfa") || lowerCat.includes("portal")) {
    return {
      category: "IT",
      categoryId: "CAT-IT",
      domainCode: "IT",
      confidence: "mapped_alias"
    };
  }
  if (/\b(fafsa|pell|scholarship|disbursement|stipend|financial aid|tuition waiver|satisfactory academic progress|sap)\b/.test(
    combinedText
  )) {
    return {
      category: "Financial Aid",
      categoryId: "CAT-FINAID",
      domainCode: "FINAID",
      confidence: "keyword_inferred"
    };
  }
  if (/\b(accommodation|disability|screen reader|extended time|captioning|accessibility|section 504|braille)\b/.test(
    combinedText
  )) {
    return {
      category: "Accessibility",
      categoryId: "CAT-ACCESS",
      domainCode: "ACCESS",
      confidence: "keyword_inferred"
    };
  }
  if (/\b(mfa|two-factor|password|sso|canvas|lms|vpn|wifi|eduroam|account locked|software license)\b/.test(
    combinedText
  )) {
    return {
      category: "IT",
      categoryId: "CAT-IT",
      domainCode: "IT",
      confidence: "keyword_inferred"
    };
  }
  if (/\b(add\/drop|withdraw|withdrawal|waitlist|prerequisite|transcript|enrollment|registrar|credit overload|late drop|drop a course|drop or withdraw)\b/.test(
    combinedText
  )) {
    return {
      category: "Registration",
      categoryId: "CAT-REG",
      domainCode: "REG",
      confidence: "keyword_inferred"
    };
  }
  return {
    category: null,
    categoryId: null,
    domainCode: null,
    confidence: "unmapped"
  };
}
function evaluateTicketRouting(input) {
  const seq = input.sequenceNumber ?? 1;
  const assignmentId = formatAssignmentId(input.ticketId, seq);
  const combined = `${input.subject} ${input.description}`.toLowerCase();
  const hasExceptionOrAppealKeyword = /\b(exception|appeal|retroactive|waiver petition|ombuds|formal grievance|emergency override|legal compliance|statutory deadline)\b/.test(
    combined
  );
  const isAdminEscalationPriority = input.priority === "Administrative Escalation Priority";
  const escalationReasons = [];
  if (isAdminEscalationPriority) {
    escalationReasons.push(
      "Request submitted with Administrative Escalation Priority."
    );
  }
  if (hasExceptionOrAppealKeyword) {
    escalationReasons.push(
      "Request text contains policy exception, formal appeal, or retroactive petition criteria requiring administrative review."
    );
  }
  if (input.hasExpiredPolicyReference) {
    escalationReasons.push(
      "Request references an expired or superseded policy version requiring human verification."
    );
  }
  if (input.hasAmbiguousPolicyCoverage) {
    escalationReasons.push(
      "Applicable policy coverage is ambiguous or unestablished; human escalation required."
    );
  }
  const requiresEscalation = escalationReasons.length > 0;
  const escalationReason = escalationReasons.length > 0 ? escalationReasons.join(" ") : null;
  if (!input.category || !DOCUMENTED_ROUTING_RULES[input.category]) {
    const assignment2 = {
      assignment_id: assignmentId,
      ticket_id: input.ticketId,
      sequence_number: seq,
      assigned_team: UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team,
      assigned_actor_id: "ACTOR-TRIAGE-QUEUE",
      assigned_actor_role: UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_actor_role,
      routing_rule_id: UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id,
      assignment_reason: UNMAPPED_HUMAN_REVIEW_ROUTING.reason,
      previous_assignment_id: input.previousAssignment?.assignment_id ?? null,
      previous_assigned_team: input.previousAssignment?.assigned_team ?? null,
      requires_human_review: true,
      is_active: true,
      assigned_at: input.assignedAtIso,
      unassigned_at: null
    };
    return {
      assignment: assignment2,
      requiresEscalation: true,
      escalationReason: escalationReason || UNMAPPED_HUMAN_REVIEW_ROUTING.reason,
      recommendedStatus: "escalated" /* Escalated */
    };
  }
  const rule = DOCUMENTED_ROUTING_RULES[input.category];
  const targetTeam = requiresEscalation ? rule.escalation_assigned_team : rule.primary_assigned_team;
  const targetRole = requiresEscalation ? rule.escalation_actor_role : rule.default_actor_role;
  const assignment = {
    assignment_id: assignmentId,
    ticket_id: input.ticketId,
    sequence_number: seq,
    assigned_team: targetTeam,
    assigned_actor_id: requiresEscalation ? `ACTOR-ESC-${rule.domain_code}` : `ACTOR-OPS-${rule.domain_code}`,
    assigned_actor_role: targetRole,
    routing_rule_id: rule.rule_id,
    assignment_reason: requiresEscalation ? `Routed to ${targetTeam} under ${rule.rule_id} due to escalation trigger: ${escalationReason}` : `Routed to ${targetTeam} under documented rule ${rule.rule_id} for category '${input.category}'.`,
    previous_assignment_id: input.previousAssignment?.assignment_id ?? null,
    previous_assigned_team: input.previousAssignment?.assigned_team ?? null,
    requires_human_review: requiresEscalation,
    is_active: true,
    assigned_at: input.assignedAtIso,
    unassigned_at: null
  };
  return {
    assignment,
    requiresEscalation,
    escalationReason,
    recommendedStatus: requiresEscalation ? "escalated" /* Escalated */ : "under_review" /* UnderReview */
  };
}
var ALLOWED_LIFECYCLE_TRANSITIONS = {
  ["draft" /* Draft */]: ["submitted" /* Submitted */],
  ["submitted" /* Submitted */]: [
    "under_review" /* UnderReview */,
    "policy_verified" /* PolicyVerified */,
    "escalated" /* Escalated */
  ],
  ["under_review" /* UnderReview */]: [
    "policy_verified" /* PolicyVerified */,
    "escalated" /* Escalated */,
    "resolved" /* Resolved */
  ],
  ["policy_verified" /* PolicyVerified */]: [
    "under_review" /* UnderReview */,
    "escalated" /* Escalated */,
    "resolved" /* Resolved */
  ],
  ["escalated" /* Escalated */]: [
    "under_review" /* UnderReview */,
    "policy_verified" /* PolicyVerified */,
    "resolved" /* Resolved */
  ],
  ["resolved" /* Resolved */]: ["closed" /* Closed */, "escalated" /* Escalated */],
  ["closed" /* Closed */]: []
};
function isValidLifecycleTransition(previousState, newState) {
  if (previousState === null) {
    return newState === "draft" /* Draft */ || newState === "submitted" /* Submitted */;
  }
  return ALLOWED_LIFECYCLE_TRANSITIONS[previousState]?.includes(newState) ?? false;
}
var DOCUMENTED_ASSIGNMENT_TEAMS = [
  DOCUMENTED_ROUTING_RULES["Financial Aid"].primary_assigned_team,
  DOCUMENTED_ROUTING_RULES["Financial Aid"].escalation_assigned_team,
  DOCUMENTED_ROUTING_RULES.Registration.primary_assigned_team,
  DOCUMENTED_ROUTING_RULES.Registration.escalation_assigned_team,
  DOCUMENTED_ROUTING_RULES.IT.primary_assigned_team,
  DOCUMENTED_ROUTING_RULES.IT.escalation_assigned_team,
  DOCUMENTED_ROUTING_RULES.Accessibility.primary_assigned_team,
  DOCUMENTED_ROUTING_RULES.Accessibility.escalation_assigned_team,
  UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team
];
function createLifecycleEvent(params) {
  if (!isValidLifecycleTransition(params.previousState, params.newState)) {
    throw new Error(
      `INVALID_LIFECYCLE_TRANSITION: Cannot transition ticket ${params.ticketId} from '${params.previousState}' to '${params.newState}'.`
    );
  }
  return {
    event_id: `EVT-${params.ticketId}-${String(params.eventSequence).padStart(3, "0")}`,
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
    event_timestamp: params.timestampIso
  };
}
var DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO = 0.75;
var DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE = {
  schedule_code: "SCHED-CONFIG-MON-FRI-0800-1700-UTC",
  classification: "PROPOSED_CONFIGURABLE_RULE",
  description: "Configurable institutional business schedule (Monday\u2013Friday, 08:00\u201317:00 UTC, 540 business minutes per day; excludes weekends and configured holiday dates). Explicitly marked as a proposed configurable schedule rather than a hardcoded institutional regulation.",
  workday_start_hour_utc: 8,
  workday_end_hour_utc: 17,
  working_days_of_week: [1, 2, 3, 4, 5],
  timezone_name: "UTC",
  holiday_dates_utc: []
};
var CONFIGURABLE_SLA_RULES = {
  "Financial Aid": {
    sla_rule_id: "SLA-RULE-FINAID-CFG-01",
    category_name: "Financial Aid",
    classification: "PROPOSED_CONFIGURABLE_RULE",
    target_business_minutes: 1080,
    // 2 configurable business days (18 business hours)
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note: "Proposed configurable target: 1,080 business minutes (2 business days under 08:00\u201317:00 UTC Mon\u2013Fri schedule; approaching threshold at 75% / 810 business minutes)."
  },
  Registration: {
    sla_rule_id: "SLA-RULE-REG-CFG-01",
    category_name: "Registration",
    classification: "PROPOSED_CONFIGURABLE_RULE",
    target_business_minutes: 540,
    // 1 configurable business day (9 business hours)
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note: "Proposed configurable target: 540 business minutes (1 business day under 08:00\u201317:00 UTC Mon\u2013Fri schedule; approaching threshold at 75% / 405 business minutes)."
  },
  IT: {
    sla_rule_id: "SLA-RULE-IT-CFG-01",
    category_name: "IT",
    classification: "PROPOSED_CONFIGURABLE_RULE",
    target_business_minutes: 240,
    // 4 configurable business hours
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note: "Proposed configurable target: 240 business minutes (4 business hours under 08:00\u201317:00 UTC Mon\u2013Fri schedule; approaching threshold at 75% / 180 business minutes)."
  },
  Accessibility: {
    sla_rule_id: "SLA-RULE-ACCESS-CFG-01",
    category_name: "Accessibility",
    classification: "PROPOSED_CONFIGURABLE_RULE",
    target_business_minutes: 540,
    // 1 configurable business day (9 business hours)
    approaching_threshold_ratio: DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
    schedule_code: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code,
    rule_note: "Proposed configurable target: 540 business minutes (1 business day under 08:00\u201317:00 UTC Mon\u2013Fri schedule; approaching threshold at 75% / 405 business minutes)."
  }
};
function validateSlaConfiguration(params) {
  const category = params.category;
  const baseRule = category && OFFICIAL_CATEGORIES.includes(category) ? CONFIGURABLE_SLA_RULES[category] : null;
  if (!baseRule && !params.customRule) {
    return {
      valid: false,
      code: "INVALID_SLA_CATEGORY",
      message: `Invalid or missing SLA category '${String(params.category ?? "")}'. Must be one of the 4 official categories (${OFFICIAL_CATEGORIES.join(", ")}) or provide a valid custom SLA rule.`
    };
  }
  const targetMinutes = params.customRule?.target_business_minutes !== void 0 ? params.customRule.target_business_minutes : baseRule?.target_business_minutes;
  if (typeof targetMinutes !== "number" || !Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    return {
      valid: false,
      code: "INVALID_SLA_TARGET_MINUTES",
      message: `Invalid SLA target_business_minutes (${String(targetMinutes)}). Must be a positive finite integer.`
    };
  }
  const sched = params.schedule ?? DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;
  const startHour = sched.workday_start_hour_utc;
  const endHour = sched.workday_end_hour_utc;
  const workingDays = sched.working_days_of_week;
  if (typeof startHour !== "number" || typeof endHour !== "number" || !Number.isFinite(startHour) || !Number.isFinite(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour || !Array.isArray(workingDays) || workingDays.length === 0 || workingDays.some((d) => typeof d !== "number" || d < 0 || d > 6)) {
    return {
      valid: false,
      code: "INVALID_BUSINESS_SCHEDULE",
      message: "Invalid business schedule configuration: workday_start_hour_utc must be < workday_end_hour_utc within [0, 24], and working_days_of_week must contain at least one valid weekday [0..6]."
    };
  }
  if (params.startTimestampIso !== void 0) {
    const startMs = Date.parse(String(params.startTimestampIso || ""));
    if (isNaN(startMs)) {
      return {
        valid: false,
        code: "INVALID_SLA_TIMESTAMPS",
        message: `Invalid SLA start_timestamp '${String(params.startTimestampIso)}'.`
      };
    }
    if (params.evaluatedTimestampIso !== void 0) {
      const evalMs = Date.parse(String(params.evaluatedTimestampIso || ""));
      if (isNaN(evalMs) || evalMs < startMs) {
        return {
          valid: false,
          code: "INVALID_SLA_TIMESTAMPS",
          message: `Invalid SLA evaluated_timestamp '${String(params.evaluatedTimestampIso)}' (must be a valid ISO timestamp >= start_timestamp '${String(params.startTimestampIso)}').`
        };
      }
    }
  }
  const ratio = params.approachingThresholdRatio ?? params.customRule?.approaching_threshold_ratio ?? baseRule?.approaching_threshold_ratio ?? DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    return {
      valid: false,
      code: "INVALID_APPROACHING_THRESHOLD",
      message: `Invalid approaching_threshold_ratio (${String(ratio)}). Must be strictly between 0 and 1 (e.g. 0.75).`
    };
  }
  return {
    valid: true,
    code: "VALID",
    message: "SLA configuration is valid."
  };
}
function formatUtcDateKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function calculateElapsedBusinessMinutes(startIso, endIso, schedule = DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE) {
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
    const dayOfWeek = cursor.getUTCDay();
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
        totalBusinessMinutes += Math.round((overlapEnd - overlapStart) / 6e4);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return totalBusinessMinutes;
}
function calculateDueTimestampByBusinessMinutes(startIso, targetBusinessMinutes, schedule = DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE) {
  let remainingMinutes = Math.max(1, Math.round(targetBusinessMinutes));
  let cursorMs = Date.parse(startIso);
  if (isNaN(cursorMs)) {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  const holidaySet = new Set(schedule.holiday_dates_utc ?? []);
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
    if (schedule.working_days_of_week.includes(dayOfWeek) && !isHoliday && cursorMs < windowEndMs) {
      const effectiveStartMs = Math.max(cursorMs, windowStartMs);
      const availableMinutesToday = Math.floor(
        (windowEndMs - effectiveStartMs) / 6e4
      );
      if (remainingMinutes <= availableMinutesToday) {
        return new Date(
          effectiveStartMs + remainingMinutes * 6e4
        ).toISOString();
      }
      remainingMinutes -= availableMinutesToday;
    }
    const nextDay = new Date(windowStartMs);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    cursorMs = nextDay.getTime();
  }
  return new Date(cursorMs).toISOString();
}
function buildReproducibleSlaRecord(input) {
  const schedule = input.schedule ?? DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;
  const configValidation = validateSlaConfiguration({
    category: input.category,
    customRule: input.customRule,
    schedule,
    startTimestampIso: input.startTimestampIso,
    evaluatedTimestampIso: input.evaluatedTimestampIso,
    approachingThresholdRatio: input.approachingThresholdRatio
  });
  const fallbackCategory = OFFICIAL_CATEGORIES.includes(
    input.category
  ) ? input.category : "Registration";
  const baseRule = CONFIGURABLE_SLA_RULES[fallbackCategory];
  const targetBusinessMinutes = input.customRule?.target_business_minutes && input.customRule.target_business_minutes > 0 ? input.customRule.target_business_minutes : baseRule.target_business_minutes;
  const slaRuleId = input.customRule?.sla_rule_id || baseRule.sla_rule_id;
  const mode = input.calculationMode ?? "business_hours_configured";
  const classification = input.ruleClassification ?? input.customRule?.classification ?? baseRule.classification;
  const approachingRatio = input.approachingThresholdRatio ?? input.customRule?.approaching_threshold_ratio ?? baseRule.approaching_threshold_ratio ?? DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO;
  const safeApproachingRatio = typeof approachingRatio === "number" && approachingRatio > 0 && approachingRatio < 1 ? approachingRatio : DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO;
  const approachingThresholdMinutes = Math.ceil(
    targetBusinessMinutes * safeApproachingRatio
  );
  const rawStartMs = Date.parse(input.startTimestampIso);
  const startMs = isNaN(rawStartMs) ? Date.now() : rawStartMs;
  const startIso = new Date(startMs).toISOString();
  const resolvedIso = input.resolvedTimestampIso || null;
  const resolvedMs = resolvedIso ? Date.parse(resolvedIso) : NaN;
  const effectiveEvalIso = !isNaN(resolvedMs) && resolvedMs >= startMs ? resolvedIso : input.evaluatedTimestampIso;
  const rawEvalMs = Date.parse(effectiveEvalIso);
  const evalMs = isNaN(rawEvalMs) ? startMs : Math.max(startMs, rawEvalMs);
  const evalIso = new Date(evalMs).toISOString();
  const elapsedWallClockMinutes = Math.round((evalMs - startMs) / 6e4);
  const elapsedBusinessMinutes = configValidation.valid ? calculateElapsedBusinessMinutes(startIso, evalIso, schedule) : 0;
  const dueTimestamp = configValidation.valid ? calculateDueTimestampByBusinessMinutes(
    startIso,
    targetBusinessMinutes,
    schedule
  ) : startIso;
  const dueMs = Date.parse(dueTimestamp);
  const observedElapsedForBreach = mode === "wall_clock_24x7" ? elapsedWallClockMinutes : elapsedBusinessMinutes;
  const breachStatus = configValidation.valid ? observedElapsedForBreach > targetBusinessMinutes : false;
  const isResolvedOrClosed = Boolean(resolvedIso && !isNaN(resolvedMs)) || input.lifecycleStatus === "resolved" /* Resolved */ || input.lifecycleStatus === "closed" /* Closed */;
  const remainingBusinessMinutes = isResolvedOrClosed ? 0 : Math.max(0, targetBusinessMinutes - observedElapsedForBreach);
  const remainingWallClockMinutes = isResolvedOrClosed ? 0 : Math.max(0, Math.round((dueMs - evalMs) / 6e4));
  const overdueBusinessMinutes = breachStatus ? Math.max(0, observedElapsedForBreach - targetBusinessMinutes) : 0;
  const overdueWallClockMinutes = breachStatus ? Math.max(0, Math.round((evalMs - dueMs) / 6e4)) : 0;
  const isApproachingDeadline = configValidation.valid && !breachStatus && !isResolvedOrClosed && observedElapsedForBreach >= approachingThresholdMinutes;
  let firstResponseTimestamp = null;
  let actualResponseBusinessMinutes = null;
  let actualResponseWallClockMinutes = null;
  if (input.firstResponseTimestampIso) {
    const respMs = Date.parse(input.firstResponseTimestampIso);
    if (!isNaN(respMs) && respMs >= startMs) {
      firstResponseTimestamp = new Date(respMs).toISOString();
      actualResponseWallClockMinutes = Math.round((respMs - startMs) / 6e4);
      actualResponseBusinessMinutes = configValidation.valid ? calculateElapsedBusinessMinutes(
        startIso,
        firstResponseTimestamp,
        schedule
      ) : 0;
    }
  }
  let resolvedTimestamp = null;
  let resolutionBusinessMinutes = null;
  let resolutionWallClockMinutes = null;
  if (!isNaN(resolvedMs) && resolvedMs >= startMs) {
    resolvedTimestamp = new Date(resolvedMs).toISOString();
    resolutionWallClockMinutes = Math.round((resolvedMs - startMs) / 6e4);
    resolutionBusinessMinutes = configValidation.valid ? calculateElapsedBusinessMinutes(startIso, resolvedTimestamp, schedule) : 0;
  }
  let slaStatus = "within_sla";
  if (!configValidation.valid) {
    slaStatus = "invalid_configuration";
  } else if (isResolvedOrClosed) {
    slaStatus = breachStatus ? "resolved_after_breach" : "resolved_within_sla";
  } else if (breachStatus) {
    slaStatus = "breached";
  } else if (isApproachingDeadline) {
    slaStatus = "approaching_deadline";
  }
  let escalationStatus = "not_required";
  if (input.isTicketEscalated) {
    escalationStatus = "escalated";
  } else if (input.requiresEscalation || breachStatus) {
    escalationStatus = "escalation_missed";
  } else if (isApproachingDeadline) {
    escalationStatus = "pending_escalation";
  }
  const calculationHistory = [
    {
      step_index: 1,
      step_code: "SLA_CLOCK_INITIALIZED",
      recorded_at: startIso,
      description: `SLA clock anchored at ticket submission (${startIso}) under rule ${slaRuleId} (${classification}, target=${targetBusinessMinutes} business minutes).`
    },
    {
      step_index: 2,
      step_code: "OPERATING_CALENDAR_APPLIED",
      recorded_at: startIso,
      description: `Applied configurable schedule ${schedule.schedule_code} (timezone=${schedule.timezone_name || "UTC"}, hours=${schedule.workday_start_hour_utc}:00-${schedule.workday_end_hour_utc}:00, holidays_excluded=${(schedule.holiday_dates_utc || []).length}) -> due_timestamp=${dueTimestamp}.`
    }
  ];
  if (firstResponseTimestamp !== null) {
    calculationHistory.push({
      step_index: calculationHistory.length + 1,
      step_code: "FIRST_RESPONSE_RECORDED",
      recorded_at: firstResponseTimestamp,
      description: `First staff/system response recorded at ${firstResponseTimestamp} (${actualResponseBusinessMinutes} business mins / ${actualResponseWallClockMinutes} wall-clock mins).`
    });
  }
  if (resolvedTimestamp !== null) {
    calculationHistory.push({
      step_index: calculationHistory.length + 1,
      step_code: "RESOLUTION_RECORDED",
      recorded_at: resolvedTimestamp,
      description: `Ticket resolution recorded at ${resolvedTimestamp} (${resolutionBusinessMinutes} business mins / ${resolutionWallClockMinutes} wall-clock mins).`
    });
  }
  calculationHistory.push({
    step_index: calculationHistory.length + 1,
    step_code: "SLA_STATUS_EVALUATED",
    recorded_at: evalIso,
    description: !configValidation.valid ? `Configuration validation failed (${configValidation.code}): ${configValidation.message}` : `Evaluated at ${evalIso} (${mode}): elapsed_business=${elapsedBusinessMinutes}m, remaining_business=${remainingBusinessMinutes}m, overdue_business=${overdueBusinessMinutes}m, approaching_threshold=${approachingThresholdMinutes}m (${Math.round(safeApproachingRatio * 100)}%) -> sla_status=${slaStatus}, breach_status=${breachStatus}, escalation_status=${escalationStatus}.`
  });
  const calculationExplanation = !configValidation.valid ? `INVALID_SLA_CONFIGURATION (${configValidation.code}): ${configValidation.message}` : mode === "business_hours_configured" ? `Calculated under ${schedule.schedule_code} (${classification}): start=${startIso}, evaluated=${evalIso}, elapsed_business_minutes=${elapsedBusinessMinutes}m (wall_clock=${elapsedWallClockMinutes}m) vs target=${targetBusinessMinutes}m (approaching_at=${approachingThresholdMinutes}m, remaining=${remainingBusinessMinutes}m, overdue=${overdueBusinessMinutes}m) -> sla_status=${slaStatus}, breach_status=${breachStatus}.` : `ANOMALY_MODE (wall_clock_24x7): SLA clock ignored business schedule ${schedule.schedule_code} and compared raw wall_clock=${elapsedWallClockMinutes}m directly against target=${targetBusinessMinutes}m (true business elapsed=${elapsedBusinessMinutes}m) -> observed breach_status=${breachStatus}.`;
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
    holiday_dates_excluded_utc: [...schedule.holiday_dates_utc || []],
    timezone_name: schedule.timezone_name || "UTC",
    configuration_valid: configValidation.valid,
    configuration_error_code: configValidation.valid ? null : configValidation.code,
    configuration_error_message: configValidation.valid ? null : configValidation.message,
    calculation_history: calculationHistory
  };
}
function evaluateSourceApplicability(source, asOfDateIso) {
  const refDate = asOfDateIso.slice(0, 10);
  const isStateActive = source.lifecycle_state === "active" || source.lifecycle_state === "published";
  if (source.expiration_date && source.expiration_date < refDate) {
    return { isApplicable: false, reason: "expired_by_date" };
  }
  if (source.lifecycle_state === "superseded" || Boolean(source.superseded_by_policy_id)) {
    return {
      isApplicable: false,
      reason: source.lifecycle_state === "expired" ? "expired_by_date" : "superseded_version"
    };
  }
  if (!isStateActive) {
    return {
      isApplicable: false,
      reason: source.lifecycle_state === "expired" ? "expired_by_date" : "inactive_lifecycle"
    };
  }
  if (source.effective_date > refDate) {
    return { isApplicable: false, reason: "not_yet_effective" };
  }
  return { isApplicable: true, reason: "applicable_active" };
}
function detectConflictingPolicySources(params) {
  const conflicts = [];
  const { applicablePolicies, applicableArticles } = params;
  const extractSignificantSubjectTokens = (title) => {
    const ignore = /* @__PURE__ */ new Set([
      "policy",
      "policies",
      "and",
      "the",
      "for",
      "with",
      "institutional",
      "academic",
      "university",
      "campus",
      "legacy",
      "current",
      "active",
      "procedure",
      "rules",
      "financial",
      "aid",
      "student",
      "students",
      "services",
      "regulations",
      "office",
      "guidelines",
      "framework",
      "standard",
      "standards"
    ]);
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !ignore.has(w));
  };
  for (let i = 0; i < applicablePolicies.length; i++) {
    for (let j = i + 1; j < applicablePolicies.length; j++) {
      const polA = applicablePolicies[i];
      const polB = applicablePolicies[j];
      const sameCategoryOrDomain = polA.category_id === polB.category_id || polA.domain === polB.domain;
      const hasSupersessionLink = polA.supersedes_policy_id === polB.policy_id || polB.supersedes_policy_id === polA.policy_id || polA.superseded_by_policy_id === polB.policy_id || polB.superseded_by_policy_id === polA.policy_id;
      if (!sameCategoryOrDomain || hasSupersessionLink) {
        continue;
      }
      const tokensA = extractSignificantSubjectTokens(polA.title);
      const tokensB = new Set(extractSignificantSubjectTokens(polB.title));
      const sharedTitleTokens = tokensA.filter((t) => tokensB.has(t));
      const sectionMajorA = (polA.authoritative_section_ref.match(/Section\s+[0-9]+/i)?.[0] || "").toLowerCase();
      const sectionMajorB = (polB.authoritative_section_ref.match(/Section\s+[0-9]+/i)?.[0] || "").toLowerCase();
      const sameMajorSection = Boolean(sectionMajorA) && sectionMajorA === sectionMajorB;
      if ((sharedTitleTokens.length >= 2 || sameMajorSection) && polA.content.trim() !== polB.content.trim()) {
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
          conflictSummary: `Active policy ${polA.policy_id} (v${polA.version}, effective ${polA.effective_date}) and active policy ${polB.policy_id} (v${polB.version}, effective ${polB.effective_date}) both govern overlapping subject matter (${sharedTitleTokens.join(", ") || sectionMajorA}) with differing provisions. CampusResolve AI will not choose arbitrarily between conflicting active policies.`
        });
      }
    }
  }
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
        conflictSummary: `Published knowledge article ${art.article_id} (v${art.version}) cites policy version v${art.primary_policy_version}, which conflicts with active policy ${matchedPol.policy_id} (v${matchedPol.version}, effective ${matchedPol.effective_date}). Human verification is required.`
      });
    }
  }
  return conflicts;
}
function detectUnsupportedFactRequest(params) {
  const { query, applicablePolicies, applicableArticles } = params;
  if (applicablePolicies.length === 0 && applicableArticles.length === 0) {
    return { unsupportedClaimRequested: false, unsupportedClaimDetails: [] };
  }
  const normalizedQuery = query.toLowerCase();
  const combinedEvidence = [
    ...applicablePolicies.map((p) => `${p.title} ${p.summary} ${p.content}`),
    ...applicableArticles.map((a) => `${a.title} ${a.summary} ${a.content}`)
  ].join(" ").toLowerCase();
  const details = [];
  const unsupportedPatterns = [
    {
      regex: /\b(dollar|dollars|usd|filing fee|processing fee|late fee|application fee|fine|fines|monetary penalty|cost|price|charge|cash stipend|cash grant|reimbursement|refund amount|hourly wage)\b|\$[0-9,]+/i,
      evidenceRegex: /\b(filing fee|processing fee|late fee|application fee|monetary penalty|cash stipend|cash grant)\b|\$[0-9,]+/i,
      description: "Monetary fees, fines, dollar amounts, or cash reimbursements are not established in the retrieved active policy documents."
    },
    {
      regex: /\b(guaranteed|automatic approval|automatic waiver|automatic grant|deadline waiver|45-day|100%\s+guaranteed|private hotel|medical scribe|personal laptop giveaway|free macbook|visa sponsorship|legal representation)\b/i,
      evidenceRegex: /\b(guaranteed approval|automatic waiver|medical scribe|visa sponsorship|legal representation)\b/i,
      description: "Automatic approval guarantees or unscheduled supplemental services requested in the question are not supported by the active institutional policy text."
    }
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
    unsupportedClaimDetails: details
  };
}
function detectQueryAmbiguityAndClarifications(params) {
  const {
    query,
    detectedCategory,
    categoryScores,
    applicablePolicies,
    isUnsupportedTopic
  } = params;
  if (isUnsupportedTopic) {
    return { clarificationNeeded: false, clarificationQuestions: [] };
  }
  const normalizedQuery = query.trim().toLowerCase();
  const questions = [];
  const matchedCategories = Object.entries(categoryScores).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]);
  if (matchedCategories.length >= 2 && matchedCategories[0][1] - matchedCategories[1][1] <= 2) {
    questions.push(
      `Your question touches on both ${matchedCategories[0][0]} and ${matchedCategories[1][0]}. Are you asking primarily about ${matchedCategories[0][0]} rules or ${matchedCategories[1][0]} procedures?`
    );
  }
  const hasExplicitSourceId = /\b(pol-|kb-)[a-z0-9-]+\b/i.test(normalizedQuery);
  const asksGenericRuleQuestion = /\b(deadline|appeal|override|waiver|petition|form|how many days|when is|eligible|eligibility|request|drop|withdraw|status|policy|rule)\b/i.test(
    normalizedQuery
  );
  if (!detectedCategory && !hasExplicitSourceId && asksGenericRuleQuestion) {
    questions.push(
      "Which institutional domain does your question concern: Financial Aid (SAP appeals or disbursement), Registration (add/drop, withdrawal, or credit overload), IT (SSO/MFA or LMS access), or Accessibility (exam accommodations or captioning)?"
    );
    questions.push(
      "Are you asking about a standard within-deadline request or a post-deadline exception/appeal?"
    );
  }
  if (detectedCategory === "Registration" && !hasExplicitSourceId) {
    const mentionsDropOrWithdraw = /\b(drop|withdraw|withdrawal|leave)\b/i.test(
      normalizedQuery
    );
    const specifiesTiming = /\b(week\s*[0-9]+|10\s*business\s*days|first\s*10|retroactive|after\s*week|before\s*week|add\/drop\s*window|census)\b/i.test(
      normalizedQuery
    );
    if (mentionsDropOrWithdraw && !specifiesTiming) {
      questions.push(
        "Are you requesting to drop a course within the first 10 business days of the term (no W grade), withdraw through Week 8 (with a W grade), or petition for a retroactive withdrawal after Week 8?"
      );
    }
  }
  if (detectedCategory === "Financial Aid" && !hasExplicitSourceId) {
    const mentionsGenericAid = /\b(financial aid|aid|disbursement|grant|scholarship)\b/i.test(
      normalizedQuery
    ) && !/\b(sap|satisfactory academic progress|appeal|gpa|pace|census|proration|half-time|full-time|6 credit|12 credit|10 days)\b/i.test(
      normalizedQuery
    );
    if (mentionsGenericAid) {
      questions.push(
        "Are you inquiring about Satisfactory Academic Progress (SAP) appeal eligibility (2.0 GPA / 67% pace within 15 business days) or term aid disbursement timing and census-date credit proration (12 credits full-time vs. 6 credits half-time)?"
      );
    }
  }
  if (questions.length === 0 && applicablePolicies.length >= 2 && !hasExplicitSourceId && normalizedQuery.split(/\s+/).length <= 8) {
    questions.push(
      `Multiple active policies matched your question (${applicablePolicies.map((p) => `${p.policy_id} v${p.version}: "${p.title}"`).join(" and ")}). Which specific policy topic applies to your situation?`
    );
  }
  return {
    clarificationNeeded: questions.length > 0,
    clarificationQuestions: questions
  };
}
function retrieveApplicablePolicyEvidence(params) {
  const asOfDate = params.asOfDateIso || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const normalizedQuery = params.query.trim().toLowerCase();
  const STOP_WORDS = /* @__PURE__ */ new Set([
    "what",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "whose",
    "why",
    "how",
    "does",
    "did",
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "have",
    "has",
    "had",
    "are",
    "was",
    "were",
    "will",
    "would",
    "could",
    "should",
    "can",
    "may",
    "university",
    "campus",
    "policy",
    "policies",
    "rule",
    "rules",
    "still",
    "apply",
    "current",
    "about",
    "into",
    "after",
    "before",
    "under",
    "over",
    "between"
  ]);
  const queryTokens = normalizedQuery.replace(/[^a-z0-9\s/-]/g, " ").split(/\s+/).filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));
  const catResolution = resolveOfficialCategory(null, normalizedQuery);
  const detectedCategory = catResolution.category;
  const categoryScores = {
    "Financial Aid": 0,
    Registration: 0,
    IT: 0,
    Accessibility: 0
  };
  if (/\b(fafsa|pell|scholarship|disbursement|stipend|financial aid|tuition|sap|gpa|pace)\b/.test(
    normalizedQuery
  )) {
    categoryScores["Financial Aid"] += 4;
  }
  if (/\b(add\/drop|withdraw|withdrawal|waitlist|prerequisite|transcript|enrollment|registrar|credit overload|late drop|course)\b/.test(
    normalizedQuery
  )) {
    categoryScores.Registration += 4;
  }
  if (/\b(mfa|two-factor|password|sso|canvas|lms|vpn|wifi|eduroam|account locked|software license|fido2|totp)\b/.test(
    normalizedQuery
  )) {
    categoryScores.IT += 4;
  }
  if (/\b(accommodation|disability|screen reader|extended time|captioning|accessibility|section 504|braille|proctored|cart)\b/.test(
    normalizedQuery
  )) {
    categoryScores.Accessibility += 4;
  }
  const scoredPolicies = [];
  for (const policy of params.policies) {
    const hay = `${policy.policy_id} ${policy.title} ${policy.summary} ${policy.content} ${policy.domain}`.toLowerCase();
    let score = 0;
    if (detectedCategory && DOCUMENTED_ROUTING_RULES[detectedCategory].category_id === policy.category_id) {
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
            applicable: app.isApplicable
          });
        }
      }
    }
  }
  const scoredArticles = [];
  for (const article of params.articles) {
    const tagsStr = Array.isArray(article.tags) ? article.tags.join(" ") : "";
    const hay = `${article.article_id} ${article.title} ${article.summary} ${article.content} ${tagsStr}`.toLowerCase();
    let score = 0;
    if (detectedCategory && DOCUMENTED_ROUTING_RULES[detectedCategory].category_id === article.category_id) {
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
      const parentPol = params.policies.find(
        (p) => p.policy_id === article.primary_policy_id
      );
      const parentExpired = parentPol ? !evaluateSourceApplicability(parentPol, asOfDate).isApplicable : false;
      scoredArticles.push({
        article,
        score,
        applicable: app.isApplicable && !parentExpired
      });
    }
  }
  scoredPolicies.sort((a, b) => b.score - a.score);
  scoredArticles.sort((a, b) => b.score - a.score);
  const applicablePolicies = scoredPolicies.filter((p) => p.applicable).slice(0, 3).map((p) => p.policy);
  const expiredPoliciesExcluded = scoredPolicies.filter((p) => !p.applicable).slice(0, 3).map((p) => p.policy);
  const applicableArticles = scoredArticles.filter((a) => a.applicable).slice(0, 4).map((a) => a.article);
  const expiredArticlesExcluded = scoredArticles.filter((a) => !a.applicable).slice(0, 3).map((a) => a.article);
  const topScore = Math.max(
    scoredPolicies.find((p) => p.applicable)?.score ?? 0,
    scoredArticles.find((a) => a.applicable)?.score ?? 0
  );
  const explicitlyReferencesExpiredPolicy = expiredPoliciesExcluded.some(
    (ep) => normalizedQuery.includes(ep.policy_id.toLowerCase())
  ) || /\b(v1\.0|version 1\.0|expired policy|legacy policy|10 calendar days|14 calendar days|sms text codes|through week 3)\b/i.test(
    normalizedQuery
  );
  const isUnsupportedTopic = /\b(parking|dining hall|meal transfer|football|stadium|dormitory|roommate|alumni donation|shuttle|study abroad visa|gym membership|library late book|pet policy|campus bookstore discount)\b/.test(
    normalizedQuery
  ) || !detectedCategory && topScore < 4 && expiredPoliciesExcluded.length === 0 && expiredArticlesExcluded.length === 0;
  const isExceptionOrEscalationRequest = /\b(exception|waive|waiver|override|retroactive|second-level|special circumstance|dispute|lawsuit|grievance|extenuating|missed the deadline|after week 8|late drop petition|emergency override|emergency statutory|account compromise|privilege anomaly|denied|denial|appeal my|request an appeal|grant me)\b/.test(
    normalizedQuery
  );
  const ambiguityCheck = detectQueryAmbiguityAndClarifications({
    query: params.query,
    detectedCategory,
    categoryScores,
    applicablePolicies,
    isUnsupportedTopic
  });
  if (isUnsupportedTopic || applicablePolicies.length === 0 && applicableArticles.length === 0) {
    if (!isUnsupportedTopic && (expiredPoliciesExcluded.length > 0 || expiredArticlesExcluded.length > 0)) {
      return {
        detectedCategory,
        applicablePolicies: [],
        applicableArticles: [],
        expiredPoliciesExcluded,
        expiredArticlesExcluded,
        retrievalConfidence: 0.25,
        evidenceStatus: "expired_only",
        escalationRecommended: true,
        escalationReason: "Only expired, superseded, or not-yet-effective policy/article versions matched the query. Expired versions are rejected as current guidance and must be reviewed by an institutional officer.",
        hasConflictingSources: false,
        conflictingSources: [],
        clarificationNeeded: false,
        clarificationQuestions: [],
        unsupportedClaimRequested: false,
        unsupportedClaimDetails: [],
        expiredPolicyRejected: true
      };
    }
    if (ambiguityCheck.clarificationNeeded && !isUnsupportedTopic) {
      return {
        detectedCategory,
        applicablePolicies: [],
        applicableArticles: [],
        expiredPoliciesExcluded,
        expiredArticlesExcluded,
        retrievalConfidence: 0.3,
        evidenceStatus: "partial_or_ambiguous",
        escalationRecommended: true,
        escalationReason: "Query is underspecified across multiple institutional policy domains; clarification is required before providing a definitive policy determination.",
        hasConflictingSources: false,
        conflictingSources: [],
        clarificationNeeded: true,
        clarificationQuestions: ambiguityCheck.clarificationQuestions,
        unsupportedClaimRequested: false,
        unsupportedClaimDetails: [],
        expiredPolicyRejected: false
      };
    }
    return {
      detectedCategory,
      applicablePolicies: [],
      applicableArticles: [],
      expiredPoliciesExcluded,
      expiredArticlesExcluded,
      retrievalConfidence: 0,
      evidenceStatus: "unsupported_or_missing",
      escalationRecommended: true,
      escalationReason: "No applicable policy document or knowledge article in the repository covers this inquiry. Escalation to human review is required.",
      hasConflictingSources: false,
      conflictingSources: [],
      clarificationNeeded: false,
      clarificationQuestions: [],
      unsupportedClaimRequested: false,
      unsupportedClaimDetails: [],
      expiredPolicyRejected: false
    };
  }
  const conflictingSources = detectConflictingPolicySources({
    applicablePolicies,
    applicableArticles
  });
  const hasConflictingSources = conflictingSources.length > 0;
  const unsupportedFactCheck = detectUnsupportedFactRequest({
    query: params.query,
    applicablePolicies,
    applicableArticles
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
      evidenceStatus: "partial_or_ambiguous",
      escalationRecommended: true,
      escalationReason: `Conflicting active policy sources detected (${conflictingSources.map(
        (c) => `${c.sourceAId} v${c.sourceAVersion} vs. ${c.sourceBId} v${c.sourceBVersion}`
      ).join("; ")}). Human adjudication is required to resolve the policy conflict.`,
      hasConflictingSources: true,
      conflictingSources,
      clarificationNeeded: ambiguityCheck.clarificationNeeded,
      clarificationQuestions: ambiguityCheck.clarificationQuestions,
      unsupportedClaimRequested: unsupportedFactCheck.unsupportedClaimRequested,
      unsupportedClaimDetails: unsupportedFactCheck.unsupportedClaimDetails,
      expiredPolicyRejected: explicitlyReferencesExpiredPolicy
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
      evidenceStatus: "partial_or_ambiguous",
      escalationRecommended: true,
      escalationReason: `Query requests specific facts or guarantees not established in the active policy corpus (${unsupportedFactCheck.unsupportedClaimDetails.join(
        " "
      )}). Human review is recommended.`,
      hasConflictingSources: false,
      conflictingSources: [],
      clarificationNeeded: ambiguityCheck.clarificationNeeded,
      clarificationQuestions: ambiguityCheck.clarificationQuestions,
      unsupportedClaimRequested: true,
      unsupportedClaimDetails: unsupportedFactCheck.unsupportedClaimDetails,
      expiredPolicyRejected: explicitlyReferencesExpiredPolicy
    };
  }
  if (isExceptionOrEscalationRequest || ambiguityCheck.clarificationNeeded || topScore < 6) {
    const reason = ambiguityCheck.clarificationNeeded ? "Query is ambiguous or missing key situational parameters required to determine which policy provision applies; see clarification questions or escalate for human review." : "Query involves a policy exception, formal appeal, retroactive petition, or boundary condition where automated determination is not permitted without human adjudicator review.";
    return {
      detectedCategory,
      applicablePolicies,
      applicableArticles,
      expiredPoliciesExcluded,
      expiredArticlesExcluded,
      retrievalConfidence: Math.min(0.74, confidence),
      evidenceStatus: "partial_or_ambiguous",
      escalationRecommended: true,
      escalationReason: reason,
      hasConflictingSources: false,
      conflictingSources: [],
      clarificationNeeded: ambiguityCheck.clarificationNeeded,
      clarificationQuestions: ambiguityCheck.clarificationQuestions,
      unsupportedClaimRequested: false,
      unsupportedClaimDetails: [],
      expiredPolicyRejected: explicitlyReferencesExpiredPolicy
    };
  }
  return {
    detectedCategory,
    applicablePolicies,
    applicableArticles,
    expiredPoliciesExcluded,
    expiredArticlesExcluded,
    retrievalConfidence: confidence,
    evidenceStatus: "supported",
    escalationRecommended: false,
    escalationReason: null,
    hasConflictingSources: false,
    conflictingSources: [],
    clarificationNeeded: false,
    clarificationQuestions: [],
    unsupportedClaimRequested: false,
    unsupportedClaimDetails: [],
    expiredPolicyRejected: explicitlyReferencesExpiredPolicy
  };
}

// server-api/ops/workspace.ts
import { createClient as createClient2 } from "@supabase/supabase-js";

// server-api/auth/firebase-claim.ts
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
var EXPECTED_FIREBASE_PROJECT_ID = "campusresolveai";
var GOOGLE_SECURETOKEN_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
var cachedGoogleCerts = null;
function getExpectedProjectId() {
  return (process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || EXPECTED_FIREBASE_PROJECT_ID).trim();
}
var cachedFirebaseApp = null;
async function getFirebaseAdminAppAsync() {
  if (cachedFirebaseApp) return cachedFirebaseApp;
  try {
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const existing = getApps();
    if (existing.length > 0) {
      cachedFirebaseApp = existing[0];
      return cachedFirebaseApp;
    }
    const projectId = getExpectedProjectId();
    const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || "").trim().replace(/^["']|["']$/g, "");
    const rawPrivateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
    if (!clientEmail || !rawPrivateKey || rawPrivateKey.includes("YOUR_PRIVATE_KEY")) {
      return null;
    }
    const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
    cachedFirebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      }),
      projectId
    });
    return cachedFirebaseApp;
  } catch {
    return null;
  }
}
var cachedFirebaseAuth = null;
async function getLazyFirebaseAuth() {
  if (cachedFirebaseAuth) return cachedFirebaseAuth;
  try {
    const authModule = await import("firebase-admin/auth");
    cachedFirebaseAuth = authModule;
    return authModule;
  } catch {
    return null;
  }
}
async function fetchGoogleSecureTokenCerts(fetchFn = fetch) {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAtMs > now) {
    return cachedGoogleCerts.certs;
  }
  const response = await fetchFn(GOOGLE_SECURETOKEN_CERTS_URL, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(
      `Unable to retrieve Google SecureToken public certificates (HTTP ${response.status}).`
    );
  }
  const certs = await response.json();
  cachedGoogleCerts = {
    certs,
    expiresAtMs: now + 50 * 60 * 1e3
  };
  return certs;
}
async function verifyFirebaseTokenWithGooglePublicCerts(idToken, expectedProjectId = getExpectedProjectId(), fetchFn = fetch) {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new Error("Malformed Firebase ID token structure.");
  }
  const [headerB64, payloadB64, signatureB64] = segments;
  let header;
  let payload;
  try {
    header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf8")
    );
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
  } catch {
    throw new Error("Invalid base64url encoding in Firebase ID token.");
  }
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Unsupported Firebase ID token signature algorithm.");
  }
  const nowSeconds = Math.floor(Date.now() / 1e3);
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  if (exp <= nowSeconds) {
    throw new Error("Firebase ID token has expired.");
  }
  if (iat > nowSeconds + 300) {
    throw new Error("Firebase ID token issued-at timestamp is invalid.");
  }
  const aud = typeof payload.aud === "string" ? payload.aud : "";
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  const iss = typeof payload.iss === "string" ? payload.iss : "";
  if (aud !== expectedProjectId || iss !== expectedIssuer) {
    throw new Error("Firebase ID token audience or issuer does not match project.");
  }
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub || sub.length > 128) {
    throw new Error("Firebase ID token is missing a valid subject (sub) claim.");
  }
  const certs = await fetchGoogleSecureTokenCerts(fetchFn);
  const certificatePem = certs[header.kid];
  if (!certificatePem) {
    throw new Error("No matching Google SecureToken public key found for token kid.");
  }
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureValid = verifier.verify(
    certificatePem,
    Buffer.from(signatureB64, "base64url")
  );
  if (!signatureValid) {
    throw new Error("Firebase ID token cryptographic signature verification failed.");
  }
  return {
    uid: sub,
    email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "",
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name.trim() : void 0,
    aud,
    iss,
    roleClaim: typeof payload.role === "string" ? payload.role : void 0,
    verifiedVia: "google_securetoken_x509"
  };
}
async function verifyFirebaseIdTokenServerSide(idToken, fetchFn = fetch) {
  const expectedProjectId = getExpectedProjectId();
  const adminApp = await getFirebaseAdminAppAsync();
  if (adminApp) {
    try {
      const authMod = await getLazyFirebaseAuth();
      if (authMod?.getAuth) {
        const adminAuth = authMod.getAuth(adminApp);
        const decoded = await adminAuth.verifyIdToken(idToken, true);
        return {
          uid: decoded.uid,
          email: (decoded.email || "").trim().toLowerCase(),
          emailVerified: decoded.email_verified === true,
          name: typeof decoded.name === "string" ? decoded.name.trim() : void 0,
          aud: typeof decoded.aud === "string" ? decoded.aud : expectedProjectId,
          iss: typeof decoded.iss === "string" ? decoded.iss : `https://securetoken.google.com/${expectedProjectId}`,
          roleClaim: typeof decoded.role === "string" ? decoded.role : void 0,
          verifiedVia: "firebase_admin"
        };
      }
    } catch (adminErr) {
      const msg = adminErr instanceof Error ? adminErr.message : "";
      const isTokenInvalidError = msg.includes("id-token-expired") || msg.includes("id-token-revoked") || msg.includes("argument-error");
      if (isTokenInvalidError) {
        throw adminErr;
      }
    }
  }
  return verifyFirebaseTokenWithGooglePublicCerts(
    idToken,
    expectedProjectId,
    fetchFn
  );
}

// src/services/dataGenerator.ts
var DETERMINISTIC_SEED = 20261022;
var BASE_ANCHOR_DATE_ISO = "2026-09-01T13:30:00+05:30";
function formatIsoWithIstOffset(dateInput) {
  const d = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1e3;
  const istDate = new Date(istMs);
  const pad = (n) => String(n).padStart(2, "0");
  const year = istDate.getUTCFullYear();
  const month = pad(istDate.getUTCMonth() + 1);
  const day = pad(istDate.getUTCDate());
  const hours = pad(istDate.getUTCHours());
  const minutes = pad(istDate.getUTCMinutes());
  const seconds = pad(istDate.getUTCSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}
var DeterministicRng = class {
  constructor(seed = DETERMINISTIC_SEED) {
    this.state = seed >>> 0;
  }
  nextFloat() {
    let t = this.state += 1831565813;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  nextInt(minInclusive, maxInclusive) {
    const r = this.nextFloat();
    return Math.floor(r * (maxInclusive - minInclusive + 1)) + minInclusive;
  }
  pick(items) {
    return items[this.nextInt(0, items.length - 1)];
  }
};
var FIRST_NAMES = [
  "Elena",
  "Marcus",
  "Priya",
  "David",
  "Sofia",
  "Liam",
  "Amara",
  "Noah",
  "Hannah",
  "Mateo",
  "Zoe",
  "Julian",
  "Nadia",
  "Caleb",
  "Maya",
  "Isaac",
  "Claire",
  "Devon",
  "Lin",
  "Tariq",
  "Aarav",
  "Ananya",
  "Rohan",
  "Meera",
  "Vikram"
];
var LAST_NAMES = [
  "Rostova",
  "Vance",
  "Patel",
  "Kim",
  "Alvarez",
  "OConnor",
  "Mensah",
  "Lindqvist",
  "ben-David",
  "Nakamura",
  "Moreau",
  "Castillo",
  "Ibrahim",
  "Kowalski",
  "Sterling",
  "Okafor",
  "Chen",
  "Bhatia",
  "Mercer",
  "Silva",
  "Sharma",
  "Reddy",
  "Deshmukh",
  "Verma",
  "Nair"
];
var DEPARTMENTS = [
  "Electrical Engineering & Computer Science",
  "Department of Economics",
  "School of Public Policy",
  "Department of Biological Sciences",
  "Department of Mathematics",
  "College of Humanities & Arts",
  "School of Architecture & Planning",
  "Department of Mechanical Engineering"
];
var POLICY_SPECS = [
  // --------------------------------------------------------------------------
  // FINANCIAL AID (FINAID) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
  {
    domain: "FINAID",
    category: "Financial Aid",
    categoryId: "CAT-FINAID",
    seq: 1,
    title: "Satisfactory Academic Progress (SAP) & Financial Aid Appeal Policy (Legacy)",
    version: "1.0",
    effectiveDate: "2025-01-01",
    expirationDate: "2026-06-30",
    lifecycleState: "expired",
    supersededBySeq: 2,
    sectionRef: "Section 4.1 (Superseded)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 EXPIRED] Legacy SAP appeal deadline rules effective through June 30, 2026.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-06-30), students placed on financial aid suspension had 10 calendar days from term start to submit a Satisfactory Academic Progress (SAP) appeal with supporting documentation to the Office of Financial Aid & Scholarships.",
    keyFactConstraint: "Legacy 10-calendar-day window (Expired 2026-06-30)"
  },
  {
    domain: "FINAID",
    category: "Financial Aid",
    categoryId: "CAT-FINAID",
    seq: 2,
    title: "Satisfactory Academic Progress (SAP) & Financial Aid Appeal Policy",
    version: "2.0",
    effectiveDate: "2026-07-01",
    expirationDate: null,
    lifecycleState: "active",
    supersedesSeq: 1,
    sectionRef: "Section 4.2 (Current)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Current SAP appeal requirements, 15-business-day submission window, and committee escalation rules.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Effective July 1, 2026 (Version 2.0, superseding POL-FINAID-2026-001 v1.0), students whose cumulative GPA falls below 2.0 or pace of completion falls below 67% may submit a written Satisfactory Academic Progress (SAP) appeal within 15 business days of notification. Standard eligibility verifications are handled by the Office of Financial Aid & Scholarships; second-level SAP appeals and emergency statutory waivers must be escalated to the Financial Aid Appeals & Compliance Review Committee.",
    keyFactConstraint: "15 business days from notification; min 2.0 GPA and 67% pace"
  },
  {
    domain: "FINAID",
    category: "Financial Aid",
    categoryId: "CAT-FINAID",
    seq: 3,
    title: "Term Aid Disbursement & Census Date Proration Policy",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 2.3",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Rules governing grant/scholarship disbursement timing and enrollment intensity proration at census date.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Institutional grants and federal aid disburse no earlier than 10 days prior to the official term start date, contingent upon active enrollment in at least 6 credit hours for half-time status or 12 credit hours for full-time status locked at the add/drop census deadline.",
    keyFactConstraint: "Disbursement up to 10 days before term start; 12 credits full-time, 6 credits half-time"
  },
  {
    domain: "FINAID",
    category: "Financial Aid",
    categoryId: "CAT-FINAID",
    seq: 4,
    title: "Emergency Hardship Relief Grants & Statutory Aid Waiver Regulations",
    version: "1.0",
    effectiveDate: "2026-02-01",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 5.1 (Conflicting Provision)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Emergency micro-grants for sudden hardship and statutory tuition waivers.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Students experiencing acute financial disruption may petition for emergency grant disbursements of up to $2,500. Note: Section 5.1 permits emergency disbursements within 48 business hours of verification, representing a priority exception to standard census proration rules under POL-FINAID-2026-003.",
    keyFactConstraint: "Emergency hardship cap $2,500; requires verification within 48 hours; escalates on dispute"
  },
  {
    domain: "FINAID",
    category: "Financial Aid",
    categoryId: "CAT-FINAID",
    seq: 5,
    title: "Institutional Merit Scholarship Retention & Renewal Standards",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 3.4",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Merit scholarship renewal GPA thresholds, continuous enrollment requirements, and probation grace periods.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Institutional merit scholarships require a minimum cumulative GPA of 3.20 evaluated at the end of each spring semester. Learners failing the threshold receive one probationary grace semester before award cancellation.",
    keyFactConstraint: "3.20 renewal GPA; 1-semester grace period prior to termination"
  },
  {
    domain: "FINAID",
    category: "Financial Aid",
    categoryId: "CAT-FINAID",
    seq: 6,
    title: "International Student Financial Aid & Campus Employment Regulations",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 6.2",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Restrictions and institutional fellowship disbursements for F-1 / J-1 visa holders.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] International students holding F-1/J-1 visas may receive departmental fellowships and emergency campus employment awards up to 20 hours per week during academic terms, subject to International Student Center immigration verification.",
    keyFactConstraint: "Max 20 hours per week campus employment; immigration check required"
  },
  // --------------------------------------------------------------------------
  // REGISTRATION (REG) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
  {
    domain: "REG",
    category: "Registration",
    categoryId: "CAT-REG",
    seq: 1,
    title: "Course Add/Drop & Late Withdrawal Petition Policy (Legacy)",
    version: "1.0",
    effectiveDate: "2025-01-01",
    expirationDate: "2026-05-31",
    lifecycleState: "expired",
    supersededBySeq: 2,
    sectionRef: "Section 3.1 (Superseded)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 EXPIRED] Legacy course drop and withdrawal rules effective through May 31, 2026.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-05-31), students could drop courses without a W grade through Week 3 of the semester.",
    keyFactConstraint: "Legacy Week 3 add/drop window (Expired 2026-05-31)"
  },
  {
    domain: "REG",
    category: "Registration",
    categoryId: "CAT-REG",
    seq: 2,
    title: "Course Add/Drop & Late Withdrawal Petition Policy",
    version: "2.0",
    effectiveDate: "2026-06-01",
    expirationDate: null,
    lifecycleState: "active",
    supersedesSeq: 1,
    sectionRef: "Section 3.2 (Current)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Current 10-business-day add/drop window, W-grade withdrawal deadline, and retroactive petition escalation.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Effective June 1, 2026 (Version 2.0, superseding POL-REG-2026-001 v1.0), standard course additions and drops without transcript notation must be completed within the first 10 business days of the term via the Office of the University Registrar. Course withdrawals with a W notation are permitted through the end of Week 8. Any retroactive withdrawal or late drop petition after Week 8 requires documented extenuating circumstances and mandatory escalation to the Academic Senate Registration Review Board.",
    keyFactConstraint: "10 business days for add/drop without W; Week 8 withdrawal deadline; post-Week 8 escalates to Academic Senate Registration Review Board"
  },
  {
    domain: "REG",
    category: "Registration",
    categoryId: "CAT-REG",
    seq: 3,
    title: "Credit Overload & Cross-Departmental Prerequisite Override Policy",
    version: "1.0",
    effectiveDate: "2026-01-10",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 5.4",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Maximum term credit cap (18 credits) and approval rules for 19\u201322 credit overload petitions.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Standard undergraduate enrollment is capped at 18 credit hours per regular term. Requests to enroll in 19 to 22 credit hours require a minimum cumulative GPA of 3.30 and advisor attestation processed by the Office of the University Registrar.",
    keyFactConstraint: "18 credit standard cap; 19-22 credit overload requires 3.30 GPA"
  },
  {
    domain: "REG",
    category: "Registration",
    categoryId: "CAT-REG",
    seq: 4,
    title: "Grade Forgiveness & Course Repetition Regulations",
    version: "1.0",
    effectiveDate: "2026-01-10",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 4.3",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Maximum course repeat allowances and grade replacement computation rules.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Undergraduate students may repeat up to 3 courses (maximum 12 credit hours) for grade replacement. The second earned grade replaces the initial grade in cumulative GPA computation, though all attempts remain permanently visible on transcript.",
    keyFactConstraint: "Max 3 courses repeated for grade replacement; all attempts on transcript"
  },
  {
    domain: "REG",
    category: "Registration",
    categoryId: "CAT-REG",
    seq: 5,
    title: "Independent Study, Cross-Registration & Dean Approval Workflows",
    version: "1.0",
    effectiveDate: "2026-01-10",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 7.1",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Requirements for variable credit independent study and consortium cross-registration.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Enrolling in independent study courses requires a structured syllabus, supervising faculty signature, and department chair approval filed with the Registrar no later than the add/drop census date.",
    keyFactConstraint: "Faculty syllabus and chair approval required before census date"
  },
  {
    domain: "REG",
    category: "Registration",
    categoryId: "CAT-REG",
    seq: 6,
    title: "Academic Standing, Probation & Reinstatement Appeals",
    version: "1.0",
    effectiveDate: "2026-01-10",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 8.2",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Good standing thresholds, academic probation triggers, and suspension appeal criteria.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Undergraduates with cumulative GPA below 2.00 are placed on academic probation. Two consecutive probationary terms trigger academic suspension, which may be appealed within 10 business days to the Dean of Academic Affairs.",
    keyFactConstraint: "Min 2.00 GPA for good standing; suspension appeal window is 10 business days"
  },
  // --------------------------------------------------------------------------
  // IT (IT) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
  {
    domain: "IT",
    category: "IT",
    categoryId: "CAT-IT",
    seq: 1,
    title: "Institutional Identity, SSO & Multi-Factor Authentication Policy (Legacy)",
    version: "1.0",
    effectiveDate: "2025-01-01",
    expirationDate: "2026-04-30",
    lifecycleState: "expired",
    supersededBySeq: 2,
    sectionRef: "Section 1.1 (Superseded)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 EXPIRED] Legacy SMS-based two-factor reset rules expired April 30, 2026.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-04-30), SMS text codes were permitted as a primary multi-factor authentication method for institutional accounts.",
    keyFactConstraint: "Legacy SMS MFA allowed (Expired 2026-04-30)"
  },
  {
    domain: "IT",
    category: "IT",
    categoryId: "CAT-IT",
    seq: 2,
    title: "Institutional Identity, SSO & Multi-Factor Authentication Policy",
    version: "2.0",
    effectiveDate: "2026-05-01",
    expirationDate: null,
    lifecycleState: "active",
    supersedesSeq: 1,
    sectionRef: "Section 1.2 (Current)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Current hardware token / authenticator app MFA requirement and identity verification procedures.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Effective May 1, 2026 (Version 2.0, superseding POL-IT-2026-001 v1.0), all learners, instructors, and staff must use FIDO2 passkeys or TOTP authenticator apps for Single Sign-On (SSO). Routine MFA device resets are handled by the Campus IT Operations & Identity Desk after photo-ID verification. Suspected account compromise or privilege anomalies must be escalated immediately to the Information Security & Infrastructure Escalation Unit.",
    keyFactConstraint: "FIDO2/TOTP MFA required; SMS deprecated; compromise escalates to Information Security & Infrastructure Escalation Unit"
  },
  {
    domain: "IT",
    category: "IT",
    categoryId: "CAT-IT",
    seq: 3,
    title: "LMS Course Shell Provisioning & Academic Software Licensing Policy",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 6.1",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Automated LMS roster synchronization and instructional lab software seat allocation.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] LMS course shells are provisioned 30 days before term start and synchronize roster changes every 4 hours with the Registrar feed. Special seat allocations for instructional lab software are fulfilled by the Campus IT Operations & Identity Desk.",
    keyFactConstraint: "LMS shells provisioned 30 days prior; 4-hour roster sync interval"
  },
  {
    domain: "IT",
    category: "IT",
    categoryId: "CAT-IT",
    seq: 4,
    title: "Student Hardware Loaner & Digital Device Support Policy",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 4.1",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Term loaner laptop eligibility, checkout periods, and replacement liabilities.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Full-time enrolled students without computing hardware may request semester laptop loaners through Campus IT Operations. Hardware checkouts are subject to financial hardship verification and must be returned within 48 hours of term conclusion.",
    keyFactConstraint: "Semester loaner for full-time students; 48-hour post-term return window"
  },
  {
    domain: "IT",
    category: "IT",
    categoryId: "CAT-IT",
    seq: 5,
    title: "Instructional Software Licensing & High-Performance Compute Cluster Access",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 7.3",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] GPU cluster access, MATLAB/SPSS campus licenses, and storage allocations.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Access to specialized departmental high-performance compute clusters and floating software licenses is provisioned to enrolled STEM and research students based on faculty sponsor endorsement.",
    keyFactConstraint: "Faculty sponsor required for GPU/HPC cluster access; standard storage quota 100GB"
  },
  {
    domain: "IT",
    category: "IT",
    categoryId: "CAT-IT",
    seq: 6,
    title: "Acceptable Network Use, Cybersecurity Incident & Vulnerability Reporting",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 9.2",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Campus network monitoring, banned protocol policies, and mandatory incident reporting.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Connecting unauthorized network infrastructure, running port scans, or hosting pirated content on the campus network is strictly prohibited. Confirmed security incidents trigger immediate port isolation and referral to the Information Security Unit.",
    keyFactConstraint: "Immediate network isolation upon policy violation; no rogue routers allowed"
  },
  // --------------------------------------------------------------------------
  // ACCESSIBILITY (ACCESS) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
  {
    domain: "ACCESS",
    category: "Accessibility",
    categoryId: "CAT-ACCESS",
    seq: 1,
    title: "Academic Accommodations & Testing Notice Policy (Legacy)",
    version: "1.0",
    effectiveDate: "2025-01-01",
    expirationDate: "2026-06-15",
    lifecycleState: "expired",
    supersededBySeq: 2,
    sectionRef: "Section 7.1 (Superseded)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 EXPIRED] Legacy 14-day proctored testing notice requirement expired June 15, 2026.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-06-15), students were required to submit proctored exam accommodation booking requests 14 calendar days prior to the examination date.",
    keyFactConstraint: "Legacy 14-day testing notice (Expired 2026-06-15)"
  },
  {
    domain: "ACCESS",
    category: "Accessibility",
    categoryId: "CAT-ACCESS",
    seq: 2,
    title: "Academic Accommodations & Proctored Testing Notice Policy",
    version: "2.0",
    effectiveDate: "2026-06-16",
    expirationDate: null,
    lifecycleState: "active",
    supersedesSeq: 1,
    sectionRef: "Section 7.2 (Current)",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Current 5-business-day proctored exam notice, accommodation letters, and Section 504 escalation.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Effective June 16, 2026 (Version 2.0, superseding POL-ACCESS-2026-001 v1.0), students holding approved accommodation letters from the Disability & Accessibility Services Office must submit proctored exam scheduling requests at least 5 business days before the exam. Accommodation implementation disputes, denials, or urgent barrier reports must be escalated to the ADA / Section 504 Compliance Review Panel.",
    keyFactConstraint: "5 business days exam scheduling notice; disputes escalate to ADA / Section 504 Compliance Review Panel"
  },
  {
    domain: "ACCESS",
    category: "Accessibility",
    categoryId: "CAT-ACCESS",
    seq: 3,
    title: "Assistive Technology, Real-Time Captioning & Accessible Media Policy",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 8.3",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Provisioning of screen-reader compatible course packets, CART captioning, and ergonomic classroom seating.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] The Disability & Accessibility Services Office coordinates real-time CART captioning, Braille/tactile graphics conversion, and screen-reader accessible PDF remediation for enrolled learners within 3 business days of request intake.",
    keyFactConstraint: "3 business days for accessible media/CART setup"
  },
  {
    domain: "ACCESS",
    category: "Accessibility",
    categoryId: "CAT-ACCESS",
    seq: 4,
    title: "Emotional Support Animal (ESA) & Campus Housing Accommodation Policy",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 4.5",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] ESA verification, veterinary health records, and residence hall accommodation approval.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Approved emotional support animals in university housing require documentation from a licensed mental health clinician and up-to-date rabies vaccination records submitted at least 30 calendar days prior to move-in.",
    keyFactConstraint: "Licensed clinician documentation and 30-day advance notice for ESA housing"
  },
  {
    domain: "ACCESS",
    category: "Accessibility",
    categoryId: "CAT-ACCESS",
    seq: 5,
    title: "Peer Note-Taking Services & Lecture Audio Recording Policy",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 6.1",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Provision of anonymous peer note-takers and non-disclosure audio recording agreements.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Students authorized for peer note-taking receive anonymized lecture notes uploaded to the portal within 24 hours of each class session. Audio recording of lectures is permitted exclusively for personal educational use upon signing the institutional disability agreement.",
    keyFactConstraint: "24-hour note upload standard; personal educational use only for recordings"
  },
  {
    domain: "ACCESS",
    category: "Accessibility",
    categoryId: "CAT-ACCESS",
    seq: 6,
    title: "Campus Physical Access Barrier Remediation & Temporary Mobility Requests",
    version: "1.0",
    effectiveDate: "2026-01-15",
    expirationDate: null,
    lifecycleState: "active",
    sectionRef: "Section 9.4",
    summary: "[SYNTHETIC DEMONSTRATION POLICY \u2014 ACTIVE] Urgent barrier reporting, elevator outages, and temporary paratransit shuttle passes.",
    content: "[SYNTHETIC DEMONSTRATION POLICY] Physical access barriers (e.g. elevator breakdown, power door failure) must be triaged as urgent requests by Disability Services within 2 business hours, with temporary accessible classroom relocation arranged if needed.",
    keyFactConstraint: "2-hour response for urgent mobility barriers; classroom relocation protocol"
  }
];
var REQUEST_STYLE_LIBRARY = {
  "Financial Aid": [
    {
      style: "hinglish",
      subject: "Fee paid hai but portal pe pending dikha raha hai, please help",
      description: "Fee paid hai online banking se yesterday morning, but student portal pe abhi bhi balance pending dikha raha hai. Registration hold lag jayega kya? Please check transaction and update ASAP."
    },
    {
      style: "urgent_deadline",
      subject: "Urgent: Scholarship disbursement hold with fee deadline today",
      description: "My merit scholarship of $3,500 has not been disbursed and the tuition payment deadline is 5:00 PM today. A late fee will be charged if this hold is not cleared immediately."
    },
    {
      style: "typo",
      subject: "My shcolarship amount is not creditted, whome should i contact?",
      description: "Sir, my term grant and shcolarship is still not reflecting in my acccount. I submitted FAFSA papers last week. Whome should I contact to get this fixed?"
    },
    {
      style: "multi_issue",
      subject: "Dual issue: SAP appeal submission and tuition payment installment plan",
      description: "I need to submit my Satisfactory Academic Progress appeal documentation following a medical leave, and simultaneously enroll in the monthly tuition installment plan before the census date."
    },
    {
      style: "vague",
      subject: "Financial aid question please check",
      description: "Can someone check my account? Something looks wrong with the total amount for Fall semester."
    },
    {
      style: "appeal",
      subject: "Formal SAP Appeal & Reinstatement Petition under extenuating medical circumstances",
      description: "I submit a formal written Satisfactory Academic Progress (SAP) appeal petition for Fall 2026. Cumulative GPA fell below 2.0 due to documented hospitalization; comprehensive physician letters and academic plan attached."
    },
    {
      style: "formal",
      subject: "Inquiry regarding Census Date Aid Proration for 9 credit enrollment",
      description: "I am currently registered for 9 credit hours and would like to verify how my institutional grant disbursement will be prorated between half-time and three-quarter time status."
    }
  ],
  Registration: [
    {
      style: "urgent_deadline",
      subject: "registration is not allowing me to select the subject and deadline is today",
      description: "The portal is throwing prerequisite error when trying to add CS-402, but I already passed the equivalent course at community college. Today is the final add deadline, please assist!"
    },
    {
      style: "hinglish",
      subject: "Course drop kiya tha still timetable me reflect ho raha hai, please check",
      description: "Hi, I dropped one course MATH-215 yesterday before the deadline but it is still showing in my active timetable and Canvas. Please confirm if drop was successful."
    },
    {
      style: "typo",
      subject: "regsitration portal throwng error for credit overload",
      description: "I am tryng to register for 19 credits with 3.4 GPA but regsitration system says max credit limit 18 reached. Need overload approval."
    },
    {
      style: "multi_issue",
      subject: "Late drop petition for PHYS-240 and prerequisite override for EECS-280",
      description: "I need to petition for late withdrawal from PHYS-240 due to illness, and also require an advisor override to register for EECS-280 for next term."
    },
    {
      style: "vague",
      subject: "I am not sure whether I should submit the withdrawal form or appeal first",
      description: "My grade is very low in one subject and week 8 is ending. What is the process to withdraw without hurting my record?"
    },
    {
      style: "appeal",
      subject: "Academic Senate Retroactive Withdrawal Petition post Week-8 deadline",
      description: "Formal petition for retroactive late withdrawal with W grade notation following unexpected emergency surgery. Submitting attending surgeon documentation for Academic Senate review."
    },
    {
      style: "formal",
      subject: "Petition for 20 Credit Hour Undergraduate Overload (GPA 3.65)",
      description: "Submitting request for credit overload to enroll in 20 semester hours to complete dual-degree requirements. Cumulative GPA 3.65 with signed faculty advisor attestation."
    }
  ],
  IT: [
    {
      style: "urgent_deadline",
      subject: "My account is locked and I have an assignment submission today",
      description: "My university SSO account got locked after multiple failed attempts and my final project submission deadline is in 3 hours on Canvas LMS. Please reset my MFA access urgently!"
    },
    {
      style: "hinglish",
      subject: "MFA authenticator app change karna hai, purana phone reset ho gaya tha",
      description: "I lost access to my Microsoft Authenticator app because my phone was factory reset. Cannot login to student email or portal. Please help reset two-factor auth."
    },
    {
      style: "typo",
      subject: "cannot acess instructional lab GPU server ssh connection timedout",
      description: "Trying to connect to cluster gpu-lab01.campusresolve.edu for machine learnng assignment, getting connecton refused error. Please verify my lab quota."
    },
    {
      style: "multi_issue",
      subject: "Laptop loaner request for term and Canvas LMS enrollment missing for BIO-172",
      description: "My personal laptop broke and I need to request an IT semester loaner device, and also my registration for BIO-172 is not syncing to my Canvas course list."
    },
    {
      style: "vague",
      subject: "Wifi and portal not working properly",
      description: "Eduroam wifi keeps disconnecting in library and my portal won't open."
    },
    {
      style: "appeal",
      subject: "Urgent Information Security Incident Report: Suspected credential compromise",
      description: "Reporting suspicious foreign IP login activity and unauthorized forwarding rules detected on my institutional email account. Requesting immediate token revocation and security audit."
    },
    {
      style: "formal",
      subject: "Request for specialized instructional software license allocation (MATLAB/Simulink)",
      description: "Requesting instructional lab license activation for engineering senior capstone course. Faculty course approval reference EECS-482 attached."
    }
  ],
  Accessibility: [
    {
      style: "urgent_deadline",
      subject: "Exam is in 3 days: Proctored testing accommodation room booking pending",
      description: "I submitted my accommodation letter for double time on exams, but the testing center has not confirmed my room booking for Friday midterms. Please confirm proctor assignment!"
    },
    {
      style: "hinglish",
      subject: "Testing accommodation letter approve hua tha but professor bol rahe hain notice late hai",
      description: "I have approved letter for 1.5x extended exam time. But course instructor says they did not receive notice 5 days in advance. Can Disability Office please contact instructor directly?"
    },
    {
      style: "typo",
      subject: "screen reader pdf course packet formating broken and unreadable",
      description: "The PDF packet uploaded for HIST-201 cannot be read by NVDA screen reader, image scans are missing OCR text. Need converted accessible file."
    },
    {
      style: "multi_issue",
      subject: "Peer note-taker assignment request and elevator outage reporting in East Hall",
      description: "Requesting an assigned peer note-taker for chemistry lectures, and also reporting that the south elevator in East Hall is out of service, blocking second floor wheelchair access."
    },
    {
      style: "vague",
      subject: "Need help with disability services appointment",
      description: "I need to schedule a meeting to renew my accommodation paperwork for this semester."
    },
    {
      style: "appeal",
      subject: "Formal Section 504 Grievance: Denial of approved exam accommodation",
      description: "Submitting formal administrative escalation to ADA / Section 504 Compliance Review Panel regarding course instructor refusal to honor approved distraction-reduced testing environment."
    },
    {
      style: "formal",
      subject: "Request for Real-Time CART Captioning Provider for Lecture Series",
      description: "Approved accommodation request for real-time CART captioning for daily 10:00 AM lecture. Course syllabus and classroom schedule submitted for scheduling."
    }
  ]
};
function generateDeterministicDataset(options = {}) {
  const seed = options.seed ?? DETERMINISTIC_SEED;
  const mode = options.mode ?? "full";
  const rng = new DeterministicRng(seed);
  const ticketCount = options.ticketCount ?? (mode === "full" ? 5e3 : 50);
  const knowledgeArticleCount = options.knowledgeArticleCount ?? (mode === "full" ? 200 : 24);
  const messagesPerTicket = options.messagesPerTicket ?? 4;
  const requesterCount = options.requesterCount ?? (mode === "full" ? 500 : 25);
  const anchorMs = Date.parse(BASE_ANCHOR_DATE_ISO);
  const roles = [
    {
      role_id: "ROLE-LEARNER",
      role_code: "learner" /* Learner */,
      role_name: "Learner",
      institutional_scope: "Undergraduate & Graduate Student Cohort",
      description: "Submits academic and support requests, queries policy-grounded answers, and provides resolution feedback.",
      allowed_actions: ["submit_academic_petition"],
      can_be_assigned_tickets: false,
      can_publish_policies: false,
      can_approve_escalations: false,
      effective_from: "2025-08-01",
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      role_id: "ROLE-INSTRUCTOR",
      role_code: "instructor" /* Instructor */,
      role_name: "Instructor",
      institutional_scope: "Faculty & Course Instructional Staff",
      description: "Submits course-related requests, attests to student petitions, and proposes policy revisions.",
      allowed_actions: ["submit_faculty_course_request", "propose_policy_revision"],
      can_be_assigned_tickets: false,
      can_publish_policies: false,
      can_approve_escalations: false,
      effective_from: "2025-08-01",
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      role_id: "ROLE-SUPPORT_STAFF",
      role_code: "support_staff" /* SupportStaff */,
      role_name: "Support Staff",
      institutional_scope: "Operational Intake & Departmental Triage Units",
      description: "Triages incoming tickets, verifies applicable policy versions, responds to routine inquiries, and escalates exceptions.",
      allowed_actions: [
        "log_intake_support_ticket",
        "triage_support_queue",
        "propose_policy_revision"
      ],
      can_be_assigned_tickets: true,
      can_publish_policies: false,
      can_approve_escalations: false,
      effective_from: "2025-08-01",
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      role_id: "ROLE-ACADEMIC_ADMINISTRATOR",
      role_code: "academic_administrator" /* AcademicAdministrator */,
      role_name: "Academic Administrator",
      institutional_scope: "Deans, Registrars & Appeals Review Boards",
      description: "Adjudicates escalated petitions, reviews policy compliance, publishes knowledge articles, and oversees SLAs.",
      allowed_actions: [
        "initiate_administrative_review",
        "approve_policy_escalation",
        "publish_knowledge_article",
        "configure_department_routing"
      ],
      can_be_assigned_tickets: true,
      can_publish_policies: true,
      can_approve_escalations: true,
      effective_from: "2025-08-01",
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      role_id: "ROLE-PLATFORM_ADMINISTRATOR",
      role_code: "platform_administrator" /* PlatformAdministrator */,
      role_name: "Platform Administrator",
      institutional_scope: "Enterprise IT & Platform Governance Authority",
      description: "Configures cross-institutional settings, manages authentication providers, and reviews system integrity metrics.",
      allowed_actions: [
        "initiate_administrative_review",
        "publish_knowledge_article",
        "configure_department_routing",
        "configure_platform_governance"
      ],
      can_be_assigned_tickets: true,
      can_publish_policies: true,
      can_approve_escalations: true,
      effective_from: "2025-08-01",
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO
    }
  ];
  const terms = [
    {
      term_id: "TERM-2025-FALL",
      term_code: "FA25",
      term_name: "Fall 2025",
      academic_year: 2025,
      start_date: "2025-08-25",
      end_date: "2025-12-19",
      add_drop_deadline: "2025-09-08",
      withdrawal_deadline: "2025-10-24",
      aid_disbursement_date: "2025-08-15",
      lifecycle_state: "archived",
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      term_id: "TERM-2026-SPRING",
      term_code: "SP26",
      term_name: "Spring 2026",
      academic_year: 2026,
      start_date: "2026-01-12",
      end_date: "2026-05-08",
      add_drop_deadline: "2026-01-26",
      withdrawal_deadline: "2026-03-13",
      aid_disbursement_date: "2026-01-02",
      lifecycle_state: "archived",
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      term_id: "TERM-2026-FALL",
      term_code: "FA26",
      term_name: "Fall 2026",
      academic_year: 2026,
      start_date: "2026-08-24",
      end_date: "2026-12-18",
      add_drop_deadline: "2026-09-08",
      withdrawal_deadline: "2026-10-23",
      aid_disbursement_date: "2026-08-14",
      lifecycle_state: "active",
      created_at: BASE_ANCHOR_DATE_ISO
    },
    {
      term_id: "TERM-2027-SPRING",
      term_code: "SP27",
      term_name: "Spring 2027",
      academic_year: 2027,
      start_date: "2027-01-11",
      end_date: "2027-05-07",
      add_drop_deadline: "2027-01-25",
      withdrawal_deadline: "2027-03-12",
      aid_disbursement_date: "2027-01-04",
      lifecycle_state: "upcoming",
      created_at: BASE_ANCHOR_DATE_ISO
    }
  ];
  const categories = OFFICIAL_CATEGORIES.map((catName) => {
    const rule = DOCUMENTED_ROUTING_RULES[catName];
    return {
      category_id: rule.category_id,
      category_name: catName,
      domain_code: rule.domain_code,
      default_assigned_team: rule.primary_assigned_team,
      primary_assigned_team: rule.primary_assigned_team,
      escalation_team: rule.escalation_assigned_team,
      escalation_assigned_team: rule.escalation_assigned_team,
      routing_rule_id: rule.rule_id,
      default_actor_role: rule.default_actor_role,
      escalation_actor_role: rule.escalation_actor_role,
      description: rule.rule_description,
      keywords: rule.keywords ? [...rule.keywords] : ["academic", catName.toLowerCase()],
      is_active: true,
      effective_from: "2026-01-01T00:00:00+05:30",
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO
    };
  });
  const requesters = [];
  for (let i = 1; i <= requesterCount; i++) {
    const firstName = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i - 1) % LAST_NAMES.length];
    const dept = DEPARTMENTS[(i - 1) % DEPARTMENTS.length];
    const isInstructor = i % 10 === 0;
    const roleId = isInstructor ? "ROLE-INSTRUCTOR" : "ROLE-LEARNER";
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i}@synthetic.campusresolve.invalid`;
    requesters.push({
      requester_id: formatRequesterId(i),
      app_profile_id: null,
      role_id: roleId,
      primary_term_id: "TERM-2026-FALL",
      verified_email: email,
      display_name: `${firstName} ${lastName}`,
      department: dept,
      program_or_unit: isInstructor ? "Instructional Faculty" : "Undergraduate Degree Cohort",
      account_status: "active",
      is_synthetic_eval: true,
      effective_from: "2026-08-01",
      effective_to: null,
      created_at: formatIsoWithIstOffset(anchorMs - 30 * 864e5 + i * 6e4),
      updated_at: BASE_ANCHOR_DATE_ISO
    });
  }
  const policyDocuments = POLICY_SPECS.map((spec) => {
    const policyId = formatPolicyId(spec.domain, spec.seq);
    const supersedesId = spec.supersedesSeq ? formatPolicyId(spec.domain, spec.supersedesSeq) : null;
    const supersededById = spec.supersededBySeq ? formatPolicyId(spec.domain, spec.supersededBySeq) : null;
    return {
      policy_id: policyId,
      domain: spec.domain,
      category_id: spec.categoryId,
      title: spec.title,
      version: spec.version,
      effective_date: spec.effectiveDate,
      expiration_date: spec.expirationDate,
      lifecycle_state: spec.lifecycleState,
      supersedes_policy_id: supersedesId,
      superseded_by_policy_id: supersededById,
      summary: spec.summary,
      content: spec.content,
      authoritative_section_ref: spec.sectionRef,
      source_name: "CampusResolve AI Synthetic Policy Corpus (YottaFlex Challenge)",
      source_url: `urn:campusresolve:synthetic-policy:${policyId.toLowerCase()}`,
      dataset_or_doc_version: `2026.10-seed-${seed}-v${spec.version}`,
      retrieval_date: "2026-09-01",
      license_terms: "CC0-1.0 Synthetic Demonstration & Evaluation Corpus (Non-Regulatory)",
      attribution: "Synthetic university policy created strictly for CampusResolve AI evaluation; not real institutional regulation.",
      transformations_performed: "Normalized section headers, tagged effective/expiration dates, and linked superseding policy IDs.",
      discarded_fields: "legacy_pdf_page_checksum",
      is_synthetic_policy: true,
      published_by_profile_id: null,
      created_at: formatIsoWithIstOffset(Date.parse(`${spec.effectiveDate}T08:00:00.000Z`)),
      updated_at: BASE_ANCHOR_DATE_ISO
    };
  });
  const knowledgeArticles = [];
  const policyArticleLinks = [];
  const topicVariantsByDomain = {
    FINAID: [
      "SAP Pace of Completion Calculation & Appeal Packet Checklist",
      "Federal & Institutional Grant Disbursement Hold Resolution",
      "Census Date Credit Hour Proration for Half-Time Learners",
      "Emergency Hardship Financial Aid Re-Evaluation Procedure",
      "Merit Scholarship Renewal GPA Verification & Grace Term Rules",
      "International Student Emergency Fellowship Application Guide",
      "Filing a Special Circumstance Financial Aid Re-Assessment",
      "Work-Study Bi-Weekly Timesheet Approval and Wage Disbursement"
    ],
    REG: [
      "First-10-Business-Day Add/Drop Procedure & Roster Lock",
      "Week 8 Course Withdrawal (W Grade) Online Submission Guide",
      "Post-Deadline Retroactive Withdrawal Petition Documentation",
      "Undergraduate 19\u201322 Credit Hour Overload Approval Workflow",
      "Cross-Departmental Prerequisite Waiver & Instructor Attestation",
      "Academic Standing Probation Review and Academic Plan Filing",
      "Grade Forgiveness Course Repetition Petition and GPA Replacement",
      "Independent Study Syllabus and Department Chair Authorization"
    ],
    IT: [
      "Transitioning from Legacy SMS to FIDO2 / TOTP Authenticator MFA",
      "Identity Verification for Locked Institutional SSO Accounts",
      "LMS Course Shell Provisioning & 4-Hour Roster Sync Troubleshooting",
      "Instructional Lab Software Floating License Seat Allocation",
      "Student Hardware Loaner Laptop Checkout Eligibility and Return Rules",
      "Reporting Suspected Phishing, Token Theft or Credential Compromise",
      "Departmental High-Performance GPU Cluster Access Sponsorship",
      "Campus Wi-Fi Connectivity and Rogue Access Point Restriction"
    ],
    ACCESS: [
      "5-Business-Day Proctored Testing Accommodation Booking Guide",
      "Requesting Real-Time CART Captioning & Accessible Course Packets",
      "Instructor Notification Letters for Approved Exam Extended Time",
      "Escalating Accommodation Implementation Barriers to Section 504 Panel",
      "Assistive Screen-Reader PDF Remediation Turnaround Standards",
      "Campus Housing Emotional Support Animal Health Record Clearance",
      "Peer Note-Taking Services and Lecture Audio Recording Permissions",
      "Reporting Physical Mobility Obstacles and Accessible Van Booking"
    ]
  };
  for (let i = 1; i <= knowledgeArticleCount; i++) {
    const articleId = formatKnowledgeArticleId(i);
    const parentPolicy = policyDocuments[(i - 1) % policyDocuments.length];
    const domainTopics = topicVariantsByDomain[parentPolicy.domain];
    const topicLabel = domainTopics[(i - 1) % domainTopics.length];
    const isExpiredArticle = parentPolicy.lifecycle_state === "expired";
    const version = isExpiredArticle ? "1.0" : i % 5 === 0 ? "2.1" : "2.0";
    const article = {
      article_id: articleId,
      category_id: parentPolicy.category_id,
      primary_policy_id: parentPolicy.policy_id,
      primary_policy_version: parentPolicy.version,
      title: `${topicLabel} (Ref ${parentPolicy.policy_id} v${parentPolicy.version} \xB7 #${i})`,
      version,
      effective_date: parentPolicy.effective_date,
      expiration_date: parentPolicy.expiration_date,
      lifecycle_state: isExpiredArticle ? "expired" : "published",
      summary: `${isExpiredArticle ? "[EXPIRED KNOWLEDGE ARTICLE] " : "[PUBLISHED KNOWLEDGE ARTICLE] "}Operational guidance for ${topicLabel.toLowerCase()} governed by ${parentPolicy.policy_id} (v${parentPolicy.version}).`,
      content: `${parentPolicy.content} Operational Article ${articleId} (v${version}) specifies step-by-step intake verification for ${topicLabel}. Governing Policy: ${parentPolicy.policy_id} v${parentPolicy.version} (${parentPolicy.authoritative_section_ref}).`,
      tags: [
        parentPolicy.domain.toLowerCase(),
        parentPolicy.policy_id.toLowerCase(),
        isExpiredArticle ? "expired-reference" : "active-guidance"
      ],
      source_url: `urn:campusresolve:synthetic-kb:${articleId.toLowerCase()}`,
      dataset_or_doc_version: `2026.10-seed-${seed}-kb-v${version}`,
      retrieval_date: "2026-09-01",
      license_terms: "CC0-1.0 Synthetic Demonstration & Evaluation Corpus",
      attribution: "Synthetic knowledge base article generated deterministically for CampusResolve AI evaluation.",
      transformations_performed: "Indexed policy section citations, normalized domain tags, and bound effective/expiration dates.",
      discarded_fields: null,
      is_synthetic_article: true,
      created_at: formatIsoWithIstOffset(Date.parse(`${parentPolicy.effective_date}T09:00:00.000Z`)),
      updated_at: BASE_ANCHOR_DATE_ISO
    };
    knowledgeArticles.push(article);
    policyArticleLinks.push({
      link_id: `LNK-POL-KB-${String(i).padStart(6, "0")}`,
      policy_id: parentPolicy.policy_id,
      policy_version: parentPolicy.version,
      article_id: article.article_id,
      article_version: article.version,
      relationship_type: isExpiredArticle ? "superseded_reference" : "primary_governance",
      created_at: BASE_ANCHOR_DATE_ISO
    });
  }
  const activePoliciesByCat = /* @__PURE__ */ new Map();
  const expiredPoliciesByCat = /* @__PURE__ */ new Map();
  for (const pol of policyDocuments) {
    const targetMap = pol.lifecycle_state === "active" ? activePoliciesByCat : expiredPoliciesByCat;
    const list = targetMap.get(pol.category_id) || [];
    list.push(pol);
    targetMap.set(pol.category_id, list);
  }
  const activeArticlesByPolicy = /* @__PURE__ */ new Map();
  const expiredArticlesByPolicy = /* @__PURE__ */ new Map();
  for (const art of knowledgeArticles) {
    const targetMap = art.lifecycle_state === "published" ? activeArticlesByPolicy : expiredArticlesByPolicy;
    const list = targetMap.get(art.primary_policy_id) || [];
    list.push(art);
    targetMap.set(art.primary_policy_id, list);
  }
  const tickets = [];
  const messages = [];
  const assignments = [];
  const slas = [];
  const resolutionFeedbacks = [];
  const ticketPolicyLinks = [];
  const ticketArticleLinks = [];
  const ticketLifecycleEvents = [];
  const groundTruthAnomalies = [];
  const groundTruthTicketEvaluations = [];
  let anomalyCounter = 0;
  const subjectSeen = /* @__PURE__ */ new Set();
  const descSeen = /* @__PURE__ */ new Set();
  let duplicateSubjectCount = 0;
  let duplicateDescCount = 0;
  const subjectLengths = [];
  const descLengths = [];
  let informalTypoCount = 0;
  let hinglishCount = 0;
  let multiIssueCount = 0;
  let ambiguityCount = 0;
  const categoryCounts = {
    "Financial Aid": 0,
    Registration: 0,
    IT: 0,
    Accessibility: 0
  };
  const lifecycleCounts = {
    ["draft" /* Draft */]: 0,
    ["submitted" /* Submitted */]: 0,
    ["under_review" /* UnderReview */]: 0,
    ["policy_verified" /* PolicyVerified */]: 0,
    ["escalated" /* Escalated */]: 0,
    ["resolved" /* Resolved */]: 0,
    ["closed" /* Closed */]: 0
  };
  const priorityCounts = {
    "Standard Priority": 0,
    "Time-Sensitive Academic Priority": 0,
    "Administrative Escalation Priority": 0
  };
  const termWeekCounts = {};
  function determineCategory(tIndex) {
    const mod100 = ((tIndex - 1) * 37 + 13) % 100;
    if (mod100 < 35) return "Financial Aid";
    if (mod100 < 65) return "Registration";
    if (mod100 < 87) return "IT";
    return "Accessibility";
  }
  function determineLifecycle(tIndex, forceEscalated, forceResolved) {
    if (forceResolved) return "resolved" /* Resolved */;
    if (forceEscalated) return "escalated" /* Escalated */;
    const mod100 = ((tIndex - 1) * 53 + 7) % 100;
    if (mod100 < 52) return "resolved" /* Resolved */;
    if (mod100 < 78) return "under_review" /* UnderReview */;
    if (mod100 < 88) return "policy_verified" /* PolicyVerified */;
    if (mod100 < 94) return "submitted" /* Submitted */;
    if (mod100 < 98) return "closed" /* Closed */;
    return "draft" /* Draft */;
  }
  const targetTotalMessages = ticketCount * 4;
  const ticketStatuses = [];
  const ticketMsgCounts = [];
  for (let i = 1; i <= ticketCount; i++) {
    const mod25 = i % 25;
    const isAnomalyMissed = mod25 === 19;
    const isNormalEsc = !isAnomalyMissed && i % 12 === 0;
    const isEscReq = isNormalEsc || isAnomalyMissed;
    const st = determineLifecycle(i, isEscReq && !isAnomalyMissed, isAnomalyMissed);
    ticketStatuses.push(st);
    let count = 4;
    if (st === "draft" /* Draft */) count = 1;
    else if (st === "submitted" /* Submitted */) count = 2;
    else if (st === "under_review" /* UnderReview */ || st === "policy_verified" /* PolicyVerified */) count = 4;
    else if (st === "escalated" /* Escalated */ || st === "closed" /* Closed */) count = 5;
    else if (st === "resolved" /* Resolved */) count = 4;
    ticketMsgCounts.push(count);
  }
  let totalMsgSum = ticketMsgCounts.reduce((acc, c) => acc + c, 0);
  if (totalMsgSum < targetTotalMessages) {
    let diff = targetTotalMessages - totalMsgSum;
    for (let i = 0; i < ticketCount && diff > 0; i++) {
      if (ticketStatuses[i] === "resolved" /* Resolved */ && ticketMsgCounts[i] === 4) {
        ticketMsgCounts[i] = 5;
        diff--;
      }
    }
  } else if (totalMsgSum > targetTotalMessages) {
    let diff = totalMsgSum - targetTotalMessages;
    for (let i = 0; i < ticketCount && diff > 0; i++) {
      if ((ticketStatuses[i] === "under_review" /* UnderReview */ || ticketStatuses[i] === "policy_verified" /* PolicyVerified */) && ticketMsgCounts[i] === 4) {
        ticketMsgCounts[i] = 3;
        diff--;
      }
    }
  }
  for (let tIdx = 1; tIdx <= ticketCount; tIdx++) {
    const ticketId = formatTicketId(tIdx);
    const requester = requesters[(tIdx - 1) % requesters.length];
    const categoryName = determineCategory(tIdx);
    categoryCounts[categoryName]++;
    const routingRule = DOCUMENTED_ROUTING_RULES[categoryName];
    const categoryId = routingRule.category_id;
    const activePolicies = activePoliciesByCat.get(categoryId);
    const expiredPolicies = expiredPoliciesByCat.get(categoryId);
    const expectedPolicy = activePolicies[(tIdx - 1) % activePolicies.length];
    const expectedArticles = activeArticlesByPolicy.get(expectedPolicy.policy_id);
    const expectedArticle = expectedArticles[(tIdx - 1) % expectedArticles.length];
    const mod25 = tIdx % 25;
    const isAnomalyExpiredCitation = mod25 === 3;
    const isAnomalyUnauthorizedRouting = mod25 === 7;
    const isAnomalyUnsupportedClaim = mod25 === 11;
    const isAnomalySlaBusinessHours = mod25 === 15;
    const isAnomalyMissedEscalation = mod25 === 19;
    const isNormalEscalationCase = !isAnomalyMissedEscalation && tIdx % 12 === 0;
    const expectedEscalationRequired = isNormalEscalationCase || isAnomalyMissedEscalation;
    const weekBucket = (tIdx * 17 + 5) % 16 + 1;
    const weekKey = `Week ${weekBucket}`;
    termWeekCounts[weekKey] = (termWeekCounts[weekKey] || 0) + 1;
    const weekStartMs = Date.UTC(2026, 7, 24) + (weekBucket - 1) * 7 * 864e5;
    const dayInWeek = (tIdx * 3 + 1) % 5;
    const hourOfDay = 9 + tIdx * 7 % 8;
    const minuteOfHour = tIdx * 11 % 60;
    const baseSubMs = weekStartMs + dayInWeek * 864e5 + hourOfDay * 36e5 + minuteOfHour * 6e4;
    const submittedAtIso = isAnomalySlaBusinessHours ? formatIsoWithIstOffset(Date.UTC(2026, 8, 4, 15, 30, 0)) : formatIsoWithIstOffset(baseSubMs);
    const evaluatedAtIso = isAnomalySlaBusinessHours ? formatIsoWithIstOffset(Date.UTC(2026, 8, 7, 9, 30, 0)) : formatIsoWithIstOffset(Date.parse(submittedAtIso) + 180 * 6e4);
    const citedPolicy = isAnomalyExpiredCitation ? expiredPolicies[0] : expectedPolicy;
    const citedArticleList = isAnomalyExpiredCitation ? expiredArticlesByPolicy.get(citedPolicy.policy_id) : expectedArticles;
    const citedArticle = citedArticleList[0];
    const priority = expectedEscalationRequired ? "Administrative Escalation Priority" : tIdx % 5 === 0 ? "Time-Sensitive Academic Priority" : "Standard Priority";
    priorityCounts[priority]++;
    const observedLifecycleStatus = determineLifecycle(
      tIdx,
      expectedEscalationRequired && !isAnomalyMissedEscalation,
      isAnomalyMissedEscalation
    );
    lifecycleCounts[observedLifecycleStatus]++;
    const isResolved = observedLifecycleStatus === "resolved" /* Resolved */;
    const isClosed = observedLifecycleStatus === "closed" /* Closed */;
    const styleVariants = REQUEST_STYLE_LIBRARY[categoryName];
    const pickedVariant = styleVariants[(tIdx - 1) % styleVariants.length];
    if (pickedVariant.style === "hinglish") hinglishCount++;
    if (pickedVariant.style === "typo" || pickedVariant.style === "hinglish") informalTypoCount++;
    if (pickedVariant.style === "multi_issue") multiIssueCount++;
    if (pickedVariant.style === "vague") ambiguityCount++;
    const courseCodes = ["CS-101", "EECS-280", "MATH-215", "BIO-172", "ECON-101", "CHEM-130", "ENG-125", "PHYS-240"];
    const courseCode = courseCodes[(tIdx - 1) % courseCodes.length];
    const subject = expectedEscalationRequired && pickedVariant.style === "appeal" ? `${categoryName} Formal Appeal Petition: ${expectedPolicy.title} (${expectedPolicy.policy_id})` : tIdx % 7 === 0 ? `${pickedVariant.subject} [${courseCode} \xB7 Ref #${tIdx}]` : `${pickedVariant.subject} (#${tIdx})`;
    const description = `${pickedVariant.description} (Student ID: ${requester.requester_id}, Course: ${courseCode}, Term: ${requester.primary_term_id}).`;
    if (subjectSeen.has(subject)) duplicateSubjectCount++;
    subjectSeen.add(subject);
    if (descSeen.has(description)) duplicateDescCount++;
    descSeen.add(description);
    subjectLengths.push(subject.length);
    descLengths.push(description.length);
    const idealRouting = evaluateTicketRouting({
      ticketId,
      category: categoryName,
      priority,
      subject,
      description,
      assignedAtIso: submittedAtIso
    });
    const wrongCategory = categoryName === "Financial Aid" ? "IT" : "Financial Aid";
    const observedAssignedTeam = isAnomalyUnauthorizedRouting ? DOCUMENTED_ROUTING_RULES[wrongCategory].primary_assigned_team : isAnomalyMissedEscalation ? routingRule.primary_assigned_team : idealRouting.assignment.assigned_team;
    const observedRoutingRuleId = isAnomalyUnauthorizedRouting ? DOCUMENTED_ROUTING_RULES[wrongCategory].rule_id : idealRouting.assignment.routing_rule_id;
    const hasReassignment = observedLifecycleStatus === "escalated" /* Escalated */ && !isAnomalyMissedEscalation;
    const currentAssignedTeam = hasReassignment ? routingRule.escalation_assigned_team : observedAssignedTeam;
    const currentRoutingRuleId = hasReassignment ? routingRule.escalation_routing_rule_id || observedRoutingRuleId : observedRoutingRuleId;
    const ticket = {
      ticket_id: ticketId,
      requester_id: requester.requester_id,
      requester_profile_id: null,
      category_id: categoryId,
      category_name: categoryName,
      term_id: requester.primary_term_id,
      subject,
      description,
      priority,
      lifecycle_status: observedLifecycleStatus,
      current_assigned_team: currentAssignedTeam,
      current_routing_rule_id: currentRoutingRuleId,
      referenced_policy_id: citedPolicy.policy_id,
      referenced_policy_version: citedPolicy.version,
      referenced_article_id: citedArticle.article_id,
      referenced_article_version: citedArticle.version,
      requires_escalation: expectedEscalationRequired,
      is_escalated: observedLifecycleStatus === "escalated" /* Escalated */,
      escalation_reason: expectedEscalationRequired ? idealRouting.escalationReason : null,
      resolution_summary: isResolved || isClosed ? isAnomalyUnsupportedClaim ? "UNSUPPORTED CLAIM: Approved automatic 100% full tuition refund and 45-day retroactive deadline extension without documentation." : `Resolved in accordance with ${citedPolicy.policy_id} v${citedPolicy.version} (${citedPolicy.authoritative_section_ref}) and ${citedArticle.article_id} v${citedArticle.version}.` : null,
      is_synthetic_eval: true,
      submitted_at: submittedAtIso,
      updated_at: evaluatedAtIso,
      resolved_at: isResolved || isClosed ? evaluatedAtIso : null,
      closed_at: isClosed ? formatIsoWithIstOffset(Date.parse(evaluatedAtIso) + 864e5) : null
    };
    tickets.push(ticket);
    ticketPolicyLinks.push({
      link_id: `TPL-${ticketId}-01`,
      ticket_id: ticketId,
      policy_id: citedPolicy.policy_id,
      policy_version: citedPolicy.version,
      applicability_status: citedPolicy.lifecycle_state === "expired" ? "expired_at_citation" : "applicable_current",
      linked_by_actor: `ACTOR-OPS-${routingRule.domain_code}`,
      linked_at: evaluatedAtIso
    });
    ticketArticleLinks.push({
      link_id: `TAL-${ticketId}-01`,
      ticket_id: ticketId,
      article_id: citedArticle.article_id,
      article_version: citedArticle.version,
      applicability_status: citedArticle.lifecycle_state === "expired" ? "expired_at_citation" : "applicable_current",
      linked_by_actor: `ACTOR-OPS-${routingRule.domain_code}`,
      linked_at: evaluatedAtIso
    });
    let eventSeq = 1;
    if (observedLifecycleStatus === "draft" /* Draft */) {
      ticketLifecycleEvents.push(
        createLifecycleEvent({
          ticketId,
          eventSequence: eventSeq++,
          previousState: null,
          newState: "draft" /* Draft */,
          actorId: requester.requester_id,
          actorRole: requester.role_id === "ROLE-INSTRUCTOR" ? "instructor" /* Instructor */ : "learner" /* Learner */,
          reason: "Draft academic request initiated by requester.",
          timestampIso: submittedAtIso
        })
      );
    } else {
      ticketLifecycleEvents.push(
        createLifecycleEvent({
          ticketId,
          eventSequence: eventSeq++,
          previousState: null,
          newState: "submitted" /* Submitted */,
          actorId: requester.requester_id,
          actorRole: requester.role_id === "ROLE-INSTRUCTOR" ? "instructor" /* Instructor */ : "learner" /* Learner */,
          reason: "Initial request submission and intake validation.",
          timestampIso: submittedAtIso
        })
      );
      const midTimeIso = formatIsoWithIstOffset(Date.parse(submittedAtIso) + 30 * 6e4);
      if (observedLifecycleStatus === "escalated" /* Escalated */) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "submitted" /* Submitted */,
            newState: "escalated" /* Escalated */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: idealRouting.escalationReason || "Escalated for administrative policy adjudication.",
            timestampIso: evaluatedAtIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version
          })
        );
      } else if (observedLifecycleStatus === "policy_verified" /* PolicyVerified */) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "submitted" /* Submitted */,
            newState: "under_review" /* UnderReview */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Assigned to ${observedAssignedTeam} via ${observedRoutingRuleId}.`,
            timestampIso: midTimeIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version
          })
        );
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "under_review" /* UnderReview */,
            newState: "policy_verified" /* PolicyVerified */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Policy citation ${citedPolicy.policy_id} v${citedPolicy.version} verified against authoritative catalog.`,
            timestampIso: evaluatedAtIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version
          })
        );
      } else if (observedLifecycleStatus === "under_review" /* UnderReview */) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "submitted" /* Submitted */,
            newState: "under_review" /* UnderReview */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Assigned to ${observedAssignedTeam} via ${observedRoutingRuleId}.`,
            timestampIso: midTimeIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version
          })
        );
      } else if (observedLifecycleStatus === "resolved" /* Resolved */) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "submitted" /* Submitted */,
            newState: "under_review" /* UnderReview */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Assigned to ${observedAssignedTeam} via ${observedRoutingRuleId}.`,
            timestampIso: midTimeIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version
          })
        );
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "under_review" /* UnderReview */,
            newState: "resolved" /* Resolved */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Resolution recorded citing ${citedPolicy.policy_id} v${citedPolicy.version}.`,
            timestampIso: evaluatedAtIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version
          })
        );
      } else if (observedLifecycleStatus === "closed" /* Closed */) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "submitted" /* Submitted */,
            newState: "under_review" /* UnderReview */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Assigned to ${observedAssignedTeam} via ${observedRoutingRuleId}.`,
            timestampIso: midTimeIso
          })
        );
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "under_review" /* UnderReview */,
            newState: "resolved" /* Resolved */,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: "support_staff" /* SupportStaff */,
            reason: `Resolution recorded citing ${citedPolicy.policy_id} v${citedPolicy.version}.`,
            timestampIso: evaluatedAtIso
          })
        );
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: "resolved" /* Resolved */,
            newState: "closed" /* Closed */,
            actorId: requester.requester_id,
            actorRole: requester.role_id === "ROLE-INSTRUCTOR" ? "instructor" /* Instructor */ : "learner" /* Learner */,
            reason: "Ticket resolved and closed after review.",
            timestampIso: formatIsoWithIstOffset(Date.parse(evaluatedAtIso) + 864e5)
          })
        );
      }
    }
    const tMsgCount = ticketMsgCounts[tIdx - 1];
    const msgTemplates = [
      {
        senderId: requester.requester_id,
        senderRole: requester.role_id === "ROLE-INSTRUCTOR" ? "instructor" /* Instructor */ : "learner" /* Learner */,
        senderName: requester.display_name,
        type: "requester_inquiry",
        body: description,
        citePolicy: false
      },
      {
        senderId: "SYSTEM-ROUTER",
        senderRole: "support_staff" /* SupportStaff */,
        senderName: "CampusResolve Routing Engine",
        type: "system_routing_note",
        body: `Ticket ${ticketId} classified under '${categoryName}' and assigned to '${observedAssignedTeam}' using routing rule ${observedRoutingRuleId}.`,
        citePolicy: false
      },
      {
        senderId: `ACTOR-OPS-${routingRule.domain_code}`,
        senderRole: "support_staff" /* SupportStaff */,
        senderName: `${observedAssignedTeam} Specialist`,
        type: "ai_grounded_reply",
        body: isAnomalyUnsupportedClaim ? `Policy Guidance (${citedPolicy.policy_id} v${citedPolicy.version}): Every student is guaranteed an automatic $5,000 cash grant and a 45-day deadline waiver without submitting documentation.` : `Policy Guidance (${citedPolicy.policy_id} v${citedPolicy.version}, ${citedArticle.article_id} v${citedArticle.version}): ${citedPolicy.summary}`,
        citePolicy: true
      },
      {
        senderId: `ACTOR-OPS-${routingRule.domain_code}`,
        senderRole: observedLifecycleStatus === "escalated" /* Escalated */ ? "academic_administrator" /* AcademicAdministrator */ : "support_staff" /* SupportStaff */,
        senderName: `${observedAssignedTeam} Reviewer`,
        type: observedLifecycleStatus === "escalated" /* Escalated */ ? "escalation_handoff" : "resolution_summary",
        body: observedLifecycleStatus === "escalated" /* Escalated */ ? `Case escalated to ${observedAssignedTeam} for administrative determination. Reason: ${idealRouting.escalationReason}` : `Lifecycle status updated to '${observedLifecycleStatus}' referencing ${citedPolicy.policy_id} v${citedPolicy.version}.`,
        citePolicy: true
      },
      {
        senderId: requester.requester_id,
        senderRole: requester.role_id === "ROLE-INSTRUCTOR" ? "instructor" /* Instructor */ : "learner" /* Learner */,
        senderName: requester.display_name,
        type: "requester_inquiry",
        body: "Thank you for reviewing my request. Please let me know if additional documentation is needed.",
        citePolicy: false
      }
    ];
    for (let m = 0; m < tMsgCount; m++) {
      const tpl = msgTemplates[m % msgTemplates.length];
      const msgSeq = m + 1;
      const msgTimeIso = formatIsoWithIstOffset(Date.parse(submittedAtIso) + msgSeq * 25 * 6e4);
      messages.push({
        message_id: formatMessageId(ticketId, msgSeq),
        ticket_id: ticketId,
        sequence_number: msgSeq,
        sender_id: tpl.senderId,
        sender_profile_id: null,
        sender_role: tpl.senderRole,
        sender_name: tpl.senderName,
        message_type: tpl.type,
        body: tpl.body,
        cited_policy_id: tpl.citePolicy ? citedPolicy.policy_id : null,
        cited_policy_version: tpl.citePolicy ? citedPolicy.version : null,
        cited_article_id: tpl.citePolicy ? citedArticle.article_id : null,
        cited_article_version: tpl.citePolicy ? citedArticle.version : null,
        created_at: msgTimeIso
      });
    }
    assignments.push({
      assignment_id: formatAssignmentId(ticketId, 1),
      ticket_id: ticketId,
      sequence_number: 1,
      assigned_team: hasReassignment ? routingRule.primary_assigned_team : observedAssignedTeam,
      assigned_actor_id: `ACTOR-OPS-${routingRule.domain_code}`,
      assigned_actor_role: idealRouting.assignment.assigned_actor_role,
      routing_rule_id: observedRoutingRuleId,
      assignment_reason: idealRouting.assignment.assignment_reason,
      previous_assignment_id: null,
      previous_assigned_team: null,
      requires_human_review: expectedEscalationRequired,
      is_active: !hasReassignment,
      assigned_at: submittedAtIso,
      unassigned_at: hasReassignment ? evaluatedAtIso : null
    });
    if (hasReassignment) {
      assignments.push({
        assignment_id: formatAssignmentId(ticketId, 2),
        ticket_id: ticketId,
        sequence_number: 2,
        assigned_team: routingRule.escalation_assigned_team,
        assigned_actor_id: `ACTOR-ESC-${routingRule.domain_code}`,
        assigned_actor_role: "academic_administrator" /* AcademicAdministrator */,
        routing_rule_id: observedRoutingRuleId,
        assignment_reason: idealRouting.escalationReason || "Administrative escalation reassignment.",
        previous_assignment_id: formatAssignmentId(ticketId, 1),
        previous_assigned_team: routingRule.primary_assigned_team,
        requires_human_review: true,
        is_active: true,
        assigned_at: evaluatedAtIso,
        unassigned_at: null
      });
    }
    const slaRecord = buildReproducibleSlaRecord({
      ticketId,
      category: categoryName,
      startTimestampIso: submittedAtIso,
      evaluatedTimestampIso: evaluatedAtIso,
      isTicketEscalated: observedLifecycleStatus === "escalated" /* Escalated */,
      requiresEscalation: expectedEscalationRequired,
      calculationMode: isAnomalySlaBusinessHours ? "wall_clock_24x7" : "business_hours_configured",
      ruleClassification: isAnomalySlaBusinessHours ? "SYNTHETIC_EVAL_SCENARIO" : "PROPOSED_CONFIGURABLE_RULE"
    });
    slas.push(slaRecord);
    if (isResolved || isClosed) {
      const hasAnyAnomaly = isAnomalyExpiredCitation || isAnomalyUnauthorizedRouting || isAnomalyUnsupportedClaim || isAnomalySlaBusinessHours || isAnomalyMissedEscalation;
      resolutionFeedbacks.push({
        feedback_id: formatFeedbackId(ticketId),
        ticket_id: ticketId,
        requester_id: requester.requester_id,
        rating: hasAnyAnomaly ? 2 : 5,
        was_helpful: !hasAnyAnomaly,
        resolution_accepted: !hasAnyAnomaly,
        policy_clarity_score: hasAnyAnomaly ? 2 : 5,
        comments: hasAnyAnomaly ? "Requester noted discrepancy in cited policy version, routing unit, or escalation handling." : "Clear policy-grounded explanation with exact section and version citation.",
        submitted_at: formatIsoWithIstOffset(Date.parse(evaluatedAtIso) + 15 * 6e4)
      });
    }
    const ticketAnomalyTypes = [];
    const ticketAnomalyIds = [];
    if (isAnomalyExpiredCitation) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push("expired_policy_citation");
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: ticketId,
        ticket_id: ticketId,
        anomaly_type: "expired_policy_citation",
        expected_decision: `Cite active policy version for category '${categoryName}' (v2.0)`,
        actual_observed_decision: `Cited expired policy ${citedPolicy.policy_id} v${citedPolicy.version} (expired ${citedPolicy.expiration_date})`,
        ground_truth_label: "ANOMALY_PRESENT",
        rule_reference: "POLICY_EFFECTIVE_DATE_APPLICABILITY_RULE",
        explanation: `Ticket ${ticketId} cites expired policy ${citedPolicy.policy_id} v${citedPolicy.version} whose expiration date is ${citedPolicy.expiration_date}.`
      });
    }
    if (isAnomalyUnauthorizedRouting) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push("unauthorized_team_routing");
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: formatAssignmentId(ticketId, 1),
        ticket_id: ticketId,
        anomaly_type: "unauthorized_team_routing",
        expected_decision: `Assign to '${routingRule.primary_assigned_team}' via ${routingRule.rule_id}`,
        actual_observed_decision: `Assigned to '${observedAssignedTeam}' via ${observedRoutingRuleId}`,
        ground_truth_label: "ANOMALY_PRESENT",
        rule_reference: routingRule.rule_id,
        explanation: `Ticket ${ticketId} in category '${categoryName}' assigned to unauthorized team '${observedAssignedTeam}'.`
      });
    }
    if (isAnomalyUnsupportedClaim) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push("unsupported_factual_claim");
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: formatMessageId(ticketId, 3),
        ticket_id: ticketId,
        anomaly_type: "unsupported_factual_claim",
        expected_decision: `Ground AI reply strictly in ${citedPolicy.policy_id} v${citedPolicy.version}`,
        actual_observed_decision: `Claimed automatic $5,000 cash grant and 45-day deadline waiver without policy basis`,
        ground_truth_label: "ANOMALY_PRESENT",
        rule_reference: "RAG_EVIDENCE_GROUNDING_RULE",
        explanation: `Message asserts unverified financial terms absent from ${citedPolicy.policy_id}.`
      });
    }
    if (isAnomalySlaBusinessHours) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push("sla_clock_ignores_business_hours");
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: slaRecord.sla_id,
        ticket_id: ticketId,
        anomaly_type: "sla_clock_ignores_business_hours",
        expected_decision: `Evaluate elapsed time under institutional business hours (180 elapsed business minutes)`,
        actual_observed_decision: `Evaluated under raw 24x7 wall-clock time (3,960 elapsed minutes) falsely declaring breach`,
        ground_truth_label: "ANOMALY_PRESENT",
        rule_reference: CONFIGURABLE_SLA_RULES[categoryName].sla_rule_id,
        explanation: `SLA calculation ran wall-clock mode over weekend resulting in false breach.`
      });
    }
    if (isAnomalyMissedEscalation) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push("required_escalation_not_triggered");
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: ticketId,
        ticket_id: ticketId,
        anomaly_type: "required_escalation_not_triggered",
        expected_decision: `Escalate to '${routingRule.escalation_assigned_team}' with requires_escalation=true`,
        actual_observed_decision: `Resolved directly at frontline support level without mandatory escalation`,
        ground_truth_label: "ANOMALY_PRESENT",
        rule_reference: routingRule.rule_id,
        explanation: `Ticket requires mandatory administrative review but was closed without escalation handoff.`
      });
    }
    const expectedBusinessMin = calculateElapsedBusinessMinutes(
      submittedAtIso,
      evaluatedAtIso,
      DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
    );
    groundTruthTicketEvaluations.push({
      ticket_id: ticketId,
      expected_category: categoryName,
      expected_assigned_team: idealRouting.assignment.assigned_team,
      expected_routing_rule_id: routingRule.rule_id,
      expected_applicable_policy_id: expectedPolicy.policy_id,
      expected_applicable_policy_version: expectedPolicy.version,
      expected_applicable_article_id: expectedArticle.article_id,
      expected_applicable_article_version: expectedArticle.version,
      expected_escalation_required: expectedEscalationRequired,
      expected_sla_business_minutes: expectedBusinessMin,
      expected_sla_breach_under_business_hours: expectedBusinessMin > CONFIGURABLE_SLA_RULES[categoryName].target_business_minutes,
      expected_lifecycle_outcome: observedLifecycleStatus,
      has_anomaly: ticketAnomalyTypes.length > 0,
      anomaly_types: ticketAnomalyTypes,
      anomaly_ids: ticketAnomalyIds
    });
  }
  const computeStats = (arr) => {
    if (arr.length === 0) return { min: 0, max: 0, mean: 0, median: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Number((sum / sorted.length).toFixed(1)),
      median: sorted[Math.floor(sorted.length / 2)]
    };
  };
  const dataQualityReport = {
    uniqueSubjectCount: subjectSeen.size,
    uniqueDescriptionCount: descSeen.size,
    duplicateSubjectRate: Number((duplicateSubjectCount / ticketCount).toFixed(4)),
    duplicateDescriptionRate: Number((duplicateDescCount / ticketCount).toFixed(4)),
    textLengthStats: {
      subject: computeStats(subjectLengths),
      description: computeStats(descLengths)
    },
    categoryDistribution: {
      "Financial Aid": {
        count: categoryCounts["Financial Aid"],
        percentage: Number((categoryCounts["Financial Aid"] / ticketCount * 100).toFixed(1))
      },
      Registration: {
        count: categoryCounts["Registration"],
        percentage: Number((categoryCounts["Registration"] / ticketCount * 100).toFixed(1))
      },
      IT: {
        count: categoryCounts["IT"],
        percentage: Number((categoryCounts["IT"] / ticketCount * 100).toFixed(1))
      },
      Accessibility: {
        count: categoryCounts["Accessibility"],
        percentage: Number((categoryCounts["Accessibility"] / ticketCount * 100).toFixed(1))
      }
    },
    lifecycleDistribution: Object.fromEntries(
      Object.entries(lifecycleCounts).map(([status, cnt]) => [
        status,
        { count: cnt, percentage: Number((cnt / ticketCount * 100).toFixed(1)) }
      ])
    ),
    priorityDistribution: Object.fromEntries(
      Object.entries(priorityCounts).map(([prio, cnt]) => [
        prio,
        { count: cnt, percentage: Number((cnt / ticketCount * 100).toFixed(1)) }
      ])
    ),
    termWeekDistribution: Object.fromEntries(
      Object.entries(termWeekCounts).map(([wk, cnt]) => [
        wk,
        { count: cnt, percentage: Number((cnt / ticketCount * 100).toFixed(1)) }
      ])
    ),
    informalAndTypoCoverageCount: informalTypoCount,
    hinglishCoverageCount: hinglishCount,
    multiIssueCoverageCount: multiIssueCount,
    ambiguityCoverageCount: ambiguityCount
  };
  return {
    metadata: {
      seed,
      mode,
      generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
      generationOrder: [
        "1. Requester",
        "2. Role",
        "3. Term",
        "4. PolicyDocument",
        "5. KnowledgeArticle",
        "6. Category",
        "7. Ticket",
        "8. Message",
        "9. Assignment",
        "10. SLA",
        "11. ResolutionFeedback"
      ],
      counts: {
        requesters: requesters.length,
        roles: roles.length,
        terms: terms.length,
        policyDocuments: policyDocuments.length,
        knowledgeArticles: knowledgeArticles.length,
        categories: categories.length,
        tickets: tickets.length,
        messages: messages.length,
        assignments: assignments.length,
        slas: slas.length,
        resolutionFeedbacks: resolutionFeedbacks.length,
        ticketLifecycleEvents: ticketLifecycleEvents.length,
        policyArticleLinks: policyArticleLinks.length,
        ticketPolicyLinks: ticketPolicyLinks.length,
        ticketArticleLinks: ticketArticleLinks.length,
        groundTruthAnomalies: groundTruthAnomalies.length,
        groundTruthTicketEvaluations: groundTruthTicketEvaluations.length
      },
      dataQualityReport
    },
    requesters,
    roles,
    terms,
    policyDocuments,
    knowledgeArticles,
    categories,
    tickets,
    messages,
    assignments,
    slas,
    resolutionFeedbacks,
    policyArticleLinks,
    ticketPolicyLinks,
    ticketArticleLinks,
    ticketLifecycleEvents,
    groundTruthAnomalies,
    groundTruthTicketEvaluations
  };
}

// src/services/validationAndEvaluationEngine.ts
var SHA256_K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// server-api/ops/workspace.ts
var cachedReferenceBundle = null;
function getDeterministicReferenceBundle() {
  if (!cachedReferenceBundle) {
    cachedReferenceBundle = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: "starter",
      ticketCount: 50,
      knowledgeArticleCount: 200
    });
  }
  return cachedReferenceBundle;
}
function getReferenceCorpus() {
  const base = getDeterministicReferenceBundle();
  return {
    roles: base.roles,
    terms: base.terms,
    categories: base.categories,
    policyDocuments: base.policyDocuments,
    knowledgeArticles: base.knowledgeArticles,
    policyArticleLinks: base.policyArticleLinks
  };
}
var DEFAULT_SUPABASE_URL = "https://llotsqzeppiltosllxvx.supabase.co";
var DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JX6Tuki8_uwYBPuQfsGmtA_2eJPoz_W";
function createScopedSupabaseClient(bearerToken) {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const supabaseKey = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY).trim();
  return createClient2(supabaseUrl, supabaseKey, {
    accessToken: async () => bearerToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
function createServiceRoleSupabaseClient() {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient2(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
async function verifyAuthenticatedProfileFromHeaders(headers) {
  const authHeaderRaw = headers["authorization"] || headers["Authorization"];
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      verified: false,
      errorMessage: "Missing Authorization Bearer token."
    };
  }
  const bearerToken = authHeader.slice("Bearer ".length).trim();
  if (!bearerToken) {
    return {
      verified: false,
      errorMessage: "Empty Authorization Bearer token."
    };
  }
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const supabaseKey = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY).trim();
  if (!supabaseUrl || !supabaseKey) {
    return {
      verified: false,
      errorMessage: "Supabase environment variables are not configured on the server."
    };
  }
  try {
    const client = createScopedSupabaseClient(bearerToken);
    const { data, error } = await client.from("app_profiles").select(
      "id, auth_provider, provider_subject, verified_email, display_name, department, office_or_cohort, actor_role, account_status"
    ).limit(1).maybeSingle();
    if (!error && data) {
      if (data.account_status !== "active") {
        return {
          verified: false,
          errorMessage: `Account status is '${data.account_status}'. Only active accounts may perform workspace operations.`
        };
      }
      return {
        verified: true,
        profile: data,
        bearerToken,
        client
      };
    }
    const serviceRoleClient = createServiceRoleSupabaseClient();
    if (serviceRoleClient) {
      try {
        const verifiedFirebase = await verifyFirebaseIdTokenServerSide(
          bearerToken
        );
        const { data: fbProfile, error: fbError } = await serviceRoleClient.from("app_profiles").select(
          "id, auth_provider, provider_subject, verified_email, display_name, department, office_or_cohort, actor_role, account_status"
        ).eq("auth_provider", "firebase_google").eq("provider_subject", verifiedFirebase.uid).maybeSingle();
        if (!fbError && fbProfile) {
          if (fbProfile.account_status !== "active") {
            return {
              verified: false,
              errorMessage: `Account status is '${fbProfile.account_status}'. Only active accounts may perform workspace operations.`
            };
          }
          return {
            verified: true,
            profile: fbProfile,
            bearerToken,
            client: serviceRoleClient
          };
        }
      } catch {
      }
    }
    return {
      verified: false,
      errorMessage: "Authenticated session does not match an active institutional profile in public.app_profiles."
    };
  } catch (err) {
    return {
      verified: false,
      errorMessage: err instanceof Error ? err.message : "Failed to verify caller identity against Supabase."
    };
  }
}

// server-api/ai/policy-assistant.ts
function evaluatePolicyAssistantAccessControl(params) {
  const { profile, body, policies } = params;
  if (profile.account_status !== "active") {
    return {
      authorized: false,
      status: 403,
      code: "ACCOUNT_INACTIVE_OR_SUSPENDED",
      message: `Access denied: Institutional profile for '${profile.verified_email}' has status '${profile.account_status}' and is not authorized to query the AI Policy Assistant.`
    };
  }
  const isElevatedRole = profile.actor_role === "support_staff" /* SupportStaff */ || profile.actor_role === "academic_administrator" /* AcademicAdministrator */ || profile.actor_role === "platform_administrator" /* PlatformAdministrator */;
  const isAdminRole = profile.actor_role === "academic_administrator" /* AcademicAdministrator */ || profile.actor_role === "platform_administrator" /* PlatformAdministrator */;
  if (body?.enforceStrictRoleAuthorization && body.activeRolePreview && body.activeRolePreview !== profile.actor_role && profile.actor_role !== "platform_administrator" /* PlatformAdministrator */) {
    return {
      authorized: false,
      status: 403,
      code: "FORBIDDEN_ROLE_ELEVATION",
      message: `Access denied: Authenticated role '${profile.actor_role}' is not authorized to execute policy assistant operations under elevated role '${body.activeRolePreview}'.`
    };
  }
  const rawQuery = (body?.query || "").trim();
  const lowerQuery = rawQuery.toLowerCase();
  const requestsCrossUserConfidentialRecords = /\b(other student's|another student's|other learner's|another learner's|confidential disability file|private ssn|social security number|all student records|export all requesters|bypass rls|service_role key|internal staff override code)\b/i.test(
    lowerQuery
  ) || !isElevatedRole && /\breq-(2026-[0-9]{6}|usr-[a-z0-9]+)\b/i.test(lowerQuery);
  if (requestsCrossUserConfidentialRecords) {
    return {
      authorized: false,
      status: 403,
      code: "FORBIDDEN_RESTRICTED_INFORMATION",
      message: `Access denied: Role '${profile.actor_role}' is not authorized to access confidential cross-requester records, private disability/financial files, or restricted internal security credentials.`
    };
  }
  const draftPoliciesReferenced = policies.filter(
    (p) => p.lifecycle_state === "draft" && lowerQuery.includes(p.policy_id.toLowerCase())
  );
  if (!isAdminRole && (draftPoliciesReferenced.length > 0 || /\b(unpublished draft policy|internal draft regulation|restricted admin-only policy|confidential committee minutes)\b/i.test(
    lowerQuery
  ))) {
    return {
      authorized: false,
      status: 403,
      code: "FORBIDDEN_RESTRICTED_INFORMATION",
      message: `Access denied: Role '${profile.actor_role}' is not authorized to access unpublished draft policy documents or restricted administrative committee records.`
    };
  }
  return {
    authorized: true,
    status: 200,
    code: "AUTHORIZED",
    message: "Caller is authorized to query the AI Policy Assistant."
  };
}
function buildDeterministicEvidenceSynthesis(params) {
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
    unsupportedClaimDetails
  } = params;
  const supportedFacts = [];
  const missingOrUnestablishedFacts = [];
  if (expiredPoliciesExcluded.length > 0) {
    for (const exp of expiredPoliciesExcluded) {
      const reasonDesc = exp.effective_date > asOfDate ? `is not yet effective (effective ${exp.effective_date})` : exp.lifecycle_state === "superseded" && !exp.expiration_date ? `was superseded` : `expired on ${exp.expiration_date || "prior date"}`;
      supportedFacts.push(
        `Historical/Non-Applicable Policy Excluded: ${exp.policy_id} v${exp.version} ("${exp.title}") ${reasonDesc} and is NOT authoritative as of ${asOfDate}${exp.superseded_by_policy_id ? `; superseded by ${exp.superseded_by_policy_id}.` : "."}`
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
      `[${pol.policy_id} v${pol.version} \xB7 ${pol.authoritative_section_ref} \xB7 Effective ${pol.effective_date}] ${pol.content}`
    );
  }
  for (const art of applicableArticles) {
    supportedFacts.push(
      `[${art.article_id} v${art.version} \xB7 Linked to ${art.primary_policy_id} v${art.primary_policy_version} \xB7 Effective ${art.effective_date}] ${art.summary}`
    );
  }
  if (evidenceStatus === "unsupported_or_missing") {
    missingOrUnestablishedFacts.push(
      `No active institutional policy document in the four supported domains (Financial Aid, Registration, IT, Accessibility) establishes rules for: "${query}".`
    );
    missingOrUnestablishedFacts.push(
      `Recommended Action: Escalate to ${UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team} under rule ${UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id}.`
    );
    return {
      answer: `INSUFFICIENT POLICY EVIDENCE (HUMAN ESCALATION REQUIRED): Based on a search of the active institutional knowledge base as of ${asOfDate}, no applicable policy document or knowledge article establishes an authoritative rule for your inquiry. In accordance with institutional AI governance, CampusResolve AI does not fabricate unsupported policy rules, deadlines, or eligibility criteria. Reason for escalation: ${escalationReason || "No matching active policy coverage."}`,
      explanation: `General Explanatory Context: CampusResolve AI searched all active PolicyDocuments (POL-<domain>-2026-XXX) and KnowledgeArticles (KB-XXXXXX) across Financial Aid, Registration, IT, and Accessibility as of ${asOfDate}. Zero authoritative sources matched your question. You may escalate this inquiry to ${UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team} via the ticket workflow.`,
      supportedFacts,
      missingOrUnestablishedFacts
    };
  }
  if (evidenceStatus === "expired_only") {
    missingOrUnestablishedFacts.push(
      "Only expired, superseded, or not-yet-effective policy versions matched this topic; expired versions cannot be used as current institutional guidance."
    );
    const expiredList = expiredPoliciesExcluded.map(
      (p) => `${p.policy_id} v${p.version} (effective ${p.effective_date}${p.expiration_date ? `, expired ${p.expiration_date}` : ""})`
    ).join(", ");
    return {
      answer: `EXPIRED POLICY REJECTED AS CURRENT GUIDANCE (HUMAN VERIFICATION REQUIRED): The matched regulation(s) (${expiredList || "historical source"}) are expired, superseded, or not in force as of the reference date (${asOfDate}). CampusResolve AI rejects expired or superseded versions as current policy authority and requires human review.`,
      explanation: `Version Applicability Explanation: Verified historical metadata confirms that ${expiredList || "the matched source"} is not active as of ${asOfDate}. No active replacement version in the current repository establishes a rule for this query without human adjudication.`,
      supportedFacts,
      missingOrUnestablishedFacts
    };
  }
  if (hasConflictingSources && conflictingSources.length > 0) {
    for (const conflict of conflictingSources) {
      missingOrUnestablishedFacts.push(conflict.conflictSummary);
    }
    const routingRule2 = detectedCategory ? DOCUMENTED_ROUTING_RULES[detectedCategory] : null;
    const escalationTeam = routingRule2?.escalation_assigned_team || UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
    const conflictDescriptions = conflictingSources.map(
      (c) => `\u2022 Source A (${c.sourceAId} v${c.sourceAVersion}, effective ${c.sourceAEffectiveDate}, "${c.sourceATitle}") states: "${c.sourceAClaim}"
\u2022 Source B (${c.sourceBId} v${c.sourceBVersion}, effective ${c.sourceBEffectiveDate}, "${c.sourceBTitle}") states: "${c.sourceBClaim}"`
    ).join("\n");
    return {
      answer: `CONFLICTING POLICY SOURCES IDENTIFIED (HUMAN ESCALATION REQUIRED): Multiple active institutional sources retrieved as of ${asOfDate} contain conflicting provisions (${conflictingSources.map(
        (c) => `${c.sourceAId} v${c.sourceAVersion} vs. ${c.sourceBId} v${c.sourceBVersion}`
      ).join(
        "; "
      )}). CampusResolve AI does not choose arbitrarily between conflicting active sources. Both provisions are surfaced below for human adjudication by ${escalationTeam}:
${conflictDescriptions}`,
      explanation: `Conflict & Evidence Explanation: Both sources are marked active/published as of ${asOfDate}, but specify divergent versions or policy clauses. Escalation to ${escalationTeam} is required for authoritative interpretation.`,
      supportedFacts,
      missingOrUnestablishedFacts
    };
  }
  if (applicablePolicies.length === 0 && clarificationNeeded) {
    for (const cq of clarificationQuestions) {
      missingOrUnestablishedFacts.push(`Clarification Required: ${cq}`);
    }
    return {
      answer: `CLARIFICATION REQUIRED (AMBIGUOUS INQUIRY): Your question could apply to multiple institutional policy domains or conditional procedures as of ${asOfDate}. Please clarify the following so CampusResolve AI can cite the exact governing policy version:
${clarificationQuestions.map((q, idx) => `${idx + 1}. ${q}`).join("\n")}`,
      explanation: `Ambiguity Explanation: Institutional deadlines and eligibility rules differ across Financial Aid (15 business days for SAP appeals), Registration (10 business days for add/drop; Week 8 for W withdrawal), IT (FIDO2/TOTP MFA), and Accessibility (5 business days for exam notice). Clarifying your domain and timing allows exact policy grounding.`,
      supportedFacts,
      missingOrUnestablishedFacts
    };
  }
  const primaryPol = applicablePolicies[0];
  const primaryArt = applicableArticles[0];
  const routingRule = detectedCategory ? DOCUMENTED_ROUTING_RULES[detectedCategory] : null;
  const expiredNote = expiredPoliciesExcluded.length > 0 ? `Rejected Expired/Superseded Policy Note: Historical version(s) (${expiredPoliciesExcluded.map(
    (p) => `${p.policy_id} v${p.version}, effective ${p.effective_date}${p.expiration_date ? `, expired ${p.expiration_date}` : ""}${p.superseded_by_policy_id ? `, superseded by ${p.superseded_by_policy_id}` : ""}`
  ).join(
    "; "
  )}) were rejected as current guidance and excluded from active policy authority.` : "";
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
  if (evidenceStatus === "partial_or_ambiguous" && !unsupportedClaimRequested && !clarificationNeeded) {
    missingOrUnestablishedFacts.push(
      escalationReason || "Exception, retroactive petition, or appeal approval requires discretionary committee review and cannot be automatically granted."
    );
  }
  const unsupportedWarningPrefix = unsupportedClaimRequested ? `UNSUPPORTED FACT NOTICE: Available active policy sources (${primaryPol.policy_id} v${primaryPol.version}) do NOT establish the requested monetary fee, fine, stipend, or guarantee (${unsupportedClaimDetails.join(
    " "
  )}). CampusResolve AI will not fabricate unestablished figures. Verified provisions that ARE established in ${primaryPol.policy_id} v${primaryPol.version} are provided below:` : "";
  const clarificationSuffix = clarificationNeeded && clarificationQuestions.length > 0 ? `Clarification Needed to Confirm Exact Provision: ${clarificationQuestions.join(
    " "
  )}` : "";
  const escalationNote = evidenceStatus === "partial_or_ambiguous" ? `Because this inquiry involves an exception, formal appeal, unsupported claim, or conditional ambiguity, human review by ${routingRule?.escalation_assigned_team || UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team} is recommended.` : "";
  const additionalPoliciesText = applicablePolicies.length > 1 ? `Additional Applicable Policy Provisions: ${applicablePolicies.slice(1).map(
    (p) => `[${p.policy_id} v${p.version}, effective ${p.effective_date}, ${p.authoritative_section_ref}]: ${p.content}`
  ).join(" ")}` : "";
  const answer = [
    unsupportedWarningPrefix,
    `Grounded in active policy ${primaryPol.policy_id} (v${primaryPol.version}, effective ${primaryPol.effective_date}, ${primaryPol.authoritative_section_ref}: "${primaryPol.title}")${primaryArt ? ` and knowledge article ${primaryArt.article_id} (v${primaryArt.version})` : ""}:`,
    primaryPol.content,
    additionalPoliciesText,
    primaryArt ? `Operational Procedure (${primaryArt.article_id} v${primaryArt.version}): ${primaryArt.content}` : "",
    expiredNote.trim(),
    clarificationSuffix.trim(),
    escalationNote.trim()
  ].filter(Boolean).join(" ");
  const explanation = [
    `Verified Policy Evidence: Cited directly from ${primaryPol.policy_id} v${primaryPol.version} (${primaryPol.authoritative_section_ref}, effective ${primaryPol.effective_date})${primaryArt ? ` and ${primaryArt.article_id} v${primaryArt.version} (effective ${primaryArt.effective_date})` : ""}.`,
    routingRule ? `General Operational Routing Context: Standard inquiries in '${detectedCategory}' route to ${routingRule.primary_assigned_team} under ${routingRule.rule_id}, while exceptions and appeals escalate to ${routingRule.escalation_assigned_team}.` : "",
    expiredNote.trim(),
    unsupportedClaimRequested ? `Limitation Statement: ${unsupportedClaimDetails.join(" ")}` : "",
    clarificationNeeded ? `Clarification Prompt: ${clarificationQuestions.join(" ")}` : ""
  ].filter(Boolean).join(" ");
  return {
    answer,
    explanation,
    supportedFacts,
    missingOrUnestablishedFacts
  };
}
function mapPolicyToCitedSourceDetail(p, asOfDate, isExcluded = false) {
  const app = evaluateSourceApplicability(p, asOfDate);
  const citation = `${p.policy_id} v${p.version} (${p.authoritative_section_ref}, Effective ${p.effective_date}${p.expiration_date ? `, Expired ${p.expiration_date}` : ""}): "${p.title}"`;
  return {
    sourceType: "policy",
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
    exclusionReason: isExcluded ? app.reason : void 0
  };
}
function mapArticleToCitedSourceDetail(a, asOfDate, isExcluded = false) {
  const app = evaluateSourceApplicability(a, asOfDate);
  const sectionRef = `Linked to ${a.primary_policy_id} v${a.primary_policy_version}`;
  const citation = `${a.article_id} v${a.version} (${sectionRef}, Effective ${a.effective_date}${a.expiration_date ? `, Expired ${a.expiration_date}` : ""}): "${a.title}"`;
  return {
    sourceType: "article",
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
    exclusionReason: isExcluded ? app.reason : void 0
  };
}
async function processPolicyAssistantRequest(method, body, headers, injectedContext) {
  if ((method || "").toUpperCase() !== "POST") {
    return {
      status: 405,
      body: {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        message: "Only POST requests are supported on /api/ai/policy-assistant."
      }
    };
  }
  let profile;
  let client;
  let injectedServiceClient;
  if (injectedContext) {
    profile = injectedContext.profile;
    client = injectedContext.client;
    injectedServiceClient = injectedContext.serviceRoleClient;
    if (typeof client?.setAuthenticatedTestCaller === "function") {
      client.setAuthenticatedTestCaller(profile);
    }
  } else {
    const caller = await verifyAuthenticatedProfileFromHeaders(headers);
    if (!caller.verified || !caller.profile || !caller.client) {
      return {
        status: 401,
        body: {
          ok: false,
          code: "UNAUTHORIZED",
          message: caller.errorMessage || "Authentication is required to use the AI Policy Assistant."
        }
      };
    }
    profile = caller.profile;
    client = caller.client;
  }
  const auditClient = injectedContext ? injectedServiceClient || client : createServiceRoleSupabaseClient() || client;
  const action = body?.action || "query";
  if (action === "feedback") {
    const queryId2 = (body?.queryId || "").trim();
    if (!queryId2 || typeof body?.helpful !== "boolean") {
      return {
        status: 400,
        body: {
          ok: false,
          code: "INVALID_FEEDBACK_PAYLOAD",
          message: "queryId and boolean helpful flag are required."
        }
      };
    }
    const { data: existingLog } = await auditClient.from("ai_retrieval_logs").select("*").eq("query_id", queryId2).maybeSingle();
    if (existingLog && existingLog.requester_profile_id !== profile.id) {
      return {
        status: 403,
        body: {
          ok: false,
          code: "FORBIDDEN_CROSS_USER_AUDIT_LOG",
          message: "You are only authorized to submit feedback on your own AI policy retrieval sessions."
        }
      };
    }
    const { data: updated, error } = await auditClient.from("ai_retrieval_logs").update({ feedback_helpful: body.helpful }).eq("query_id", queryId2).eq("requester_profile_id", profile.id).select("*").maybeSingle();
    if (error) {
      return {
        status: 503,
        body: {
          ok: false,
          code: "DATABASE_SCHEMA_NOT_APPLIED",
          errorCode: error.code,
          message: `Could not persist feedback in remote PostgreSQL table public.ai_retrieval_logs (${error.code}: ${error.message}).`
        }
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        retrievalLog: updated,
        message: "Retrieval feedback recorded in remote PostgreSQL."
      }
    };
  }
  if (action === "link_escalation_ticket") {
    const queryId2 = (body?.queryId || "").trim();
    const ticketId = (body?.ticketId || "").trim();
    if (!queryId2 || !ticketId) {
      return {
        status: 400,
        body: {
          ok: false,
          code: "INVALID_ESCALATION_LINK_PAYLOAD",
          message: "queryId and ticketId are required to link an escalated ticket."
        }
      };
    }
    const { data: existingLog } = await auditClient.from("ai_retrieval_logs").select("*").eq("query_id", queryId2).maybeSingle();
    if (existingLog && existingLog.requester_profile_id !== profile.id) {
      return {
        status: 403,
        body: {
          ok: false,
          code: "FORBIDDEN_CROSS_USER_AUDIT_LOG",
          message: "You are only authorized to link escalation tickets to your own AI policy retrieval sessions."
        }
      };
    }
    const { data: updated, error } = await auditClient.from("ai_retrieval_logs").update({
      escalated_ticket_id: ticketId,
      escalation_triggered: true
    }).eq("query_id", queryId2).eq("requester_profile_id", profile.id).select("*").maybeSingle();
    if (error) {
      return {
        status: 503,
        body: {
          ok: false,
          code: "DATABASE_SCHEMA_NOT_APPLIED",
          errorCode: error.code,
          message: `Could not link escalated ticket ${ticketId} in public.ai_retrieval_logs (${error.code}: ${error.message}).`
        }
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        retrievalLog: updated,
        message: `Linked escalated ticket ${ticketId} to retrieval session ${queryId2}.`
      }
    };
  }
  const rawQuery = (body?.query || "").trim();
  if (rawQuery.length < 5) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "QUERY_TOO_SHORT",
        message: "Please enter a specific policy question (minimum 5 characters)."
      }
    };
  }
  const asOfDate = (body?.asOfDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).trim();
  const [polRes, artRes, histRes] = await Promise.all([
    client.from("policy_documents").select("*"),
    client.from("knowledge_articles").select("*"),
    client.from("policy_version_history").select("*")
  ]);
  const fallbackCorpus = getReferenceCorpus();
  const rawPolicies = injectedContext?.customCorpus?.policies ?? (polRes.data && polRes.data.length > 0 ? polRes.data : fallbackCorpus.policyDocuments);
  const rawArticles = injectedContext?.customCorpus?.articles ?? (artRes.data && artRes.data.length > 0 ? artRes.data : fallbackCorpus.knowledgeArticles);
  const versionHistoryRecords = injectedContext?.customCorpus?.policyVersionHistory ?? (histRes?.data || []);
  const accessCheck = evaluatePolicyAssistantAccessControl({
    profile,
    body,
    policies: rawPolicies
  });
  if (!accessCheck.authorized) {
    return {
      status: accessCheck.status,
      body: {
        ok: false,
        code: accessCheck.code,
        message: accessCheck.message
      }
    };
  }
  const isAdminCaller = profile.actor_role === "academic_administrator" /* AcademicAdministrator */ || profile.actor_role === "platform_administrator" /* PlatformAdministrator */;
  const policyDocuments = isAdminCaller ? rawPolicies : rawPolicies.filter((p) => p.lifecycle_state !== "draft");
  const knowledgeArticles = isAdminCaller ? rawArticles : rawArticles.filter((a) => a.lifecycle_state !== "draft");
  const retrieval = retrieveApplicablePolicyEvidence({
    query: rawQuery,
    policies: policyDocuments,
    articles: knowledgeArticles,
    asOfDateIso: `${asOfDate}T12:00:00.000Z`
  });
  const routingRule = retrieval.detectedCategory ? DOCUMENTED_ROUTING_RULES[retrieval.detectedCategory] : null;
  const recommendedTeam = retrieval.escalationRecommended ? routingRule?.escalation_assigned_team || UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team : routingRule?.primary_assigned_team || UNMAPPED_HUMAN_REVIEW_ROUTING.assigned_team;
  const recommendedRoutingRuleId = retrieval.escalationRecommended ? routingRule?.rule_id || UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id : routingRule?.rule_id || UNMAPPED_HUMAN_REVIEW_ROUTING.rule_id;
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
    unsupportedClaimDetails: retrieval.unsupportedClaimDetails || []
  });
  let synthesisMode = "deterministic_fallback";
  let modelUsed = "deterministic-rule-engine";
  let geminiApiStatus = "api_key_missing";
  let geminiApiError = null;
  const evidenceContext = [
    ...retrieval.applicablePolicies.map(
      (p) => `POLICY_ID: ${p.policy_id} | VERSION: ${p.version} | EFFECTIVE: ${p.effective_date} | SECTION: ${p.authoritative_section_ref} | TITLE: ${p.title}
CONTENT: ${p.content}`
    ),
    ...retrieval.applicableArticles.map(
      (a) => `ARTICLE_ID: ${a.article_id} | VERSION: ${a.version} | LINKED_POLICY: ${a.primary_policy_id} v${a.primary_policy_version} | EFFECTIVE: ${a.effective_date} | TITLE: ${a.title}
CONTENT: ${a.content}`
    )
  ].join("\n\n---\n\n");
  if (injectedContext?.customGeminiSynthesizer && retrieval.applicablePolicies.length > 0 && retrieval.evidenceStatus !== "unsupported_or_missing" && retrieval.evidenceStatus !== "expired_only" && !retrieval.hasConflictingSources) {
    try {
      const customRes = await injectedContext.customGeminiSynthesizer({
        query: rawQuery,
        asOfDate,
        evidenceContext
      });
      if (customRes && typeof customRes.groundedAnswer === "string") {
        synthesized = {
          answer: customRes.groundedAnswer,
          explanation: customRes.explanation || synthesized.explanation,
          supportedFacts: customRes.supportedFacts?.length > 0 ? customRes.supportedFacts : synthesized.supportedFacts,
          missingOrUnestablishedFacts: customRes.missingOrUnestablishedFacts?.length > 0 ? customRes.missingOrUnestablishedFacts : synthesized.missingOrUnestablishedFacts
        };
        synthesisMode = "gemini_api";
        modelUsed = "gemini-3-flash-preview";
        geminiApiStatus = "succeeded";
      }
    } catch (err) {
      geminiApiStatus = "fallback_after_error";
      geminiApiError = err instanceof Error ? err.message : String(err || "Gemini API error");
    }
  } else {
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const hasRealGeminiKey = Boolean(apiKey) && apiKey !== "MY_GEMINI_API_KEY" && !apiKey.startsWith("YOUR_");
    if ((!injectedContext || injectedContext.allowLiveGemini) && hasRealGeminiKey && retrieval.applicablePolicies.length > 0 && retrieval.evidenceStatus !== "unsupported_or_missing" && retrieval.evidenceStatus !== "expired_only" && !retrieval.hasConflictingSources) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const expiredContext = retrieval.expiredPoliciesExcluded.length > 0 ? retrieval.expiredPoliciesExcluded.map(
        (p) => `EXPIRED_POLICY_ID: ${p.policy_id} v${p.version} (Expired ${p.expiration_date}) \u2014 REJECTED AS CURRENT AUTHORITY`
      ).join("\n") : "None";
      const candidateModels = ["gemini-2.5-flash"];
      for (const candidateModel of candidateModels) {
        try {
          const callWithTimeout = (timeoutMs = 12e3) => Promise.race([
            ai.models.generateContent({
              model: candidateModel,
              contents: `User Policy Question: "${rawQuery}"
Reference Date: ${asOfDate}

APPLICABLE RETRIEVED EVIDENCE:
${evidenceContext}

EXCLUDED EXPIRED SOURCES:
${expiredContext}`,
              config: {
                systemInstruction: "You are the CampusResolve AI Policy Assistant. Answer ONLY using the provided APPLICABLE RETRIEVED EVIDENCE. Cite the exact POLICY_ID (with version and effective date) and ARTICLE_ID (with version). Never invent policy rules, deadlines, fees, or numeric thresholds not explicitly written in the evidence. Explicitly reject any EXCLUDED EXPIRED SOURCES as current guidance. Clearly state if any aspect of the question is not established in the provided evidence and requires clarification or human escalation.",
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    groundedAnswer: {
                      type: Type.STRING,
                      description: "Policy-grounded answer citing exact POLICY_ID vX.X (with effective date) and ARTICLE_ID vX.X."
                    },
                    explanation: {
                      type: Type.STRING,
                      description: "Explanation distinguishing verified policy provisions from general routing context and any unestablished facts."
                    },
                    supportedFacts: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "Specific facts directly supported by the retrieved policy and article versions."
                    },
                    missingOrUnestablishedFacts: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "Any parts of the user question that cannot be established from the retrieved sources."
                    }
                  },
                  required: [
                    "groundedAnswer",
                    "explanation",
                    "supportedFacts",
                    "missingOrUnestablishedFacts"
                  ]
                }
              }
            }),
            new Promise(
              (_, reject) => setTimeout(
                () => reject(
                  new Error(
                    `Gemini model ${candidateModel} timed out after ${timeoutMs}ms.`
                  )
                ),
                timeoutMs
              )
            )
          ]);
          const response = await callWithTimeout(12e3);
          const rawJson = (response.text ?? "").trim();
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (parsed && typeof parsed.groundedAnswer === "string" && parsed.groundedAnswer.length >= 20) {
              const primaryPol = retrieval.applicablePolicies[0];
              const includesPrimaryCitation = parsed.groundedAnswer.includes(primaryPol.policy_id) && parsed.groundedAnswer.includes(primaryPol.version);
              const verifiedAnswer = includesPrimaryCitation ? parsed.groundedAnswer : `[${primaryPol.policy_id} v${primaryPol.version}, Effective ${primaryPol.effective_date}] ${parsed.groundedAnswer}`;
              synthesized = {
                answer: verifiedAnswer,
                explanation: typeof parsed.explanation === "string" && parsed.explanation.length >= 10 ? parsed.explanation : synthesized.explanation,
                supportedFacts: Array.isArray(parsed.supportedFacts) && parsed.supportedFacts.length > 0 ? parsed.supportedFacts : synthesized.supportedFacts,
                missingOrUnestablishedFacts: Array.isArray(parsed.missingOrUnestablishedFacts) && parsed.missingOrUnestablishedFacts.length > 0 ? parsed.missingOrUnestablishedFacts : synthesized.missingOrUnestablishedFacts
              };
              synthesisMode = "gemini_api";
              modelUsed = candidateModel;
              geminiApiStatus = "succeeded";
              geminiApiError = null;
              break;
            }
          }
        } catch (err) {
          geminiApiStatus = "fallback_after_error";
          geminiApiError = err instanceof Error ? err.message : String(err || "Gemini API error");
        }
      }
    }
  }
  const queryId = `QRY-2026-${String(Date.now()).slice(-6)}`;
  const logRecord = {
    query_id: queryId,
    requester_profile_id: profile.id,
    actor_role: profile.actor_role,
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
      )
    ],
    generated_response: synthesized.answer,
    retrieval_confidence: retrieval.retrievalConfidence,
    evidence_status: retrieval.evidenceStatus,
    escalation_triggered: retrieval.escalationRecommended,
    escalation_reason: retrieval.escalationReason,
    escalated_ticket_id: null,
    feedback_helpful: null,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { error: logInsertErr } = await auditClient.from("ai_retrieval_logs").insert(logRecord);
  const databasePersistence = {
    persistedToPostgres: !logInsertErr,
    table: "public.ai_retrieval_logs",
    errorCode: logInsertErr?.code ?? null,
    errorMessage: logInsertErr?.message ?? null
  };
  const citedSources = [
    ...retrieval.applicablePolicies.map(
      (p) => mapPolicyToCitedSourceDetail(p, asOfDate, false)
    ),
    ...retrieval.applicableArticles.map(
      (a) => mapArticleToCitedSourceDetail(a, asOfDate, false)
    )
  ];
  const expiredSourcesExcludedDetails = [
    ...retrieval.expiredPoliciesExcluded.map(
      (p) => mapPolicyToCitedSourceDetail(p, asOfDate, true)
    ),
    ...retrieval.expiredArticlesExcluded.map(
      (a) => mapArticleToCitedSourceDetail(a, asOfDate, true)
    )
  ];
  const relevantPolicyIds = /* @__PURE__ */ new Set([
    ...retrieval.applicablePolicies.map((p) => p.policy_id),
    ...retrieval.expiredPoliciesExcluded.map((p) => p.policy_id)
  ]);
  const policyVersionHistoryMatched = versionHistoryRecords.filter(
    (h) => relevantPolicyIds.has(h.policy_id)
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
      recommendedRoutingRuleId
    }
  };
}
async function handler(req, res) {
  const sendResponse = (status, body) => {
    try {
      if (status === 204) {
        if (typeof res.status === "function" && typeof res.end === "function") {
          res.status(204).end();
        } else {
          res.statusCode = 204;
          res.end();
        }
        return;
      }
      if (typeof res.status === "function" && typeof res.json === "function") {
        res.status(status).json(body);
        return;
      }
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    } catch {
      try {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: false,
            code: "SERVER_ERROR",
            message: "Failed writing policy assistant response."
          })
        );
      } catch {
      }
    }
  };
  try {
    const method = (req.method || "GET").toUpperCase();
    let parsedBody = req.body;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      parsedBody = void 0;
    } else if (typeof parsedBody === "string" && parsedBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        parsedBody = void 0;
      }
    } else if (parsedBody === void 0 && typeof req.on === "function" && !req.readableEnded) {
      const contentLength = req.headers?.["content-length"];
      const hasBody = contentLength && parseInt(contentLength, 10) > 0 || Boolean(req.headers?.["transfer-encoding"]);
      if (hasBody) {
        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          if (raw.trim().length > 0) {
            parsedBody = JSON.parse(raw);
          }
        } catch {
          parsedBody = void 0;
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
      code: "SERVER_ERROR",
      message: err instanceof Error ? err.message : "An unexpected error occurred in the policy assistant service."
    });
  }
}
export {
  handler as default,
  evaluatePolicyAssistantAccessControl,
  processPolicyAssistantRequest
};
