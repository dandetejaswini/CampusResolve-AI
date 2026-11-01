import React from 'react';
import { Inbox } from 'lucide-react';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  scopeContext?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  scopeContext,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => {
  return (
    <div
      role="region"
      aria-label={title}
      className="w-full rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/45 p-8 md:p-10 flex flex-col items-start justify-between gap-6 transition-all duration-200"
    >
      <div className="flex flex-col gap-3 max-w-2xl">
        <div className="flex items-center gap-3 text-xs text-[#777B63] font-medium">
          <div className="w-9 h-9 rounded-md bg-[#F8F7F3] border border-[#292A25]/12 shadow-2xs flex items-center justify-center text-[#777B63] shrink-0">
            {icon || <Inbox className="w-4 h-4" aria-hidden="true" />}
          </div>
          {scopeContext && (
            <div className="flex items-center gap-2 text-xs text-[#292A25]/65">
              <span>Zero Active Records</span>
              <span aria-hidden="true">·</span>
              <span>{scopeContext}</span>
            </div>
          )}
        </div>

        <h3 className="text-lg font-semibold text-[#292A25] tracking-tight mt-1">
          {title}
        </h3>
        <p className="text-sm text-[#292A25]/75 leading-relaxed">
          {description}
        </p>
      </div>

      {(primaryActionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {primaryActionLabel && onPrimaryAction && (
            <Button variant="primary" size="md" onClick={onPrimaryAction}>
              {primaryActionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="outline" size="md" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
