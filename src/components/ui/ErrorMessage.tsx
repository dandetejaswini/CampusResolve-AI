import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './Button';

export interface ErrorMessageProps {
  title: string;
  message: string;
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title,
  message,
  code,
  onRetry,
  retryLabel = 'Return to Empty State',
  onDismiss,
}) => {
  return (
    <div
      role="alert"
      className="w-full rounded-md border border-[#7A3B32]/35 bg-[#7A3B32]/[0.05] p-6 flex flex-col md:flex-row md:items-center justify-between gap-5 transition-all duration-200"
    >
      <div className="flex items-start gap-3.5">
        <div className="w-9 h-9 rounded-md bg-[#7A3B32]/12 text-[#7A3B32] flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[#292A25]">{title}</h4>
            {code && (
              <>
                <span aria-hidden="true" className="text-xs text-[#292A25]/40">
                  ·
                </span>
                <span className="font-mono-tabular text-xs text-[#7A3B32]">
                  {code}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-[#292A25]/75 leading-relaxed max-w-2xl">
            {message}
          </p>
        </div>
      </div>

      {(onRetry || onDismiss) && (
        <div className="flex items-center gap-2.5 shrink-0">
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={onRetry}
            >
              {retryLabel}
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
