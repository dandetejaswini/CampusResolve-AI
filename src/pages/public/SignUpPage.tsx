import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, ShieldAlert, CheckCircle2 } from 'lucide-react';
import {
  InputField,
  SelectField,
  CheckboxField,
} from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { ActorRole } from '../../types/domain';
import { ACTOR_METADATA } from '../../utils/rbac';
import { useAuth } from '../../context/AuthContext';
import { SignUpFormInput, validateSignUpForm } from '../../utils/validation';

const ROLE_OPTIONS = Object.values(ActorRole).map((role) => ({
  value: role,
  label: `${ACTOR_METADATA[role].label} — ${ACTOR_METADATA[role].primaryResponsibility}`,
}));

export const SignUpPage: React.FC = () => {
  const { status, profile, signUpWithEmail, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [formState, setFormState] = useState<SignUpFormInput>({
    fullName: '',
    email: '',
    role: ActorRole.Learner,
    department: '',
    password: '',
    confirmPassword: '',
    acceptedTerms: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{
    type: 'verification' | 'error';
    title: string;
    message: string;
  } | null>(null);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [isSubmittingGoogle, setIsSubmittingGoogle] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && profile) {
      navigate('/workspace/dashboard', { replace: true });
    }
  }, [status, profile, navigate]);

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingEmail || isSubmittingGoogle) return;
    const validation = validateSignUpForm(formState);
    setErrors(validation.errors);
    if (!validation.isValid) {
      setFeedback(null);
      return;
    }

    setIsSubmittingEmail(true);
    setFeedback(null);
    try {
      const result = await signUpWithEmail({
        fullName: formState.fullName,
        email: formState.email,
        password: formState.password,
        department: formState.department,
        requestedRole: formState.role,
      });

      if (result.ok && !result.requiresEmailVerification) {
        navigate('/workspace/dashboard', { replace: true });
        return;
      }

      if (result.ok && result.requiresEmailVerification) {
        setFeedback({
          type: 'verification',
          title: 'Verify Your Institutional Email',
          message: result.message,
        });
        return;
      }

      setFeedback({
        type: 'error',
        title: 'Registration Could Not Be Completed',
        message: result.message,
      });
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (isSubmittingGoogle || isSubmittingEmail) return;
    setErrors({});
    setFeedback(null);
    setIsSubmittingGoogle(true);
    try {
      const result = await signInWithGoogle();
      if (result.ok) {
        navigate('/workspace/dashboard', { replace: true });
        return;
      }

      setFeedback({
        type: 'error',
        title: 'Google Registration Notice',
        message: result.message,
      });
    } finally {
      setIsSubmittingGoogle(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 flex justify-center">
      <div className="w-full max-w-xl rounded-md surface-elevated p-8 md:p-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2 border-b border-[#292A25]/10 pb-5">
          <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Institutional Account Registration</span>
          </div>
          <h1 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
            Create your CampusResolve AI account
          </h1>
          <p className="text-xs text-[#292A25]/70 leading-relaxed">
            Register with your institutional email address or continue with
            Google. New accounts are provisioned with standard{' '}
            <strong>Learner</strong> access by default; requests for faculty,
            support, or administrative roles are recorded for institutional
            verification.
          </p>
        </div>

        {feedback && (
          <div
            role="alert"
            className={`rounded-md border p-4 flex flex-col gap-2.5 ${
              feedback.type === 'verification'
                ? 'border-[#777B63]/55 bg-[#E8E4DC]/80'
                : 'border-[#8C3A32]/45 bg-[#8C3A32]/10'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-[#292A25]">
              {feedback.type === 'verification' ? (
                <CheckCircle2
                  className="w-4 h-4 text-[#777B63] shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <ShieldAlert
                  className="w-4 h-4 text-[#8C3A32] shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>{feedback.title}</span>
            </div>
            <p className="text-xs text-[#292A25]/85 leading-relaxed">
              {feedback.message}
            </p>
            {feedback.type === 'verification' && (
              <Link
                to="/sign-in"
                className="text-xs font-semibold text-[#777B63] hover:text-[#292A25] underline underline-offset-4 w-fit"
              >
                Proceed to Sign In once verified →
              </Link>
            )}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          fullWidth
          disabled={isSubmittingGoogle || isSubmittingEmail}
          onClick={handleGoogleSignUp}
          leftIcon={
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 15.65 5 12c0-3.65 3.36-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
              />
            </svg>
          }
        >
          {isSubmittingGoogle
            ? 'Connecting to Google...'
            : 'Continue with Google'}
        </Button>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-[#292A25]/12 w-full" />
          <span className="bg-[#F8F7F3] px-3 text-xs text-[#292A25]/55 whitespace-nowrap">
            or register with institutional email
          </span>
          <div className="border-t border-[#292A25]/12 w-full" />
        </div>

        <form
          noValidate
          onSubmit={handleSignUpSubmit}
          className="flex flex-col gap-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <InputField
              label="Full Name"
              required
              autoComplete="name"
              placeholder="Enter full name"
              value={formState.fullName}
              onChange={(e) =>
                setFormState({ ...formState, fullName: e.target.value })
              }
              error={errors.fullName}
            />

            <InputField
              label="Institutional Email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@university.edu"
              value={formState.email}
              onChange={(e) =>
                setFormState({ ...formState, email: e.target.value })
              }
              error={errors.email}
            />
          </div>

          <SelectField
            label="Requested Institutional Role (Recorded for Review)"
            required
            placeholder="Select actor role..."
            options={ROLE_OPTIONS}
            value={formState.role}
            onChange={(e) =>
              setFormState({ ...formState, role: e.target.value })
            }
            error={errors.role}
            helperText="New accounts begin with standard Learner access. Selecting an instructor, staff, or administrator role records your role request for institutional review."
          />

          <InputField
            label="Academic Department or Administrative Unit"
            required
            placeholder="Enter department or unit"
            value={formState.department}
            onChange={(e) =>
              setFormState({ ...formState, department: e.target.value })
            }
            error={errors.department}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <InputField
              label="Password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Create password"
              value={formState.password}
              onChange={(e) =>
                setFormState({ ...formState, password: e.target.value })
              }
              error={errors.password}
              helperText="8+ chars, 1 uppercase, 1 number."
            />

            <InputField
              label="Confirm Password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Repeat password"
              value={formState.confirmPassword}
              onChange={(e) =>
                setFormState({ ...formState, confirmPassword: e.target.value })
              }
              error={errors.confirmPassword}
            />
          </div>

          <CheckboxField
            label="I acknowledge that requests and responses are routed according to institutional governance guidelines."
            checked={formState.acceptedTerms}
            onChange={(e) =>
              setFormState({ ...formState, acceptedTerms: e.target.checked })
            }
            error={errors.acceptedTerms}
          />

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={isSubmittingEmail || isSubmittingGoogle}
          >
            {isSubmittingEmail ? 'Creating Account...' : 'Create Account'}
          </Button>
        </form>

        <div className="pt-4 border-t border-[#292A25]/10 flex items-center justify-between text-xs text-[#292A25]/75">
          <span>Already have an account?</span>
          <Link
            to="/sign-in"
            className="font-semibold text-[#777B63] hover:text-[#292A25] transition-colors"
          >
            Go to Sign In →
          </Link>
        </div>
      </div>
    </div>
  );
};
