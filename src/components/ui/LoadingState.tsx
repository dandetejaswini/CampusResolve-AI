import React from 'react';

export interface LoadingStateProps {
  label?: string;
  rows?: number;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  label = 'Loading workspace records...',
  rows = 4,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="w-full rounded-md border border-[#292A25]/12 bg-[#F8F7F3] p-6 md:p-8 flex flex-col gap-5 shadow-2xs"
    >
      <div className="flex items-center justify-between border-b border-[#292A25]/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-[#777B63] border-t-transparent animate-spin" />
          <span className="text-xs font-medium text-[#777B63]">{label}</span>
        </div>
        <span className="font-mono-tabular text-xs text-[#292A25]/50">
          LOADING
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, idx) => (
          <div
            key={idx}
            className="h-11 w-full rounded bg-[#E8E4DC]/75 animate-pulse flex items-center justify-between px-4"
          >
            <div className="h-3 w-1/3 rounded bg-[#292A25]/12" />
            <div className="h-3 w-24 rounded bg-[#292A25]/12" />
          </div>
        ))}
      </div>
    </div>
  );
};
