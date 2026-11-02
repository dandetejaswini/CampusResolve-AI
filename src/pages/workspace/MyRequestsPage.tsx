import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FilePlus2,
  Search,
  Clock,
  CheckCircle2,
  MessageSquare,
  GitCommit,
  Star,
  AlertTriangle,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { useAuth } from '../../context/AuthContext';
import {
  AuthorizedAction,
  RequestStatus,
  ViewDataState,
} from '../../types/domain';
import { canActorPerformAction, getActorMetadata } from '../../utils/rbac';
import {
  DOCUMENTED_ASSIGNMENT_TEAMS,
  OFFICIAL_CATEGORIES,
  evaluateReassignmentAuthorization,
  getPermittedNextLifecycleStatesForActor,
} from '../../services/workflowEngine';
import {
  evaluateTicketSlaAndEscalation,
  reassignOperationalTicket,
  submitTicketFeedback,
  transitionOperationalTicket,
} from '../../services/workspaceClient';
import { Table, TableColumn } from '../../components/ui/Table';
import { StatusIndicator } from '../../components/ui/StatusIndicator';
import {
  InputField,
  SelectField,
  TextAreaField,
  CheckboxField,
} from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';

interface LedgerRow {
  id: string;
  title: string;
  category: string;
  department: string;
  policyCitation: string;
  slaLabel: string;
  slaTone: 'normal' | 'warning' | 'danger';
  slaSubtext: string;
  status: RequestStatus;
  submittedAt: string;
}

export const MyRequestsPage: React.FC = () => {
  const {
    activeRole,
    dataState,
    setDataState,
    workspaceData,
    setWorkspaceData,
    isLoadingWorkspace,
    refreshWorkspaceData,
  } = useWorkspaceContext();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const actorMeta = getActorMetadata(activeRole);

  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [slaFilter, setSlaFilter] = useState('all');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Lifecycle transition form state
  const [targetState, setTargetState] = useState<RequestStatus | ''>('');
  const [transitionReason, setTransitionReason] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isEvaluatingSla, setIsEvaluatingSla] = useState(false);
  const [actionBanner, setActionBanner] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Reassignment form state (Phase 5 Section 4)
  const [reassignTargetTeam, setReassignTargetTeam] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');
  const [isReassigning, setIsReassigning] = useState(false);

  // Resolution feedback form state
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [clarityScore, setClarityScore] = useState<number>(5);
  const [wasHelpful, setWasHelpful] = useState<boolean>(true);
  const [resolutionAccepted, setResolutionAccepted] = useState<boolean>(true);
  const [feedbackComments, setFeedbackComments] = useState<string>('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  useEffect(() => {
    if (!selectedTicketId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTicketId(null);
        setActionBanner(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTicketId]);

  const canAdjudicateEscalation = canActorPerformAction(
    activeRole,
    AuthorizedAction.ApprovePolicyEscalation
  );
  const canTriage = canActorPerformAction(
    activeRole,
    AuthorizedAction.TriageSupportQueue
  );
  const canReassign = evaluateReassignmentAuthorization(activeRole).authorized;

  const tickets = workspaceData?.tickets || [];
  const slasByTicketId = new Map(
    (workspaceData?.slas || []).map((s) => [s.ticket_id, s])
  );

  const filteredTickets = tickets.filter((t) => {
    const sla = slasByTicketId.get(t.ticket_id);
    const matchesStage =
      stageFilter === 'all' || t.lifecycle_status === stageFilter;
    const matchesCategory =
      categoryFilter === 'all' || t.category_name === categoryFilter;

    let matchesSla = true;
    if (slaFilter === 'within_sla') {
      matchesSla = Boolean(
        sla && !sla.breach_status && !sla.is_approaching_deadline
      );
    } else if (slaFilter === 'approaching_deadline') {
      matchesSla = Boolean(
        sla && sla.is_approaching_deadline && !sla.breach_status
      );
    } else if (slaFilter === 'breached') {
      matchesSla = Boolean(sla?.breach_status);
    } else if (slaFilter === 'escalated_unresolved') {
      matchesSla =
        (t.lifecycle_status === RequestStatus.Escalated || t.is_escalated) &&
        t.lifecycle_status !== RequestStatus.Resolved &&
        t.lifecycle_status !== RequestStatus.Closed;
    }

    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      `${t.ticket_id} ${t.subject} ${t.category_name} ${t.current_assigned_team} ${t.referenced_policy_id || ''} ${t.referenced_article_id || ''} ${t.escalation_reason || ''}`
        .toLowerCase()
        .includes(q);
    return matchesStage && matchesCategory && matchesSla && matchesQuery;
  });

  const rows: LedgerRow[] = filteredTickets.map((t) => {
    const sla = slasByTicketId.get(t.ticket_id);
    const isTerminal =
      t.lifecycle_status === RequestStatus.Resolved ||
      t.lifecycle_status === RequestStatus.Closed;
    const breached = Boolean(sla?.breach_status);
    const approaching = Boolean(sla?.is_approaching_deadline && !breached);

    const slaLabel = breached
      ? isTerminal
        ? 'RESOLVED AFTER BREACH'
        : 'BREACHED'
      : approaching
      ? 'APPROACHING'
      : isTerminal
      ? 'RESOLVED IN SLA'
      : 'WITHIN SLA';

    const slaTone: 'normal' | 'warning' | 'danger' = breached
      ? 'danger'
      : approaching
      ? 'warning'
      : 'normal';

    const slaSubtext = sla
      ? breached
        ? `+${sla.overdue_business_minutes ?? Math.max(0, sla.elapsed_business_minutes - sla.target_business_minutes)}m overdue`
        : isTerminal
        ? `${sla.resolution_business_minutes ?? sla.elapsed_business_minutes}m / ${sla.target_business_minutes}m`
        : `${sla.remaining_business_minutes ?? Math.max(0, sla.target_business_minutes - sla.elapsed_business_minutes)}m left`
      : 'N/A';

    return {
      id: t.ticket_id,
      title: t.subject,
      category: t.category_name,
      department: t.current_assigned_team,
      policyCitation: t.referenced_policy_id
        ? `${t.referenced_policy_id} v${t.referenced_policy_version}`
        : 'None',
      slaLabel,
      slaTone,
      slaSubtext,
      status: t.lifecycle_status,
      submittedAt: new Date(t.submitted_at).toLocaleString(),
    };
  });

  const activeTicket = selectedTicketId
    ? tickets.find((t) => t.ticket_id === selectedTicketId) || null
    : null;

  const isActiveTicketOwner = Boolean(
    activeTicket &&
      workspaceData?.requester &&
      activeTicket.requester_id === workspaceData.requester.requester_id
  );

  const activeSla = activeTicket
    ? workspaceData?.slas.find((s) => s.ticket_id === activeTicket.ticket_id)
    : null;
  const activeAssignments = activeTicket
    ? (workspaceData?.assignments || []).filter(
        (a) => a.ticket_id === activeTicket.ticket_id
      )
    : [];
  const activeEvents = activeTicket
    ? (workspaceData?.lifecycleEvents || []).filter(
        (e) => e.ticket_id === activeTicket.ticket_id
      )
    : [];
  const activeFeedback = activeTicket
    ? workspaceData?.resolutionFeedbacks.find(
        (f) => f.ticket_id === activeTicket.ticket_id
      )
    : null;

  const allowedNextStates = activeTicket
    ? getPermittedNextLifecycleStatesForActor(
        activeTicket.lifecycle_status,
        activeRole,
        isActiveTicketOwner
      )
    : [];

  const COLUMNS: TableColumn<LedgerRow>[] = [
    {
      key: 'id',
      header: 'Ticket ID',
      mono: true,
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            setSelectedTicketId(r.id);
            setActionBanner(null);
          }}
          className="font-mono font-semibold text-[#292A25] underline hover:text-[#777B63] text-left cursor-pointer"
        >
          {r.id}
        </button>
      ),
    },
    {
      key: 'title',
      header: 'Request Subject',
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            setSelectedTicketId(r.id);
            setActionBanner(null);
          }}
          className="text-left font-medium text-[#292A25] hover:text-[#777B63] hover:underline cursor-pointer block w-full"
        >
          {r.title}
        </button>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (r) => r.category,
    },
    {
      key: 'department',
      header: 'Assigned Team',
      render: (r) => r.department,
    },
    {
      key: 'slaLabel',
      header: 'SLA Posture',
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span
            className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
              r.slaTone === 'danger'
                ? 'bg-[#8C3A32]/15 text-[#8C3A32]'
                : r.slaTone === 'warning'
                ? 'bg-[#A36A2B]/15 text-[#A36A2B]'
                : 'bg-[#777B63]/20 text-[#292A25]'
            }`}
          >
            {r.slaLabel}
          </span>
          <span className="font-mono text-[11px] text-[#292A25]/65">
            {r.slaSubtext}
          </span>
        </div>
      ),
    },
    {
      key: 'policyCitation',
      header: 'Policy & Version',
      mono: true,
      render: (r) => r.policyCitation,
    },
    {
      key: 'status',
      header: 'Lifecycle Stage',
      render: (r) => <StatusIndicator status={r.status} />,
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      align: 'right',
      mono: true,
      render: (r) => r.submittedAt,
    },
  ];

  const handleEvaluateSlaAndEscalation = async () => {
    if (!activeTicket || isEvaluatingSla) return;
    setIsEvaluatingSla(true);
    setActionBanner(null);
    try {
      const res = await evaluateTicketSlaAndEscalation(
        {
          ticketId: activeTicket.ticket_id,
        },
        profile
      );
      if (res && res.ok) {
        setWorkspaceData((prev) => {
          if (!prev) return prev;
          const updatedTickets = prev.tickets.map((t) =>
            t.ticket_id === res.ticket.ticket_id ? res.ticket : t
          );
          const updatedSlas = prev.slas.map((s) =>
            s.ticket_id === res.sla.ticket_id ? res.sla : s
          );
          if (!prev.slas.some((s) => s.ticket_id === res.sla.ticket_id)) {
            updatedSlas.unshift(res.sla);
          }
          const updatedNotifications = res.notification
            ? [res.notification, ...prev.notifications]
            : prev.notifications;
          const updatedEvents = res.lifecycleEvent
            ? [res.lifecycleEvent, ...prev.lifecycleEvents]
            : prev.lifecycleEvents;
          return {
            ...prev,
            tickets: updatedTickets,
            slas: updatedSlas,
            notifications: updatedNotifications,
            lifecycleEvents: updatedEvents,
          };
        });
      }
      refreshWorkspaceData().catch(() => {});
      setActionBanner({
        ok: true,
        message: res.message,
      });
    } catch (err) {
      setActionBanner({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'Failed evaluating SLA and escalation rules.',
      });
    } finally {
      setIsEvaluatingSla(false);
    }
  };

  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTransitioning) return;
    if (!activeTicket || !targetState || transitionReason.trim().length < 5) {
      setActionBanner({
        ok: false,
        message:
          'Select a valid next lifecycle state and provide a reason of at least 5 characters.',
      });
      return;
    }

    setIsTransitioning(true);
    setActionBanner(null);
    try {
      const res = await transitionOperationalTicket(
        {
          ticketId: activeTicket.ticket_id,
          newState: targetState,
          reason: transitionReason.trim(),
          resolutionSummary:
            targetState === RequestStatus.Resolved
              ? transitionReason.trim()
              : undefined,
        },
        profile
      );
      setTransitionReason('');
      setTargetState('');
      if (res && res.ok) {
        setWorkspaceData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tickets: prev.tickets.map((t) =>
              t.ticket_id === res.ticket.ticket_id ? res.ticket : t
            ),
            lifecycleEvents: res.event
              ? [res.event, ...prev.lifecycleEvents]
              : prev.lifecycleEvents,
            messages: res.messageRecord
              ? [...prev.messages, res.messageRecord]
              : prev.messages,
            slas: res.sla
              ? prev.slas.map((s) =>
                  s.ticket_id === res.sla!.ticket_id ? res.sla! : s
                )
              : prev.slas,
          };
        });
      }
      refreshWorkspaceData().catch(() => {});
      setActionBanner({
        ok: true,
        message: `Ticket ${activeTicket.ticket_id} transitioned to '${targetState}' and audit event recorded.`,
      });
    } catch (err) {
      setActionBanner({
        ok: false,
        message:
          err instanceof Error ? err.message : 'Failed to transition ticket.',
      });
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleReassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReassigning) return;
    if (
      !activeTicket ||
      !reassignTargetTeam ||
      reassignReason.trim().length < 5
    ) {
      setActionBanner({
        ok: false,
        message:
          'Select a documented destination team and enter a reassignment reason (min 5 chars).',
      });
      return;
    }

    setIsReassigning(true);
    setActionBanner(null);
    try {
      const res = await reassignOperationalTicket(
        {
          ticketId: activeTicket.ticket_id,
          targetTeam: reassignTargetTeam,
          reason: reassignReason.trim(),
        },
        profile
      );
      setReassignReason('');
      setReassignTargetTeam('');
      if (res && res.ok) {
        setWorkspaceData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tickets: prev.tickets.map((t) =>
              t.ticket_id === res.ticket.ticket_id ? res.ticket : t
            ),
            assignments: res.assignment
              ? [res.assignment, ...prev.assignments]
              : prev.assignments,
            messages: res.messageRecord
              ? [...prev.messages, res.messageRecord]
              : prev.messages,
          };
        });
      }
      refreshWorkspaceData().catch(() => {});
      setActionBanner({
        ok: true,
        message: res.message,
      });
    } catch (err) {
      setActionBanner({
        ok: false,
        message:
          err instanceof Error ? err.message : 'Failed to reassign ticket.',
      });
    } finally {
      setIsReassigning(false);
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || isSubmittingFeedback) return;

    setIsSubmittingFeedback(true);
    setActionBanner(null);
    try {
      const res = await submitTicketFeedback(
        {
          ticketId: activeTicket.ticket_id,
          rating: feedbackRating,
          policyClarityScore: clarityScore,
          wasHelpful,
          resolutionAccepted,
          comments: feedbackComments,
        },
        profile
      );
      if (res && res.ok) {
        setWorkspaceData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            resolutionFeedbacks: [res.feedback, ...prev.resolutionFeedbacks],
          };
        });
      }
      refreshWorkspaceData().catch(() => {});
      setActionBanner({
        ok: true,
        message: res.message,
      });
    } catch (err) {
      setActionBanner({
        ok: false,
        message:
          err instanceof Error ? err.message : 'Failed to submit feedback.',
      });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const effectiveTableState =
    dataState !== ViewDataState.Empty
      ? dataState
      : isLoadingWorkspace && !workspaceData
      ? ViewDataState.Loading
      : ViewDataState.Empty;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#292A25]/10 pb-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
            <span>{actorMeta.label} Operational Queue</span>
            <span aria-hidden="true">·</span>
            <span>
              {canAdjudicateEscalation
                ? 'Escalation Adjudication & Audit View'
                : canTriage
                ? 'Support Triage & Routing View'
                : 'Request Lifecycle & SLA Tracking'}
            </span>
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
            {actorMeta.requestViewTitle}
          </h1>
        </div>

        <Button
          variant="primary"
          leftIcon={<FilePlus2 className="w-4 h-4" />}
          onClick={() => navigate('/workspace/create-request')}
        >
          {actorMeta.createRequestTitle}
        </Button>
      </div>

      {/* Filter & Search Controls */}
      <div className="rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/45 p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        <div className="md:col-span-4">
          <InputField
            label="Search by Ticket ID, Subject, Team, or Policy ID"
            placeholder="e.g., TKT-2026-100001 or POL-FINAID-2026-002"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <SelectField
            label="Category Filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All 4 Categories' },
              ...OFFICIAL_CATEGORIES.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
        <div className="md:col-span-2">
          <SelectField
            label="Lifecycle Stage"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All Stages' },
              { value: RequestStatus.Submitted, label: 'Submitted' },
              { value: RequestStatus.UnderReview, label: 'Under Review' },
              { value: RequestStatus.PolicyVerified, label: 'Policy Verified' },
              { value: RequestStatus.Escalated, label: 'Escalated' },
              { value: RequestStatus.Resolved, label: 'Resolved' },
              { value: RequestStatus.Closed, label: 'Closed' },
            ]}
          />
        </div>
        <div className="md:col-span-2">
          <SelectField
            label="SLA & Escalation"
            value={slaFilter}
            onChange={(e) => setSlaFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All SLA States' },
              { value: 'within_sla', label: 'Within SLA' },
              { value: 'approaching_deadline', label: 'Approaching Deadline' },
              { value: 'breached', label: 'SLA Breached' },
              {
                value: 'escalated_unresolved',
                label: 'Escalated & Unresolved',
              },
            ]}
          />
        </div>
        <div className="md:col-span-2">
          <Button
            variant="outline"
            fullWidth
            leftIcon={<Search className="w-3.5 h-3.5" />}
            onClick={() => {
              setSearchQuery('');
              setStageFilter('all');
              setCategoryFilter('all');
              setSlaFilter('all');
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Authorised Request Queue Table */}
      <Table<LedgerRow>
        caption={actorMeta.requestViewTitle}
        columns={COLUMNS}
        data={rows}
        getRowKey={(r) => r.id}
        dataState={effectiveTableState}
        loadingLabel={`Loading ${actorMeta.requestViewTitle.toLowerCase()}...`}
        onRetryState={() => {
          setDataState(ViewDataState.Empty);
          refreshWorkspaceData();
        }}
        emptyStateProps={{
          title: `No requests found in ${actorMeta.requestViewTitle}`,
          scopeContext: `${actorMeta.label} Operational Queue`,
          description:
            searchQuery ||
            stageFilter !== 'all' ||
            categoryFilter !== 'all' ||
            slaFilter !== 'all'
              ? `No records match your current filter criteria. Clear filters or submit a new request.`
              : `This account currently has no submitted or assigned operational requests. Create a request to initiate category routing, departmental assignment, SLA tracking, and policy citation verification.`,
          primaryActionLabel: actorMeta.createRequestTitle,
          onPrimaryAction: () => navigate('/workspace/create-request'),
          secondaryActionLabel:
            searchQuery ||
            stageFilter !== 'all' ||
            categoryFilter !== 'all' ||
            slaFilter !== 'all'
              ? 'Clear Filters'
              : undefined,
          onSecondaryAction:
            searchQuery ||
            stageFilter !== 'all' ||
            categoryFilter !== 'all' ||
            slaFilter !== 'all'
              ? () => {
                  setSearchQuery('');
                  setStageFilter('all');
                  setCategoryFilter('all');
                  setSlaFilter('all');
                }
              : undefined,
        }}
      />

      {/* Complete Traceability & Lifecycle Management Panel for Selected Ticket in a Window Modal */}
      {activeTicket && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Ticket ${activeTicket.ticket_id}: ${activeTicket.subject}`}
          className="fixed inset-0 z-50 flex items-start justify-center bg-[#292A25]/60 backdrop-blur-xs p-4 sm:p-6 md:p-8 overflow-y-auto pt-6 sm:pt-10 pb-12 animate-page-enter"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTicketId(null);
              setActionBanner(null);
            }
          }}
        >
          <div className="w-full max-w-4xl rounded-xl surface-elevated p-6 md:p-8 flex flex-col gap-6 border border-[#292A25]/20 shadow-2xl bg-[#F8F7F3] my-auto sm:my-0 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-[#292A25]/12 pb-4">
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#777B63]">
                  <span className="font-semibold text-[#292A25]">{activeTicket.ticket_id}</span>
                  <span>·</span>
                  <span>Requester: {activeTicket.requester_id}</span>
                  <span>·</span>
                  <span>Term: {activeTicket.term_id}</span>
                </div>
                <h2 className="font-serif-display text-xl md:text-2xl text-[#292A25] mt-1 break-words">
                  {activeTicket.subject}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <StatusIndicator status={activeTicket.lifecycle_status} showCode />
                {canReassign && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isEvaluatingSla}
                    leftIcon={<Clock className="w-3.5 h-3.5" />}
                    onClick={handleEvaluateSlaAndEscalation}
                  >
                    {isEvaluatingSla
                      ? 'Evaluating SLA...'
                      : 'Evaluate SLA'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<MessageSquare className="w-3.5 h-3.5" />}
                  onClick={() => navigate('/workspace/messages')}
                >
                  Open Thread
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTicketId(null);
                    setActionBanner(null);
                  }}
                  className="p-1.5 rounded-md text-[#292A25]/60 hover:text-[#292A25] hover:bg-[#292A25]/10 transition-colors"
                  aria-label="Close ticket window"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

          {actionBanner && (
            <div
              role="status"
              className={`rounded-md border p-3.5 text-xs ${
                actionBanner.ok
                  ? 'border-[#777B63]/45 bg-[#E8E4DC]/80 text-[#292A25]'
                  : 'border-[#8C3A32]/45 bg-[#8C3A32]/10 text-[#292A25]'
              }`}
            >
              {actionBanner.message}
            </div>
          )}

          {/* Escalation & SLA Alert Banner (shown when ticket is escalated, approaching SLA, or breached) */}
          {(activeTicket.is_escalated ||
            activeTicket.lifecycle_status === RequestStatus.Escalated ||
            activeSla?.breach_status ||
            activeSla?.is_approaching_deadline) && (
            <div
              className={`rounded-md border p-4 flex flex-col gap-1.5 text-xs ${
                activeSla?.breach_status ||
                activeTicket.lifecycle_status === RequestStatus.Escalated
                  ? 'border-[#8C3A32]/40 bg-[#8C3A32]/8 text-[#292A25]'
                  : 'border-[#A36A2B]/40 bg-[#A36A2B]/10 text-[#292A25]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                <span className="flex items-center gap-1.5">
                  {activeSla?.breach_status ||
                  activeTicket.lifecycle_status === RequestStatus.Escalated ? (
                    <ShieldAlert className="w-4 h-4 text-[#8C3A32]" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#A36A2B]" />
                  )}
                  <span>
                    {activeTicket.lifecycle_status === RequestStatus.Escalated
                      ? `Escalated Case (${activeTicket.current_assigned_team}) — Requires Administrative Adjudication`
                      : activeSla?.breach_status
                      ? 'Business-Hour SLA Deadline Breached'
                      : 'Approaching Business-Hour SLA Deadline'}
                  </span>
                </span>
                <span className="font-mono text-[11px] uppercase px-2 py-0.5 rounded bg-[#292A25]/10">
                  Escalation Status: {activeSla?.escalation_status || 'escalated'}
                </span>
              </div>
              <p className="text-[#292A25]/80 leading-relaxed">
                <strong>Traceable Escalation Reason:</strong>{' '}
                {activeTicket.escalation_reason ||
                  (activeSla?.breach_status
                    ? `Elapsed business time (${activeSla.elapsed_business_minutes}m) exceeded configurable target (${activeSla.target_business_minutes}m) by ${activeSla.overdue_business_minutes ?? Math.max(0, activeSla.elapsed_business_minutes - activeSla.target_business_minutes)} business minutes.`
                    : `Approaching configurable SLA deadline (${activeSla?.remaining_business_minutes ?? 0} business minutes remaining of ${activeSla?.target_business_minutes ?? 0}m target).`)}
              </p>
            </div>
          )}

          {/* Metadata, Routing Assignment & SLA Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* 1. Classification & Policy Citations */}
            <div className="rounded-md border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2.5 text-xs">
              <div className="font-semibold text-[#292A25] border-b border-[#292A25]/10 pb-2">
                Classification & Policy Version Reference
              </div>
              <div className="flex justify-between">
                <span className="text-[#292A25]/60">Official Category:</span>
                <span className="font-semibold text-[#292A25]">
                  {activeTicket.category_name} ({activeTicket.category_id})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#292A25]/60">Priority:</span>
                <span className="font-medium text-[#292A25]">
                  {activeTicket.priority}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#292A25]/60">Policy Document:</span>
                <span className="font-mono font-semibold text-[#777B63]">
                  {activeTicket.referenced_policy_id} v
                  {activeTicket.referenced_policy_version}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#292A25]/60">Knowledge Article:</span>
                <span className="font-mono font-semibold text-[#777B63]">
                  {activeTicket.referenced_article_id} v
                  {activeTicket.referenced_article_version}
                </span>
              </div>
              <p className="text-[#292A25]/75 pt-2 border-t border-[#292A25]/10 leading-relaxed">
                {activeTicket.description}
              </p>
            </div>

            {/* 2. Explainable Routing & Assignment History */}
            <div className="rounded-md border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2.5 text-xs">
              <div className="font-semibold text-[#292A25] border-b border-[#292A25]/10 pb-2">
                Explainable Routing & Assignment Lineage (
                {activeAssignments.length})
              </div>
              {activeAssignments.map((asg) => (
                <div
                  key={asg.assignment_id}
                  className="flex flex-col gap-1 border-b border-[#292A25]/8 pb-2.5 last:border-b-0"
                >
                  <div className="flex items-center justify-between font-mono text-[11px] text-[#777B63]">
                    <span>
                      {asg.assignment_id} · {asg.routing_rule_id}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        asg.is_active
                          ? 'bg-[#777B63]/20 text-[#292A25] font-semibold'
                          : 'bg-[#292A25]/10 text-[#292A25]/65'
                      }`}
                    >
                      {asg.is_active ? 'ACTIVE' : 'HISTORICAL'}
                    </span>
                  </div>
                  <div className="font-semibold text-[#292A25]">
                    {asg.assigned_team}
                  </div>
                  <div className="font-mono text-[11px] text-[#292A25]/70">
                    Assigned Actor: {asg.assigned_actor_id || 'Queue'} (
                    {asg.assigned_actor_role})
                  </div>
                  <div className="text-[#292A25]/75 leading-relaxed">
                    {asg.assignment_reason}
                  </div>
                  {asg.previous_assigned_team && (
                    <div className="text-[11px] text-[#777B63]">
                      Previous Team: {asg.previous_assigned_team} (
                      {asg.previous_assignment_id})
                    </div>
                  )}
                  <div className="font-mono text-[10px] text-[#292A25]/55">
                    Assigned: {new Date(asg.assigned_at).toLocaleString()}
                    {asg.unassigned_at
                      ? ` · Unassigned: ${new Date(asg.unassigned_at).toLocaleString()}`
                      : ''}
                  </div>
                </div>
              ))}
            </div>

            {/* 3. Reproducible SLA Record & Calculation History */}
            <div className="rounded-md border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-[#292A25] border-b border-[#292A25]/10 pb-2">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#777B63]" />
                  <span>SLA Record ({activeSla?.sla_id})</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    activeSla?.breach_status
                      ? 'bg-[#8C3A32]/15 text-[#8C3A32]'
                      : activeSla?.is_approaching_deadline
                      ? 'bg-[#A36A2B]/15 text-[#A36A2B]'
                      : 'bg-[#777B63]/20 text-[#292A25]'
                  }`}
                >
                  {activeSla?.sla_status
                    ? activeSla.sla_status.toUpperCase().replace(/_/g, ' ')
                    : activeSla?.breach_status
                    ? 'BREACHED'
                    : 'WITHIN SLA'}
                </span>
              </div>
              {activeSla && (
                <>
                  <div className="flex justify-between">
                    <span className="text-[#292A25]/60">
                      Configurable Rule:
                    </span>
                    <span className="font-mono">
                      {activeSla.sla_rule_id} ({activeSla.rule_classification})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#292A25]/60">
                      Target / Approaching Threshold:
                    </span>
                    <span className="font-mono">
                      {activeSla.target_business_minutes}m /{' '}
                      {activeSla.approaching_threshold_business_minutes ??
                        Math.ceil(activeSla.target_business_minutes * 0.75)}
                      m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#292A25]/60">
                      Elapsed (Business / Wall):
                    </span>
                    <span className="font-mono">
                      {activeSla.elapsed_business_minutes}m /{' '}
                      {activeSla.elapsed_wall_clock_minutes}m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#292A25]/60">
                      Remaining / Overdue Business Time:
                    </span>
                    <span className="font-mono font-semibold text-[#292A25]">
                      {activeSla.remaining_business_minutes ??
                        Math.max(
                          0,
                          activeSla.target_business_minutes -
                            activeSla.elapsed_business_minutes
                        )}
                      m left ·{' '}
                      {activeSla.overdue_business_minutes ??
                        (activeSla.breach_status
                          ? Math.max(
                              0,
                              activeSla.elapsed_business_minutes -
                                activeSla.target_business_minutes
                            )
                          : 0)}
                      m overdue
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#292A25]/60">
                      Actual Response / Resolution:
                    </span>
                    <span className="font-mono">
                      {activeSla.actual_response_business_minutes !==
                        undefined &&
                      activeSla.actual_response_business_minutes !== null
                        ? `${activeSla.actual_response_business_minutes}m resp`
                        : 'Pending resp'}{' '}
                      ·{' '}
                      {activeSla.resolution_business_minutes !== undefined &&
                      activeSla.resolution_business_minutes !== null
                        ? `${activeSla.resolution_business_minutes}m resolved`
                        : 'Unresolved'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#292A25]/60">
                      Start / Due Timestamp:
                    </span>
                    <span className="font-mono text-[11px]">
                      {new Date(activeSla.start_timestamp).toLocaleDateString()}{' '}
                      → {new Date(activeSla.due_timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#292A25]/70 pt-2 border-t border-[#292A25]/10 font-mono leading-relaxed">
                    {activeSla.calculation_explanation}
                  </p>
                  {activeSla.calculation_history &&
                    activeSla.calculation_history.length > 0 && (
                      <div className="pt-2 border-t border-[#292A25]/10 flex flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#777B63]">
                          SLA Calculation History
                        </span>
                        {activeSla.calculation_history.map((step) => (
                          <div
                            key={step.step_index}
                            className="text-[10px] font-mono text-[#292A25]/70"
                          >
                            {step.step_index}. [{step.step_code}]{' '}
                            {step.description}
                          </div>
                        ))}
                      </div>
                    )}
                </>
              )}
            </div>
          </div>

          {/* Immutable Lifecycle Event History & State Transition Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2 border-t border-[#292A25]/10">
            <div className="lg:col-span-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#292A25]">
                <GitCommit className="w-4 h-4 text-[#777B63]" />
                <span>
                  Lifecycle Audit History ({activeEvents.length})
                </span>
              </div>
              <ul className="flex flex-col gap-2.5">
                {activeEvents.map((ev) => (
                  <li
                    key={ev.event_id}
                    className="rounded border border-[#292A25]/10 bg-[#F8F7F3] p-3 text-xs flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] text-[#777B63]">
                      <span>{ev.event_id}</span>
                      <span>
                        {new Date(ev.event_timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="font-semibold text-[#292A25]">
                      {ev.previous_state || 'INITIAL'} → {ev.new_state} (Actor:{' '}
                      {ev.actor_id} · {ev.actor_role})
                    </div>
                    <div className="text-[#292A25]/75">{ev.reason}</div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: State Transition, Reassignment & Resolution Feedback Controls */}
            <div className="lg:col-span-6 flex flex-col gap-5">
              {allowedNextStates.length > 0 && (
                <form
                  onSubmit={handleTransitionSubmit}
                  className="rounded border border-[#292A25]/12 bg-[#E8E4DC]/45 p-4 flex flex-col gap-3"
                >
                  <div className="text-xs font-semibold text-[#292A25]">
                    Record Documented Lifecycle State Transition
                  </div>
                  <SelectField
                    label="Target Next Lifecycle State"
                    value={targetState}
                    onChange={(e) =>
                      setTargetState(e.target.value as RequestStatus)
                    }
                    options={[
                      { value: '', label: 'Select permitted transition...' },
                      ...allowedNextStates.map((st) => ({
                        value: st,
                        label: `Transition to: ${st}`,
                      })),
                    ]}
                  />
                  <InputField
                    label="Transition / Adjudication Reason"
                    placeholder="Document policy basis, resolution summary (min 10 chars), or escalation reason..."
                    value={transitionReason}
                    onChange={(e) => setTransitionReason(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={isTransitioning}
                    >
                      {isTransitioning
                        ? 'Recording Event...'
                        : 'Record State Transition'}
                    </Button>
                  </div>
                </form>
              )}

              {/* Authorized Staff / Admin Reassignment Form (Phase 5 Section 4) */}
              {canReassign &&
                activeTicket.lifecycle_status !== RequestStatus.Closed && (
                  <form
                    onSubmit={handleReassignSubmit}
                    className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-3"
                  >
                    <div className="text-xs font-semibold text-[#292A25]">
                      Reassign Operational Queue Destination (Preserves Lineage)
                    </div>
                    <SelectField
                      label="Target Assigned Team"
                      value={reassignTargetTeam}
                      onChange={(e) => setReassignTargetTeam(e.target.value)}
                      options={[
                        {
                          value: '',
                          label: 'Select documented destination team...',
                        },
                        ...DOCUMENTED_ASSIGNMENT_TEAMS.map((team) => ({
                          value: team,
                          label: team,
                        })),
                      ]}
                    />
                    <InputField
                      label="Reassignment Reason"
                      placeholder="Document routing rule or inter-departmental handoff reason (min 5 chars)..."
                      value={reassignReason}
                      onChange={(e) => setReassignReason(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={isReassigning}
                      >
                        {isReassigning
                          ? 'Reassigning Ticket...'
                          : 'Record Reassignment'}
                      </Button>
                    </div>
                  </form>
                )}

              {/* Role-Governed Resolution Feedback Section */}
              {isActiveTicketOwner ? (
                /* Ticket Requester: Can submit or update feedback once ticket is resolved/closed */
                <form
                  onSubmit={handleFeedbackSubmit}
                  className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#292A25]">
                      <Star className="w-3.5 h-3.5 text-[#777B63]" />
                      <span>
                        Resolution Feedback Record (
                        {activeFeedback
                          ? activeFeedback.feedback_id
                          : `FDB-${activeTicket.ticket_id}`}
                        )
                      </span>
                    </div>
                    {activeFeedback && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-[#777B63]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Recorded ({activeFeedback.rating}/5)
                      </span>
                    )}
                  </div>

                  {activeTicket.lifecycle_status !== RequestStatus.Resolved &&
                    activeTicket.lifecycle_status !== RequestStatus.Closed && (
                      <div className="rounded border border-[#777B63]/30 bg-[#E8E4DC]/50 p-2.5 text-[11px] text-[#292A25]/80">
                        Resolution feedback becomes available once the ticket is marked 'resolved' or 'closed' (current stage: '{activeTicket.lifecycle_status}').
                      </div>
                    )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SelectField
                      label="Resolution Satisfaction (1–5)"
                      value={String(feedbackRating)}
                      onChange={(e) => setFeedbackRating(Number(e.target.value))}
                      options={[
                        { value: '5', label: '5 — Very Satisfied' },
                        { value: '4', label: '4 — Satisfied' },
                        { value: '3', label: '3 — Neutral' },
                        { value: '2', label: '2 — Dissatisfied' },
                        { value: '1', label: '1 — Very Dissatisfied' },
                      ]}
                    />
                    <SelectField
                      label="Policy Citation Clarity (1–5)"
                      value={String(clarityScore)}
                      onChange={(e) => setClarityScore(Number(e.target.value))}
                      options={[
                        { value: '5', label: '5 — Exact & Clear Citation' },
                        { value: '4', label: '4 — Clear' },
                        { value: '3', label: '3 — Adequate' },
                        { value: '2', label: '2 — Ambiguous' },
                        { value: '1', label: '1 — Unclear / Missing' },
                      ]}
                    />
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <CheckboxField
                      label="Response was helpful"
                      checked={wasHelpful}
                      onChange={(e) => setWasHelpful(e.target.checked)}
                    />
                    <CheckboxField
                      label="Resolution determination accepted"
                      checked={resolutionAccepted}
                      onChange={(e) => setResolutionAccepted(e.target.checked)}
                    />
                  </div>

                  <TextAreaField
                    label="Feedback Comments (Optional)"
                    rows={2}
                    placeholder="Add optional feedback regarding policy accuracy or resolution handling..."
                    value={feedbackComments}
                    onChange={(e) => setFeedbackComments(e.target.value)}
                  />

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={
                        isSubmittingFeedback ||
                        (activeTicket.lifecycle_status !==
                          RequestStatus.Resolved &&
                          activeTicket.lifecycle_status !== RequestStatus.Closed)
                      }
                    >
                      {isSubmittingFeedback
                        ? 'Saving Feedback...'
                        : activeFeedback
                        ? 'Update Resolution Feedback'
                        : 'Record Resolution Feedback'}
                    </Button>
                  </div>
                </form>
              ) : activeFeedback ? (
                /* Non-Requester (Instructor, Operations Staff, Dean, Admin): Read-only feedback review */
                <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-[#292A25]/8 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#292A25]">
                      <Star className="w-3.5 h-3.5 text-[#777B63]" />
                      <span>Requester Resolution Feedback ({activeFeedback.feedback_id})</span>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[#777B63] bg-[#777B63]/15 px-2 py-0.5 rounded">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Recorded Score: {activeFeedback.rating}/5
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-[#777B63] text-[11px] block">Satisfaction</span>
                      <strong className="text-[#292A25]">{activeFeedback.rating} / 5</strong>
                    </div>
                    <div>
                      <span className="text-[#777B63] text-[11px] block">Policy Clarity</span>
                      <strong className="text-[#292A25]">{activeFeedback.policy_clarity_score} / 5</strong>
                    </div>
                    <div>
                      <span className="text-[#777B63] text-[11px] block">Helpful</span>
                      <strong className="text-[#292A25]">{activeFeedback.was_helpful ? 'Yes' : 'No'}</strong>
                    </div>
                    <div>
                      <span className="text-[#777B63] text-[11px] block">Determination</span>
                      <strong className="text-[#292A25]">{activeFeedback.resolution_accepted ? 'Accepted' : 'Appealed'}</strong>
                    </div>
                  </div>
                  {activeFeedback.comments && (
                    <div className="text-xs text-[#292A25]/80 bg-[#E8E4DC]/40 p-2.5 rounded border border-[#292A25]/8">
                      <span className="font-semibold text-[#777B63] block text-[10px] uppercase tracking-wider mb-0.5">Requester Comments</span>
                      "{activeFeedback.comments}"
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
};
