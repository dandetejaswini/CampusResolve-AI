export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export interface SignInFormInput {
  email: string;
  password: string;
}

export function validateSignInForm(input: SignInFormInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.email || input.email.trim().length === 0) {
    errors.email = 'Institutional email address is required.';
  } else if (!isValidEmail(input.email)) {
    errors.email = 'Enter a valid institutional email address (e.g., name@university.edu).';
  }

  if (!input.password || input.password.length === 0) {
    errors.password = 'Password is required.';
  } else if (input.password.length < 8) {
    errors.password = 'Password must be at least 8 characters long.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface SignUpFormInput {
  fullName: string;
  email: string;
  role: string;
  department: string;
  password: string;
  confirmPassword: string;
  acceptedTerms: boolean;
}

export function validateSignUpForm(input: SignUpFormInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.fullName || input.fullName.trim().length < 2) {
    errors.fullName = 'Full legal or academic name is required (minimum 2 characters).';
  }

  if (!input.email || input.email.trim().length === 0) {
    errors.email = 'Institutional email address is required.';
  } else if (!isValidEmail(input.email)) {
    errors.email = 'Enter a valid institutional email address.';
  }

  if (!input.role || input.role.trim().length === 0) {
    errors.role = 'Select your primary institutional actor role.';
  }

  if (!input.department || input.department.trim().length < 2) {
    errors.department = 'Academic department or administrative unit is required.';
  }

  if (!input.password || input.password.length < 8) {
    errors.password = 'Password must contain at least 8 characters.';
  } else if (!/[A-Z]/.test(input.password) || !/[0-9]/.test(input.password)) {
    errors.password = 'Password must include at least one uppercase letter and one number.';
  }

  if (!input.confirmPassword || input.confirmPassword.length === 0) {
    errors.confirmPassword = 'Confirm your password.';
  } else if (input.password !== input.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (!input.acceptedTerms) {
    errors.acceptedTerms = 'You must acknowledge the institutional governance policy.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface ContactFormInput {
  fullName: string;
  email: string;
  institution: string;
  actorRole: string;
  topic: string;
  message: string;
}

export function validateContactForm(input: ContactFormInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.fullName || input.fullName.trim().length < 2) {
    errors.fullName = 'Please enter your full name.';
  }

  if (!input.email || input.email.trim().length === 0) {
    errors.email = 'Institutional email is required.';
  } else if (!isValidEmail(input.email)) {
    errors.email = 'Enter a valid institutional email address.';
  }

  if (!input.institution || input.institution.trim().length < 2) {
    errors.institution = 'Institution or academic division name is required.';
  }

  if (!input.actorRole || input.actorRole.trim().length === 0) {
    errors.actorRole = 'Please select your institutional role.';
  }

  if (!input.topic || input.topic.trim().length === 0) {
    errors.topic = 'Please select an inquiry topic.';
  }

  if (!input.message || input.message.trim().length < 20) {
    errors.message = 'Please provide at least 20 characters describing your inquiry.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface CreateRequestFormInput {
  subject: string;
  category: string;
  departmentTarget: string;
  urgencyLevel: string;
  courseOrPolicyCode: string;
  description: string;
  policyAcknowledged: boolean;
}

export function validateCreateRequestForm(
  input: CreateRequestFormInput
): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.subject || input.subject.trim().length < 5) {
    errors.subject = 'Request subject must be at least 5 characters.';
  }

  if (!input.category || input.category.trim().length === 0) {
    errors.category = 'Select a policy category for routing classification.';
  }

  if (!input.departmentTarget || input.departmentTarget.trim().length === 0) {
    errors.departmentTarget = 'Select the receiving academic or administrative unit.';
  }

  if (!input.urgencyLevel || input.urgencyLevel.trim().length === 0) {
    errors.urgencyLevel = 'Select an urgency classification.';
  }

  if (!input.description || input.description.trim().length < 25) {
    errors.description =
      'Provide a complete factual summary (minimum 25 characters) for policy evaluation.';
  }

  if (!input.policyAcknowledged) {
    errors.policyAcknowledged =
      'Confirm that the submitted statements align with institutional policy guidelines.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface ProfileFormInput {
  displayName: string;
  institutionalEmail: string;
  departmentUnit: string;
  officeOrCohort: string;
}

export function validateProfileForm(input: ProfileFormInput): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.displayName || input.displayName.trim().length < 2) {
    errors.displayName = 'Display name must be at least 2 characters.';
  }

  if (!input.institutionalEmail || !isValidEmail(input.institutionalEmail)) {
    errors.institutionalEmail = 'Valid institutional email is required.';
  }

  if (!input.departmentUnit || input.departmentUnit.trim().length < 2) {
    errors.departmentUnit = 'Department or academic unit is required.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
