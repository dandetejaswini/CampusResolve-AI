import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { InputField } from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../context/AuthContext';

export const ResetPasswordPage: React.FC = () => {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!password || password.length < 8) {
      nextErrors.password = 'Password must contain at least 8 characters.';
    } else if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      nextErrors.password =
        'Password must include at least one uppercase letter and one number.';
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Confirm your new password.';
    } else if (password !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStatusFeedback(null);
      return;
    }

    setSubmitting(true);
    setStatusFeedback(null);
    const result = await updatePassword(password);
    setSubmitting(false);

    if (result.ok) {
      setStatusFeedback({
        type: 'success',
        message: result.message,
      });
      setTimeout(() => {
        navigate('/workspace/dashboard', { replace: true });
      }, 1500);
    } else {
      setStatusFeedback({
        type: 'error',
        message: result.message,
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 flex justify-center">
      <div className="w-full max-w-md rounded-md surface-elevated p-8 md:p-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2 border-b border-[#292A25]/10 pb-5">
          <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Account Security · Password Recovery</span>
          </div>
          <h1 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
            Set a new institutional password
          </h1>
          <p className="text-xs text-[#292A25]/70 leading-relaxed">
            Enter and confirm a new password for your institutional account.
          </p>
        </div>

        {statusFeedback && (
          <div
            role="alert"
            className={`rounded-md border p-4 flex items-start gap-2.5 text-xs leading-relaxed ${
              statusFeedback.type === 'success'
                ? 'border-[#777B63]/50 bg-[#E8E4DC]/80 text-[#292A25]'
                : 'border-[#8C3A32]/45 bg-[#8C3A32]/10 text-[#292A25]'
            }`}
          >
            {statusFeedback.type === 'success' ? (
              <CheckCircle2
                className="w-4 h-4 text-[#777B63] shrink-0 mt-0.5"
                aria-hidden="true"
              />
            ) : (
              <AlertCircle
                className="w-4 h-4 text-[#8C3A32] shrink-0 mt-0.5"
                aria-hidden="true"
              />
            )}
            <span>{statusFeedback.message}</span>
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
          <InputField
            label="New Password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Enter new password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            helperText="Minimum 8 characters, at least 1 uppercase letter and 1 number."
          />

          <InputField
            label="Confirm New Password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Repeat new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={errors.confirmPassword}
          />

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={submitting}
          >
            {submitting ? 'Updating Password...' : 'Update Password'}
          </Button>
        </form>

        <div className="pt-4 border-t border-[#292A25]/10 flex items-center justify-between text-xs text-[#292A25]/75">
          <span>Return to authentication</span>
          <Link
            to="/sign-in"
            className="font-semibold text-[#777B63] hover:text-[#292A25] transition-colors"
          >
            Back to Sign In →
          </Link>
        </div>
      </div>
    </div>
  );
};
