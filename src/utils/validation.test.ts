import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSignInForm,
  validateSignUpForm,
  validateContactForm,
  validateCreateRequestForm,
  validateProfileForm,
} from './validation';
import {
  ActorRole,
  AuthorizedAction,
  WorkspaceSection,
} from '../types/domain';
import {
  canActorPerformAction,
  getActorMetadata,
  getAuthorizedNavItems,
  getActorCategories,
} from './rbac';

test('validateSignInForm rejects empty and malformed inputs and accepts valid inputs', () => {
  const emptyResult = validateSignInForm({ email: '', password: '' });
  assert.equal(emptyResult.isValid, false);
  assert.ok(emptyResult.errors.email);
  assert.ok(emptyResult.errors.password);

  const badEmailResult = validateSignInForm({
    email: 'not-an-email',
    password: 'short',
  });
  assert.equal(badEmailResult.isValid, false);
  assert.ok(badEmailResult.errors.email);
  assert.ok(badEmailResult.errors.password);

  const validResult = validateSignInForm({
    email: 'provost@university.edu',
    password: 'SecurePassword123',
  });
  assert.equal(validResult.isValid, true);
  assert.deepEqual(validResult.errors, {});
});

test('validateSignUpForm enforces password complexity, confirmation match, and terms acceptance', () => {
  const mismatchResult = validateSignUpForm({
    fullName: 'Dr. Elena Rostova',
    email: 'erostova@university.edu',
    role: ActorRole.Instructor,
    department: 'Department of Mathematics',
    password: 'Password123',
    confirmPassword: 'Password999',
    acceptedTerms: false,
  });
  assert.equal(mismatchResult.isValid, false);
  assert.ok(mismatchResult.errors.confirmPassword);
  assert.ok(mismatchResult.errors.acceptedTerms);

  const validResult = validateSignUpForm({
    fullName: 'Dr. Elena Rostova',
    email: 'erostova@university.edu',
    role: ActorRole.Instructor,
    department: 'Department of Mathematics',
    password: 'Password123',
    confirmPassword: 'Password123',
    acceptedTerms: true,
  });
  assert.equal(validResult.isValid, true);
});

test('validateContactForm validates all fields including message minimum length', () => {
  const shortMessage = validateContactForm({
    fullName: 'Arthur Pendelton',
    email: 'apendelton@university.edu',
    institution: 'Northbridge University',
    actorRole: 'Academic Administrator',
    topic: 'Policy Governance Architecture',
    message: 'Too short',
  });
  assert.equal(shortMessage.isValid, false);
  assert.ok(shortMessage.errors.message);

  const validContact = validateContactForm({
    fullName: 'Arthur Pendelton',
    email: 'apendelton@university.edu',
    institution: 'Northbridge University',
    actorRole: 'Academic Administrator',
    topic: 'Policy Governance Architecture',
    message: 'We are evaluating structured policy routing across four graduate schools.',
  });
  assert.equal(validContact.isValid, true);
});

test('validateCreateRequestForm enforces required fields and policy acknowledgment', () => {
  const invalidReq = validateCreateRequestForm({
    subject: 'Hi',
    category: '',
    departmentTarget: '',
    urgencyLevel: '',
    courseOrPolicyCode: '',
    description: 'Short text',
    policyAcknowledged: false,
  });
  assert.equal(invalidReq.isValid, false);
  assert.ok(invalidReq.errors.subject);
  assert.ok(invalidReq.errors.category);
  assert.ok(invalidReq.errors.description);
  assert.ok(invalidReq.errors.policyAcknowledged);

  const validReq = validateCreateRequestForm({
    subject: 'Academic Registration Inquiry for Current Term',
    category: 'Academic Enrollment & Registration Inquiry',
    departmentTarget: 'Academic Support Unit',
    urgencyLevel: 'Standard Priority',
    courseOrPolicyCode: 'Optional Reference',
    description:
      'Requesting routing and policy-grounded guidance regarding course registration options for the upcoming term.',
    policyAcknowledged: true,
  });
  assert.equal(validReq.isValid, true);
});

test('RBAC strictly separates permissions across all 5 institutional actors', () => {
  // Learner permissions
  assert.equal(
    canActorPerformAction(ActorRole.Learner, AuthorizedAction.SubmitAcademicPetition),
    true
  );
  assert.equal(
    canActorPerformAction(ActorRole.Learner, AuthorizedAction.ApprovePolicyEscalation),
    false
  );
  assert.equal(
    canActorPerformAction(ActorRole.Learner, AuthorizedAction.ConfigurePlatformGovernance),
    false
  );

  // Instructor permissions
  assert.equal(
    canActorPerformAction(
      ActorRole.Instructor,
      AuthorizedAction.SubmitFacultyCourseRequest
    ),
    true
  );
  assert.equal(
    canActorPerformAction(
      ActorRole.Instructor,
      AuthorizedAction.ConfigurePlatformGovernance
    ),
    false
  );

  // Academic Administrator permissions
  assert.equal(
    canActorPerformAction(
      ActorRole.AcademicAdministrator,
      AuthorizedAction.ApprovePolicyEscalation
    ),
    true
  );
  assert.equal(
    canActorPerformAction(
      ActorRole.AcademicAdministrator,
      AuthorizedAction.ConfigurePlatformGovernance
    ),
    false
  );

  // Support Staff permissions
  assert.equal(
    canActorPerformAction(ActorRole.SupportStaff, AuthorizedAction.TriageSupportQueue),
    true
  );
  assert.equal(
    canActorPerformAction(
      ActorRole.SupportStaff,
      AuthorizedAction.ApprovePolicyEscalation
    ),
    false
  );

  // Platform Administrator permissions
  assert.equal(
    canActorPerformAction(
      ActorRole.PlatformAdministrator,
      AuthorizedAction.ConfigurePlatformGovernance
    ),
    true
  );
  assert.equal(
    canActorPerformAction(
      ActorRole.PlatformAdministrator,
      AuthorizedAction.ApprovePolicyEscalation
    ),
    false
  );

  // Verify all 9 workspace sections are returned with actor-scoped descriptions
  for (const role of Object.values(ActorRole)) {
    const navItems = getAuthorizedNavItems(role);
    assert.equal(navItems.length, 9);
    assert.equal(navItems[0].id, WorkspaceSection.Dashboard);
    const categories = getActorCategories(role);
    assert.ok(categories.length >= 4);
    const meta = getActorMetadata(role);
    assert.ok(meta.label.length > 0);
  }
});

test('validateProfileForm checks display name, email, and department unit', () => {
  const invalid = validateProfileForm({
    displayName: 'A',
    institutionalEmail: 'invalid',
    departmentUnit: '',
    officeOrCohort: '',
  });
  assert.equal(invalid.isValid, false);

  const valid = validateProfileForm({
    displayName: 'Prof. Julian Vance',
    institutionalEmail: 'jvance@university.edu',
    departmentUnit: 'School of Public Policy',
    officeOrCohort: 'Hall 304',
  });
  assert.equal(valid.isValid, true);
});
