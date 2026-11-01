import { ActorRole, RequestStatus } from '../types/domain';
import {
  AnomalyScenarioType,
  AssignmentRecord,
  CategoryRecord,
  GroundTruthAnomalyRecord,
  GroundTruthTicketEvaluationRecord,
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
} from '../types/phase3';
import {
  CONFIGURABLE_SLA_RULES,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
  DOCUMENTED_ROUTING_RULES,
  OFFICIAL_CATEGORIES,
  buildReproducibleSlaRecord,
  calculateElapsedBusinessMinutes,
  createLifecycleEvent,
   evaluateTicketRouting,
  formatAnomalyId,
  formatAssignmentId,
  formatFeedbackId,
  formatKnowledgeArticleId,
  formatMessageId,
  formatPolicyId,
  formatRequesterId,
  formatTicketId,
} from './workflowEngine';

export const DETERMINISTIC_SEED = 20261022;
export const BASE_ANCHOR_DATE_ISO = '2026-09-01T08:00:00.000Z';

/**
 * Deterministic Mulberry32 PRNG.
 * Guarantees 100% identical sequences across platforms for the same numeric seed.
 */
export class DeterministicRng {
  private state: number;

  constructor(seed: number = DETERMINISTIC_SEED) {
    this.state = seed >>> 0;
  }

  nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    const r = this.nextFloat();
    return (
      Math.floor(r * (maxInclusive - minInclusive + 1)) + minInclusive
    );
  }

  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(0, items.length - 1)];
  }
}

export interface GeneratorOptions {
  seed?: number;
  mode?: 'starter' | 'full';
  ticketCount?: number;
  knowledgeArticleCount?: number;
  messagesPerTicket?: number;
  requesterCount?: number;
}

export interface GeneratedDatasetBundle {
  metadata: {
    seed: number;
    mode: 'starter' | 'full';
    generatedAtAnchor: string;
    generationOrder: readonly string[];
    counts: {
      requesters: number;
      roles: number;
      terms: number;
      policyDocuments: number;
      knowledgeArticles: number;
      categories: number;
      tickets: number;
      messages: number;
      assignments: number;
      slas: number;
      resolutionFeedbacks: number;
      ticketLifecycleEvents: number;
      policyArticleLinks: number;
      ticketPolicyLinks: number;
      ticketArticleLinks: number;
      groundTruthAnomalies: number;
      groundTruthTicketEvaluations: number;
    };
  };
  // 11 Core Entities in exact generation order:
  requesters: RequesterRecord[];
  roles: RoleRecord[];
  terms: TermRecord[];
  policyDocuments: PolicyDocumentRecord[];
  knowledgeArticles: KnowledgeArticleRecord[];
  categories: CategoryRecord[];
  tickets: TicketRecord[];
  messages: MessageRecord[];
  assignments: AssignmentRecord[];
  slas: SLARecord[];
  resolutionFeedbacks: ResolutionFeedbackRecord[];
  // Bridge & History Tables:
  policyArticleLinks: PolicyArticleLinkRecord[];
  ticketPolicyLinks: TicketPolicyLinkRecord[];
  ticketArticleLinks: TicketArticleLinkRecord[];
  ticketLifecycleEvents: TicketLifecycleEventRecord[];
  // Separate Ground-Truth Evaluation Records (NEVER included in operational AI input features):
  groundTruthAnomalies: GroundTruthAnomalyRecord[];
  groundTruthTicketEvaluations: GroundTruthTicketEvaluationRecord[];
}

const FIRST_NAMES = [
  'Elena',
  'Marcus',
  'Priya',
  'David',
  'Sofia',
  'Liam',
  'Amara',
  'Noah',
  'Hannah',
  'Mateo',
  'Zoe',
  'Julian',
  'Nadia',
  'Caleb',
  'Maya',
  'Isaac',
  'Claire',
  'Devon',
  'Lin',
  'Tariq',
] as const;

const LAST_NAMES = [
  'Rostova',
  'Vance',
  'Patel',
  'Kim',
  'Alvarez',
  'OConnor',
  'Mensah',
  'Lindqvist',
  'ben-David',
  'Nakamura',
  'Moreau',
  'Castillo',
  'Ibrahim',
  'Kowalski',
  'Sterling',
  'okafor',
  'Chen',
  'Bhatia',
  'Mercer',
  'Silva',
] as const;

const DEPARTMENTS = [
  'Electrical Engineering & Computer Science',
  'Department of Economics',
  'School of Public Policy',
  'Department of Biological Sciences',
  'Department of Mathematics',
  'College of Humanities & Arts',
  'School of Architecture & Planning',
  'Department of Mechanical Engineering',
] as const;

interface PolicyTemplateSpec {
  domain: PolicyDomainCode;
  category: OfficialCategoryName;
  categoryId: CategoryRecord['category_id'];
  seq: number;
  title: string;
  version: string;
  effectiveDate: string;
  expirationDate: string | null;
  lifecycleState: 'active' | 'expired';
  supersedesSeq?: number;
  supersededBySeq?: number;
  sectionRef: string;
  summary: string;
  content: string;
  keyFactConstraint: string;
}

const POLICY_SPECS: readonly PolicyTemplateSpec[] = [
  // FINANCIAL AID (FINAID) - POL-FINAID-2026-001 (Expired v1.0) & POL-FINAID-2026-002 (Active v2.0), plus 003, 004
  {
    domain: 'FINAID',
    category: 'Financial Aid',
    categoryId: 'CAT-FINAID',
    seq: 1,
    title: 'Satisfactory Academic Progress (SAP) & Financial Aid Appeal Policy (Legacy)',
    version: '1.0',
    effectiveDate: '2025-01-01',
    expirationDate: '2026-06-30',
    lifecycleState: 'expired',
    supersededBySeq: 2,
    sectionRef: 'Section 4.1 (Superseded)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — EXPIRED] Legacy SAP appeal deadline rules effective through June 30, 2026.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-06-30), students placed on financial aid suspension had 10 calendar days from term start to submit a Satisfactory Academic Progress (SAP) appeal with supporting documentation to the Office of Financial Aid & Scholarships.',
    keyFactConstraint: 'Legacy 10-calendar-day window (Expired 2026-06-30)',
  },
  {
    domain: 'FINAID',
    category: 'Financial Aid',
    categoryId: 'CAT-FINAID',
    seq: 2,
    title: 'Satisfactory Academic Progress (SAP) & Financial Aid Appeal Policy',
    version: '2.0',
    effectiveDate: '2026-07-01',
    expirationDate: null,
    lifecycleState: 'active',
    supersedesSeq: 1,
    sectionRef: 'Section 4.2 (Current)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Current SAP appeal requirements, 15-business-day submission window, and committee escalation rules.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Effective July 1, 2026 (Version 2.0, superseding POL-FINAID-2026-001 v1.0), students whose cumulative GPA falls below 2.0 or pace of completion falls below 67% may submit a written Satisfactory Academic Progress (SAP) appeal within 15 business days of notification. Standard eligibility verifications are handled by the Office of Financial Aid & Scholarships; second-level SAP appeals and emergency statutory waivers must be escalated to the Financial Aid Appeals & Compliance Review Committee.',
    keyFactConstraint: '15 business days from notification; min 2.0 GPA and 67% pace',
  },
  {
    domain: 'FINAID',
    category: 'Financial Aid',
    categoryId: 'CAT-FINAID',
    seq: 3,
    title: 'Term Aid Disbursement & Census Date Proration Policy',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 2.3',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Rules governing grant/scholarship disbursement timing and enrollment intensity proration at census date.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Institutional grants and federal aid disburse no earlier than 10 days prior to the official term start date, contingent upon active enrollment in at least 6 credit hours for half-time status or 12 credit hours for full-time status locked at the add/drop census deadline.',
    keyFactConstraint: 'Disbursement up to 10 days before term start; 12 credits full-time, 6 credits half-time',
  },
  // REGISTRATION (REG) - POL-REG-2026-001 (Expired v1.0) & POL-REG-2026-002 (Active v2.0), plus 003
  {
    domain: 'REG',
    category: 'Registration',
    categoryId: 'CAT-REG',
    seq: 1,
    title: 'Course Add/Drop & Late Withdrawal Petition Policy (Legacy)',
    version: '1.0',
    effectiveDate: '2025-01-01',
    expirationDate: '2026-05-31',
    lifecycleState: 'expired',
    supersededBySeq: 2,
    sectionRef: 'Section 3.1 (Superseded)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — EXPIRED] Legacy course drop and withdrawal rules effective through May 31, 2026.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-05-31), students could drop courses without a W grade through Week 3 of the semester.',
    keyFactConstraint: 'Legacy Week 3 add/drop window (Expired 2026-05-31)',
  },
  {
    domain: 'REG',
    category: 'Registration',
    categoryId: 'CAT-REG',
    seq: 2,
    title: 'Course Add/Drop & Late Withdrawal Petition Policy',
    version: '2.0',
    effectiveDate: '2026-06-01',
    expirationDate: null,
    lifecycleState: 'active',
    supersedesSeq: 1,
    sectionRef: 'Section 3.2 (Current)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Current 10-business-day add/drop window, W-grade withdrawal deadline, and retroactive petition escalation.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Effective June 1, 2026 (Version 2.0, superseding POL-REG-2026-001 v1.0), standard course additions and drops without transcript notation must be completed within the first 10 business days of the term via the Office of the University Registrar. Course withdrawals with a W notation are permitted through the end of Week 8. Any retroactive withdrawal or late drop petition after Week 8 requires documented extenuating circumstances and mandatory escalation to the Academic Senate Registration Review Board.',
    keyFactConstraint: '10 business days for add/drop without W; Week 8 withdrawal deadline; post-Week 8 escalates to Academic Senate Registration Review Board',
  },
  {
    domain: 'REG',
    category: 'Registration',
    categoryId: 'CAT-REG',
    seq: 3,
    title: 'Credit Overload & Cross-Departmental Prerequisite Override Policy',
    version: '1.0',
    effectiveDate: '2026-01-10',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 5.4',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Maximum term credit cap (18 credits) and approval rules for 19–22 credit overload petitions.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Standard undergraduate enrollment is capped at 18 credit hours per regular term. Requests to enroll in 19 to 22 credit hours require a minimum cumulative GPA of 3.30 and advisor attestation processed by the Office of the University Registrar.',
    keyFactConstraint: '18 credit standard cap; 19-22 credit overload requires 3.30 GPA',
  },
  // IT (IT) - POL-IT-2026-001 (Expired v1.0), POL-IT-2026-002 (Active v2.0), POL-IT-2026-003 (Active v1.0)
  {
    domain: 'IT',
    category: 'IT',
    categoryId: 'CAT-IT',
    seq: 1,
    title: 'Institutional Identity, SSO & Multi-Factor Authentication Policy (Legacy)',
    version: '1.0',
    effectiveDate: '2025-01-01',
    expirationDate: '2026-04-30',
    lifecycleState: 'expired',
    supersededBySeq: 2,
    sectionRef: 'Section 1.1 (Superseded)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — EXPIRED] Legacy SMS-based two-factor reset rules expired April 30, 2026.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-04-30), SMS text codes were permitted as a primary multi-factor authentication method for institutional accounts.',
    keyFactConstraint: 'Legacy SMS MFA allowed (Expired 2026-04-30)',
  },
  {
    domain: 'IT',
    category: 'IT',
    categoryId: 'CAT-IT',
    seq: 2,
    title: 'Institutional Identity, SSO & Multi-Factor Authentication Policy',
    version: '2.0',
    effectiveDate: '2026-05-01',
    expirationDate: null,
    lifecycleState: 'active',
    supersedesSeq: 1,
    sectionRef: 'Section 1.2 (Current)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Current hardware token / authenticator app MFA requirement and identity verification procedures.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Effective May 1, 2026 (Version 2.0, superseding POL-IT-2026-001 v1.0), all learners, instructors, and staff must use FIDO2 passkeys or TOTP authenticator apps for Single Sign-On (SSO). Routine MFA device resets are handled by the Campus IT Operations & Identity Desk after photo-ID verification. Suspected account compromise or privilege anomalies must be escalated immediately to the Information Security & Infrastructure Escalation Unit.',
    keyFactConstraint: 'FIDO2/TOTP MFA required; SMS deprecated; compromise escalates to Information Security & Infrastructure Escalation Unit',
  },
  {
    domain: 'IT',
    category: 'IT',
    categoryId: 'CAT-IT',
    seq: 3,
    title: 'LMS Course Shell Provisioning & Academic Software Licensing Policy',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 6.1',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Automated LMS roster synchronization and instructional lab software seat allocation.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] LMS course shells are provisioned 30 days before term start and synchronize roster changes every 4 hours with the Registrar feed. Special seat allocations for instructional lab software are fulfilled by the Campus IT Operations & Identity Desk.',
    keyFactConstraint: 'LMS shells provisioned 30 days prior; 4-hour roster sync interval',
  },
  // ACCESSIBILITY (ACCESS) - POL-ACCESS-2026-001 (Expired v1.0), POL-ACCESS-2026-002 (Active v2.0), POL-ACCESS-2026-003 (Active v1.0)
  {
    domain: 'ACCESS',
    category: 'Accessibility',
    categoryId: 'CAT-ACCESS',
    seq: 1,
    title: 'Academic Accommodations & Testing Notice Policy (Legacy)',
    version: '1.0',
    effectiveDate: '2025-01-01',
    expirationDate: '2026-06-15',
    lifecycleState: 'expired',
    supersededBySeq: 2,
    sectionRef: 'Section 7.1 (Superseded)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — EXPIRED] Legacy 14-day proctored testing notice requirement expired June 15, 2026.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Under legacy version 1.0 (expired 2026-06-15), students were required to submit proctored exam accommodation booking requests 14 calendar days prior to the examination date.',
    keyFactConstraint: 'Legacy 14-day testing notice (Expired 2026-06-15)',
  },
  {
    domain: 'ACCESS',
    category: 'Accessibility',
    categoryId: 'CAT-ACCESS',
    seq: 2,
    title: 'Academic Accommodations & Proctored Testing Notice Policy',
    version: '2.0',
    effectiveDate: '2026-06-16',
    expirationDate: null,
    lifecycleState: 'active',
    supersedesSeq: 1,
    sectionRef: 'Section 7.2 (Current)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Current 5-business-day proctored exam notice, accommodation letters, and Section 504 escalation.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Effective June 16, 2026 (Version 2.0, superseding POL-ACCESS-2026-001 v1.0), students holding approved accommodation letters from the Disability & Accessibility Services Office must submit proctored exam scheduling requests at least 5 business days before the exam. Accommodation implementation disputes, denials, or urgent barrier reports must be escalated to the ADA / Section 504 Compliance Review Panel.',
    keyFactConstraint: '5 business days exam scheduling notice; disputes escalate to ADA / Section 504 Compliance Review Panel',
  },
  {
    domain: 'ACCESS',
    category: 'Accessibility',
    categoryId: 'CAT-ACCESS',
    seq: 3,
    title: 'Assistive Technology, Real-Time Captioning & Accessible Media Policy',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 8.3',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Provisioning of screen-reader compatible course packets, CART captioning, and ergonomic classroom seating.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] The Disability & Accessibility Services Office coordinates real-time CART captioning, Braille/tactile graphics conversion, and screen-reader accessible PDF remediation for enrolled learners within 3 business days of request intake.',
    keyFactConstraint: '3 business days for accessible media/CART setup',
  },
];

/**
 * Generates the complete, deterministic Phase 3 dataset following the mandatory
 * 11-entity order (Section 5) and exact ID formats (Section 6).
 */
export function generateDeterministicDataset(
  options: GeneratorOptions = {}
): GeneratedDatasetBundle {
  const seed = options.seed ?? DETERMINISTIC_SEED;
  const mode = options.mode ?? 'full';
  const rng = new DeterministicRng(seed);

  const ticketCount =
    options.ticketCount ?? (mode === 'full' ? 5000 : 50);
  const knowledgeArticleCount =
    options.knowledgeArticleCount ?? (mode === 'full' ? 200 : 24);
  const messagesPerTicket = options.messagesPerTicket ?? 4; // 5000 * 4 = 20,000 messages in full mode
  const requesterCount =
    options.requesterCount ?? (mode === 'full' ? 500 : 25);

  const anchorMs = Date.parse(BASE_ANCHOR_DATE_ISO);

  // --------------------------------------------------------------------------
  // STEP 2 & 3 MASTER TABLES NEEDED FOR REQUESTER FK INTEGRITY: ROLE & TERM
  // Note: We instantiate Role and Term master arrays first so Requester FKs
  // reference valid Role and Term IDs, while preserving the logical bundle order.
  // --------------------------------------------------------------------------
  const roles: RoleRecord[] = [
    {
      role_id: 'ROLE-LEARNER',
      role_code: ActorRole.Learner,
      role_name: 'Learner',
      institutional_scope: 'Undergraduate & Graduate Student Cohort',
      description:
        'Submits academic and support requests, queries policy-grounded answers, and provides resolution feedback.',
      allowed_actions: ['submit_academic_petition'],
      can_be_assigned_tickets: false,
      can_publish_policies: false,
      can_approve_escalations: false,
      effective_from: '2025-08-01',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      role_id: 'ROLE-INSTRUCTOR',
      role_code: ActorRole.Instructor,
      role_name: 'Instructor',
      institutional_scope: 'Faculty & Course Instructional Staff',
      description:
        'Submits course-related requests, attests to student petitions, and proposes policy revisions.',
      allowed_actions: ['submit_faculty_course_request', 'propose_policy_revision'],
      can_be_assigned_tickets: false,
      can_publish_policies: false,
      can_approve_escalations: false,
      effective_from: '2025-08-01',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      role_id: 'ROLE-SUPPORT_STAFF',
      role_code: ActorRole.SupportStaff,
      role_name: 'Support Staff',
      institutional_scope: 'Operational Intake & Departmental Triage Units',
      description:
        'Triages incoming tickets, verifies applicable policy versions, responds to routine inquiries, and escalates exceptions.',
      allowed_actions: [
        'log_intake_support_ticket',
        'triage_support_queue',
        'propose_policy_revision',
      ],
      can_be_assigned_tickets: true,
      can_publish_policies: false,
      can_approve_escalations: false,
      effective_from: '2025-08-01',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      role_id: 'ROLE-ACADEMIC_ADMIN',
      role_code: ActorRole.AcademicAdministrator,
      role_name: 'Academic Administrator',
      institutional_scope: 'Academic Governance & Escalation Review Boards',
      description:
        'Adjudicates escalated requests, approves policy exceptions, and publishes authoritative policy documents.',
      allowed_actions: [
        'initiate_administrative_review',
        'approve_policy_escalation',
        'publish_knowledge_article',
        'configure_department_routing',
      ],
      can_be_assigned_tickets: true,
      can_publish_policies: true,
      can_approve_escalations: true,
      effective_from: '2025-08-01',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      role_id: 'ROLE-PLATFORM_ADMIN',
      role_code: ActorRole.PlatformAdministrator,
      role_name: 'Platform Administrator',
      institutional_scope: 'Enterprise Workflow, Routing & SLA Governance',
      description:
        'Configures routing rules, SLA schedules, and platform security governance.',
      allowed_actions: [
        'initiate_administrative_review',
        'publish_knowledge_article',
        'configure_department_routing',
        'configure_platform_governance',
      ],
      can_be_assigned_tickets: true,
      can_publish_policies: true,
      can_approve_escalations: true,
      effective_from: '2025-08-01',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    },
  ];

  const terms: TermRecord[] = [
    {
      term_id: 'TERM-2025-FALL',
      term_code: 'FA2025',
      term_name: 'Fall Semester 2025',
      academic_year: 2025,
      start_date: '2025-08-25',
      add_drop_deadline: '2025-09-08',
      withdrawal_deadline: '2025-10-20',
      end_date: '2025-12-15',
      aid_disbursement_date: '2025-08-15',
      lifecycle_state: 'archived',
      created_at: '2025-05-01T08:00:00.000Z',
    },
    {
      term_id: 'TERM-2026-SPRING',
      term_code: 'SP2026',
      term_name: 'Spring Semester 2026',
      academic_year: 2026,
      start_date: '2026-01-19',
      add_drop_deadline: '2026-02-02',
      withdrawal_deadline: '2026-03-16',
      end_date: '2026-05-15',
      aid_disbursement_date: '2026-01-09',
      lifecycle_state: 'archived',
      created_at: '2025-10-01T08:00:00.000Z',
    },
    {
      term_id: 'TERM-2026-SUMMER',
      term_code: 'SU2026',
      term_name: 'Summer Session 2026',
      academic_year: 2026,
      start_date: '2026-06-01',
      add_drop_deadline: '2026-06-08',
      withdrawal_deadline: '2026-07-06',
      end_date: '2026-08-07',
      aid_disbursement_date: '2026-05-22',
      lifecycle_state: 'archived',
      created_at: '2026-02-01T08:00:00.000Z',
    },
    {
      term_id: 'TERM-2026-FALL',
      term_code: 'FA2026',
      term_name: 'Fall Semester 2026',
      academic_year: 2026,
      start_date: '2026-08-24',
      add_drop_deadline: '2026-09-07',
      withdrawal_deadline: '2026-10-19',
      end_date: '2026-12-18',
      aid_disbursement_date: '2026-08-14',
      lifecycle_state: 'active',
      created_at: '2026-04-01T08:00:00.000Z',
    },
  ];

  // --------------------------------------------------------------------------
  // 1. GENERATE REQUESTERS (REQ-2026-000001 ..)
  // --------------------------------------------------------------------------
  const requesters: RequesterRecord[] = [];
  for (let i = 1; i <= requesterCount; i++) {
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const dept = rng.pick(DEPARTMENTS);
    const isInstructor = i % 7 === 0;
    const roleId = isInstructor ? 'ROLE-INSTRUCTOR' : 'ROLE-LEARNER';
    const requesterId = formatRequesterId(i);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i}@synthetic.campusresolve.invalid`;

    requesters.push({
      requester_id: requesterId,
      app_profile_id: null,
      role_id: roleId,
      primary_term_id: 'TERM-2026-FALL',
      verified_email: email,
      display_name: `${firstName} ${lastName}`,
      department: dept,
      program_or_unit: isInstructor
        ? `${dept} Faculty`
        : `Class of ${2026 + (i % 4)}`,
      account_status: 'active',
      is_synthetic_eval: true,
      effective_from: '2025-08-15T08:00:00.000Z',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
      updated_at: BASE_ANCHOR_DATE_ISO,
    });
  }

  // --------------------------------------------------------------------------
  // 6. CATEGORIES (Defined before PolicyDocument & KnowledgeArticle for FK binding)
  // --------------------------------------------------------------------------
  const categories: CategoryRecord[] = OFFICIAL_CATEGORIES.map((catName) => {
    const rule = DOCUMENTED_ROUTING_RULES[catName];
    return {
      category_id: rule.category_id,
      category_name: catName,
      domain_code: rule.domain_code,
      default_assigned_team: rule.primary_assigned_team,
      escalation_team: rule.escalation_assigned_team,
      routing_rule_id: rule.rule_id,
      description: rule.rule_description,
      keywords:
        catName === 'Financial Aid'
          ? ['fafsa', 'sap', 'appeal', 'disbursement', 'scholarship', 'grant']
          : catName === 'Registration'
          ? ['add/drop', 'withdrawal', 'overload', 'prerequisite', 'enrollment']
          : catName === 'IT'
          ? ['mfa', 'sso', 'lms', 'password', 'authenticator', 'license']
          : ['accommodation', 'testing', 'captioning', 'assistive', 'section 504'],
      is_active: true,
      effective_from: '2025-08-01',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    };
  });

  // --------------------------------------------------------------------------
  // 4. GENERATE POLICY DOCUMENTS (POL-<domain>-2026-001 ..)
  // --------------------------------------------------------------------------
  const policyDocuments: PolicyDocumentRecord[] = POLICY_SPECS.map((spec) => {
    const policyId = formatPolicyId(spec.domain, spec.seq);
    const supersedesId = spec.supersedesSeq
      ? formatPolicyId(spec.domain, spec.supersedesSeq)
      : null;
    const supersededById = spec.supersededBySeq
      ? formatPolicyId(spec.domain, spec.supersededBySeq)
      : null;

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
      source_name: 'CampusResolve AI Synthetic Policy Corpus (YottaFlex Challenge)',
      source_url: `urn:campusresolve:synthetic-policy:${policyId.toLowerCase()}`,
      dataset_or_doc_version: `2026.10-seed-${seed}-v${spec.version}`,
      retrieval_date: '2026-09-01',
      license_terms: 'CC0-1.0 Synthetic Demonstration & Evaluation Corpus (Non-Regulatory)',
      attribution:
        'Synthetic university policy created strictly for CampusResolve AI evaluation; not real institutional regulation.',
      transformations_performed:
        'Normalized section headers, tagged effective/expiration dates, and linked superseding policy IDs.',
      discarded_fields: 'legacy_pdf_page_checksum',
      is_synthetic_policy: true,
      published_by_profile_id: null,
      created_at: `${spec.effectiveDate}T08:00:00.000Z`,
      updated_at: BASE_ANCHOR_DATE_ISO,
    };
  });

  // --------------------------------------------------------------------------
  // 5. GENERATE 200 KNOWLEDGE ARTICLES (KB-000001 .. KB-000200) + BRIDGE LINKS
  // --------------------------------------------------------------------------
  const knowledgeArticles: KnowledgeArticleRecord[] = [];
  const policyArticleLinks: PolicyArticleLinkRecord[] = [];

  const topicVariantsByDomain: Record<PolicyDomainCode, readonly string[]> = {
    FINAID: [
      'SAP Pace of Completion Calculation & Appeal Packet Checklist',
      'Federal & Institutional Grant Disbursement Hold Resolution',
      'Census Date Credit Hour Proration for Half-Time Learners',
      'Emergency Hardship Financial Aid Re-Evaluation Procedure',
      'Scholarship Renewal GPA Verification & Grace Term Rules',
    ],
    REG: [
      'First-10-Business-Day Add/Drop Procedure & Roster Lock',
      'Week 8 Course Withdrawal (W Grade) Online Submission Guide',
      'Post-Deadline Retroactive Withdrawal Petition Documentation',
      'Undergraduate 19–22 Credit Hour Overload Approval Workflow',
      'Cross-Departmental Prerequisite Waiver & Instructor Attestation',
    ],
    IT: [
      'Transitioning from Legacy SMS to FIDO2 / TOTP Authenticator MFA',
      'Identity Verification for Locked Institutional SSO Accounts',
      'LMS Course Shell Provisioning & 4-Hour Roster Sync Troubleshooting',
      'Instructional Lab Software Floating License Seat Allocation',
      'Reporting Suspected Phishing or Unauthorized Token Escalation',
    ],
    ACCESS: [
      '5-Business-Day Proctored Testing Accommodation Booking Guide',
      'Requesting Real-Time CART Captioning & Accessible Course Packets',
      'Instructor Notification Letters for Approved Exam Extended Time',
      'Escalating Accommodation Implementation Barriers to Section 504 Panel',
      'Assistive Screen-Reader PDF Remediation Turnaround Standards',
    ],
  };

  for (let i = 1; i <= knowledgeArticleCount; i++) {
    const articleId = formatKnowledgeArticleId(i);
    const parentPolicy = policyDocuments[(i - 1) % policyDocuments.length];
    const domainTopics = topicVariantsByDomain[parentPolicy.domain];
    const topicLabel = domainTopics[(i - 1) % domainTopics.length];
    const isExpiredArticle = parentPolicy.lifecycle_state === 'expired';
    const version = isExpiredArticle ? '1.0' : i % 5 === 0 ? '2.1' : '2.0';

    const article: KnowledgeArticleRecord = {
      article_id: articleId,
      category_id: parentPolicy.category_id,
      primary_policy_id: parentPolicy.policy_id,
      primary_policy_version: parentPolicy.version,
      title: `${topicLabel} (Ref ${parentPolicy.policy_id} v${parentPolicy.version} · #${i})`,
      version,
      effective_date: parentPolicy.effective_date,
      expiration_date: parentPolicy.expiration_date,
      lifecycle_state: isExpiredArticle ? 'expired' : 'published',
      summary: `${
        isExpiredArticle
          ? '[EXPIRED KNOWLEDGE ARTICLE] '
          : '[PUBLISHED KNOWLEDGE ARTICLE] '
      }Operational guidance for ${topicLabel.toLowerCase()} governed by ${parentPolicy.policy_id} (v${parentPolicy.version}).`,
      content: `${parentPolicy.content} Operational Article ${articleId} (v${version}) specifies step-by-step intake verification for ${topicLabel}. Governing Policy: ${parentPolicy.policy_id} v${parentPolicy.version} (${parentPolicy.authoritative_section_ref}).`,
      tags: [
        parentPolicy.domain.toLowerCase(),
        parentPolicy.policy_id.toLowerCase(),
        isExpiredArticle ? 'expired-reference' : 'active-guidance',
      ],
      source_url: `urn:campusresolve:synthetic-kb:${articleId.toLowerCase()}`,
      dataset_or_doc_version: `2026.10-seed-${seed}-kb-v${version}`,
      retrieval_date: '2026-09-01',
      license_terms: 'CC0-1.0 Synthetic Demonstration & Evaluation Corpus',
      attribution:
        'Synthetic knowledge base article generated deterministically for CampusResolve AI evaluation.',
      transformations_performed:
        'Indexed policy section citations, normalized domain tags, and bound effective/expiration dates.',
      discarded_fields: null,
      is_synthetic_article: true,
      created_at: `${parentPolicy.effective_date}T09:00:00.000Z`,
      updated_at: BASE_ANCHOR_DATE_ISO,
    };

    knowledgeArticles.push(article);

    policyArticleLinks.push({
      link_id: `LNK-POL-KB-${String(i).padStart(6, '0')}`,
      policy_id: parentPolicy.policy_id,
      policy_version: parentPolicy.version,
      article_id: article.article_id,
      article_version: article.version,
      relationship_type: isExpiredArticle
        ? 'superseded_reference'
        : 'primary_governance',
      created_at: BASE_ANCHOR_DATE_ISO,
    });
  }

  // Helper lookup maps for active vs expired policies & articles per category
  const activePoliciesByCat = new Map<CategoryRecord['category_id'], PolicyDocumentRecord[]>();
  const expiredPoliciesByCat = new Map<CategoryRecord['category_id'], PolicyDocumentRecord[]>();
  for (const pol of policyDocuments) {
    const targetMap =
      pol.lifecycle_state === 'active'
        ? activePoliciesByCat
        : expiredPoliciesByCat;
    const list = targetMap.get(pol.category_id) || [];
    list.push(pol);
    targetMap.set(pol.category_id, list);
  }

  const activeArticlesByPolicy = new Map<string, KnowledgeArticleRecord[]>();
  const expiredArticlesByPolicy = new Map<string, KnowledgeArticleRecord[]>();
  for (const art of knowledgeArticles) {
    const targetMap =
      art.lifecycle_state === 'published'
        ? activeArticlesByPolicy
        : expiredArticlesByPolicy;
    const list = targetMap.get(art.primary_policy_id) || [];
    list.push(art);
    targetMap.set(art.primary_policy_id, list);
  }

  // --------------------------------------------------------------------------
  // 7, 8, 9, 10, 11. GENERATE TICKETS, MESSAGES, ASSIGNMENTS, SLAS, FEEDBACKS
  // & SEPARATE GROUND-TRUTH EVALUATION RECORDS
  // --------------------------------------------------------------------------
  const tickets: TicketRecord[] = [];
  const messages: MessageRecord[] = [];
  const assignments: AssignmentRecord[] = [];
  const slas: SLARecord[] = [];
  const resolutionFeedbacks: ResolutionFeedbackRecord[] = [];
  const ticketPolicyLinks: TicketPolicyLinkRecord[] = [];
  const ticketArticleLinks: TicketArticleLinkRecord[] = [];
  const ticketLifecycleEvents: TicketLifecycleEventRecord[] = [];
  const groundTruthAnomalies: GroundTruthAnomalyRecord[] = [];
  const groundTruthTicketEvaluations: GroundTruthTicketEvaluationRecord[] = [];

  let anomalyCounter = 0;

  for (let tIdx = 1; tIdx <= ticketCount; tIdx++) {
    const ticketId = formatTicketId(tIdx);
    const requester = requesters[(tIdx - 1) % requesters.length];
    const categoryName = OFFICIAL_CATEGORIES[(tIdx - 1) % OFFICIAL_CATEGORIES.length];
    const routingRule = DOCUMENTED_ROUTING_RULES[categoryName];
    const categoryId = routingRule.category_id;

    const activePolicies = activePoliciesByCat.get(categoryId)!;
    const expiredPolicies = expiredPoliciesByCat.get(categoryId)!;
    const expectedPolicy = activePolicies[(tIdx - 1) % activePolicies.length];
    const expectedArticles = activeArticlesByPolicy.get(expectedPolicy.policy_id)!;
    const expectedArticle = expectedArticles[(tIdx - 1) % expectedArticles.length];

    // Deterministically schedule ticket submission on a Friday afternoon (15:00 UTC)
    // or standard weekday morning so business-hour vs wall-clock SLA behavior is testable.
    // 2026-09-04 is a Friday!
    const dayOffset = (tIdx - 1) % 28;
    const baseSubMs = Date.UTC(2026, 8, 1 + dayOffset, 14, (tIdx * 7) % 55, 0);

    // Deterministically assign anomaly scenarios to specific ticket slots so all 5
    // challenge-defined anomalies are represented and reproducible in both starter and full modes:
    // Slot mod 25 === 3  -> Scenario 1: expired_policy_citation
    // Slot mod 25 === 7  -> Scenario 2: unauthorized_team_routing
    // Slot mod 25 === 11 -> Scenario 3: unsupported_factual_claim
    // Slot mod 25 === 15 -> Scenario 4: sla_clock_ignores_business_hours (submitted Friday 15:30 UTC, resolved Monday 10:00 UTC)
    // Slot mod 25 === 19 -> Scenario 5: required_escalation_not_triggered
    const mod25 = tIdx % 25;
    const isAnomalyExpiredCitation = mod25 === 3;
    const isAnomalyUnauthorizedRouting = mod25 === 7;
    const isAnomalyUnsupportedClaim = mod25 === 11;
    const isAnomalySlaBusinessHours = mod25 === 15;
    const isAnomalyMissedEscalation = mod25 === 19;

    // Normal escalation cases (mod 10 === 0)
    const isNormalEscalationCase = !isAnomalyMissedEscalation && tIdx % 10 === 0;
    const expectedEscalationRequired =
      isNormalEscalationCase || isAnomalyMissedEscalation;

    const priority: TicketPriorityLevel = expectedEscalationRequired
      ? 'Administrative Escalation Priority'
      : tIdx % 4 === 0
      ? 'Time-Sensitive Academic Priority'
      : 'Standard Priority';

    // Submission timestamp: for Scenario 4 (isAnomalySlaBusinessHours), anchor specifically to
    // Friday 2026-09-04T15:30:00.000Z and evaluate Monday 2026-09-07T09:30:00.000Z:
    // Elapsed business minutes = 90m (Fri 15:30-17:00) + 90m (Mon 08:00-09:30) = 180m (well under 240m/540m/1080m targets!),
    // whereas raw 24x7 wall-clock minutes = 3,960m (66 hours -> false breach!).
    const submittedAtIso = isAnomalySlaBusinessHours
      ? '2026-09-04T15:30:00.000Z'
      : new Date(baseSubMs).toISOString();

    const evaluatedAtIso = isAnomalySlaBusinessHours
      ? '2026-09-07T09:30:00.000Z'
      : new Date(Date.parse(submittedAtIso) + 180 * 60000).toISOString();

    // Policy & Article actually cited on the ticket:
    const citedPolicy = isAnomalyExpiredCitation
      ? expiredPolicies[0]
      : expectedPolicy;
    const citedArticleList = isAnomalyExpiredCitation
      ? expiredArticlesByPolicy.get(citedPolicy.policy_id)!
      : expectedArticles;
    const citedArticle = citedArticleList[0];

    // Subject & description
    const subject = expectedEscalationRequired
      ? `${categoryName} Formal Appeal & Exception Petition (${expectedPolicy.policy_id})`
      : `${categoryName} Operational Inquiry: ${expectedPolicy.title}`;

    const description = expectedEscalationRequired
      ? `Requester ${requester.display_name} (${requester.requester_id}) submits a formal exception and retroactive appeal regarding ${expectedPolicy.title}. Request requires administrative adjudication under ${expectedPolicy.policy_id}.`
      : `Requester ${requester.display_name} (${requester.requester_id}) requests policy-grounded verification regarding ${expectedPolicy.title} (${expectedPolicy.authoritative_section_ref}) for term ${requester.primary_term_id}.`;

    // Routing decision
    const idealRouting = evaluateTicketRouting({
      ticketId,
      category: categoryName,
      priority,
      subject,
      description,
      assignedAtIso: submittedAtIso,
    });

    // Observed routing (inject Scenario 2: unauthorized_team_routing when isAnomalyUnauthorizedRouting is true)
    const wrongCategory: OfficialCategoryName =
      categoryName === 'Financial Aid' ? 'IT' : 'Financial Aid';
    const observedAssignedTeam = isAnomalyUnauthorizedRouting
      ? DOCUMENTED_ROUTING_RULES[wrongCategory].primary_assigned_team
      : isAnomalyMissedEscalation
      ? routingRule.primary_assigned_team // Failed to route to escalation team!
      : idealRouting.assignment.assigned_team;

    const observedRoutingRuleId = isAnomalyUnauthorizedRouting
      ? DOCUMENTED_ROUTING_RULES[wrongCategory].rule_id
      : idealRouting.assignment.routing_rule_id;

    // Lifecycle status
    const expectedLifecycleStatus: RequestStatus = expectedEscalationRequired
      ? RequestStatus.Escalated
      : tIdx % 5 === 0
      ? RequestStatus.UnderReview
      : RequestStatus.Resolved;

    const observedLifecycleStatus: RequestStatus = isAnomalyMissedEscalation
      ? RequestStatus.Resolved // Anomaly 5: resolved directly without required escalation!
      : expectedLifecycleStatus;

    const isResolved = observedLifecycleStatus === RequestStatus.Resolved;

    const ticket: TicketRecord = {
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
      current_assigned_team: observedAssignedTeam,
      current_routing_rule_id: observedRoutingRuleId,
      referenced_policy_id: citedPolicy.policy_id,
      referenced_policy_version: citedPolicy.version,
      referenced_article_id: citedArticle.article_id,
      referenced_article_version: citedArticle.version,
      requires_escalation: expectedEscalationRequired,
      is_escalated: observedLifecycleStatus === RequestStatus.Escalated,
      escalation_reason: expectedEscalationRequired
        ? idealRouting.escalationReason
        : null,
      resolution_summary: isResolved
        ? isAnomalyUnsupportedClaim
          ? `UNSUPPORTED CLAIM: Approved automatic 100% full tuition refund and 45-day retroactive deadline extension without documentation.`
          : `Resolved in accordance with ${citedPolicy.policy_id} v${citedPolicy.version} (${citedPolicy.authoritative_section_ref}) and ${citedArticle.article_id} v${citedArticle.version}.`
        : null,
      is_synthetic_eval: true,
      submitted_at: submittedAtIso,
      updated_at: evaluatedAtIso,
      resolved_at: isResolved ? evaluatedAtIso : null,
      closed_at: null,
    };

    tickets.push(ticket);

    // Bridge links: Ticket <-> Policy & Ticket <-> Article
    ticketPolicyLinks.push({
      link_id: `TPL-${ticketId}-01`,
      ticket_id: ticketId,
      policy_id: citedPolicy.policy_id,
      policy_version: citedPolicy.version,
      applicability_status:
        citedPolicy.lifecycle_state === 'expired'
          ? 'expired_at_citation'
          : 'applicable_current',
      linked_by_actor: `ACTOR-OPS-${routingRule.domain_code}`,
      linked_at: evaluatedAtIso,
    });

    ticketArticleLinks.push({
      link_id: `TAL-${ticketId}-01`,
      ticket_id: ticketId,
      article_id: citedArticle.article_id,
      article_version: citedArticle.version,
      applicability_status:
        citedArticle.lifecycle_state === 'expired'
          ? 'expired_at_citation'
          : 'applicable_current',
      linked_by_actor: `ACTOR-OPS-${routingRule.domain_code}`,
      linked_at: evaluatedAtIso,
    });

    // Lifecycle Events (immutable state transitions)
    let eventSeq = 1;
    ticketLifecycleEvents.push(
      createLifecycleEvent({
        ticketId,
        eventSequence: eventSeq++,
        previousState: null,
        newState: RequestStatus.Submitted,
        actorId: requester.requester_id,
        actorRole:
          requester.role_id === 'ROLE-INSTRUCTOR'
            ? ActorRole.Instructor
            : ActorRole.Learner,
        reason: 'Initial request submission and intake validation.',
        timestampIso: submittedAtIso,
      })
    );

    const midTimeIso = new Date(
      Date.parse(submittedAtIso) + 30 * 60000
    ).toISOString();

    if (observedLifecycleStatus === RequestStatus.Escalated) {
      ticketLifecycleEvents.push(
        createLifecycleEvent({
          ticketId,
          eventSequence: eventSeq++,
          previousState: RequestStatus.Submitted,
          newState: RequestStatus.Escalated,
          actorId: `ACTOR-OPS-${routingRule.domain_code}`,
          actorRole: ActorRole.SupportStaff,
          reason:
            idealRouting.escalationReason ||
            'Escalated for administrative policy adjudication.',
          timestampIso: evaluatedAtIso,
          referencedPolicyId: citedPolicy.policy_id,
          referencedPolicyVersion: citedPolicy.version,
          referencedArticleId: citedArticle.article_id,
          referencedArticleVersion: citedArticle.version,
        })
      );
    } else {
      ticketLifecycleEvents.push(
        createLifecycleEvent({
          ticketId,
          eventSequence: eventSeq++,
          previousState: RequestStatus.Submitted,
          newState: RequestStatus.UnderReview,
          actorId: `ACTOR-OPS-${routingRule.domain_code}`,
          actorRole: ActorRole.SupportStaff,
          reason: `Assigned to ${observedAssignedTeam} via ${observedRoutingRuleId}.`,
          timestampIso: midTimeIso,
          referencedPolicyId: citedPolicy.policy_id,
          referencedPolicyVersion: citedPolicy.version,
          referencedArticleId: citedArticle.article_id,
          referencedArticleVersion: citedArticle.version,
        })
      );

      if (observedLifecycleStatus === RequestStatus.Resolved) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: RequestStatus.UnderReview,
            newState: RequestStatus.Resolved,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: ActorRole.SupportStaff,
            reason: `Resolution recorded citing ${citedPolicy.policy_id} v${citedPolicy.version}.`,
            timestampIso: evaluatedAtIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version,
          })
        );
      }
    }

    // 8. MESSAGES (Exact ID format: MSG-<ticket-id>-001 .. 004)
    const msgTemplates: {
      seq: number;
      senderId: string;
      senderRole: ActorRole;
      senderName: string;
      type: MessageRecord['message_type'];
      body: string;
      citePolicy: boolean;
    }[] = [
      {
        seq: 1,
        senderId: requester.requester_id,
        senderRole:
          requester.role_id === 'ROLE-INSTRUCTOR'
            ? ActorRole.Instructor
            : ActorRole.Learner,
        senderName: requester.display_name,
        type: 'requester_inquiry',
        body: description,
        citePolicy: false,
      },
      {
        seq: 2,
        senderId: 'SYSTEM-ROUTER',
        senderRole: ActorRole.SupportStaff,
        senderName: 'CampusResolve Routing Engine',
        type: 'system_routing_note',
        body: `Ticket ${ticketId} classified under '${categoryName}' and assigned to '${observedAssignedTeam}' using routing rule ${observedRoutingRuleId}.`,
        citePolicy: false,
      },
      {
        seq: 3,
        senderId: `ACTOR-OPS-${routingRule.domain_code}`,
        senderRole: ActorRole.SupportStaff,
        senderName: `${observedAssignedTeam} Specialist`,
        type: 'ai_grounded_reply',
        body: isAnomalyUnsupportedClaim
          ? `Policy Guidance (${citedPolicy.policy_id} v${citedPolicy.version}): Every student is guaranteed an automatic $5,000 cash grant and a 45-day deadline waiver without submitting documentation.`
          : `Policy Guidance (${citedPolicy.policy_id} v${citedPolicy.version}, ${citedArticle.article_id} v${citedArticle.version}): ${citedPolicy.summary}`,
        citePolicy: true,
      },
      {
        seq: 4,
        senderId: `ACTOR-OPS-${routingRule.domain_code}`,
        senderRole:
          observedLifecycleStatus === RequestStatus.Escalated
            ? ActorRole.AcademicAdministrator
            : ActorRole.SupportStaff,
        senderName: `${observedAssignedTeam} Reviewer`,
        type:
          observedLifecycleStatus === RequestStatus.Escalated
            ? 'escalation_handoff'
            : 'resolution_summary',
        body:
          observedLifecycleStatus === RequestStatus.Escalated
            ? `Case escalated to ${observedAssignedTeam} for administrative determination. Reason: ${idealRouting.escalationReason}`
            : `Lifecycle status updated to '${observedLifecycleStatus}' referencing ${citedPolicy.policy_id} v${citedPolicy.version}.`,
        citePolicy: true,
      },
    ];

    for (let m = 0; m < messagesPerTicket; m++) {
      const tpl = msgTemplates[m % msgTemplates.length];
      const msgSeq = m + 1;
      const msgTimeIso = new Date(
        Date.parse(submittedAtIso) + msgSeq * 25 * 60000
      ).toISOString();

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
        created_at: msgTimeIso,
      });
    }

    // 9. ASSIGNMENT RECORD
    assignments.push({
      assignment_id: formatAssignmentId(ticketId, 1),
      ticket_id: ticketId,
      sequence_number: 1,
      assigned_team: observedAssignedTeam,
      assigned_actor_id: `ACTOR-OPS-${routingRule.domain_code}`,
      assigned_actor_role: idealRouting.assignment.assigned_actor_role,
      routing_rule_id: observedRoutingRuleId,
      assignment_reason: idealRouting.assignment.assignment_reason,
      previous_assignment_id: null,
      previous_assigned_team: null,
      requires_human_review: expectedEscalationRequired,
      is_active: true,
      assigned_at: submittedAtIso,
      unassigned_at: null,
    });

    // 10. SLA RECORD (Exact ID: SLA-<ticket-id>)
    const slaRecord = buildReproducibleSlaRecord({
      ticketId,
      category: categoryName,
      startTimestampIso: submittedAtIso,
      evaluatedTimestampIso: evaluatedAtIso,
      isTicketEscalated: observedLifecycleStatus === RequestStatus.Escalated,
      requiresEscalation: expectedEscalationRequired,
      calculationMode: isAnomalySlaBusinessHours
        ? 'wall_clock_24x7'
        : 'business_hours_configured',
      ruleClassification: isAnomalySlaBusinessHours
        ? 'SYNTHETIC_EVAL_SCENARIO'
        : 'PROPOSED_CONFIGURABLE_RULE',
    });
    slas.push(slaRecord);

    // 11. RESOLUTION FEEDBACK RECORD (for resolved tickets)
    if (isResolved) {
      const hasAnyAnomaly =
        isAnomalyExpiredCitation ||
        isAnomalyUnauthorizedRouting ||
        isAnomalyUnsupportedClaim ||
        isAnomalySlaBusinessHours ||
        isAnomalyMissedEscalation;

      resolutionFeedbacks.push({
        feedback_id: formatFeedbackId(ticketId),
        ticket_id: ticketId,
        requester_id: requester.requester_id,
        rating: hasAnyAnomaly ? 2 : 5,
        was_helpful: !hasAnyAnomaly,
        resolution_accepted: !hasAnyAnomaly,
        policy_clarity_score: hasAnyAnomaly ? 2 : 5,
        comments: hasAnyAnomaly
          ? 'Requester noted discrepancy in cited policy version, routing unit, or escalation handling.'
          : 'Clear policy-grounded explanation with exact section and version citation.',
        submitted_at: new Date(
          Date.parse(evaluatedAtIso) + 15 * 60000
        ).toISOString(),
      });
    }

    // ------------------------------------------------------------------------
    // SEPARATE GROUND-TRUTH EVALUATION & ANOMALY RECORDS (Sections 13 & 14)
    // ------------------------------------------------------------------------
    const ticketAnomalyTypes: AnomalyScenarioType[] = [];
    const ticketAnomalyIds: string[] = [];

    if (isAnomalyExpiredCitation) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push('expired_policy_citation');
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: ticketId,
        ticket_id: ticketId,
        anomaly_type: 'expired_policy_citation',
        expected_decision: `Cite active policy ${expectedPolicy.policy_id} (v${expectedPolicy.version}, effective ${expectedPolicy.effective_date}) and active article ${expectedArticle.article_id} (v${expectedArticle.version}).`,
        actual_observed_decision: `Cited expired policy ${citedPolicy.policy_id} (v${citedPolicy.version}, expired ${citedPolicy.expiration_date}) on ticket submitted ${submittedAtIso.slice(0, 10)}.`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: 'POLICY_EFFECTIVE_DATE_APPLICABILITY_RULE',
        explanation: `Ticket ${ticketId} was submitted on ${submittedAtIso.slice(0, 10)}, after ${citedPolicy.policy_id} v${citedPolicy.version} expired on ${citedPolicy.expiration_date}. Superseding policy ${expectedPolicy.policy_id} v${expectedPolicy.version} was in effect.`,
      });
    }

    if (isAnomalyUnauthorizedRouting) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push('unauthorized_team_routing');
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: formatAssignmentId(ticketId, 1),
        ticket_id: ticketId,
        anomaly_type: 'unauthorized_team_routing',
        expected_decision: `Route '${categoryName}' ticket to '${idealRouting.assignment.assigned_team}' under rule '${routingRule.rule_id}'.`,
        actual_observed_decision: `Routed '${categoryName}' ticket to unauthorized team '${observedAssignedTeam}' under rule '${observedRoutingRuleId}'.`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: routingRule.rule_id,
        explanation: `Assignment ${formatAssignmentId(ticketId, 1)} violated ${routingRule.rule_id} by routing a '${categoryName}' request to '${observedAssignedTeam}'.`,
      });
    }

    if (isAnomalyUnsupportedClaim) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push('unsupported_factual_claim');
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: formatMessageId(ticketId, 3),
        ticket_id: ticketId,
        anomaly_type: 'unsupported_factual_claim',
        expected_decision: `Restrict response strictly to facts stated in ${expectedPolicy.policy_id} v${expectedPolicy.version} (${expectedPolicy.authoritative_section_ref}).`,
        actual_observed_decision: `Response ${formatMessageId(ticketId, 3)} asserted an unverified '$5,000 cash grant and 45-day deadline waiver' absent from ${citedPolicy.policy_id}.`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: 'RAG_EVIDENCE_GROUNDING_RULE',
        explanation: `Message ${formatMessageId(ticketId, 3)} on ticket ${ticketId} fabricated numeric financial and deadline entitlements not present in ${citedPolicy.policy_id}.`,
      });
    }

    if (isAnomalySlaBusinessHours) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push('sla_clock_ignores_business_hours');
      ticketAnomalyIds.push(anmId);
      const trueBusinessMinutes = calculateElapsedBusinessMinutes(
        submittedAtIso,
        evaluatedAtIso,
        DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE
      );
      const targetMinutes = CONFIGURABLE_SLA_RULES[categoryName].target_business_minutes;
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: slaRecord.sla_id,
        ticket_id: ticketId,
        anomaly_type: 'sla_clock_ignores_business_hours',
        expected_decision: `Compute elapsed_business_minutes=${trueBusinessMinutes}m under ${DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE.schedule_code} vs target=${targetMinutes}m -> breach_status=false.`,
        actual_observed_decision: `Computed breach_status=${slaRecord.breach_status} using raw 24x7 wall-clock elapsed=${slaRecord.elapsed_wall_clock_minutes}m across weekend non-working hours.`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: CONFIGURABLE_SLA_RULES[categoryName].sla_rule_id,
        explanation: `${slaRecord.sla_id} counted weekend hours between Friday 15:30 UTC and Monday 09:30 UTC (${slaRecord.elapsed_wall_clock_minutes} wall-clock minutes) instead of ${trueBusinessMinutes} business minutes.`,
      });
    }

    if (isAnomalyMissedEscalation) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push('required_escalation_not_triggered');
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: ticketId,
        ticket_id: ticketId,
        anomaly_type: 'required_escalation_not_triggered',
        expected_decision: `Transition ticket ${ticketId} to 'escalated' and assign to '${routingRule.escalation_assigned_team}'.`,
        actual_observed_decision: `Ticket ${ticketId} remained assigned to '${observedAssignedTeam}' and transitioned directly to '${observedLifecycleStatus}' without escalation.`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: 'MANDATORY_ESCALATION_POLICY_RULE',
        explanation: `Ticket ${ticketId} contained mandatory escalation criteria (${idealRouting.escalationReason}) but was resolved without administrative escalation.`,
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
      expected_sla_breach_under_business_hours:
        expectedBusinessMin >
        CONFIGURABLE_SLA_RULES[categoryName].target_business_minutes,
      expected_lifecycle_outcome: expectedLifecycleStatus,
      has_anomaly: ticketAnomalyTypes.length > 0,
      anomaly_types: ticketAnomalyTypes,
      anomaly_ids: ticketAnomalyIds,
    });
  }

  return {
    metadata: {
      seed,
      mode,
      generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
      generationOrder: [
        '1. Requester',
        '2. Role',
        '3. Term',
        '4. PolicyDocument',
        '5. KnowledgeArticle',
        '6. Category',
        '7. Ticket',
        '8. Message',
        '9. Assignment',
        '10. SLA',
        '11. ResolutionFeedback',
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
        groundTruthTicketEvaluations: groundTruthTicketEvaluations.length,
      },
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
    groundTruthTicketEvaluations,
  };
}
