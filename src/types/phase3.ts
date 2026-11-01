import { ActorRole, RequestStatus } from './domain.js';

/**
 * Official challenge ticket categories (Section 7).
 * Do not invent additional official ticket categories.
 */
export type OfficialCategoryName =
  | 'Financial Aid'
  | 'Registration'
  | 'IT'
  | 'Accessibility';

export type PolicyDomainCode = 'FINAID' | 'REG' | 'IT' | 'ACCESS';

export type TermLifecycleState = 'archived' | 'active' | 'upcoming';

export type PolicyLifecycleState =
  | 'draft'
  | 'active'
  | 'expired'
  | 'superseded';

export type ArticleLifecycleState =
  | 'draft'
  | 'published'
  | 'expired'
  | 'archived';

export type TicketPriorityLevel =
  | 'Standard Priority'
  | 'Time-Sensitive Academic Priority'
  | 'Administrative Escalation Priority';

export type MessageRecordType =
  | 'requester_inquiry'
  | 'staff_response'
  | 'ai_grounded_reply'
  | 'system_routing_note'
  | 'escalation_handoff'
  | 'resolution_summary';

export type SLACalculationMode =
  | 'business_hours_configured'
  | 'wall_clock_24x7';

export type SLAEscalationStatus =
  | 'not_required'
  | 'pending_escalation'
  | 'escalated'
  | 'escalation_missed';

export type SLARuleClassification =
  | 'CONFIRMED_CHALLENGE_REQUIREMENT'
  | 'PROPOSED_CONFIGURABLE_RULE'
  | 'SYNTHETIC_EVAL_SCENARIO';

export type AIEvidenceStatus =
  | 'supported'
  | 'partial_or_ambiguous'
  | 'unsupported_or_missing'
  | 'expired_only';

/**
 * Challenge-defined 5 anomaly scenarios (Section 13).
 */
export type AnomalyScenarioType =
  | 'expired_policy_citation'
  | 'unauthorized_team_routing'
  | 'unsupported_factual_claim'
  | 'sla_clock_ignores_business_hours'
  | 'required_escalation_not_triggered';

/**
 * 1. Core Entity: Requester
 */
export interface RequesterRecord {
  requester_id: string; // REQ-2026-000001 or REQ-USR-<hash>
  app_profile_id: string | null; // Optional 1:1 FK to public.app_profiles(id)
  role_id: string; // FK -> Role.role_id
  primary_term_id: string; // FK -> Term.term_id
  verified_email: string;
  display_name: string;
  department: string;
  program_or_unit: string | null;
  account_status: 'active' | 'inactive' | 'suspended';
  is_synthetic_eval: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 2. Core Entity: Role
 */
export interface RoleRecord {
  role_id: string; // ROLE-LEARNER, etc.
  role_code: ActorRole;
  role_name: string;
  institutional_scope: string;
  description: string;
  allowed_actions: string[];
  can_be_assigned_tickets: boolean;
  can_publish_policies: boolean;
  can_approve_escalations: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

/**
 * 3. Core Entity: Term
 */
export interface TermRecord {
  term_id: string; // TERM-2026-FALL, etc.
  term_code: string;
  term_name: string;
  academic_year: number;
  start_date: string;
  end_date: string;
  add_drop_deadline: string;
  withdrawal_deadline: string;
  aid_disbursement_date: string;
  lifecycle_state: TermLifecycleState;
  created_at: string;
}

/**
 * 4. Core Entity: PolicyDocument
 * Exact ID format: POL-<domain>-2026-001
 */
export interface PolicyDocumentRecord {
  policy_id: string; // POL-FINAID-2026-001
  domain: PolicyDomainCode;
  category_id: CategoryRecord['category_id']; // FK -> Category.category_id
  title: string;
  version: string; // e.g. '1.0', '2.0'
  effective_date: string;
  expiration_date: string | null;
  lifecycle_state: PolicyLifecycleState;
  supersedes_policy_id: string | null;
  superseded_by_policy_id: string | null;
  summary: string;
  content: string;
  authoritative_section_ref: string;
  source_name: string;
  source_url: string;
  dataset_or_doc_version: string;
  retrieval_date: string;
  license_terms: string;
  attribution: string;
  transformations_performed: string;
  discarded_fields: string | null;
  is_synthetic_policy: boolean;
  published_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Historical snapshot of PolicyDocument
 */
export interface PolicyVersionHistoryRecord {
  history_id: string;
  policy_id: string;
  version: string;
  effective_date: string;
  expiration_date: string | null;
  lifecycle_state: PolicyLifecycleState;
  change_summary: string;
  authoritative_section_ref: string;
  title?: string;
  content?: string;
  recorded_reason?: string;
  recorded_at: string;
}

/**
 * 5. Core Entity: KnowledgeArticle
 * Exact ID format: KB-000001
 */
export interface KnowledgeArticleRecord {
  article_id: string; // KB-000001
  category_id: CategoryRecord['category_id']; // FK -> Category.category_id
  primary_policy_id: string; // FK -> PolicyDocument.policy_id
  primary_policy_version: string;
  title: string;
  version: string;
  effective_date: string;
  expiration_date: string | null;
  lifecycle_state: ArticleLifecycleState;
  summary: string;
  content: string;
  tags: string[];
  source_url: string;
  dataset_or_doc_version: string;
  retrieval_date: string;
  license_terms: string;
  attribution: string;
  transformations_performed: string;
  discarded_fields: string | null;
  is_synthetic_article: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Many-to-many Bridge: PolicyDocument <-> KnowledgeArticle
 */
export interface PolicyArticleLinkRecord {
  link_id: string;
  policy_id: string;
  policy_version: string;
  article_id: string;
  article_version: string;
  relationship_type:
    | 'primary_governance'
    | 'supporting_reference'
    | 'superseded_reference'
    | 'historical_reference';
  created_at: string;
}

/**
 * 6. Core Entity: Ticket
 * Exact ID format: TKT-2026-000001
 */
export interface TicketRecord {
  ticket_id: string; // TKT-2026-000001
  requester_id: string; // FK -> Requester.requester_id
  requester_profile_id: string | null; // FK -> app_profiles.id
  category_id: CategoryRecord['category_id']; // FK -> Category.category_id
  category_name: OfficialCategoryName;
  term_id: string; // FK -> Term.term_id
  subject: string;
  description: string;
  priority: TicketPriorityLevel;
  lifecycle_status: RequestStatus;
  current_assigned_team: string;
  current_routing_rule_id: string;
  referenced_policy_id: string | null;
  referenced_policy_version: string | null;
  referenced_article_id: string | null;
  referenced_article_version: string | null;
  requires_escalation: boolean;
  is_escalated: boolean;
  escalation_reason: string | null;
  resolution_summary: string | null;
  is_synthetic_eval: boolean;
  submitted_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

/**
 * Many-to-many Bridge: Ticket <-> PolicyDocument
 */
export interface TicketPolicyLinkRecord {
  link_id: string;
  ticket_id: string;
  policy_id: string;
  policy_version: string;
  applicability_status:
    | 'applicable_current'
    | 'expired_at_citation'
    | 'superseded_at_citation';
  linked_by_actor: string;
  linked_at: string;
}

/**
 * Many-to-many Bridge: Ticket <-> KnowledgeArticle
 */
export interface TicketArticleLinkRecord {
  link_id: string;
  ticket_id: string;
  article_id: string;
  article_version: string;
  applicability_status:
    | 'applicable_current'
    | 'expired_at_citation'
    | 'archived_at_citation';
  linked_by_actor: string;
  linked_at: string;
}

/**
 * Explicit Lifecycle Event Audit Record (Section 9)
 */
export interface TicketLifecycleEventRecord {
  event_id: string;
  ticket_id: string;
  previous_state: RequestStatus | null;
  new_state: RequestStatus;
  actor_id: string;
  actor_role: ActorRole;
  reason: string;
  referenced_policy_id: string | null;
  referenced_policy_version: string | null;
  referenced_article_id: string | null;
  referenced_article_version: string | null;
  event_timestamp: string;
}

/**
 * 7. Core Entity: Message
 * Exact ID format: MSG-<ticket-id>-001
 */
export interface MessageRecord {
  message_id: string; // MSG-TKT-2026-000001-001
  ticket_id: string; // FK -> Ticket.ticket_id
  sequence_number: number;
  sender_id: string;
  sender_profile_id: string | null;
  sender_role: ActorRole;
  sender_name: string;
  message_type: MessageRecordType;
  body: string;
  cited_policy_id: string | null;
  cited_policy_version: string | null;
  cited_article_id: string | null;
  cited_article_version: string | null;
  is_internal?: boolean;
  created_at: string;
}

/**
 * 8. Core Entity: Category
 */
export interface CategoryRecord {
  category_id: 'CAT-FINAID' | 'CAT-REG' | 'CAT-IT' | 'CAT-ACCESS';
  category_name: OfficialCategoryName;
  domain_code: PolicyDomainCode;
  default_assigned_team: string;
  escalation_team: string;
  routing_rule_id: string;
  description: string;
  keywords: string[];
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

/**
 * 9. Core Entity: Assignment
 */
export interface AssignmentRecord {
  assignment_id: string; // ASG-TKT-2026-000001-01
  ticket_id: string; // FK -> Ticket.ticket_id
  sequence_number: number;
  assigned_team: string;
  assigned_actor_id: string | null;
  assigned_actor_role: ActorRole;
  routing_rule_id: string;
  assignment_reason: string;
  previous_assignment_id: string | null;
  previous_assigned_team: string | null;
  requires_human_review: boolean;
  is_active: boolean;
  assigned_at: string;
  unassigned_at: string | null;
}

/**
 * Phase 7: Operational SLA Status Classification
 * Note: 'approaching_deadline' threshold is a PROPOSED_CONFIGURABLE_RULE (configurable assumption),
 * not an official hardcoded YottaFlex challenge regulation.
 */
export type SLAOperationalStatus =
  | 'within_sla'
  | 'approaching_deadline'
  | 'breached'
  | 'resolved_within_sla'
  | 'resolved_after_breach'
  | 'invalid_configuration';

/**
 * Phase 7: Documented Escalation Trigger Codes
 */
export type EscalationTriggerCode =
  | 'approaching_sla_deadline'
  | 'sla_breached'
  | 'unresolved_post_escalation'
  | 'missing_or_invalid_assignment'
  | 'unauthorized_team_routing'
  | 'human_review_required'
  | 'ai_policy_assistant_escalation'
  | 'administrative_priority_escalation'
  | 'appeal_or_exception_petition'
  | 'expired_or_conflicting_policy_reference';

export interface SLACalculationHistoryStep {
  step_index: number;
  step_code: string;
  recorded_at: string;
  description: string;
}

/**
 * 10. Core Entity: SLA
 * Exact ID format: SLA-<ticket-id>
 */
export interface SLARecord {
  sla_id: string; // SLA-TKT-2026-000001
  ticket_id: string; // 1:1 FK -> Ticket.ticket_id
  sla_rule_id: string;
  applicable_category: OfficialCategoryName;
  rule_classification: SLARuleClassification;
  target_business_minutes: number;
  start_timestamp: string;
  due_timestamp: string;
  evaluated_timestamp: string;
  elapsed_wall_clock_minutes: number;
  elapsed_business_minutes: number;
  calculation_mode: SLACalculationMode;
  business_schedule_code: string;
  breach_status: boolean;
  escalation_status: SLAEscalationStatus;
  calculation_explanation: string;
  created_at: string;
  updated_at?: string;
  // Phase 7 computed operational fields (derived at evaluation time; not extra DB columns)
  sla_status?: SLAOperationalStatus;
  is_approaching_deadline?: boolean;
  approaching_threshold_ratio?: number;
  approaching_threshold_business_minutes?: number;
  remaining_business_minutes?: number;
  remaining_wall_clock_minutes?: number;
  overdue_business_minutes?: number;
  overdue_wall_clock_minutes?: number;
  first_response_timestamp?: string | null;
  actual_response_business_minutes?: number | null;
  actual_response_wall_clock_minutes?: number | null;
  resolved_timestamp?: string | null;
  resolution_business_minutes?: number | null;
  resolution_wall_clock_minutes?: number | null;
  holiday_dates_excluded_utc?: string[];
  timezone_name?: string;
  configuration_valid?: boolean;
  configuration_error_code?: string | null;
  configuration_error_message?: string | null;
  calculation_history?: SLACalculationHistoryStep[];
}

/**
 * 11. Core Entity: ResolutionFeedback
 */
export interface ResolutionFeedbackRecord {
  feedback_id: string; // FDB-TKT-2026-000001
  ticket_id: string; // 1:0..1 FK -> Ticket.ticket_id
  requester_id: string; // FK -> Requester.requester_id
  rating: number; // 1..5
  was_helpful: boolean;
  resolution_accepted: boolean;
  policy_clarity_score: number; // 1..5
  comments: string | null;
  submitted_at: string;
}

/**
 * AI Policy Retrieval Audit Log (Section 12)
 */
export interface AIRetrievalLogRecord {
  query_id: string;
  requester_profile_id: string | null;
  actor_role: ActorRole;
  user_query: string;
  detected_category: OfficialCategoryName | null;
  retrieved_policy_ids: string[];
  retrieved_policy_versions: string[];
  retrieved_article_ids: string[];
  retrieved_article_versions: string[];
  expired_sources_excluded: string[];
  generated_response: string;
  retrieval_confidence: number;
  evidence_status: AIEvidenceStatus;
  escalation_triggered: boolean;
  escalation_reason: string | null;
  escalated_ticket_id: string | null;
  feedback_helpful: boolean | null;
  created_at: string;
}

/**
 * Workspace Notification Record (Section 16)
 */
export interface WorkspaceNotificationRecord {
  notification_id: string;
  recipient_profile_id: string;
  ticket_id: string | null;
  event_type:
    | 'ticket_created'
    | 'routing_assigned'
    | 'policy_verified'
    | 'escalated'
    | 'resolved'
    | 'message_posted';
  category: 'escalations' | 'policy' | 'lifecycle';
  title: string;
  summary: string;
  policy_reference: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * Separate Ground-Truth Anomaly Record (Section 13)
 * NEVER included in operational AI input features.
 */
export interface GroundTruthAnomalyRecord {
  anomaly_id: string; // ANM-2026-000001
  related_record_id: string; // e.g. TKT-2026-000015 or SLA-TKT-2026-000015
  ticket_id: string;
  anomaly_type: AnomalyScenarioType;
  expected_decision: string;
  actual_observed_decision: string;
  ground_truth_label: 'ANOMALY_PRESENT';
  rule_reference: string;
  explanation: string;
}

/**
 * Separate Ground-Truth Ticket Evaluation Record (Section 14)
 * NEVER included in operational AI input features.
 */
export interface GroundTruthTicketEvaluationRecord {
  ticket_id: string;
  expected_category: OfficialCategoryName;
  expected_assigned_team: string;
  expected_routing_rule_id: string;
  expected_applicable_policy_id: string;
  expected_applicable_policy_version: string;
  expected_applicable_article_id: string;
  expected_applicable_article_version: string;
  expected_escalation_required: boolean;
  expected_sla_business_minutes: number;
  expected_sla_breach_under_business_hours: boolean;
  expected_lifecycle_outcome: RequestStatus;
  has_anomaly: boolean;
  anomaly_types: AnomalyScenarioType[];
  anomaly_ids: string[];
}
