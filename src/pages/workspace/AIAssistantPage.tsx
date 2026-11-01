import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenCheck,
  Send,
  AlertTriangle,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  FileText,
  ArrowUpRight,
  HelpCircle,
  GitCompare,
  ShieldAlert,
} from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { ViewDataState } from '../../types/domain';
import { getActorMetadata } from '../../utils/rbac';
import { ConflictingSourcePair } from '../../services/workflowEngine';
import {
  createOperationalTicket,
  linkPolicyAssistantEscalationTicket,
  queryPolicyAssistant,
  submitPolicyAssistantFeedback,
} from '../../services/workspaceClient';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { InputField } from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';

interface CitedSourceItem {
  sourceType: 'policy' | 'article';
  id: string;
  sourceId: string;
  version: string;
  title: string;
  sourceDocumentTitle: string;
  domainOrCategory: string;
  effectiveDate: string;
  expirationDate: string | null;
  lifecycleState: string;
  sectionRef?: string;
  relevantSectionOrPassage: string;
  citation: string;
  summary: string;
  content: string;
  sourceUrl: string;
  isSynthetic: boolean;
  supersedesPolicyId?: string | null;
  supersededByPolicyId?: string | null;
  exclusionReason?: string;
}

interface ActiveAssistantResult {
  queryId: string;
  userQuery: string;
  asOfDate: string;
  detectedCategory: string | null;
  generatedResponse: string;
  explanation: string;
  retrievalConfidence: number;
  evidenceStatus: string;
  clarificationNeeded: boolean;
  clarificationQuestions: string[];
  hasConflictingSources: boolean;
  conflictingSources: ConflictingSourcePair[];
  unsupportedClaimRequested: boolean;
  unsupportedClaimDetails: string[];
  expiredPolicyRejected: boolean;
  escalationTriggered: boolean;
  escalationReason: string | null;
  escalatedTicketId: string | null;
  recommendedEscalationTeam: string | null;
  recommendedRoutingRuleId: string | null;
  synthesisMode: 'gemini_api' | 'deterministic_fallback';
  modelUsed: string;
  databasePersistence: {
    persistedToPostgres: boolean;
    table: string;
    errorCode: string | null;
    errorMessage: string | null;
  };
  supportedFacts: string[];
  missingOrUnestablishedFacts: string[];
  citedSources: CitedSourceItem[];
  expiredSourcesExcludedDetails: CitedSourceItem[];
  feedbackHelpful?: boolean | null;
}

const SAMPLE_POLICY_QUERIES = [
  {
    label: 'SAP Appeal Deadline & GPA Requirement',
    query:
      'What is the current deadline in business days to submit a Satisfactory Academic Progress (SAP) appeal and what GPA is required?',
  },
  {
    label: 'Superseded Financial Aid Policy Check',
    query:
      'Does expired policy POL-FINAID-2026-001 v1.0 still apply, or which active version superseded it?',
  },
  {
    label: 'Course Drop & Academic Status Inquiry',
    query: 'Can I drop a course and how does it affect my status?',
  },
  {
    label: 'SAP Appeal Filing Fee Inquiry',
    query:
      'What is the dollar filing fee required to submit a Satisfactory Academic Progress (SAP) appeal under POL-FINAID-2026-002?',
  },
  {
    label: 'Post-Week 8 Retroactive Withdrawal Petition',
    query:
      'What is the course add/drop window without a W grade, and what happens if I request a retroactive withdrawal after Week 8?',
  },
  {
    label: 'Non-Academic Campus Policy Check',
    query:
      'What is the university policy on alumni football stadium parking pass refunds and dining hall meal transfers?',
  },
];

export const AIAssistantPage: React.FC = () => {
  const {
    activeRole,
    dataState,
    setDataState,
    workspaceData,
    refreshWorkspaceData,
  } = useWorkspaceContext();
  const navigate = useNavigate();
  const actorMeta = getActorMetadata(activeRole);

  const [queryText, setQueryText] = useState('');
  const [asOfDate, setAsOfDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [queryError, setQueryError] = useState<string | undefined>();
  const [isQuerying, setIsQuerying] = useState(false);
  const [activeResult, setActiveResult] =
    useState<ActiveAssistantResult | null>(null);
  const [inspectedSource, setInspectedSource] =
    useState<CitedSourceItem | null>(null);
  const [escalatingTicket, setEscalatingTicket] = useState(false);
  const [escalatedBanner, setEscalatedBanner] = useState<string | null>(null);

  const pastLogs = workspaceData?.aiRetrievalLogs || [];

  const executePolicyQuery = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || trimmed.length < 5) {
      setQueryError(
        'Enter a policy question of at least 5 characters to retrieve grounded sources.'
      );
      return;
    }

    setQueryError(undefined);
    setEscalatedBanner(null);
    setIsQuerying(true);
    try {
      const res = await queryPolicyAssistant({
        query: trimmed,
        asOfDate,
        activeRolePreview: activeRole,
      });

      setActiveResult({
        queryId: res.retrievalLog.query_id,
        userQuery: res.retrievalLog.user_query,
        asOfDate,
        detectedCategory: res.retrievalLog.detected_category,
        generatedResponse: res.answer || res.retrievalLog.generated_response,
        explanation: res.explanation || '',
        retrievalConfidence:
          res.confidence ?? res.retrievalLog.retrieval_confidence,
        evidenceStatus:
          res.evidenceStatus || res.retrievalLog.evidence_status,
        clarificationNeeded: Boolean(res.clarificationNeeded),
        clarificationQuestions: res.clarificationQuestions || [],
        hasConflictingSources: Boolean(res.hasConflictingSources),
        conflictingSources: res.conflictingSources || [],
        unsupportedClaimRequested: Boolean(res.unsupportedClaimRequested),
        unsupportedClaimDetails: res.unsupportedClaimDetails || [],
        expiredPolicyRejected: Boolean(res.expiredPolicyRejected),
        escalationTriggered: res.retrievalLog.escalation_triggered,
        escalationReason: res.retrievalLog.escalation_reason,
        escalatedTicketId: res.retrievalLog.escalated_ticket_id,
        recommendedEscalationTeam: res.recommendedEscalationTeam,
        recommendedRoutingRuleId: res.recommendedRoutingRuleId,
        synthesisMode: res.synthesisMode,
        modelUsed: res.modelUsed,
        databasePersistence: res.databasePersistence,
        supportedFacts: res.supportedFacts,
        missingOrUnestablishedFacts: res.missingOrUnestablishedFacts,
        citedSources: res.citedSources,
        expiredSourcesExcludedDetails: res.expiredSourcesExcludedDetails,
        feedbackHelpful: res.retrievalLog.feedback_helpful,
      });
      await refreshWorkspaceData();
    } catch (err) {
      setQueryError(
        err instanceof Error
          ? err.message
          : 'Failed to retrieve policy-grounded answer.'
      );
    } finally {
      setIsQuerying(false);
    }
  };

  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executePolicyQuery(queryText);
  };

  const handleFeedback = async (helpful: boolean) => {
    if (!activeResult) return;
    try {
      await submitPolicyAssistantFeedback({
        queryId: activeResult.queryId,
        helpful,
      });
      setActiveResult({ ...activeResult, feedbackHelpful: helpful });
      await refreshWorkspaceData();
    } catch {
      // Non-blocking feedback update
    }
  };

  const handleEscalateToTicket = async () => {
    if (!activeResult) return;
    setEscalatingTicket(true);
    try {
      const category = activeResult.detectedCategory || 'Registration';
      const created = await createOperationalTicket({
        subject: `Escalated Policy Inquiry (${activeResult.queryId}): ${activeResult.userQuery.slice(0, 60)}`,
        category,
        departmentTarget:
          activeResult.recommendedEscalationTeam ||
          'Academic Administration Review Office',
        urgencyLevel: 'Administrative Escalation Priority',
        courseOrPolicyCode:
          activeResult.citedSources[0]?.id || 'HUMAN-ESCALATION',
        description: `Escalated from AI Policy Assistant query ${activeResult.queryId}. Original Question: "${activeResult.userQuery}". Evidence Status: ${activeResult.evidenceStatus}. Escalation Reason: ${
          activeResult.escalationReason ||
          'Requested human policy verification.'
        }`,
      });

      if (created.ticket?.ticket_id) {
        try {
          await linkPolicyAssistantEscalationTicket({
            queryId: activeResult.queryId,
            ticketId: created.ticket.ticket_id,
          });
        } catch {
          // Non-blocking link update
        }
      }

      setActiveResult({
        ...activeResult,
        escalatedTicketId: created.ticket.ticket_id,
      });
      setEscalatedBanner(
        `Created escalated ticket ${created.ticket.ticket_id} assigned to ${created.assignment.assigned_team} (${created.assignment.routing_rule_id}).`
      );
      await refreshWorkspaceData();
    } catch (err) {
      setEscalatedBanner(
        err instanceof Error
          ? err.message
          : 'Failed to create escalation ticket.'
      );
    } finally {
      setEscalatingTicket(false);
    }
  };

  const handleOpenPrefilledRequestForm = () => {
    if (!activeResult) return;
    const category = activeResult.detectedCategory || 'Registration';
    navigate('/workspace/create-request', {
      state: {
        prefill: {
          subject: `Policy Review Request (${activeResult.queryId}): ${activeResult.userQuery.slice(0, 55)}`,
          category,
          departmentTarget: 'Academic Administration Review Office',
          urgencyLevel: 'Administrative Escalation Priority',
          courseOrPolicyCode:
            activeResult.citedSources[0]?.id || 'HUMAN-ESCALATION',
          description: `Escalated from AI Policy Assistant session ${activeResult.queryId}.\nOriginal Inquiry: "${activeResult.userQuery}"\nEvidence Status: ${activeResult.evidenceStatus}\nReason for Human Review: ${
            activeResult.escalationReason ||
            'Requesting authoritative human policy interpretation.'
          }`,
          policyAcknowledged: true,
          fromQueryId: activeResult.queryId,
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
          <span>Retrieval-Augmented Policy Grounding</span>
          <span aria-hidden="true">·</span>
          <span>Effective-Date Filtering, Version Citation & Conflict Detection</span>
        </div>
        <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
          AI Policy Assistant
        </h1>
        <p className="text-sm text-[#292A25]/70">
          Searches the institutional Knowledge Base, verifies policy effective
          and expiration dates, retains exact document and article versions,
          surfaces conflicting sources, asks clarification questions when
          inquiries are ambiguous, and integrates with the ticket escalation
          workflow.
        </p>
      </div>

      {dataState === ViewDataState.Loading && (
        <LoadingState
          label="Loading policy assistant interface state..."
          rows={3}
        />
      )}

      {dataState === ViewDataState.Error && (
        <ErrorMessage
          title="Policy Retrieval Service Unavailable"
          message="Return to live view to query the AI Policy Assistant."
          code="ASSISTANT_UNAVAILABLE"
          onRetry={() => setDataState(ViewDataState.Empty)}
        />
      )}

      {dataState === ViewDataState.Empty && (
        <>
          {/* Validated Policy Query Input Form */}
          <form
            noValidate
            onSubmit={handleQuerySubmit}
            className="rounded-md surface-elevated p-6 flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-3">
                <InputField
                  label={`Ask a Policy Question (${actorMeta.label} View)`}
                  required
                  placeholder="e.g., What is the current deadline in business days to submit a SAP appeal?"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  error={queryError}
                  helperText="Retrieves active policy versions and knowledge articles while automatically excluding expired or superseded versions."
                />
              </div>
              <div>
                <InputField
                  label="Effective As-Of Date"
                  type="date"
                  value={asOfDate}
                  onChange={(e) =>
                    setAsOfDate(
                      e.target.value || new Date().toISOString().slice(0, 10)
                    )
                  }
                  helperText="Evaluates policy effective and expiration dates against this date."
                />
              </div>
            </div>

            {/* Sample Policy Questions */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-[#777B63]">
                Sample Policy Questions:
              </span>
              {SAMPLE_POLICY_QUERIES.map((sq) => (
                <button
                  key={sq.label}
                  type="button"
                  onClick={() => {
                    setQueryText(sq.query);
                    setQueryError(undefined);
                  }}
                  className="text-[11px] px-2.5 py-1 rounded border border-[#292A25]/15 bg-[#E8E4DC]/55 hover:bg-[#E8E4DC] text-[#292A25] transition-colors"
                >
                  {sq.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQueryText('');
                  setQueryError(undefined);
                  setActiveResult(null);
                }}
              >
                Clear Query
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isQuerying}
                leftIcon={<Send className="w-3.5 h-3.5" />}
              >
                {isQuerying
                  ? 'Retrieving Grounded Sources...'
                  : 'Retrieve Policy-Grounded Answer'}
              </Button>
            </div>
          </form>

          {/* Grounded Response & Structured Source Citations */}
          {activeResult && (
            <section
              aria-label="Policy retrieval result"
              className="rounded-md surface-elevated p-6 md:p-8 flex flex-col gap-6 border border-[#292A25]/15"
            >
              {/* Result Header & Evidence Confidence Status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#292A25]/10 pb-4">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#777B63]">
                    <span>Query ID: {activeResult.queryId}</span>
                    <span>·</span>
                    <span>As-Of: {activeResult.asOfDate}</span>
                    <span>·</span>
                    <span>
                      Category:{' '}
                      {activeResult.detectedCategory || 'Unmapped / Multi-Domain'}
                    </span>
                    <span>·</span>
                    <span>
                      Evidence Confidence:{' '}
                      {(activeResult.retrievalConfidence * 100).toFixed(1)}%
                    </span>
                    <span>·</span>
                    <span>
                      Grounded Sources: {activeResult.citedSources.length} Active
                    </span>
                  </div>
                  <h2 className="font-serif-display text-xl text-[#292A25]">
                    {activeResult.userQuery}
                  </h2>
                </div>

                <span
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold shrink-0 ${
                    activeResult.evidenceStatus === 'supported'
                      ? 'bg-[#777B63]/20 text-[#292A25]'
                      : 'bg-[#8C3A32]/15 text-[#8C3A32]'
                  }`}
                >
                  EVIDENCE: {activeResult.evidenceStatus.toUpperCase()}
                </span>
              </div>

              {/* Conflicting Policy Sources Warning Banner */}
              {activeResult.hasConflictingSources &&
                activeResult.conflictingSources.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-md border border-[#8C3A32]/50 bg-[#8C3A32]/10 p-4 flex flex-col gap-3 text-xs text-[#292A25]"
                  >
                    <div className="flex items-center gap-2 font-semibold text-[#8C3A32]">
                      <GitCompare className="w-4 h-4 shrink-0" />
                      <span>
                        Conflicting Applicable Policy Sources Detected (No
                        Arbitrary Selection)
                      </span>
                    </div>
                    <p className="text-[#292A25]/85">
                      Multiple active sources matched your inquiry with
                      divergent versions or provisions. Both sources are
                      surfaced below for human adjudication:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {activeResult.conflictingSources.map((conflict, idx) => (
                        <React.Fragment key={idx}>
                          <div className="rounded bg-[#F8F7F3] border border-[#8C3A32]/25 p-3 flex flex-col gap-1">
                            <span className="font-mono font-semibold text-[#8C3A32]">
                              Source A: {conflict.sourceAId} · v
                              {conflict.sourceAVersion} (Effective{' '}
                              {conflict.sourceAEffectiveDate})
                            </span>
                            <span className="font-medium">
                              {conflict.sourceATitle}
                            </span>
                            <span className="text-[#292A25]/75">
                              {conflict.sourceAClaim}
                            </span>
                          </div>
                          <div className="rounded bg-[#F8F7F3] border border-[#8C3A32]/25 p-3 flex flex-col gap-1">
                            <span className="font-mono font-semibold text-[#8C3A32]">
                              Source B: {conflict.sourceBId} · v
                              {conflict.sourceBVersion} (Effective{' '}
                              {conflict.sourceBEffectiveDate})
                            </span>
                            <span className="font-medium">
                              {conflict.sourceBTitle}
                            </span>
                            <span className="text-[#292A25]/75">
                              {conflict.sourceBClaim}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

              {/* Unsupported Fact Requested Warning Banner */}
              {activeResult.unsupportedClaimRequested &&
                activeResult.unsupportedClaimDetails.length > 0 && (
                  <div
                    role="alert"
                    className="rounded-md border border-[#8C3A32]/40 bg-[#8C3A32]/8 p-4 flex items-start gap-2.5 text-xs text-[#292A25]"
                  >
                    <ShieldAlert className="w-4 h-4 text-[#8C3A32] shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-1">
                      <strong className="text-[#8C3A32]">
                        Unsupported Fact / Unestablished Claim Notice
                      </strong>
                      <span>
                        Available institutional policy sources do not establish
                        the specific fee, fine, stipend, or guarantee requested:{' '}
                        {activeResult.unsupportedClaimDetails.join(' ')}
                      </span>
                    </div>
                  </div>
                )}

              {/* Ambiguity & Focused Clarification Questions Panel */}
              {activeResult.clarificationNeeded &&
                activeResult.clarificationQuestions.length > 0 && (
                  <div className="rounded-md border border-[#777B63]/50 bg-[#E8E4DC]/65 p-4 flex flex-col gap-3 text-xs text-[#292A25]">
                    <div className="flex items-center gap-2 font-semibold text-[#292A25]">
                      <HelpCircle className="w-4 h-4 text-[#777B63] shrink-0" />
                      <span>
                        Clarification Needed to Narrow Governing Policy
                        Provision
                      </span>
                    </div>
                    <ul className="list-decimal pl-5 flex flex-col gap-1.5 text-[#292A25]/90">
                      {activeResult.clarificationQuestions.map((cq, idx) => (
                        <li key={idx} className="font-medium">
                          {cq}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-[11px] font-mono text-[#777B63]">
                        Quick Clarifications:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const refined = `${activeResult.userQuery} (Specifically within the first 10 business days add/drop window under POL-REG-2026-002)`;
                          setQueryText(refined);
                          executePolicyQuery(refined);
                        }}
                        className="text-[11px] px-2.5 py-1 rounded border border-[#292A25]/20 bg-[#F8F7F3] hover:bg-[#E8E4DC] text-[#292A25]"
                      >
                        Clarify: First 10 Business Days (Add/Drop)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const refined = `${activeResult.userQuery} (Specifically retroactive withdrawal petition after Week 8 under POL-REG-2026-002)`;
                          setQueryText(refined);
                          executePolicyQuery(refined);
                        }}
                        className="text-[11px] px-2.5 py-1 rounded border border-[#292A25]/20 bg-[#F8F7F3] hover:bg-[#E8E4DC] text-[#292A25]"
                      >
                        Clarify: Post-Week 8 Retroactive Petition
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const refined = `${activeResult.userQuery} (Specifically Satisfactory Academic Progress SAP appeal within 15 business days under POL-FINAID-2026-002)`;
                          setQueryText(refined);
                          executePolicyQuery(refined);
                        }}
                        className="text-[11px] px-2.5 py-1 rounded border border-[#292A25]/20 bg-[#F8F7F3] hover:bg-[#E8E4DC] text-[#292A25]"
                      >
                        Clarify: Financial Aid SAP Appeal
                      </button>
                    </div>
                  </div>
                )}

              {/* Structured Grounded Answer & Explanation */}
              <div className="flex flex-col gap-3">
                <div className="rounded-md bg-[#F8F7F3] border border-[#292A25]/12 p-5 flex flex-col gap-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[#777B63] font-semibold">
                    Policy-Grounded Answer
                  </div>
                  <div className="text-sm text-[#292A25] leading-relaxed whitespace-pre-line">
                    {activeResult.generatedResponse}
                  </div>
                </div>

                {activeResult.explanation && (
                  <div className="rounded-md bg-[#E8E4DC]/35 border border-[#292A25]/10 p-4 flex flex-col gap-1.5 text-xs text-[#292A25]/85">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-[#777B63] font-semibold">
                      Evidence & Operational Explanation (Verified Policy vs.
                      General Routing Context)
                    </div>
                    <p className="leading-relaxed">{activeResult.explanation}</p>
                  </div>
                )}
              </div>

              {/* Escalation Warning & Human Review Ticket Workflow Integration */}
              <div
                className={`rounded-md border p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                  activeResult.escalationTriggered
                    ? 'border-[#8C3A32]/40 bg-[#8C3A32]/8'
                    : 'border-[#292A25]/15 bg-[#E8E4DC]/40'
                }`}
              >
                <div className="flex items-start gap-2.5 text-xs text-[#292A25]">
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      activeResult.escalationTriggered
                        ? 'text-[#8C3A32]'
                        : 'text-[#777B63]'
                    }`}
                  />
                  <div className="flex flex-col gap-1">
                    <strong
                      className={
                        activeResult.escalationTriggered
                          ? 'text-[#8C3A32]'
                          : 'text-[#292A25]'
                      }
                    >
                      {activeResult.escalationTriggered
                        ? 'Human Review & Escalation Recommended'
                        : 'Need Individual Case Review or Formal Exception?'}
                    </strong>
                    <span>
                      {activeResult.escalationReason ||
                        'If your situation involves extenuating circumstances or requires official case adjudication, you can escalate this inquiry directly into the institutional ticket workflow.'}
                    </span>
                    {activeResult.recommendedEscalationTeam && (
                      <span className="font-mono text-[11px] text-[#777B63]">
                        Target Escalation Unit:{' '}
                        {activeResult.recommendedEscalationTeam}
                        {activeResult.recommendedRoutingRuleId
                          ? ` (${activeResult.recommendedRoutingRuleId})`
                          : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleOpenPrefilledRequestForm}
                  >
                    Open in Pre-Filled Request Form
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={
                      escalatingTicket || Boolean(activeResult.escalatedTicketId)
                    }
                    onClick={handleEscalateToTicket}
                  >
                    {activeResult.escalatedTicketId
                      ? `Escalated (${activeResult.escalatedTicketId})`
                      : escalatingTicket
                      ? 'Escalating...'
                      : 'Escalate to Human Review Ticket'}
                  </Button>
                </div>
              </div>

              {escalatedBanner && (
                <div className="rounded-md border border-[#777B63]/45 bg-[#E8E4DC]/80 p-3.5 text-xs text-[#292A25] flex items-center justify-between gap-3">
                  <span>{escalatedBanner}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/workspace/requests')}
                  >
                    View Ticket
                  </Button>
                </div>
              )}

              {/* Supported vs Missing/Unestablished Facts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-[#292A25]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#777B63]" />
                    <span>
                      Supported Policy Evidence (
                      {activeResult.supportedFacts.length})
                    </span>
                  </div>
                  {activeResult.supportedFacts.length === 0 ? (
                    <p className="text-[#292A25]/60">
                      No active policy evidence matched this inquiry.
                    </p>
                  ) : (
                    <ul className="list-disc pl-4 flex flex-col gap-1.5 text-[#292A25]/80">
                      {activeResult.supportedFacts.map((f, idx) => (
                        <li key={idx}>{f}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-[#292A25]">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#777B63]" />
                    <span>
                      Missing, Ambiguous, or Unestablished Information (
                      {activeResult.missingOrUnestablishedFacts.length})
                    </span>
                  </div>
                  {activeResult.missingOrUnestablishedFacts.length === 0 ? (
                    <p className="text-[#292A25]/60">
                      All queried policy parameters are directly established in
                      the cited active sources.
                    </p>
                  ) : (
                    <ul className="list-disc pl-4 flex flex-col gap-1.5 text-[#292A25]/80">
                      {activeResult.missingOrUnestablishedFacts.map((m, idx) => (
                        <li key={idx}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Structured Cited Applicable Sources (Title, Source ID, Version, Section/Passage, Effective Date, Citation) */}
              <div className="flex flex-col gap-3">
                <div className="text-xs font-semibold text-[#292A25]">
                  Cited Applicable Sources ({activeResult.citedSources.length})
                  — Click Any Card to Inspect Full Versioned Source
                </div>
                {activeResult.citedSources.length === 0 ? (
                  <div className="text-xs text-[#292A25]/65 italic">
                    Zero active sources cited because no applicable current
                    policy covered the query.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeResult.citedSources.map((src) => (
                      <button
                        key={`${src.id}-${src.version}`}
                        type="button"
                        onClick={() => setInspectedSource(src)}
                        className="text-left rounded border border-[#292A25]/15 bg-[#F8F7F3] hover:bg-[#E8E4DC]/55 p-4 flex flex-col gap-2 transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs font-mono text-[#777B63]">
                          <span className="font-semibold flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5" />
                            {src.id} · v{src.version} (
                            {src.lifecycleState.toUpperCase()})
                          </span>
                          <span className="flex items-center gap-1 text-[11px]">
                            Effective {src.effectiveDate}
                            <ArrowUpRight className="w-3 h-3" />
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[#292A25]">
                          {src.title}
                        </div>
                        <div className="text-[11px] font-mono text-[#777B63]">
                          Section/Reference: {src.sectionRef || 'Section 1.0'}
                          {src.supersedesPolicyId
                            ? ` · Supersedes ${src.supersedesPolicyId}`
                            : ''}
                        </div>
                        <div className="text-[11px] text-[#292A25]/80 line-clamp-2">
                          {src.relevantSectionOrPassage || src.summary}
                        </div>
                        <div className="text-[10px] font-mono text-[#292A25]/60 pt-1 border-t border-[#292A25]/10">
                          Citation: {src.citation}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Excluded Expired / Superseded Sources Notice */}
              {activeResult.expiredSourcesExcludedDetails.length > 0 && (
                <div className="rounded border border-[#8C3A32]/30 bg-[#8C3A32]/6 p-4 flex flex-col gap-2.5 text-xs">
                  <div className="font-semibold text-[#8C3A32]">
                    Rejected Expired / Superseded / Non-Effective Sources (Never
                    Used as Current Policy Authority):
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {activeResult.expiredSourcesExcludedDetails.map((ex) => (
                      <button
                        key={`${ex.id}-${ex.version}`}
                        type="button"
                        onClick={() => setInspectedSource(ex)}
                        className="text-left p-3 rounded bg-[#F8F7F3] border border-[#8C3A32]/30 flex flex-col gap-1 hover:bg-[#E8E4DC]/40 transition-colors"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-[#8C3A32] font-semibold">
                          <span>
                            {ex.id} · v{ex.version} (
                            {ex.lifecycleState.toUpperCase()})
                          </span>
                          <span>
                            {ex.expirationDate
                              ? `Expired ${ex.expirationDate}`
                              : `Effective ${ex.effectiveDate}`}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-[#292A25]">
                          {ex.title}
                        </div>
                        <div className="text-[11px] font-mono text-[#777B63]">
                          Exclusion Reason:{' '}
                          {ex.exclusionReason || 'expired_by_date'}
                          {ex.supersededByPolicyId
                            ? ` · Superseded by ${ex.supersededByPolicyId}`
                            : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Feedback Controls */}
              <div className="flex items-center justify-between pt-3 border-t border-[#292A25]/10 text-xs">
                <span className="text-[#292A25]/70">
                  Was this policy-grounded retrieval accurate and helpful?
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={
                      activeResult.feedbackHelpful === true
                        ? 'primary'
                        : 'outline'
                    }
                    leftIcon={<ThumbsUp className="w-3.5 h-3.5" />}
                    onClick={() => handleFeedback(true)}
                  >
                    Helpful
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      activeResult.feedbackHelpful === false
                        ? 'primary'
                        : 'outline'
                    }
                    leftIcon={<ThumbsDown className="w-3.5 h-3.5" />}
                    onClick={() => handleFeedback(false)}
                  >
                    Needs Review
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Past Retrieval Sessions or Empty State */}
          {!activeResult && pastLogs.length === 0 && (
            <EmptyState
              icon={<BookOpenCheck className="w-4 h-4" />}
              title="No policy retrieval sessions recorded for this account yet"
              scopeContext={`${actorMeta.label} Policy Assistant`}
              description="Submit a policy question above or select one of the sample policy questions to retrieve versioned institutional policy documents and knowledge articles."
              primaryActionLabel="Browse Knowledge Base"
              onPrimaryAction={() => navigate('/workspace/knowledge-base')}
              secondaryActionLabel={actorMeta.createRequestTitle}
              onSecondaryAction={() => navigate('/workspace/create-request')}
            />
          )}

          {pastLogs.length > 0 && (
            <section className="rounded-md surface-elevated p-6 flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-[#292A25]">
                Recorded Policy Retrieval Audit Log ({pastLogs.length})
              </h3>
              <ul className="divide-y divide-[#292A25]/10">
                {pastLogs.slice(0, 6).map((log) => (
                  <li
                    key={log.query_id}
                    className="py-3 flex flex-col gap-1 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#777B63]">
                      <span>
                        {log.query_id} · {log.detected_category || 'General'} ·
                        Status: {log.evidence_status} · Confidence:{' '}
                        {(Number(log.retrieval_confidence) * 100).toFixed(1)}%
                        {log.escalated_ticket_id
                          ? ` · Escalated Ticket: ${log.escalated_ticket_id}`
                          : ''}
                      </span>
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                    <div className="font-semibold text-[#292A25]">
                      Q: {log.user_query}
                    </div>
                    <div className="text-[#292A25]/75 line-clamp-2">
                      {log.generated_response}
                    </div>
                    <div className="font-mono text-[11px] text-[#777B63]">
                      Cited Policies:{' '}
                      {log.retrieved_policy_ids.length > 0
                        ? log.retrieved_policy_ids
                            .map(
                              (id, i) =>
                                `${id} v${log.retrieved_policy_versions[i]}`
                            )
                            .join(', ')
                        : 'None'}{' '}
                      · Cited Articles:{' '}
                      {log.retrieved_article_ids.length > 0
                        ? log.retrieved_article_ids
                            .map(
                              (id, i) =>
                                `${id} v${log.retrieved_article_versions[i]}`
                            )
                            .join(', ')
                        : 'None'}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Source Document Inspection Modal */}
      <ConfirmationDialog
        isOpen={Boolean(inspectedSource)}
        title={
          inspectedSource
            ? `${inspectedSource.id} (Version ${inspectedSource.version}) — ${inspectedSource.title}`
            : 'Source Reference'
        }
        description={
          inspectedSource
            ? `Effective Date: ${inspectedSource.effectiveDate} | Expiration Date: ${
                inspectedSource.expirationDate || 'None (Active)'
              } | Lifecycle State: ${inspectedSource.lifecycleState.toUpperCase()}`
            : ''
        }
        confirmLabel="Close Source Viewer"
        cancelLabel="Dismiss"
        onConfirm={() => setInspectedSource(null)}
        onCancel={() => setInspectedSource(null)}
      >
        {inspectedSource && (
          <div className="rounded-md border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-3 text-xs text-[#292A25]">
            <div className="font-mono text-[11px] text-[#777B63] flex flex-col gap-1">
              <span>
                Section/Reference: {inspectedSource.sectionRef} · Provenance
                URL: {inspectedSource.sourceUrl}
              </span>
              <span>Formal Citation: {inspectedSource.citation}</span>
            </div>
            <p className="leading-relaxed font-medium">
              {inspectedSource.content}
            </p>
            {inspectedSource.isSynthetic && (
              <div className="pt-2 border-t border-[#292A25]/10 text-[11px] text-[#292A25]/65">
                Notice: This document is a clearly identified synthetic
                demonstration policy created for CampusResolve AI evaluation and
                is not a real university regulation.
              </div>
            )}
          </div>
        )}
      </ConfirmationDialog>
    </div>
  );
};

