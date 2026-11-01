export enum ActorRole {
  Learner = 'learner',
  Instructor = 'instructor',
  AcademicAdministrator = 'academic_administrator',
  SupportStaff = 'support_staff',
  PlatformAdministrator = 'platform_administrator',
}

export enum WorkspaceSection {
  Dashboard = 'dashboard',
  MyRequests = 'requests',
  CreateRequest = 'create-request',
  AIAssistant = 'assistant',
  KnowledgeBase = 'knowledge-base',
  Messages = 'messages',
  Notifications = 'notifications',
  Profile = 'profile',
  Settings = 'settings',
}

export enum ViewDataState {
  Empty = 'empty',
  Loading = 'loading',
  Error = 'error',
}

export enum RequestStatus {
  Draft = 'draft',
  Submitted = 'submitted',
  UnderReview = 'under_review',
  PolicyVerified = 'policy_verified',
  Escalated = 'escalated',
  Resolved = 'resolved',
  Closed = 'closed',
}

export enum AuthorizedAction {
  SubmitAcademicPetition = 'submit_academic_petition',
  SubmitFacultyCourseRequest = 'submit_faculty_course_request',
  InitiateAdministrativeReview = 'initiate_administrative_review',
  LogIntakeSupportTicket = 'log_intake_support_ticket',
  ApprovePolicyEscalation = 'approve_policy_escalation',
  TriageSupportQueue = 'triage_support_queue',
  PublishKnowledgeArticle = 'publish_knowledge_article',
  ProposePolicyRevision = 'propose_policy_revision',
  ConfigureDepartmentRouting = 'configure_department_routing',
  ConfigurePlatformGovernance = 'configure_platform_governance',
}

export interface ActorMetadata {
  role: ActorRole;
  label: string;
  shortLabel: string;
  institutionalScope: string;
  description: string;
  primaryResponsibility: string;
  restrictedCapabilities: string[];
  allowedActions: AuthorizedAction[];
  requestViewTitle: string;
  createRequestTitle: string;
}

export interface NavItemConfig {
  id: WorkspaceSection;
  label: string;
  path: string;
  scopeNote: string;
}
