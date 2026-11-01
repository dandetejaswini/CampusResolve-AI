import {
  ActorMetadata,
  ActorRole,
  AuthorizedAction,
  NavItemConfig,
  WorkspaceSection,
} from '../types/domain.js';

export const ACTOR_METADATA: Record<ActorRole, ActorMetadata> = {
  [ActorRole.Learner]: {
    role: ActorRole.Learner,
    label: 'Learner',
    shortLabel: 'Learner',
    institutionalScope: 'Student & Learner Request Portal',
    description:
      'Submits academic requests and support inquiries, consults policy-grounded answers, and tracks resolution and escalation progress.',
    primaryResponsibility: 'Academic & Support Request Submission',
    restrictedCapabilities: [
      'Escalation adjudication is reserved for Academic Administrators',
      'Official policy publication is reserved for Academic and Platform Administrators',
      'Departmental routing and governance configuration are reserved for administrative staff',
    ],
    allowedActions: [AuthorizedAction.SubmitAcademicPetition],
    requestViewTitle: 'Learner Requests View',
    createRequestTitle: 'New Academic Request',
  },
  [ActorRole.Instructor]: {
    role: ActorRole.Instructor,
    label: 'Instructor',
    shortLabel: 'Instructor',
    institutionalScope: 'Faculty & Instructional Support Portal',
    description:
      'Submits instructional or course-related requests, provides faculty input on academic cases, and consults policy-grounded guidance.',
    primaryResponsibility: 'Instructional Requests & Course Case Input',
    restrictedCapabilities: [
      'Final administrative escalation adjudication is reserved for Academic Administrators',
      'Platform-wide governance configuration is reserved for Platform Administrators',
    ],
    allowedActions: [
      AuthorizedAction.SubmitFacultyCourseRequest,
      AuthorizedAction.ProposePolicyRevision,
    ],
    requestViewTitle: 'Instructor Requests View',
    createRequestTitle: 'New Course Request',
  },
  [ActorRole.AcademicAdministrator]: {
    role: ActorRole.AcademicAdministrator,
    label: 'Academic Administrator',
    shortLabel: 'Academic Admin',
    institutionalScope: 'Academic Governance & Case Review Office',
    description:
      'Reviews escalated academic cases, oversees policy-grounded determinations, and manages departmental policy guidance.',
    primaryResponsibility: 'Escalation Review & Academic Policy Oversight',
    restrictedCapabilities: [
      'Platform-wide infrastructure settings are reserved for Platform Administrators',
      'Role permissions are verified for every case adjudication and policy publication',
    ],
    allowedActions: [
      AuthorizedAction.InitiateAdministrativeReview,
      AuthorizedAction.ApprovePolicyEscalation,
      AuthorizedAction.PublishKnowledgeArticle,
      AuthorizedAction.ConfigureDepartmentRouting,
    ],
    requestViewTitle: 'Escalated & Departmental Requests View',
    createRequestTitle: 'Initiate Policy Review',
  },
  [ActorRole.SupportStaff]: {
    role: ActorRole.SupportStaff,
    label: 'Support Staff',
    shortLabel: 'Support Staff',
    institutionalScope: 'Operational Support & Intake Triage Desk',
    description:
      'Coordinates request intake, verifies routing categories, tracks resolution status, and escalates complex inquiries when required.',
    primaryResponsibility: 'Request Intake Triage & Routing Support',
    restrictedCapabilities: [
      'Final academic escalation determinations are reserved for Academic Administrators',
      'Platform governance settings are reserved for Platform Administrators',
    ],
    allowedActions: [
      AuthorizedAction.LogIntakeSupportTicket,
      AuthorizedAction.TriageSupportQueue,
      AuthorizedAction.ProposePolicyRevision,
    ],
    requestViewTitle: 'Support Queue & Routing View',
    createRequestTitle: 'Log Support Request',
  },
  [ActorRole.PlatformAdministrator]: {
    role: ActorRole.PlatformAdministrator,
    label: 'Platform Administrator',
    shortLabel: 'Platform Admin',
    institutionalScope: 'Institutional Platform & Routing Administration',
    description:
      'Manages workspace routing configuration, knowledge base structure, and institutional governance settings.',
    primaryResponsibility: 'Platform Configuration & Routing Structure',
    restrictedCapabilities: [
      'Academic case adjudication is reserved for Academic Administrators',
      'Administrative configuration changes are recorded in the institutional audit trail',
    ],
    allowedActions: [
      AuthorizedAction.InitiateAdministrativeReview,
      AuthorizedAction.PublishKnowledgeArticle,
      AuthorizedAction.ConfigureDepartmentRouting,
      AuthorizedAction.ConfigurePlatformGovernance,
    ],
    requestViewTitle: 'Platform Routing & Escalation Overview',
    createRequestTitle: 'New Routing Directive',
  },
};

export const WORKSPACE_NAV_ITEMS: NavItemConfig[] = [
  {
    id: WorkspaceSection.Dashboard,
    label: 'Dashboard',
    path: '/workspace/dashboard',
    scopeNote: 'Role-scoped operational overview',
  },
  {
    id: WorkspaceSection.MyRequests,
    label: 'My Requests',
    path: '/workspace/requests',
    scopeNote: 'Request tracking and resolution view',
  },
  {
    id: WorkspaceSection.CreateRequest,
    label: 'Create Request',
    path: '/workspace/create-request',
    scopeNote: 'Structured request intake form',
  },
  {
    id: WorkspaceSection.AIAssistant,
    label: 'AI Assistant',
    path: '/workspace/assistant',
    scopeNote: 'Policy-grounded answer retrieval interface',
  },
  {
    id: WorkspaceSection.KnowledgeBase,
    label: 'Knowledge Base',
    path: '/workspace/knowledge-base',
    scopeNote: 'Policy reference repository interface',
  },
  {
    id: WorkspaceSection.Messages,
    label: 'Messages',
    path: '/workspace/messages',
    scopeNote: 'Request-linked communication view',
  },
  {
    id: WorkspaceSection.Notifications,
    label: 'Notifications',
    path: '/workspace/notifications',
    scopeNote: 'Resolution and escalation updates',
  },
  {
    id: WorkspaceSection.Profile,
    label: 'Profile',
    path: '/workspace/profile',
    scopeNote: 'Institutional profile and role details',
  },
  {
    id: WorkspaceSection.Settings,
    label: 'Settings',
    path: '/workspace/settings',
    scopeNote: 'Workspace preferences, routing rules, and system evaluation',
  },
];

export function getActorMetadata(role: ActorRole): ActorMetadata {
  return ACTOR_METADATA[role];
}

export function canActorPerformAction(
  role: ActorRole,
  action: AuthorizedAction
): boolean {
  const metadata = ACTOR_METADATA[role];
  if (!metadata) return false;
  return metadata.allowedActions.includes(action);
}

export function getAuthorizedNavItems(role: ActorRole): NavItemConfig[] {
  const metadata = ACTOR_METADATA[role];
  if (!metadata) return WORKSPACE_NAV_ITEMS;
  return WORKSPACE_NAV_ITEMS.map((item) => {
    if (item.id === WorkspaceSection.MyRequests) {
      return {
        ...item,
        scopeNote: metadata.requestViewTitle,
      };
    }
    if (item.id === WorkspaceSection.CreateRequest) {
      return {
        ...item,
        scopeNote: metadata.createRequestTitle,
      };
    }
    return item;
  });
}

export function getActorCategories(role: ActorRole): string[] {
  switch (role) {
    case ActorRole.Learner:
      return [
        'Academic Enrollment & Registration Inquiry',
        'Course Schedule or Deadline Request',
        'Assessment & Academic Review Inquiry',
        'Academic Support & Advising Request',
        'General Student Services Inquiry',
      ];
    case ActorRole.Instructor:
      return [
        'Course Policy & Syllabus Inquiry',
        'Instructional Support & Classroom Request',
        'Student Case Attestation Submission',
        'Curriculum or Academic Unit Inquiry',
      ];
    case ActorRole.AcademicAdministrator:
      return [
        'Escalated Academic Case Review',
        'Departmental Policy Clarification',
        'Cross-Unit Resolution Coordination',
        'Academic Governance Documentation Review',
      ];
    case ActorRole.SupportStaff:
      return [
        'Incoming Request Intake & Verification',
        'Departmental Routing Assignment',
        'Student & Faculty Support Coordination',
        'Escalation Handoff Preparation',
      ];
    case ActorRole.PlatformAdministrator:
      return [
        'Routing Category Structure Update',
        'Actor Workspace Layout Configuration',
        'Knowledge Base Indexing Configuration',
        'Escalation Workflow Rule Definition',
      ];
  }
}
