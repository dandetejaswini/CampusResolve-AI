import { ActorRole, RequestStatus } from '../types/domain.js';
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
} from '../types/phase3.js';
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
} from './workflowEngine.js';

export const DETERMINISTIC_SEED = 20261022;

/**
 * Standard anchor timestamp represented in ISO 8601 with explicit institutional IST (+05:30) offset.
 * Corresponds to 2026-09-01 13:30:00 IST (08:00:00 UTC).
 */
export const BASE_ANCHOR_DATE_ISO = '2026-09-01T13:30:00+05:30';

/**
 * Converts any Date, timestamp number, or ISO string into a canonical ISO 8601 string
 * with explicit institutional IST (+05:30) offset.
 * Example: 2026-09-01T19:37:00+05:30
 */
export function formatIsoWithIstOffset(dateInput: Date | number | string): string {
  const d =
    typeof dateInput === 'string' || typeof dateInput === 'number'
      ? new Date(dateInput)
      : dateInput;
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(istMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = istDate.getUTCFullYear();
  const month = pad(istDate.getUTCMonth() + 1);
  const day = pad(istDate.getUTCDate());
  const hours = pad(istDate.getUTCHours());
  const minutes = pad(istDate.getUTCMinutes());
  const seconds = pad(istDate.getUTCSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}

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

export interface DataQualityReport {
  uniqueSubjectCount: number;
  uniqueDescriptionCount: number;
  duplicateSubjectRate: number;
  duplicateDescriptionRate: number;
  textLengthStats: {
    subject: { min: number; max: number; mean: number; median: number };
    description: { min: number; max: number; mean: number; median: number };
  };
  categoryDistribution: Record<OfficialCategoryName, { count: number; percentage: number }>;
  lifecycleDistribution: Record<RequestStatus, { count: number; percentage: number }>;
  priorityDistribution: Record<TicketPriorityLevel, { count: number; percentage: number }>;
  termWeekDistribution: Record<string, { count: number; percentage: number }>;
  informalAndTypoCoverageCount: number;
  hinglishCoverageCount: number;
  multiIssueCoverageCount: number;
  ambiguityCoverageCount: number;
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
    dataQualityReport?: DataQualityReport;
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
  // Separate Ground-Truth Evaluation Records:
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
  'Aarav',
  'Ananya',
  'Rohan',
  'Meera',
  'Vikram',
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
  'Okafor',
  'Chen',
  'Bhatia',
  'Mercer',
  'Silva',
  'Sharma',
  'Reddy',
  'Deshmukh',
  'Verma',
  'Nair',
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

/**
 * 24 Distinct Policy Documents (6 policies per category across all 4 categories).
 * Includes expired, active, superseded, multiple versions, and conflicting cases.
 */
export const POLICY_SPECS: readonly PolicyTemplateSpec[] = [
  // --------------------------------------------------------------------------
  // FINANCIAL AID (FINAID) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
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
  {
    domain: 'FINAID',
    category: 'Financial Aid',
    categoryId: 'CAT-FINAID',
    seq: 4,
    title: 'Emergency Hardship Relief Grants & Statutory Aid Waiver Regulations',
    version: '1.0',
    effectiveDate: '2026-02-01',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 5.1 (Conflicting Provision)',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Emergency micro-grants for sudden hardship and statutory tuition waivers.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Students experiencing acute financial disruption may petition for emergency grant disbursements of up to $2,500. Note: Section 5.1 permits emergency disbursements within 48 business hours of verification, representing a priority exception to standard census proration rules under POL-FINAID-2026-003.',
    keyFactConstraint: 'Emergency hardship cap $2,500; requires verification within 48 hours; escalates on dispute',
  },
  {
    domain: 'FINAID',
    category: 'Financial Aid',
    categoryId: 'CAT-FINAID',
    seq: 5,
    title: 'Institutional Merit Scholarship Retention & Renewal Standards',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 3.4',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Merit scholarship renewal GPA thresholds, continuous enrollment requirements, and probation grace periods.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Institutional merit scholarships require a minimum cumulative GPA of 3.20 evaluated at the end of each spring semester. Learners failing the threshold receive one probationary grace semester before award cancellation.',
    keyFactConstraint: '3.20 renewal GPA; 1-semester grace period prior to termination',
  },
  {
    domain: 'FINAID',
    category: 'Financial Aid',
    categoryId: 'CAT-FINAID',
    seq: 6,
    title: 'International Student Financial Aid & Campus Employment Regulations',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 6.2',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Restrictions and institutional fellowship disbursements for F-1 / J-1 visa holders.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] International students holding F-1/J-1 visas may receive departmental fellowships and emergency campus employment awards up to 20 hours per week during academic terms, subject to International Student Center immigration verification.',
    keyFactConstraint: 'Max 20 hours per week campus employment; immigration check required',
  },

  // --------------------------------------------------------------------------
  // REGISTRATION (REG) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
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
  {
    domain: 'REG',
    category: 'Registration',
    categoryId: 'CAT-REG',
    seq: 4,
    title: 'Grade Forgiveness & Course Repetition Regulations',
    version: '1.0',
    effectiveDate: '2026-01-10',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 4.3',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Maximum course repeat allowances and grade replacement computation rules.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Undergraduate students may repeat up to 3 courses (maximum 12 credit hours) for grade replacement. The second earned grade replaces the initial grade in cumulative GPA computation, though all attempts remain permanently visible on transcript.',
    keyFactConstraint: 'Max 3 courses repeated for grade replacement; all attempts on transcript',
  },
  {
    domain: 'REG',
    category: 'Registration',
    categoryId: 'CAT-REG',
    seq: 5,
    title: 'Independent Study, Cross-Registration & Dean Approval Workflows',
    version: '1.0',
    effectiveDate: '2026-01-10',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 7.1',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Requirements for variable credit independent study and consortium cross-registration.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Enrolling in independent study courses requires a structured syllabus, supervising faculty signature, and department chair approval filed with the Registrar no later than the add/drop census date.',
    keyFactConstraint: 'Faculty syllabus and chair approval required before census date',
  },
  {
    domain: 'REG',
    category: 'Registration',
    categoryId: 'CAT-REG',
    seq: 6,
    title: 'Academic Standing, Probation & Reinstatement Appeals',
    version: '1.0',
    effectiveDate: '2026-01-10',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 8.2',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Good standing thresholds, academic probation triggers, and suspension appeal criteria.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Undergraduates with cumulative GPA below 2.00 are placed on academic probation. Two consecutive probationary terms trigger academic suspension, which may be appealed within 10 business days to the Dean of Academic Affairs.',
    keyFactConstraint: 'Min 2.00 GPA for good standing; suspension appeal window is 10 business days',
  },

  // --------------------------------------------------------------------------
  // IT (IT) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
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
  {
    domain: 'IT',
    category: 'IT',
    categoryId: 'CAT-IT',
    seq: 4,
    title: 'Student Hardware Loaner & Digital Device Support Policy',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 4.1',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Term loaner laptop eligibility, checkout periods, and replacement liabilities.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Full-time enrolled students without computing hardware may request semester laptop loaners through Campus IT Operations. Hardware checkouts are subject to financial hardship verification and must be returned within 48 hours of term conclusion.',
    keyFactConstraint: 'Semester loaner for full-time students; 48-hour post-term return window',
  },
  {
    domain: 'IT',
    category: 'IT',
    categoryId: 'CAT-IT',
    seq: 5,
    title: 'Instructional Software Licensing & High-Performance Compute Cluster Access',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 7.3',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] GPU cluster access, MATLAB/SPSS campus licenses, and storage allocations.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Access to specialized departmental high-performance compute clusters and floating software licenses is provisioned to enrolled STEM and research students based on faculty sponsor endorsement.',
    keyFactConstraint: 'Faculty sponsor required for GPU/HPC cluster access; standard storage quota 100GB',
  },
  {
    domain: 'IT',
    category: 'IT',
    categoryId: 'CAT-IT',
    seq: 6,
    title: 'Acceptable Network Use, Cybersecurity Incident & Vulnerability Reporting',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 9.2',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Campus network monitoring, banned protocol policies, and mandatory incident reporting.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Connecting unauthorized network infrastructure, running port scans, or hosting pirated content on the campus network is strictly prohibited. Confirmed security incidents trigger immediate port isolation and referral to the Information Security Unit.',
    keyFactConstraint: 'Immediate network isolation upon policy violation; no rogue routers allowed',
  },

  // --------------------------------------------------------------------------
  // ACCESSIBILITY (ACCESS) — 6 POLICIES (Seq 1 to 6)
  // --------------------------------------------------------------------------
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
  {
    domain: 'ACCESS',
    category: 'Accessibility',
    categoryId: 'CAT-ACCESS',
    seq: 4,
    title: 'Emotional Support Animal (ESA) & Campus Housing Accommodation Policy',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 4.5',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] ESA verification, veterinary health records, and residence hall accommodation approval.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Approved emotional support animals in university housing require documentation from a licensed mental health clinician and up-to-date rabies vaccination records submitted at least 30 calendar days prior to move-in.',
    keyFactConstraint: 'Licensed clinician documentation and 30-day advance notice for ESA housing',
  },
  {
    domain: 'ACCESS',
    category: 'Accessibility',
    categoryId: 'CAT-ACCESS',
    seq: 5,
    title: 'Peer Note-Taking Services & Lecture Audio Recording Policy',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 6.1',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Provision of anonymous peer note-takers and non-disclosure audio recording agreements.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Students authorized for peer note-taking receive anonymized lecture notes uploaded to the portal within 24 hours of each class session. Audio recording of lectures is permitted exclusively for personal educational use upon signing the institutional disability agreement.',
    keyFactConstraint: '24-hour note upload standard; personal educational use only for recordings',
  },
  {
    domain: 'ACCESS',
    category: 'Accessibility',
    categoryId: 'CAT-ACCESS',
    seq: 6,
    title: 'Campus Physical Access Barrier Remediation & Temporary Mobility Requests',
    version: '1.0',
    effectiveDate: '2026-01-15',
    expirationDate: null,
    lifecycleState: 'active',
    sectionRef: 'Section 9.4',
    summary:
      '[SYNTHETIC DEMONSTRATION POLICY — ACTIVE] Urgent barrier reporting, elevator outages, and temporary paratransit shuttle passes.',
    content:
      '[SYNTHETIC DEMONSTRATION POLICY] Physical access barriers (e.g. elevator breakdown, power door failure) must be triaged as urgent requests by Disability Services within 2 business hours, with temporary accessible classroom relocation arranged if needed.',
    keyFactConstraint: '2-hour response for urgent mobility barriers; classroom relocation protocol',
  },
];

// Rich realistic templates for student/faculty requests
interface RequestStyleVariant {
  style: 'formal' | 'urgent_deadline' | 'typo' | 'hinglish' | 'multi_issue' | 'vague' | 'appeal';
  subject: string;
  description: string;
}

const REQUEST_STYLE_LIBRARY: Record<OfficialCategoryName, RequestStyleVariant[]> = {
  'Financial Aid': [
    {
      style: 'hinglish',
      subject: 'Fee paid hai but portal pe pending dikha raha hai, please help',
      description: 'Fee paid hai online banking se yesterday morning, but student portal pe abhi bhi balance pending dikha raha hai. Registration hold lag jayega kya? Please check transaction and update ASAP.',
    },
    {
      style: 'urgent_deadline',
      subject: 'Urgent: Scholarship disbursement hold with fee deadline today',
      description: 'My merit scholarship of $3,500 has not been disbursed and the tuition payment deadline is 5:00 PM today. A late fee will be charged if this hold is not cleared immediately.',
    },
    {
      style: 'typo',
      subject: 'My shcolarship amount is not creditted, whome should i contact?',
      description: 'Sir, my term grant and shcolarship is still not reflecting in my acccount. I submitted FAFSA papers last week. Whome should I contact to get this fixed?',
    },
    {
      style: 'multi_issue',
      subject: 'Dual issue: SAP appeal submission and tuition payment installment plan',
      description: 'I need to submit my Satisfactory Academic Progress appeal documentation following a medical leave, and simultaneously enroll in the monthly tuition installment plan before the census date.',
    },
    {
      style: 'vague',
      subject: 'Financial aid question please check',
      description: 'Can someone check my account? Something looks wrong with the total amount for Fall semester.',
    },
    {
      style: 'appeal',
      subject: 'Formal SAP Appeal & Reinstatement Petition under extenuating medical circumstances',
      description: 'I submit a formal written Satisfactory Academic Progress (SAP) appeal petition for Fall 2026. Cumulative GPA fell below 2.0 due to documented hospitalization; comprehensive physician letters and academic plan attached.',
    },
    {
      style: 'formal',
      subject: 'Inquiry regarding Census Date Aid Proration for 9 credit enrollment',
      description: 'I am currently registered for 9 credit hours and would like to verify how my institutional grant disbursement will be prorated between half-time and three-quarter time status.',
    },
  ],
  Registration: [
    {
      style: 'urgent_deadline',
      subject: 'registration is not allowing me to select the subject and deadline is today',
      description: 'The portal is throwing prerequisite error when trying to add CS-402, but I already passed the equivalent course at community college. Today is the final add deadline, please assist!',
    },
    {
      style: 'hinglish',
      subject: 'Course drop kiya tha still timetable me reflect ho raha hai, please check',
      description: 'Hi, I dropped one course MATH-215 yesterday before the deadline but it is still showing in my active timetable and Canvas. Please confirm if drop was successful.',
    },
    {
      style: 'typo',
      subject: 'regsitration portal throwng error for credit overload',
      description: 'I am tryng to register for 19 credits with 3.4 GPA but regsitration system says max credit limit 18 reached. Need overload approval.',
    },
    {
      style: 'multi_issue',
      subject: 'Late drop petition for PHYS-240 and prerequisite override for EECS-280',
      description: 'I need to petition for late withdrawal from PHYS-240 due to illness, and also require an advisor override to register for EECS-280 for next term.',
    },
    {
      style: 'vague',
      subject: 'I am not sure whether I should submit the withdrawal form or appeal first',
      description: 'My grade is very low in one subject and week 8 is ending. What is the process to withdraw without hurting my record?',
    },
    {
      style: 'appeal',
      subject: 'Academic Senate Retroactive Withdrawal Petition post Week-8 deadline',
      description: 'Formal petition for retroactive late withdrawal with W grade notation following unexpected emergency surgery. Submitting attending surgeon documentation for Academic Senate review.',
    },
    {
      style: 'formal',
      subject: 'Petition for 20 Credit Hour Undergraduate Overload (GPA 3.65)',
      description: 'Submitting request for credit overload to enroll in 20 semester hours to complete dual-degree requirements. Cumulative GPA 3.65 with signed faculty advisor attestation.',
    },
  ],
  IT: [
    {
      style: 'urgent_deadline',
      subject: 'My account is locked and I have an assignment submission today',
      description: 'My university SSO account got locked after multiple failed attempts and my final project submission deadline is in 3 hours on Canvas LMS. Please reset my MFA access urgently!',
    },
    {
      style: 'hinglish',
      subject: 'MFA authenticator app change karna hai, purana phone reset ho gaya tha',
      description: 'I lost access to my Microsoft Authenticator app because my phone was factory reset. Cannot login to student email or portal. Please help reset two-factor auth.',
    },
    {
      style: 'typo',
      subject: 'cannot acess instructional lab GPU server ssh connection timedout',
      description: 'Trying to connect to cluster gpu-lab01.campusresolve.edu for machine learnng assignment, getting connecton refused error. Please verify my lab quota.',
    },
    {
      style: 'multi_issue',
      subject: 'Laptop loaner request for term and Canvas LMS enrollment missing for BIO-172',
      description: 'My personal laptop broke and I need to request an IT semester loaner device, and also my registration for BIO-172 is not syncing to my Canvas course list.',
    },
    {
      style: 'vague',
      subject: 'Wifi and portal not working properly',
      description: 'Eduroam wifi keeps disconnecting in library and my portal won\'t open.',
    },
    {
      style: 'appeal',
      subject: 'Urgent Information Security Incident Report: Suspected credential compromise',
      description: 'Reporting suspicious foreign IP login activity and unauthorized forwarding rules detected on my institutional email account. Requesting immediate token revocation and security audit.',
    },
    {
      style: 'formal',
      subject: 'Request for specialized instructional software license allocation (MATLAB/Simulink)',
      description: 'Requesting instructional lab license activation for engineering senior capstone course. Faculty course approval reference EECS-482 attached.',
    },
  ],
  Accessibility: [
    {
      style: 'urgent_deadline',
      subject: 'Exam is in 3 days: Proctored testing accommodation room booking pending',
      description: 'I submitted my accommodation letter for double time on exams, but the testing center has not confirmed my room booking for Friday midterms. Please confirm proctor assignment!',
    },
    {
      style: 'hinglish',
      subject: 'Testing accommodation letter approve hua tha but professor bol rahe hain notice late hai',
      description: 'I have approved letter for 1.5x extended exam time. But course instructor says they did not receive notice 5 days in advance. Can Disability Office please contact instructor directly?',
    },
    {
      style: 'typo',
      subject: 'screen reader pdf course packet formating broken and unreadable',
      description: 'The PDF packet uploaded for HIST-201 cannot be read by NVDA screen reader, image scans are missing OCR text. Need converted accessible file.',
    },
    {
      style: 'multi_issue',
      subject: 'Peer note-taker assignment request and elevator outage reporting in East Hall',
      description: 'Requesting an assigned peer note-taker for chemistry lectures, and also reporting that the south elevator in East Hall is out of service, blocking second floor wheelchair access.',
    },
    {
      style: 'vague',
      subject: 'Need help with disability services appointment',
      description: 'I need to schedule a meeting to renew my accommodation paperwork for this semester.',
    },
    {
      style: 'appeal',
      subject: 'Formal Section 504 Grievance: Denial of approved exam accommodation',
      description: 'Submitting formal administrative escalation to ADA / Section 504 Compliance Review Panel regarding course instructor refusal to honor approved distraction-reduced testing environment.',
    },
    {
      style: 'formal',
      subject: 'Request for Real-Time CART Captioning Provider for Lecture Series',
      description: 'Approved accommodation request for real-time CART captioning for daily 10:00 AM lecture. Course syllabus and classroom schedule submitted for scheduling.',
    },
  ],
};

/**
 * Generates the complete, deterministic Phase 3/4/8 dataset following the mandatory
 * 11-entity order (Section 5) and exact ID formats (Section 6).
 */
export function generateDeterministicDataset(
  options: GeneratorOptions = {}
): GeneratedDatasetBundle {
  const seed = options.seed ?? DETERMINISTIC_SEED;
  const mode = options.mode ?? 'full';
  const rng = new DeterministicRng(seed);

  const ticketCount = options.ticketCount ?? (mode === 'full' ? 5000 : 50);
  const knowledgeArticleCount = options.knowledgeArticleCount ?? (mode === 'full' ? 200 : 24);
  const messagesPerTicket = options.messagesPerTicket ?? 4;
  const requesterCount = options.requesterCount ?? (mode === 'full' ? 500 : 25);

  const anchorMs = Date.parse(BASE_ANCHOR_DATE_ISO);

  // --------------------------------------------------------------------------
  // STEP 2 & 3 MASTER TABLES: ROLE & TERM
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
      role_id: 'ROLE-ACADEMIC_ADMINISTRATOR',
      role_code: ActorRole.AcademicAdministrator,
      role_name: 'Academic Administrator',
      institutional_scope: 'Deans, Registrars & Appeals Review Boards',
      description:
        'Adjudicates escalated petitions, reviews policy compliance, publishes knowledge articles, and oversees SLAs.',
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
      role_id: 'ROLE-PLATFORM_ADMINISTRATOR',
      role_code: ActorRole.PlatformAdministrator,
      role_name: 'Platform Administrator',
      institutional_scope: 'Enterprise IT & Platform Governance Authority',
      description:
        'Configures cross-institutional settings, manages authentication providers, and reviews system integrity metrics.',
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
      term_code: 'FA25',
      term_name: 'Fall 2025',
      academic_year: 2025,
      start_date: '2025-08-25',
      end_date: '2025-12-19',
      add_drop_deadline: '2025-09-08',
      withdrawal_deadline: '2025-10-24',
      aid_disbursement_date: '2025-08-15',
      lifecycle_state: 'archived',
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      term_id: 'TERM-2026-SPRING',
      term_code: 'SP26',
      term_name: 'Spring 2026',
      academic_year: 2026,
      start_date: '2026-01-12',
      end_date: '2026-05-08',
      add_drop_deadline: '2026-01-26',
      withdrawal_deadline: '2026-03-13',
      aid_disbursement_date: '2026-01-02',
      lifecycle_state: 'archived',
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      term_id: 'TERM-2026-FALL',
      term_code: 'FA26',
      term_name: 'Fall 2026',
      academic_year: 2026,
      start_date: '2026-08-24',
      end_date: '2026-12-18',
      add_drop_deadline: '2026-09-08',
      withdrawal_deadline: '2026-10-23',
      aid_disbursement_date: '2026-08-14',
      lifecycle_state: 'active',
      created_at: BASE_ANCHOR_DATE_ISO,
    },
    {
      term_id: 'TERM-2027-SPRING',
      term_code: 'SP27',
      term_name: 'Spring 2027',
      academic_year: 2027,
      start_date: '2027-01-11',
      end_date: '2027-05-07',
      add_drop_deadline: '2027-01-25',
      withdrawal_deadline: '2027-03-12',
      aid_disbursement_date: '2027-01-04',
      lifecycle_state: 'upcoming',
      created_at: BASE_ANCHOR_DATE_ISO,
    },
  ];

  // --------------------------------------------------------------------------
  // 6. CATEGORIES (CAT-FINAID, CAT-REG, CAT-IT, CAT-ACCESS)
  // --------------------------------------------------------------------------
  const categories: CategoryRecord[] = OFFICIAL_CATEGORIES.map((catName) => {
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
      keywords: (rule as any).keywords ? [...(rule as any).keywords] : ['academic', catName.toLowerCase()],
      is_active: true,
      effective_from: '2026-01-01T00:00:00+05:30',
      effective_to: null,
      created_at: BASE_ANCHOR_DATE_ISO,
    };
  });

  // --------------------------------------------------------------------------
  // 1. GENERATE REQUESTERS (REQ-2026-000001 ..)
  // --------------------------------------------------------------------------
  const requesters: RequesterRecord[] = [];
  for (let i = 1; i <= requesterCount; i++) {
    const firstName = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i - 1) % LAST_NAMES.length];
    const dept = DEPARTMENTS[(i - 1) % DEPARTMENTS.length];
    const isInstructor = i % 10 === 0;
    const roleId = isInstructor ? 'ROLE-INSTRUCTOR' : 'ROLE-LEARNER';
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i}@synthetic.campusresolve.invalid`;

    requesters.push({
      requester_id: formatRequesterId(i),
      app_profile_id: null,
      role_id: roleId,
      primary_term_id: 'TERM-2026-FALL',
      verified_email: email,
      display_name: `${firstName} ${lastName}`,
      department: dept,
      program_or_unit: isInstructor ? 'Instructional Faculty' : 'Undergraduate Degree Cohort',
      account_status: 'active',
      is_synthetic_eval: true,
      effective_from: '2026-08-01',
      effective_to: null,
      created_at: formatIsoWithIstOffset(anchorMs - 30 * 86400000 + i * 60000),
      updated_at: BASE_ANCHOR_DATE_ISO,
    });
  }

  // --------------------------------------------------------------------------
  // 4. GENERATE 24 POLICY DOCUMENTS (POL-<domain>-2026-001 .. 006)
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
      created_at: formatIsoWithIstOffset(Date.parse(`${spec.effectiveDate}T08:00:00.000Z`)),
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
      'Merit Scholarship Renewal GPA Verification & Grace Term Rules',
      'International Student Emergency Fellowship Application Guide',
      'Filing a Special Circumstance Financial Aid Re-Assessment',
      'Work-Study Bi-Weekly Timesheet Approval and Wage Disbursement',
    ],
    REG: [
      'First-10-Business-Day Add/Drop Procedure & Roster Lock',
      'Week 8 Course Withdrawal (W Grade) Online Submission Guide',
      'Post-Deadline Retroactive Withdrawal Petition Documentation',
      'Undergraduate 19–22 Credit Hour Overload Approval Workflow',
      'Cross-Departmental Prerequisite Waiver & Instructor Attestation',
      'Academic Standing Probation Review and Academic Plan Filing',
      'Grade Forgiveness Course Repetition Petition and GPA Replacement',
      'Independent Study Syllabus and Department Chair Authorization',
    ],
    IT: [
      'Transitioning from Legacy SMS to FIDO2 / TOTP Authenticator MFA',
      'Identity Verification for Locked Institutional SSO Accounts',
      'LMS Course Shell Provisioning & 4-Hour Roster Sync Troubleshooting',
      'Instructional Lab Software Floating License Seat Allocation',
      'Student Hardware Loaner Laptop Checkout Eligibility and Return Rules',
      'Reporting Suspected Phishing, Token Theft or Credential Compromise',
      'Departmental High-Performance GPU Cluster Access Sponsorship',
      'Campus Wi-Fi Connectivity and Rogue Access Point Restriction',
    ],
    ACCESS: [
      '5-Business-Day Proctored Testing Accommodation Booking Guide',
      'Requesting Real-Time CART Captioning & Accessible Course Packets',
      'Instructor Notification Letters for Approved Exam Extended Time',
      'Escalating Accommodation Implementation Barriers to Section 504 Panel',
      'Assistive Screen-Reader PDF Remediation Turnaround Standards',
      'Campus Housing Emotional Support Animal Health Record Clearance',
      'Peer Note-Taking Services and Lecture Audio Recording Permissions',
      'Reporting Physical Mobility Obstacles and Accessible Van Booking',
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
        isExpiredArticle ? '[EXPIRED KNOWLEDGE ARTICLE] ' : '[PUBLISHED KNOWLEDGE ARTICLE] '
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
      created_at: formatIsoWithIstOffset(Date.parse(`${parentPolicy.effective_date}T09:00:00.000Z`)),
      updated_at: BASE_ANCHOR_DATE_ISO,
    };

    knowledgeArticles.push(article);

    policyArticleLinks.push({
      link_id: `LNK-POL-KB-${String(i).padStart(6, '0')}`,
      policy_id: parentPolicy.policy_id,
      policy_version: parentPolicy.version,
      article_id: article.article_id,
      article_version: article.version,
      relationship_type: isExpiredArticle ? 'superseded_reference' : 'primary_governance',
      created_at: BASE_ANCHOR_DATE_ISO,
    });
  }

  // Lookup maps for active vs expired policies & articles
  const activePoliciesByCat = new Map<CategoryRecord['category_id'], PolicyDocumentRecord[]>();
  const expiredPoliciesByCat = new Map<CategoryRecord['category_id'], PolicyDocumentRecord[]>();
  for (const pol of policyDocuments) {
    const targetMap = pol.lifecycle_state === 'active' ? activePoliciesByCat : expiredPoliciesByCat;
    const list = targetMap.get(pol.category_id) || [];
    list.push(pol);
    targetMap.set(pol.category_id, list);
  }

  const activeArticlesByPolicy = new Map<string, KnowledgeArticleRecord[]>();
  const expiredArticlesByPolicy = new Map<string, KnowledgeArticleRecord[]>();
  for (const art of knowledgeArticles) {
    const targetMap = art.lifecycle_state === 'published' ? activeArticlesByPolicy : expiredArticlesByPolicy;
    const list = targetMap.get(art.primary_policy_id) || [];
    list.push(art);
    targetMap.set(art.primary_policy_id, list);
  }

  // --------------------------------------------------------------------------
  // 7, 8, 9, 10, 11. GENERATE TICKETS, MESSAGES, ASSIGNMENTS, SLAS, FEEDBACKS
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

  // Track metrics for Data Quality Report
  const subjectSeen = new Set<string>();
  const descSeen = new Set<string>();
  let duplicateSubjectCount = 0;
  let duplicateDescCount = 0;
  const subjectLengths: number[] = [];
  const descLengths: number[] = [];
  let informalTypoCount = 0;
  let hinglishCount = 0;
  let multiIssueCount = 0;
  let ambiguityCount = 0;

  const categoryCounts: Record<OfficialCategoryName, number> = {
    'Financial Aid': 0,
    Registration: 0,
    IT: 0,
    Accessibility: 0,
  };
  const lifecycleCounts: Record<RequestStatus, number> = {
    [RequestStatus.Draft]: 0,
    [RequestStatus.Submitted]: 0,
    [RequestStatus.UnderReview]: 0,
    [RequestStatus.PolicyVerified]: 0,
    [RequestStatus.Escalated]: 0,
    [RequestStatus.Resolved]: 0,
    [RequestStatus.Closed]: 0,
  };
  const priorityCounts: Record<TicketPriorityLevel, number> = {
    'Standard Priority': 0,
    'Time-Sensitive Academic Priority': 0,
    'Administrative Escalation Priority': 0,
  };
  const termWeekCounts: Record<string, number> = {};

  // Deterministic Category Selection with Mentor-Requested Weights:
  // Financial Aid: 35% (1750), Registration: 30% (1500), IT: 22% (1100), Accessibility: 13% (650)
  function determineCategory(tIndex: number): OfficialCategoryName {
    const mod100 = ((tIndex - 1) * 37 + 13) % 100;
    if (mod100 < 35) return 'Financial Aid';
    if (mod100 < 65) return 'Registration';
    if (mod100 < 87) return 'IT';
    return 'Accessibility';
  }

  // Deterministic Lifecycle Selection with Realistic Varied Non-Uniform Weights:
  // Resolved: 48% (2400), UnderReview: 22% (1100), PolicyVerified: 9% (450),
  // Escalated: 8% (400), Submitted: 6% (300), Closed: 4% (200), Draft: 3% (150)
  function determineLifecycle(tIndex: number, forceEscalated: boolean, forceResolved: boolean): RequestStatus {
    if (forceResolved) return RequestStatus.Resolved;
    if (forceEscalated) return RequestStatus.Escalated;
    const mod100 = ((tIndex - 1) * 53 + 7) % 100;
    if (mod100 < 52) return RequestStatus.Resolved;
    if (mod100 < 78) return RequestStatus.UnderReview;
    if (mod100 < 88) return RequestStatus.PolicyVerified;
    if (mod100 < 94) return RequestStatus.Submitted;
    if (mod100 < 98) return RequestStatus.Closed;
    return RequestStatus.Draft;
  }

  // Pre-calculate message count allocation across tickets to sum to EXACTLY targetTotalMessages (20,000 for 5,000 tickets)
  const targetTotalMessages = ticketCount * 4;
  const ticketStatuses: RequestStatus[] = [];
  const ticketMsgCounts: number[] = [];
  for (let i = 1; i <= ticketCount; i++) {
    const mod25 = i % 25;
    const isAnomalyMissed = mod25 === 19;
    const isNormalEsc = !isAnomalyMissed && i % 12 === 0;
    const isEscReq = isNormalEsc || isAnomalyMissed;
    const st = determineLifecycle(i, isEscReq && !isAnomalyMissed, isAnomalyMissed);
    ticketStatuses.push(st);

    let count = 4;
    if (st === RequestStatus.Draft) count = 1;
    else if (st === RequestStatus.Submitted) count = 2;
    else if (st === RequestStatus.UnderReview || st === RequestStatus.PolicyVerified) count = 4;
    else if (st === RequestStatus.Escalated || st === RequestStatus.Closed) count = 5;
    else if (st === RequestStatus.Resolved) count = 4;
    ticketMsgCounts.push(count);
  }

  let totalMsgSum = ticketMsgCounts.reduce((acc, c) => acc + c, 0);
  if (totalMsgSum < targetTotalMessages) {
    let diff = targetTotalMessages - totalMsgSum;
    for (let i = 0; i < ticketCount && diff > 0; i++) {
      if (ticketStatuses[i] === RequestStatus.Resolved && ticketMsgCounts[i] === 4) {
        ticketMsgCounts[i] = 5;
        diff--;
      }
    }
  } else if (totalMsgSum > targetTotalMessages) {
    let diff = totalMsgSum - targetTotalMessages;
    for (let i = 0; i < ticketCount && diff > 0; i++) {
      if (
        (ticketStatuses[i] === RequestStatus.UnderReview ||
          ticketStatuses[i] === RequestStatus.PolicyVerified) &&
        ticketMsgCounts[i] === 4
      ) {
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

    const activePolicies = activePoliciesByCat.get(categoryId)!;
    const expiredPolicies = expiredPoliciesByCat.get(categoryId)!;
    const expectedPolicy = activePolicies[(tIdx - 1) % activePolicies.length];
    const expectedArticles = activeArticlesByPolicy.get(expectedPolicy.policy_id)!;
    const expectedArticle = expectedArticles[(tIdx - 1) % expectedArticles.length];

    // Five mandatory anomaly scenarios placed deterministically (200 of each anomaly in full 5,000 mode)
    const mod25 = tIdx % 25;
    const isAnomalyExpiredCitation = mod25 === 3;
    const isAnomalyUnauthorizedRouting = mod25 === 7;
    const isAnomalyUnsupportedClaim = mod25 === 11;
    const isAnomalySlaBusinessHours = mod25 === 15;
    const isAnomalyMissedEscalation = mod25 === 19;

    const isNormalEscalationCase = !isAnomalyMissedEscalation && tIdx % 12 === 0;
    const expectedEscalationRequired = isNormalEscalationCase || isAnomalyMissedEscalation;

    // Realistic Term-Week Scheduling across 16 weeks of Fall 2026 (Aug 24 to Dec 18, 2026)
    // Add/Drop peak: weeks 1-2; Census peak: weeks 4-5; Midterms peak: week 8; Finals peak: weeks 14-15
    const weekBucket = (tIdx * 17 + 5) % 16 + 1; // 1 to 16
    const weekKey = `Week ${weekBucket}`;
    termWeekCounts[weekKey] = (termWeekCounts[weekKey] || 0) + 1;

    // Base submission date calculated from Fall 2026 start (2026-08-24)
    const weekStartMs = Date.UTC(2026, 7, 24) + (weekBucket - 1) * 7 * 86400000;
    const dayInWeek = (tIdx * 3 + 1) % 5; // Monday to Friday (0 to 4)
    const hourOfDay = 9 + ((tIdx * 7) % 8); // 9:00 to 17:00
    const minuteOfHour = (tIdx * 11) % 60;
    const baseSubMs = weekStartMs + dayInWeek * 86400000 + hourOfDay * 3600000 + minuteOfHour * 60000;

    // ISO 8601 Timestamps with explicit +05:30 offset
    const submittedAtIso = isAnomalySlaBusinessHours
      ? formatIsoWithIstOffset(Date.UTC(2026, 8, 4, 15, 30, 0)) // Friday 15:30 UTC
      : formatIsoWithIstOffset(baseSubMs);

    const evaluatedAtIso = isAnomalySlaBusinessHours
      ? formatIsoWithIstOffset(Date.UTC(2026, 8, 7, 9, 30, 0)) // Monday 09:30 UTC
      : formatIsoWithIstOffset(Date.parse(submittedAtIso) + 180 * 60000);

    // Policy & Article cited on ticket
    const citedPolicy = isAnomalyExpiredCitation ? expiredPolicies[0] : expectedPolicy;
    const citedArticleList = isAnomalyExpiredCitation
      ? expiredArticlesByPolicy.get(citedPolicy.policy_id)!
      : expectedArticles;
    const citedArticle = citedArticleList[0];

    // Priority derivation based on urgency, category, and escalation
    const priority: TicketPriorityLevel = expectedEscalationRequired
      ? 'Administrative Escalation Priority'
      : tIdx % 5 === 0
      ? 'Time-Sensitive Academic Priority'
      : 'Standard Priority';
    priorityCounts[priority]++;

    // Lifecycle Status derivation
    const observedLifecycleStatus = determineLifecycle(
      tIdx,
      expectedEscalationRequired && !isAnomalyMissedEscalation,
      isAnomalyMissedEscalation
    );
    lifecycleCounts[observedLifecycleStatus]++;

    const isResolved = observedLifecycleStatus === RequestStatus.Resolved;
    const isClosed = observedLifecycleStatus === RequestStatus.Closed;

    // Generate realistic, messy ticket text using style variants
    const styleVariants = REQUEST_STYLE_LIBRARY[categoryName];
    const pickedVariant = styleVariants[(tIdx - 1) % styleVariants.length];

    // Track text statistics
    if (pickedVariant.style === 'hinglish') hinglishCount++;
    if (pickedVariant.style === 'typo' || pickedVariant.style === 'hinglish') informalTypoCount++;
    if (pickedVariant.style === 'multi_issue') multiIssueCount++;
    if (pickedVariant.style === 'vague') ambiguityCount++;

    // Add seeded specific identifiers to eliminate artificial duplicates
    const courseCodes = ['CS-101', 'EECS-280', 'MATH-215', 'BIO-172', 'ECON-101', 'CHEM-130', 'ENG-125', 'PHYS-240'];
    const courseCode = courseCodes[(tIdx - 1) % courseCodes.length];

    const subject =
      expectedEscalationRequired && pickedVariant.style === 'appeal'
        ? `${categoryName} Formal Appeal Petition: ${expectedPolicy.title} (${expectedPolicy.policy_id})`
        : tIdx % 7 === 0
        ? `${pickedVariant.subject} [${courseCode} · Ref #${tIdx}]`
        : `${pickedVariant.subject} (#${tIdx})`;

    const description = `${pickedVariant.description} (Student ID: ${requester.requester_id}, Course: ${courseCode}, Term: ${requester.primary_term_id}).`;

    if (subjectSeen.has(subject)) duplicateSubjectCount++;
    subjectSeen.add(subject);
    if (descSeen.has(description)) duplicateDescCount++;
    descSeen.add(description);

    subjectLengths.push(subject.length);
    descLengths.push(description.length);

    // Routing decision
    const idealRouting = evaluateTicketRouting({
      ticketId,
      category: categoryName,
      priority,
      subject,
      description,
      assignedAtIso: submittedAtIso,
    });

    const wrongCategory: OfficialCategoryName =
      categoryName === 'Financial Aid' ? 'IT' : 'Financial Aid';
    const observedAssignedTeam = isAnomalyUnauthorizedRouting
      ? DOCUMENTED_ROUTING_RULES[wrongCategory].primary_assigned_team
      : isAnomalyMissedEscalation
      ? routingRule.primary_assigned_team
      : idealRouting.assignment.assigned_team;

    const observedRoutingRuleId = isAnomalyUnauthorizedRouting
      ? DOCUMENTED_ROUTING_RULES[wrongCategory].rule_id
      : idealRouting.assignment.routing_rule_id;

    const hasReassignment =
      observedLifecycleStatus === RequestStatus.Escalated && !isAnomalyMissedEscalation;
    const currentAssignedTeam = hasReassignment
      ? routingRule.escalation_assigned_team
      : observedAssignedTeam;
    const currentRoutingRuleId = hasReassignment
      ? ((routingRule as any).escalation_routing_rule_id || observedRoutingRuleId)
      : observedRoutingRuleId;

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
      current_assigned_team: currentAssignedTeam,
      current_routing_rule_id: currentRoutingRuleId,
      referenced_policy_id: citedPolicy.policy_id,
      referenced_policy_version: citedPolicy.version,
      referenced_article_id: citedArticle.article_id,
      referenced_article_version: citedArticle.version,
      requires_escalation: expectedEscalationRequired,
      is_escalated: observedLifecycleStatus === RequestStatus.Escalated,
      escalation_reason: expectedEscalationRequired ? idealRouting.escalationReason : null,
      resolution_summary:
        isResolved || isClosed
          ? isAnomalyUnsupportedClaim
            ? 'UNSUPPORTED CLAIM: Approved automatic 100% full tuition refund and 45-day retroactive deadline extension without documentation.'
            : `Resolved in accordance with ${citedPolicy.policy_id} v${citedPolicy.version} (${citedPolicy.authoritative_section_ref}) and ${citedArticle.article_id} v${citedArticle.version}.`
          : null,
      is_synthetic_eval: true,
      submitted_at: submittedAtIso,
      updated_at: evaluatedAtIso,
      resolved_at: isResolved || isClosed ? evaluatedAtIso : null,
      closed_at: isClosed ? formatIsoWithIstOffset(Date.parse(evaluatedAtIso) + 86400000) : null,
    };

    tickets.push(ticket);

    // Bridge Links: Ticket <-> Policy & Ticket <-> Article
    ticketPolicyLinks.push({
      link_id: `TPL-${ticketId}-01`,
      ticket_id: ticketId,
      policy_id: citedPolicy.policy_id,
      policy_version: citedPolicy.version,
      applicability_status:
        citedPolicy.lifecycle_state === 'expired' ? 'expired_at_citation' : 'applicable_current',
      linked_by_actor: `ACTOR-OPS-${routingRule.domain_code}`,
      linked_at: evaluatedAtIso,
    });

    ticketArticleLinks.push({
      link_id: `TAL-${ticketId}-01`,
      ticket_id: ticketId,
      article_id: citedArticle.article_id,
      article_version: citedArticle.version,
      applicability_status:
        citedArticle.lifecycle_state === 'expired' ? 'expired_at_citation' : 'applicable_current',
      linked_by_actor: `ACTOR-OPS-${routingRule.domain_code}`,
      linked_at: evaluatedAtIso,
    });

    // Valid Lifecycle Event Audit Trail following DAG transitions
    let eventSeq = 1;
    if (observedLifecycleStatus === RequestStatus.Draft) {
      ticketLifecycleEvents.push(
        createLifecycleEvent({
          ticketId,
          eventSequence: eventSeq++,
          previousState: null,
          newState: RequestStatus.Draft,
          actorId: requester.requester_id,
          actorRole: requester.role_id === 'ROLE-INSTRUCTOR' ? ActorRole.Instructor : ActorRole.Learner,
          reason: 'Draft academic request initiated by requester.',
          timestampIso: submittedAtIso,
        })
      );
    } else {
      ticketLifecycleEvents.push(
        createLifecycleEvent({
          ticketId,
          eventSequence: eventSeq++,
          previousState: null,
          newState: RequestStatus.Submitted,
          actorId: requester.requester_id,
          actorRole: requester.role_id === 'ROLE-INSTRUCTOR' ? ActorRole.Instructor : ActorRole.Learner,
          reason: 'Initial request submission and intake validation.',
          timestampIso: submittedAtIso,
        })
      );

      const midTimeIso = formatIsoWithIstOffset(Date.parse(submittedAtIso) + 30 * 60000);

      if (observedLifecycleStatus === RequestStatus.Escalated) {
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: RequestStatus.Submitted,
            newState: RequestStatus.Escalated,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: ActorRole.SupportStaff,
            reason: idealRouting.escalationReason || 'Escalated for administrative policy adjudication.',
            timestampIso: evaluatedAtIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version,
          })
        );
      } else if (observedLifecycleStatus === RequestStatus.PolicyVerified) {
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
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: RequestStatus.UnderReview,
            newState: RequestStatus.PolicyVerified,
            actorId: `ACTOR-OPS-${routingRule.domain_code}`,
            actorRole: ActorRole.SupportStaff,
            reason: `Policy citation ${citedPolicy.policy_id} v${citedPolicy.version} verified against authoritative catalog.`,
            timestampIso: evaluatedAtIso,
            referencedPolicyId: citedPolicy.policy_id,
            referencedPolicyVersion: citedPolicy.version,
            referencedArticleId: citedArticle.article_id,
            referencedArticleVersion: citedArticle.version,
          })
        );
      } else if (observedLifecycleStatus === RequestStatus.UnderReview) {
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
      } else if (observedLifecycleStatus === RequestStatus.Resolved) {
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
      } else if (observedLifecycleStatus === RequestStatus.Closed) {
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
          })
        );
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
          })
        );
        ticketLifecycleEvents.push(
          createLifecycleEvent({
            ticketId,
            eventSequence: eventSeq++,
            previousState: RequestStatus.Resolved,
            newState: RequestStatus.Closed,
            actorId: requester.requester_id,
            actorRole: requester.role_id === 'ROLE-INSTRUCTOR' ? ActorRole.Instructor : ActorRole.Learner,
            reason: 'Ticket resolved and closed after review.',
            timestampIso: formatIsoWithIstOffset(Date.parse(evaluatedAtIso) + 86400000),
          })
        );
      }
    }

    // Determine message count per ticket from precalculated balanced budget:
    const tMsgCount = ticketMsgCounts[tIdx - 1];

    // Message creation
    const msgTemplates: {
      senderId: string;
      senderRole: ActorRole;
      senderName: string;
      type: MessageRecord['message_type'];
      body: string;
      citePolicy: boolean;
    }[] = [
      {
        senderId: requester.requester_id,
        senderRole: requester.role_id === 'ROLE-INSTRUCTOR' ? ActorRole.Instructor : ActorRole.Learner,
        senderName: requester.display_name,
        type: 'requester_inquiry',
        body: description,
        citePolicy: false,
      },
      {
        senderId: 'SYSTEM-ROUTER',
        senderRole: ActorRole.SupportStaff,
        senderName: 'CampusResolve Routing Engine',
        type: 'system_routing_note',
        body: `Ticket ${ticketId} classified under '${categoryName}' and assigned to '${observedAssignedTeam}' using routing rule ${observedRoutingRuleId}.`,
        citePolicy: false,
      },
      {
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
      {
        senderId: requester.requester_id,
        senderRole: requester.role_id === 'ROLE-INSTRUCTOR' ? ActorRole.Instructor : ActorRole.Learner,
        senderName: requester.display_name,
        type: 'requester_inquiry',
        body: 'Thank you for reviewing my request. Please let me know if additional documentation is needed.',
        citePolicy: false,
      },
    ];

    for (let m = 0; m < tMsgCount; m++) {
      const tpl = msgTemplates[m % msgTemplates.length];
      const msgSeq = m + 1;
      const msgTimeIso = formatIsoWithIstOffset(Date.parse(submittedAtIso) + msgSeq * 25 * 60000);

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

    // 9. ASSIGNMENTS (Sequence 1, and Sequence 2 for escalated cases)
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
      unassigned_at: hasReassignment ? evaluatedAtIso : null,
    });

    if (hasReassignment) {
      assignments.push({
        assignment_id: formatAssignmentId(ticketId, 2),
        ticket_id: ticketId,
        sequence_number: 2,
        assigned_team: routingRule.escalation_assigned_team,
        assigned_actor_id: `ACTOR-ESC-${routingRule.domain_code}`,
        assigned_actor_role: ActorRole.AcademicAdministrator,
        routing_rule_id: observedRoutingRuleId,
        assignment_reason: idealRouting.escalationReason || 'Administrative escalation reassignment.',
        previous_assignment_id: formatAssignmentId(ticketId, 1),
        previous_assigned_team: routingRule.primary_assigned_team,
        requires_human_review: true,
        is_active: true,
        assigned_at: evaluatedAtIso,
        unassigned_at: null,
      });
    }

    // 10. SLA RECORD
    const slaRecord = buildReproducibleSlaRecord({
      ticketId,
      category: categoryName,
      startTimestampIso: submittedAtIso,
      evaluatedTimestampIso: evaluatedAtIso,
      isTicketEscalated: observedLifecycleStatus === RequestStatus.Escalated,
      requiresEscalation: expectedEscalationRequired,
      calculationMode: isAnomalySlaBusinessHours ? 'wall_clock_24x7' : 'business_hours_configured',
      ruleClassification: isAnomalySlaBusinessHours ? 'SYNTHETIC_EVAL_SCENARIO' : 'PROPOSED_CONFIGURABLE_RULE',
    });
    slas.push(slaRecord);

    // 11. RESOLUTION FEEDBACK (for resolved & closed tickets)
    if (isResolved || isClosed) {
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
        submitted_at: formatIsoWithIstOffset(Date.parse(evaluatedAtIso) + 15 * 60000),
      });
    }

    // Ground-truth anomaly tracking
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
        expected_decision: `Cite active policy version for category '${categoryName}' (v2.0)`,
        actual_observed_decision: `Cited expired policy ${citedPolicy.policy_id} v${citedPolicy.version} (expired ${citedPolicy.expiration_date})`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: 'POLICY_EFFECTIVE_DATE_APPLICABILITY_RULE',
        explanation: `Ticket ${ticketId} cites expired policy ${citedPolicy.policy_id} v${citedPolicy.version} whose expiration date is ${citedPolicy.expiration_date}.`,
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
        expected_decision: `Assign to '${routingRule.primary_assigned_team}' via ${routingRule.rule_id}`,
        actual_observed_decision: `Assigned to '${observedAssignedTeam}' via ${observedRoutingRuleId}`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: routingRule.rule_id,
        explanation: `Ticket ${ticketId} in category '${categoryName}' assigned to unauthorized team '${observedAssignedTeam}'.`,
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
        expected_decision: `Ground AI reply strictly in ${citedPolicy.policy_id} v${citedPolicy.version}`,
        actual_observed_decision: `Claimed automatic $5,000 cash grant and 45-day deadline waiver without policy basis`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: 'RAG_EVIDENCE_GROUNDING_RULE',
        explanation: `Message asserts unverified financial terms absent from ${citedPolicy.policy_id}.`,
      });
    }

    if (isAnomalySlaBusinessHours) {
      anomalyCounter++;
      const anmId = formatAnomalyId(anomalyCounter);
      ticketAnomalyTypes.push('sla_clock_ignores_business_hours');
      ticketAnomalyIds.push(anmId);
      groundTruthAnomalies.push({
        anomaly_id: anmId,
        related_record_id: slaRecord.sla_id,
        ticket_id: ticketId,
        anomaly_type: 'sla_clock_ignores_business_hours',
        expected_decision: `Evaluate elapsed time under institutional business hours (180 elapsed business minutes)`,
        actual_observed_decision: `Evaluated under raw 24x7 wall-clock time (3,960 elapsed minutes) falsely declaring breach`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: CONFIGURABLE_SLA_RULES[categoryName].sla_rule_id,
        explanation: `SLA calculation ran wall-clock mode over weekend resulting in false breach.`,
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
        expected_decision: `Escalate to '${routingRule.escalation_assigned_team}' with requires_escalation=true`,
        actual_observed_decision: `Resolved directly at frontline support level without mandatory escalation`,
        ground_truth_label: 'ANOMALY_PRESENT',
        rule_reference: routingRule.rule_id,
        explanation: `Ticket requires mandatory administrative review but was closed without escalation handoff.`,
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
        expectedBusinessMin > CONFIGURABLE_SLA_RULES[categoryName].target_business_minutes,
      expected_lifecycle_outcome: observedLifecycleStatus,
      has_anomaly: ticketAnomalyTypes.length > 0,
      anomaly_types: ticketAnomalyTypes,
      anomaly_ids: ticketAnomalyIds,
    });
  }

  // Calculate Text & Distribution Quality Statistics
  const computeStats = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 0, mean: 0, median: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Number((sum / sorted.length).toFixed(1)),
      median: sorted[Math.floor(sorted.length / 2)],
    };
  };

  const dataQualityReport: DataQualityReport = {
    uniqueSubjectCount: subjectSeen.size,
    uniqueDescriptionCount: descSeen.size,
    duplicateSubjectRate: Number((duplicateSubjectCount / ticketCount).toFixed(4)),
    duplicateDescriptionRate: Number((duplicateDescCount / ticketCount).toFixed(4)),
    textLengthStats: {
      subject: computeStats(subjectLengths),
      description: computeStats(descLengths),
    },
    categoryDistribution: {
      'Financial Aid': {
        count: categoryCounts['Financial Aid'],
        percentage: Number(((categoryCounts['Financial Aid'] / ticketCount) * 100).toFixed(1)),
      },
      Registration: {
        count: categoryCounts['Registration'],
        percentage: Number(((categoryCounts['Registration'] / ticketCount) * 100).toFixed(1)),
      },
      IT: {
        count: categoryCounts['IT'],
        percentage: Number(((categoryCounts['IT'] / ticketCount) * 100).toFixed(1)),
      },
      Accessibility: {
        count: categoryCounts['Accessibility'],
        percentage: Number(((categoryCounts['Accessibility'] / ticketCount) * 100).toFixed(1)),
      },
    },
    lifecycleDistribution: Object.fromEntries(
      Object.entries(lifecycleCounts).map(([status, cnt]) => [
        status,
        { count: cnt, percentage: Number(((cnt / ticketCount) * 100).toFixed(1)) },
      ])
    ) as Record<RequestStatus, { count: number; percentage: number }>,
    priorityDistribution: Object.fromEntries(
      Object.entries(priorityCounts).map(([prio, cnt]) => [
        prio,
        { count: cnt, percentage: Number(((cnt / ticketCount) * 100).toFixed(1)) },
      ])
    ) as Record<TicketPriorityLevel, { count: number; percentage: number }>,
    termWeekDistribution: Object.fromEntries(
      Object.entries(termWeekCounts).map(([wk, cnt]) => [
        wk,
        { count: cnt, percentage: Number(((cnt / ticketCount) * 100).toFixed(1)) },
      ])
    ),
    informalAndTypoCoverageCount: informalTypoCount,
    hinglishCoverageCount: hinglishCount,
    multiIssueCoverageCount: multiIssueCount,
    ambiguityCoverageCount: ambiguityCount,
  };

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
      dataQualityReport,
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
