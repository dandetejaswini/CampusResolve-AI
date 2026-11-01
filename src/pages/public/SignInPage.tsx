import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
import { InputField, CheckboxField } from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useAuth } from '../../context/AuthContext';
import {
  SignInFormInput,
  validateSignInForm,
  isValidEmail,
} from '../../utils/validation';

interface LocationState {
  from?: string;
  reason?: string;
}

export const SignInPage: React.FC = () => {
  const {
    status,
    profile,
    signInWithEmail,
    signInWithGoogle,
    requestPasswordReset,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState | null) || null;
  const destinationPath = locationState?.from || '/workspace/dashboard';

  const [formState, setFormState] = useState<SignInFormInput>({
    email: '',
    password: '',
  });
  const [rememberDevice, setRememberDevice] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [authFeedback, setAuthFeedback] = useState<{
    type: 'error' | 'info' | 'verification';
    title: string;
    message: string;
  } | null>(null);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [isSubmittingGoogle, setIsSubmittingGoogle] = useState(false);

  // Forgot password dialog state
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | undefined>();
  const [recoveryNotice, setRecoveryNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [isSendingRecovery, setIsSendingRecovery] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && profile) {
      navigate(destinationPath, { replace: true });
    }
  }, [status, profile, navigate, destinationPath]);

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingEmail || isSubmittingGoogle) return;
    const validation = validateSignInForm(formState);
    setErrors(validation.errors);
    if (!validation.isValid) {
      setAuthFeedback(null);
      return;
    }

    setIsSubmittingEmail(true);
    setAuthFeedback(null);
    try {
      const result = await signInWithEmail(formState.email, formState.password);
      if (result.ok) {
        navigate(destinationPath, { replace: true });
        return;
      }

      setAuthFeedback({
        type: result.requiresEmailVerification ? 'verification' : 'error',
        title: result.requiresEmailVerification
          ? 'Email Verification Required'
          : 'Institutional Sign-In Failed',
        message: result.message,
      });
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  const handleGoogleContinue = async () => {
    if (isSubmittingGoogle || isSubmittingEmail) return;
    setErrors({});
    setAuthFeedback(null);
    setIsSubmittingGoogle(true);
    try {
      const result = await signInWithGoogle();
      if (result.ok) {
        navigate(destinationPath, { replace: true });
        return;
      }

      setAuthFeedback({
        type: 'error',
        title: 'Google Authentication Notice',
        message: result.message,
      });
    } finally {
      setIsSubmittingGoogle(false);
    }
  };

  const handleConfirmForgotPassword = async () => {
    if (isSendingRecovery) return;
    if (!recoveryEmail.trim() || !isValidEmail(recoveryEmail)) {
      setRecoveryError(
        'Enter a valid institutional email address for password reset.'
      );
      return;
    }
    setRecoveryError(undefined);
    setIsSendingRecovery(true);
    try {
      const result = await requestPasswordReset(recoveryEmail);
      setRecoveryNotice({
        ok: result.ok,
        message: result.message,
      });
    } finally {
      setIsSendingRecovery(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 flex justify-center">
      <div className="w-full max-w-md rounded-md surface-elevated p-8 md:p-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2 border-b border-[#292A25]/10 pb-5">
          <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Institutional Authentication · Single Sign-On & Email</span>
          </div>
          <h1 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
            Sign in to CampusResolve AI
          </h1>
          <p className="text-xs text-[#292A25]/70 leading-relaxed">
            Sign in with your verified institutional email and password or
            continue with your Google account.
          </p>
        </div>

        {locationState?.reason === 'protected_workspace' && !authFeedback && (
          <div
            role="status"
            className="rounded-md border border-[#777B63]/45 bg-[#E8E4DC]/75 p-4 flex items-start gap-2.5"
          >
            <Lock
              className="w-4 h-4 text-[#777B63] shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#292A25]">
                Authentication Required
              </span>
              <p className="text-xs text-[#292A25]/80 leading-relaxed">
                Please sign in with an authenticated institutional account to
                access your workspace.
              </p>
            </div>
          </div>
        )}

        {authFeedback && (
          <div
            role="alert"
            className={`rounded-md border p-4 flex flex-col gap-2 ${
              authFeedback.type === 'verification'
                ? 'border-[#777B63]/55 bg-[#E8E4DC]/80'
                : 'border-[#8C3A32]/45 bg-[#8C3A32]/10'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-[#292A25]">
              {authFeedback.type === 'verification' ? (
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
              <span>{authFeedback.title}</span>
            </div>
            <p className="text-xs text-[#292A25]/85 leading-relaxed">
              {authFeedback.message}
            </p>
          </div>
        )}

        {/* Continue with Google Button (Firebase Auth -> Supabase Third-Party Auth) */}
        <Button
          type="button"
          variant="outline"
          fullWidth
          disabled={isSubmittingGoogle || isSubmittingEmail}
          onClick={handleGoogleContinue}
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
            or sign in with email
          </span>
          <div className="border-t border-[#292A25]/12 w-full" />
        </div>

        <form
          noValidate
          onSubmit={handleSignInSubmit}
          className="flex flex-col gap-5"
        >
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

          <div className="flex flex-col gap-1.5">
            <InputField
              label="Password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              value={formState.password}
              onChange={(e) =>
                setFormState({ ...formState, password: e.target.value })
              }
              error={errors.password}
              helperText="Minimum 8 characters required."
            />

            <div className="flex items-center justify-between pt-1">
              <CheckboxField
                label="Remember this device"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
              />
              <button
                type="button"
                onClick={() => {
                  setRecoveryNotice(null);
                  setRecoveryError(undefined);
                  setRecoveryEmail(formState.email);
                  setForgotModalOpen(true);
                }}
                className="text-xs font-medium text-[#777B63] hover:text-[#292A25] underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                Forgot password?
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={isSubmittingEmail || isSubmittingGoogle}
          >
            {isSubmittingEmail ? 'Signing In...' : 'Sign In'}
          </Button>
        </form>

        <div className="pt-4 border-t border-[#292A25]/10 flex items-center justify-between text-xs text-[#292A25]/75">
          <span>Need an account?</span>
          <Link
            to="/sign-up"
            className="font-semibold text-[#777B63] hover:text-[#292A25] transition-colors"
          >
            Go to Sign Up →
          </Link>
        </div>
      </div>

      {/* Accessible Forgot Password Recovery Dialog */}
      <ConfirmationDialog
        isOpen={forgotModalOpen}
        title="Reset Institutional Password"
        description="Enter your institutional email address to receive a password recovery link."
        confirmLabel={
          isSendingRecovery ? 'Sending Recovery Link...' : 'Send Recovery Link'
        }
        cancelLabel="Close"
        onConfirm={handleConfirmForgotPassword}
        onCancel={() => setForgotModalOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <InputField
            label="Institutional Email Address"
            type="email"
            required
            placeholder="name@university.edu"
            value={recoveryEmail}
            onChange={(e) => setRecoveryEmail(e.target.value)}
            error={recoveryError}
          />
          {recoveryNotice && (
            <p
              role="status"
              className={`text-xs p-3 rounded border leading-relaxed ${
                recoveryNotice.ok
                  ? 'text-[#292A25] bg-[#E8E4DC]/75 border-[#292A25]/12'
                  : 'text-[#292A25] bg-[#8C3A32]/10 border-[#8C3A32]/40'
              }`}
            >
              {recoveryNotice.message}
            </p>
          )}
        </div>
      </ConfirmationDialog>
    </div>
  );
};
