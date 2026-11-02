import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, FilePlus2, BookOpenCheck, Library, RefreshCw } from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import {
  AuthorizedAction,
  RequestStatus,
  ViewDataState,
} from '../../types/domain';
import {
  canActorPerformAction,
  getActorMetadata,
} from '../../utils/rbac';
import { OFFICIAL_CATEGORIES, DOCUMENTED_ROUTING_RULES } from '../../services/workflowEngine';
import { Table, TableColumn } from '../../components/ui/Table';
import { StatusIndicator } from '../../components/ui/StatusIndicator';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';

interface RequestSchemaRow {
  requestId: string;
  subject: string;
  category: string;
  assignedTeam: string;
  policyRef: string;
  slaStatusLabel: string;
  slaStatusTone: 'normal' | 'warning' | 'danger';
  slaTimingDetail: string;
  escalationDetail: string | null;
  stage: RequestStatus;
  updatedAt: string;
}

const SCHEMA_COLUMNS: TableColumn<RequestSchemaRow>[] = [
  {
    key: 'requestId',
    header: 'Ticket ID',
    mono: true,
    render: (row) => (
      <Link
        to="/workspace/requests"
        className="font-mono font-semibold text-[#292A25] underline hover:text-[#777B63]"
      >
        {row.requestId}
      </Link>
    ),
  },
  {
    key: 'subject',
    header: 'Subject, Team & Escalation Context',
    render: (row) => (
      <div className="flex flex-col gap-0.5">
        <Link
          to="/workspace/requests"
          className="font-medium text-[#292A25] hover:text-[#777B63] hover:underline"
        >
          {row.subject}
        </Link>
        <span className="text-[11px] text-[#777B63] font-mono">
          {row.policyRef} · {row.assignedTeam}
        </span>
        {row.escalationDetail && (
          <span className="text-[11px] text-[#8C3A32] font-medium">
            Escalation: {row.escalationDetail}
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    render: (row) => row.category,
  },
  {
    key: 'slaStatusLabel',
    header: 'SLA & Remaining / Overdue',
    render: (row) => (
      <div className="flex flex-col gap-0.5">
        <span
          className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
            row.slaStatusTone === 'danger'
              ? 'bg-[#8C3A32]/15 text-[#8C3A32]'
              : row.slaStatusTone === 'warning'
              ? 'bg-[#A36A2B]/15 text-[#A36A2B]'
              : 'bg-[#777B63]/20 text-[#292A25]'
          }`}
        >
          {row.slaStatusLabel}
        </span>
        <span className="font-mono text-[11px] text-[#292A25]/70">
          {row.slaTimingDetail}
        </span>
      </div>
    ),
  },
  {
    key: 'stage',
    header: 'Lifecycle Stage',
    render: (row) => <StatusIndicator status={row.stage} />,
  },
  {
    key: 'updatedAt',
    header: 'Last Updated',
    align: 'right',
    mono: true,
    render: (row) => row.updatedAt,
  },
];

export const DashboardPage: React.FC = () => {
  const {
    activeRole,
    dataState,
    setDataState,
    workspaceData,
    isLoadingWorkspace,
    refreshWorkspaceData,
  } = useWorkspaceContext();
  const navigate = useNavigate();
  const actorMeta = getActorMetadata(activeRole);
  const [governanceDialogOpen, setGovernanceDialogOpen] = useState(false);

  const canApproveEscalation = canActorPerformAction(
    activeRole,
    AuthorizedAction.ApprovePolicyEscalation
  );
  const canTriageQueue = canActorPerformAction(
    activeRole,
    AuthorizedAction.TriageSupportQueue
  );
  const canConfigureGovernance = canActorPerformAction(
    activeRole,
    AuthorizedAction.ConfigurePlatformGovernance
  );

  const metrics = workspaceData?.metrics || {
    totalAuthorizedTickets: 0,
    activeOpenCount: 0,
    policyVerifiedCount: 0,
    escalatedCount: 0,
    resolvedCount: 0,
    unreadNotificationCount: 0,
    withinSlaCount: 0,
    approachingSlaCount: 0,
    breachedSlaCount: 0,
    unresolvedEscalatedCount: 0,
  };

  const slasByTicketId = new Map(
    (workspaceData?.slas || []).map((s) => [s.ticket_id, s])
  );

  const rows: RequestSchemaRow[] = (workspaceData?.tickets || [])
    .slice(0, 10)
    .map((t) => {
      const sla = slasByTicketId.get(t.ticket_id);
      const isTerminal =
        t.lifecycle_status === RequestStatus.Resolved ||
        t.lifecycle_status === RequestStatus.Closed;
      const breached = Boolean(sla?.breach_status);
      const approaching = Boolean(sla?.is_approaching_deadline && !breached);

      const slaStatusLabel = breached
        ? isTerminal
          ? 'RESOLVED AFTER BREACH'
          : 'SLA BREACHED'
        : approaching
        ? 'APPROACHING DEADLINE'
        : isTerminal
        ? 'RESOLVED WITHIN SLA'
        : 'WITHIN SLA';

      const slaStatusTone: 'normal' | 'warning' | 'danger' = breached
        ? 'danger'
        : approaching
        ? 'warning'
        : 'normal';

      const slaTimingDetail = sla
        ? breached
          ? `Overdue: ${sla.overdue_business_minutes ?? Math.max(0, sla.elapsed_business_minutes - sla.target_business_minutes)}m (${sla.elapsed_business_minutes}m / ${sla.target_business_minutes}m)`
          : isTerminal
          ? `Resolved in ${sla.resolution_business_minutes ?? sla.elapsed_business_minutes}m (target ${sla.target_business_minutes}m)`
          : `Remaining: ${sla.remaining_business_minutes ?? Math.max(0, sla.target_business_minutes - sla.elapsed_business_minutes)}m of ${sla.target_business_minutes}m`
        : 'Configurable SLA pending';

      return {
        requestId: t.ticket_id,
        subject: t.subject,
        category: t.category_name,
        assignedTeam: t.current_assigned_team,
        policyRef: t.referenced_policy_id
          ? `${t.referenced_policy_id} v${t.referenced_policy_version}`
          : 'Pending citation',
        slaStatusLabel,
        slaStatusTone,
        slaTimingDetail,
        escalationDetail:
          t.is_escalated || t.lifecycle_status === RequestStatus.Escalated
            ? t.escalation_reason || 'Routed to escalation review queue'
            : null,
        stage: t.lifecycle_status,
        updatedAt: new Date(t.updated_at).toLocaleString(),
      };
    });

  const metricContainers = [
    {
      label: 'Active Open Requests',
      value: String(metrics.activeOpenCount),
      schemaBinding: 'Active Operational Queue',
      description:
        'Authorized requests currently in submitted, under review, policy verified, or escalated stages.',
    },
    {
      label: 'SLA Compliance & Approaching',
      value: `${metrics.withinSlaCount ?? 0} OK · ${metrics.approachingSlaCount ?? 0} Near · ${metrics.breachedSlaCount ?? 0} Breach`,
      schemaBinding: 'Business-Hour SLA Posture',
      description:
        'Tracks requests within business-hour SLA targets, approaching deadlines (>=75% elapsed), and breached targets.',
    },
    {
      label: canApproveEscalation
        ? 'Escalated Cases Queue'
        : 'Escalation Tracking',
      value: `${metrics.escalatedCount} Total (${metrics.unresolvedEscalatedCount ?? 0} Unresolved)`,
      schemaBinding: 'Administrative Escalation Queue',
      description: canApproveEscalation
        ? 'Escalated cases routed to administrative review committees requiring formal human adjudication.'
        : 'Requests escalated for administrative exception, SLA breach, or appeal adjudication.',
    },
    {
      label: 'Resolved Determinations',
      value: String(metrics.resolvedCount),
      schemaBinding: 'Completed Determinations',
      description:
        'Completed determinations with recorded policy version citations and business-hour resolution metrics.',
    },
  ];

  const effectiveTableState =
    dataState !== ViewDataState.Empty
      ? dataState
      : isLoadingWorkspace && !workspaceData
      ? ViewDataState.Loading
      : ViewDataState.Empty;

  return (
    <div className="flex flex-col gap-8">
      {/* Role-Scoped Header Banner */}
      <section className="rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/55 p-6 md:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col gap-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#777B63]">
            <span>{actorMeta.label} Workspace</span>
            <span aria-hidden="true">·</span>
            <span>
              Requester ID:{' '}
              {workspaceData?.requester?.requester_id ||
                (isLoadingWorkspace ? 'Loading...' : 'Unavailable')}
            </span>
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
            {actorMeta.label} Dashboard
          </h1>
          <p className="text-sm text-[#292A25]/75 leading-relaxed">
            {actorMeta.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Button
            variant="primary"
            leftIcon={<FilePlus2 className="w-4 h-4" />}
            onClick={() => navigate('/workspace/create-request')}
          >
            {actorMeta.createRequestTitle}
          </Button>
          <Button
            variant="outline"
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoadingWorkspace ? 'animate-spin' : ''}`} />}
            disabled={isLoadingWorkspace}
            onClick={() => refreshWorkspaceData()}
          >
            {isLoadingWorkspace ? 'Refreshing...' : 'Refresh Ledger'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setGovernanceDialogOpen(true)}
          >
            Inspect Role Scope
          </Button>
        </div>
      </section>

      {/* Operational Summary Metrics */}
      <section aria-label="Workspace operational metrics">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#292A25] font-sans">
            Operational Summary
          </h2>
          <span className="font-mono-tabular text-xs text-[#292A25]/60">
            RECORDS: {metrics.totalAuthorizedTickets} TOTAL ·{' '}
            {metrics.activeOpenCount} ACTIVE
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {metricContainers.map((slot) => (
            <div
              key={slot.schemaBinding}
              className="rounded-md surface-elevated surface-elevated-interactive p-5 flex flex-col justify-between gap-4 min-w-0"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-xs font-semibold text-[#292A25] leading-snug">
                  {slot.label}
                </span>
                <span className="font-mono-tabular text-[11px] text-[#777B63] truncate">
                  {slot.schemaBinding}
                </span>
              </div>
              <div className="font-mono-tabular text-2xl font-semibold text-[#292A25]">
                {slot.value}
              </div>
              <p className="text-xs text-[#292A25]/65 leading-relaxed border-t border-[#292A25]/10 pt-2.5">
                {slot.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Primary Request Ledger Table */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#292A25] font-sans">
              {actorMeta.requestViewTitle}
            </h2>
            <p className="text-xs text-[#292A25]/65">
              Displays authorized requests, routing assignments, and current SLA status for your institutional role.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#777B63]">
            {rows.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/workspace/requests')}
              >
                Open Full Request Ledger ({metrics.totalAuthorizedTickets})
              </Button>
            )}
          </div>
        </div>

        <Table<RequestSchemaRow>
          caption={actorMeta.requestViewTitle}
          columns={SCHEMA_COLUMNS}
          data={rows}
          getRowKey={(r) => r.requestId}
          dataState={effectiveTableState}
          loadingLabel={`Synchronizing ${actorMeta.label.toLowerCase()} operational records...`}
          onRetryState={() => {
            setDataState(ViewDataState.Empty);
            refreshWorkspaceData();
          }}
          emptyStateProps={{
            title: `No operational requests exist for this account yet`,
            scopeContext: `${actorMeta.label} Operational View`,
            description: `Submit a request to initiate category routing, departmental assignment, SLA tracking, and policy citation verification.`,
            primaryActionLabel: actorMeta.createRequestTitle,
            onPrimaryAction: () => navigate('/workspace/create-request'),
            secondaryActionLabel: 'Open AI Policy Assistant',
            onSecondaryAction: () => navigate('/workspace/assistant'),
          }}
        />
      </section>

      {/* Categories & Lifecycle Stage Indicators */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-md surface-elevated p-6 flex flex-col justify-between gap-5">
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-medium text-[#777B63]">
              Institutional Request Categories & Routing Rules
            </div>
            <h3 className="text-base font-semibold text-[#292A25]">
              Supported Request Categories & Responsible Teams
            </h3>
            <p className="text-xs text-[#292A25]/70 leading-relaxed">
              Every request is classified into one of the four supported
              categories and routed according to documented team responsibility
              rules.
            </p>
          </div>

          <ul className="divide-y divide-[#292A25]/10 border-t border-b border-[#292A25]/10">
            {OFFICIAL_CATEGORIES.map((cat, index) => {
              const rule = DOCUMENTED_ROUTING_RULES[cat];
              return (
                <li
                  key={cat}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-[#292A25]/85"
                >
                  <span className="font-semibold">
                    <span className="font-mono-tabular text-[#777B63] mr-2">
                      0{index + 1}.
                    </span>
                    {cat}{' '}
                    <span className="font-mono text-[11px] text-[#777B63] font-normal">
                      ({rule.rule_id})
                    </span>
                  </span>
                  <span className="text-[#292A25]/65">
                    {rule.primary_assigned_team}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<BookOpenCheck className="w-3.5 h-3.5" />}
              onClick={() => navigate('/workspace/assistant')}
            >
              Open Policy Assistant
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Library className="w-3.5 h-3.5" />}
              onClick={() => navigate('/workspace/knowledge-base')}
            >
              Browse Knowledge Base (
              {workspaceData?.knowledgeBase?.policies.length || 12} Policies ·{' '}
              {workspaceData?.knowledgeBase?.totalArticlesCount || 200} Articles)
            </Button>
            {(canApproveEscalation ||
              canTriageQueue ||
              canConfigureGovernance) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate('/workspace/settings')}
              >
                Governance & Quality Assurance
              </Button>
            )}
          </div>
        </div>

        {/* Lifecycle Stage Indicators */}
        <div className="lg:col-span-5 rounded-md surface-elevated p-6 flex flex-col justify-between gap-5">
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-medium text-[#777B63]">
              Request Lifecycle Progression
            </div>
            <h3 className="text-base font-semibold text-[#292A25]">
              Resolution & Escalation Stage Indicators
            </h3>
            <p className="text-xs text-[#292A25]/70 leading-relaxed">
              Every state transition is recorded as a permanent lifecycle audit
              entry with previous state, new state, responsible actor,
              timestamp, and policy citation.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 border-t border-[#292A25]/10 pt-4">
            {Object.values(RequestStatus).map((st) => (
              <div
                key={st}
                className="flex items-center justify-between py-1 border-b border-[#292A25]/8 last:border-b-0"
              >
                <StatusIndicator status={st} showCode />
              </div>
            ))}
          </div>
        </div>
      </section>

      <ConfirmationDialog
        isOpen={governanceDialogOpen}
        title={`${actorMeta.label} — Role & Authorization Scope`}
        description={`${actorMeta.institutionalScope}. All workspace actions are verified against your authenticated institutional identity and assigned role.`}
        confirmLabel="Acknowledge Scope"
        cancelLabel="Close"
        onConfirm={() => setGovernanceDialogOpen(false)}
        onCancel={() => setGovernanceDialogOpen(false)}
      >
        <div className="rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/55 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#292A25]">
            <Shield className="w-3.5 h-3.5 text-[#777B63]" aria-hidden="true" />
            <span>Role Governance Notes for {actorMeta.label}:</span>
          </div>
          <ul className="flex flex-col gap-1.5 text-xs text-[#292A25]/80 pl-5 list-disc">
            {actorMeta.restrictedCapabilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </ConfirmationDialog>
    </div>
  );
};
