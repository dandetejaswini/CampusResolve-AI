import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileSearch,
  Send,
  FileEdit,
  Archive,
} from 'lucide-react';
import { RequestStatus } from '../../types/domain';

export interface StatusIndicatorProps {
  status: RequestStatus;
  showCode?: boolean;
}

const statusConfig: Record<
  RequestStatus,
  {
    label: string;
    proposedInternalId: string;
    textClass: string;
    icon: React.FC<{ className?: string }>;
  }
> = {
  [RequestStatus.Draft]: {
    label: 'Draft Unsubmitted',
    proposedInternalId: 'STG-01',
    textClass: 'text-[#292A25]/70',
    icon: FileEdit,
  },
  [RequestStatus.Submitted]: {
    label: 'Submitted · Intake Queue',
    proposedInternalId: 'STG-02',
    textClass: 'text-[#777B63]',
    icon: Send,
  },
  [RequestStatus.UnderReview]: {
    label: 'Under Departmental Review',
    proposedInternalId: 'STG-03',
    textClass: 'text-[#292A25]',
    icon: Clock,
  },
  [RequestStatus.PolicyVerified]: {
    label: 'Policy Context Attached',
    proposedInternalId: 'STG-04',
    textClass: 'text-[#777B63]',
    icon: FileSearch,
  },
  [RequestStatus.Escalated]: {
    label: 'Escalated · Admin Review',
    proposedInternalId: 'STG-05',
    textClass: 'text-[#7A3B32]',
    icon: AlertTriangle,
  },
  [RequestStatus.Resolved]: {
    label: 'Resolved · Determination Recorded',
    proposedInternalId: 'STG-06',
    textClass: 'text-[#4A5D46]',
    icon: CheckCircle2,
  },
  [RequestStatus.Closed]: {
    label: 'Closed & Archived',
    proposedInternalId: 'STG-07',
    textClass: 'text-[#292A25]/60',
    icon: Archive,
  },
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  showCode = false,
}) => {
  const cfg = statusConfig[status] || statusConfig[RequestStatus.Draft];
  const Icon = cfg.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors duration-200 ${cfg.textClass}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{cfg.label}</span>
      {showCode && (
        <>
          <span aria-hidden="true" className="text-[#292A25]/35">
            ·
          </span>
          <span className="font-mono-tabular text-[11px] text-[#292A25]/60">
            {cfg.proposedInternalId}
          </span>
        </>
      )}
    </span>
  );
};
