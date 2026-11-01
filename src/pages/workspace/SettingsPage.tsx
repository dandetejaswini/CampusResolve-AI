import React, { useMemo, useState } from 'react';
import {
  Lock,
  Database,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Download,
  ShieldCheck,
  FileSpreadsheet,
  FileJson,
  Activity,
} from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { ActorRole, AuthorizedAction } from '../../types/domain';
import { canActorPerformAction, getActorMetadata } from '../../utils/rbac';
import { Form } from '../../components/ui/Form';
import { CheckboxField, SelectField } from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import {
  fetchEvaluationBenchmark,
  EvaluationBenchmarkPayload,
} from '../../services/workspaceClient';
import {
  CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026,
  CONFIGURABLE_SLA_RULES,
  DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
  DOCUMENTED_ROUTING_RULES,
} from '../../services/workflowEngine';
import {
  DETERMINISTIC_SEED,
  generateDeterministicDataset,
} from '../../services/dataGenerator';
import {
  evaluateOperationalAnomaliesAgainstGroundTruth,
  formatPhase8AnomalyScenariosCsv,
  formatPhase8EvaluationMetricsCsv,
  formatPhase8GroundTruthComparisonCsv,
  formatPhase8ValidationChecksCsv,
  runDatasetValidationSuite,
  verifyFixedSeedReproducibility,
} from '../../services/validationAndEvaluationEngine';

function triggerBrowserFileDownload(
  filename: string,
  content: string,
  mimeType: string
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export const SettingsPage: React.FC = () => {
  const { activeRole, workspaceData } = useWorkspaceContext();
  const actorMeta = getActorMetadata(activeRole);

  const canConfigureDepartmentRouting = canActorPerformAction(
    activeRole,
    AuthorizedAction.ConfigureDepartmentRouting
  );
  const canConfigurePlatformGovernance = canActorPerformAction(
    activeRole,
    AuthorizedAction.ConfigurePlatformGovernance
  );

  // Ground-truth evaluation dashboard is restricted to authorized administrative/staff roles
  // and never exposed to ordinary Learner or Instructor actors (Phase 8 Section 3 & Section 9).
  const isAuthorizedForGroundTruthEvaluation =
    activeRole === ActorRole.AcademicAdministrator ||
    activeRole === ActorRole.PlatformAdministrator ||
    activeRole === ActorRole.SupportStaff;

  const [emailDigestCadence, setEmailDigestCadence] = useState('immediate');
  const [notifyStageTransitions, setNotifyStageTransitions] = useState(true);
  const [notifyPolicyCitations, setNotifyPolicyCitations] = useState(true);
  const [routingMode, setRoutingMode] = useState('category-based');
  const [strictCitationEnforcement, setStrictCitationEnforcement] =
    useState(true);

  const [savedNotice, setSavedNotice] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Evaluation Benchmark state
  const [benchmarkMode, setBenchmarkMode] = useState<'starter' | 'full'>(
    'starter'
  );
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [apiBenchmarkResult, setApiBenchmarkResult] =
    useState<EvaluationBenchmarkPayload | null>(null);

  // Precompute deterministic starter evaluation locally for immediate administrative inspection
  const localDefaultEvaluation = useMemo<EvaluationBenchmarkPayload | null>(() => {
    if (!isAuthorizedForGroundTruthEvaluation) return null;
    const ds = generateDeterministicDataset({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
    });
    const validationReport = runDatasetValidationSuite(ds);
    const evaluationReport = evaluateOperationalAnomaliesAgainstGroundTruth(ds);
    const reproducibilityReport = verifyFixedSeedReproducibility({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
    });
    return {
      ok: true,
      metadata: {
        seed: ds.metadata.seed,
        mode: ds.metadata.mode,
        generatedAtAnchor: ds.metadata.generatedAtAnchor,
        generationOrder: [...ds.metadata.generationOrder],
        counts: { ...ds.metadata.counts },
      },
      validationReport,
      evaluationReport,
      reproducibilityReport,
    };
  }, [isAuthorizedForGroundTruthEvaluation]);

  const benchmarkResult = apiBenchmarkResult ?? localDefaultEvaluation;

  const routingRules =
    workspaceData?.knowledgeBase.routingRules ??
    Object.values(DOCUMENTED_ROUTING_RULES);
  const slaRules =
    workspaceData?.knowledgeBase.configurableSlaRules ??
    Object.values(CONFIGURABLE_SLA_RULES);
  const businessSchedule =
    workspaceData?.knowledgeBase.businessSchedule ??
    DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE;

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(true);
  };

  const handleConfirmResetDefaults = () => {
    setEmailDigestCadence('immediate');
    setNotifyStageTransitions(true);
    setNotifyPolicyCitations(true);
    setRoutingMode('category-based');
    setStrictCitationEnforcement(true);
    setSavedNotice(false);
    setResetDialogOpen(false);
  };

  const handleRunBenchmark = async () => {
    if (!isAuthorizedForGroundTruthEvaluation) return;
    setBenchmarkLoading(true);
    setBenchmarkError(null);
    try {
      const res = await fetchEvaluationBenchmark(benchmarkMode, activeRole);
      setApiBenchmarkResult(res);
    } catch {
      // If offline or unauthenticated preview, compute deterministically in-memory with identical seed 20261022
      try {
        const ds = generateDeterministicDataset({
          seed: DETERMINISTIC_SEED,
          mode: benchmarkMode,
        });
        const validationReport = runDatasetValidationSuite(ds);
        const evaluationReport =
          evaluateOperationalAnomaliesAgainstGroundTruth(ds);
        const reproducibilityReport = verifyFixedSeedReproducibility({
          seed: DETERMINISTIC_SEED,
          mode: 'starter',
        });
        setApiBenchmarkResult({
          ok: true,
          metadata: {
            seed: ds.metadata.seed,
            mode: ds.metadata.mode,
            generatedAtAnchor: ds.metadata.generatedAtAnchor,
            generationOrder: [...ds.metadata.generationOrder],
            counts: { ...ds.metadata.counts },
          },
          validationReport,
          evaluationReport,
          reproducibilityReport,
        });
      } catch (innerErr) {
        setBenchmarkError(
          innerErr instanceof Error
            ? innerErr.message
            : 'Failed to execute evaluation benchmark.'
        );
      }
    } finally {
      setBenchmarkLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
          <span>Workspace Governance, Routing Rules &amp; Quality Assurance</span>
          <span aria-hidden="true">·</span>
          <span>Active Role: {actorMeta.label}</span>
        </div>
        <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
          Settings, Governance &amp; Evaluation Dashboard
        </h1>
        <p className="text-sm text-[#292A25]/70">
          Configure workspace notification preferences, inspect departmental routing and business-hour SLA schedules, and run the institutional workflow &amp; compliance evaluation suite.
        </p>
      </div>

      {savedNotice && (
        <div
          role="status"
          className="rounded-md border border-[#777B63]/45 bg-[#E8E4DC]/75 p-4 text-xs text-[#292A25]/85"
        >
          <strong className="text-[#292A25] block mb-0.5">
            Preferences Saved ({actorMeta.label})
          </strong>
          Workspace notification and governance preferences have been updated for your session.
        </div>
      )}

      {/* Routing & Configurable Business-Hour SLA Matrix */}
      <div className="rounded-md surface-elevated p-6 md:p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-1 border-b border-[#292A25]/10 pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#777B63] uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5" />
            <span>
              Institutional Routing, Escalation &amp; Business-Hour SLA Schedule
            </span>
          </div>
          <h2 className="font-serif-display text-xl text-[#292A25]">
            Supported Category Routing &amp; Operating Schedule
          </h2>
          <p className="text-xs text-[#292A25]/75 leading-relaxed">
            Requests across the four supported institutional categories (
            <strong>Financial Aid</strong>, <strong>Registration</strong>,{' '}
            <strong>IT</strong>, and <strong>Accessibility</strong>) are routed
            to designated university support units and evaluated against the
            configured business-hour operating schedule (
            <strong>
              Mon–Fri {businessSchedule.workday_start_hour_utc}:00–
              {businessSchedule.workday_end_hour_utc}:00 UTC · 540 business
              minutes/day · {businessSchedule.schedule_code}
            </strong>
            ).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {routingRules.map((rule) => {
            const sla = slaRules.find(
              (s) => s.category_name === rule.category_name
            );
            return (
              <div
                key={rule.rule_id}
                className="rounded-md border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#777B63]">
                    {rule.rule_id}
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                    {rule.category_id}
                  </span>
                </div>
                <div className="text-sm font-semibold text-[#292A25]">
                  Category: {rule.category_name} → {rule.primary_assigned_team}
                </div>
                <div className="text-xs text-[#292A25]/75">
                  Escalation Committee:{' '}
                  <strong>{rule.escalation_assigned_team}</strong>
                </div>
                {sla && (
                  <div className="text-xs font-mono text-[#777B63] pt-1 border-t border-[#292A25]/10">
                    SLA Target: {sla.target_business_minutes} business mins ·
                    Approaching Warning at{' '}
                    {Math.round(
                      sla.target_business_minutes *
                        DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO
                    )}{' '}
                    mins (
                    {Math.round(DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO * 100)}%)
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2 text-xs text-[#292A25]/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#292A25]">
              Operating Calendar &amp; Escalation Warning Thresholds
            </span>
            <span className="font-mono text-[11px] text-[#777B63]">
              Timezone: {businessSchedule.timezone_name ?? 'UTC'} · Approaching Threshold:{' '}
              {Math.round(DEFAULT_APPROACHING_SLA_THRESHOLD_RATIO * 100)}%
            </span>
          </div>
          <p className="leading-relaxed">
            Business-hour SLA calculations pause outside standard weekday operating hours and exclude configured academic holidays:{' '}
            <code className="font-mono text-[11px]">
              {CONFIGURABLE_ACADEMIC_HOLIDAY_CALENDAR_2026.join(', ')}
            </code>
            .
          </p>
        </div>
      </div>

      {/* Quality Assurance & Compliance Evaluation Dashboard (Restricted to Administrative / Staff Roles) */}
      <div className="rounded-md surface-elevated p-6 md:p-8 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#292A25]/10 pb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#777B63] uppercase tracking-wider">
              <Database className="w-3.5 h-3.5" />
              <span>
                Institutional Quality Assurance &amp; Compliance Evaluation (Seed 20261022)
              </span>
            </div>
            <h2 className="font-serif-display text-xl text-[#292A25]">
              Data Integrity, End-to-End Workflow &amp; Ground-Truth Compliance Audit
            </h2>
            <p className="text-xs text-[#292A25]/70">
              Evaluation benchmark datasets are strictly isolated from live operational requests and verified against independent ground-truth reference records.
            </p>
          </div>

          {isAuthorizedForGroundTruthEvaluation && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Benchmark Dataset Scale"
                value={benchmarkMode}
                onChange={(e) =>
                  setBenchmarkMode(e.target.value as 'starter' | 'full')
                }
                className="rounded border border-[#292A25]/20 bg-[#F8F7F3] px-3 py-1.5 text-xs text-[#292A25]"
              >
                <option value="starter">
                  Starter Mode (50 Tickets / 24 KB / 200 Msgs)
                </option>
                <option value="full">
                  Full Scale (5,000 Tickets / 200 KB / 20,000 Msgs)
                </option>
              </select>
              <Button
                variant="primary"
                size="sm"
                disabled={benchmarkLoading}
                leftIcon={<Play className="w-3.5 h-3.5" />}
                onClick={handleRunBenchmark}
              >
                {benchmarkLoading ? 'Running Audit...' : 'Run Benchmark Audit'}
              </Button>
            </div>
          )}
        </div>

        {!isAuthorizedForGroundTruthEvaluation ? (
          <div
            role="alert"
            className="rounded border border-[#777B63]/40 bg-[#E8E4DC]/65 p-5 flex items-start gap-3 text-xs text-[#292A25]"
          >
            <Lock className="w-4 h-4 text-[#777B63] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <strong className="text-sm text-[#292A25]">
                Administrative Evaluation Dashboard Restricted ({actorMeta.label} View)
              </strong>
              <p className="text-[#292A25]/80 leading-relaxed">
                Ground-truth benchmark labels and administrative compliance evaluation metrics are restricted to authorized oversight roles (<code className="font-mono">Academic Administrator</code>, <code className="font-mono">Platform Administrator</code>, and <code className="font-mono">Support Staff</code>) and are not displayed to <code className="font-mono">Learner</code> or <code className="font-mono">Instructor</code> accounts.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded border border-[#777B63]/35 bg-[#E8E4DC]/55 p-3.5 text-xs text-[#292A25]/85 leading-relaxed">
              <strong className="text-[#292A25] block mb-1">
                Evaluation Methodology &amp; Ground-Truth Isolation (Seed 20261022)
              </strong>
              Ground-truth anomaly labels are stored separately from operational entity records and excluded prior to automated anomaly detection. Both raw benchmark dataset compliance rates (reflecting the 20% injected benchmark anomalies across expired policy citations, misrouted assignments, duplicate tickets, SLA breaches, and missing escalations) and automated detector accuracy rates are reported below with exact numerators and denominators.
            </div>

            {benchmarkError && (
              <div className="rounded border border-[#8F3F34]/40 bg-[#8F3F34]/10 p-3 text-xs text-[#8F3F34]">
                {benchmarkError}
              </div>
            )}

            {benchmarkResult && (
              <div className="flex flex-col gap-6">
                {/* Exportable Evaluation Artifacts Bar */}
                <div className="rounded border border-[#292A25]/15 bg-[#F8F7F3] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-[#292A25] flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-[#777B63]" />
                      Exportable Evaluation &amp; Validation Reports
                    </span>
                    <span className="text-[11px] text-[#292A25]/70">
                      Download machine-readable JSON and CSV reports for Seed{' '}
                      <code className="font-mono">{benchmarkResult.metadata.seed}</code> (
                      <code className="font-mono">{benchmarkResult.metadata.mode}</code> mode ·{' '}
                      {(benchmarkResult.metadata.counts.tickets ?? 0).toLocaleString()} tickets).
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<FileJson className="w-3.5 h-3.5" />}
                      onClick={() =>
                        triggerBrowserFileDownload(
                          `validation_report_${benchmarkResult.metadata.mode}_seed_${benchmarkResult.metadata.seed}.json`,
                          JSON.stringify(benchmarkResult.validationReport, null, 2),
                          'application/json'
                        )
                      }
                    >
                      Validation JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<FileJson className="w-3.5 h-3.5" />}
                      onClick={() =>
                        triggerBrowserFileDownload(
                          `evaluation_report_${benchmarkResult.metadata.mode}_seed_${benchmarkResult.metadata.seed}.json`,
                          JSON.stringify(benchmarkResult.evaluationReport, null, 2),
                          'application/json'
                        )
                      }
                    >
                      Evaluation JSON
                    </Button>
                    {benchmarkResult.reproducibilityReport && (
                      <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<FileJson className="w-3.5 h-3.5" />}
                        onClick={() =>
                          triggerBrowserFileDownload(
                            `reproducibility_report_seed_${benchmarkResult.metadata.seed}.json`,
                            JSON.stringify(
                              benchmarkResult.reproducibilityReport,
                              null,
                              2
                            ),
                            'application/json'
                          )
                        }
                      >
                        Reproducibility JSON
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                      onClick={() =>
                        triggerBrowserFileDownload(
                          `evaluation_metrics_${benchmarkResult.metadata.mode}_seed_${benchmarkResult.metadata.seed}.csv`,
                          formatPhase8EvaluationMetricsCsv(
                            benchmarkResult.evaluationReport
                          ),
                          'text/csv'
                        )
                      }
                    >
                      Metrics CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                      onClick={() =>
                        triggerBrowserFileDownload(
                          `anomaly_scenarios_${benchmarkResult.metadata.mode}_seed_${benchmarkResult.metadata.seed}.csv`,
                          formatPhase8AnomalyScenariosCsv(
                            benchmarkResult.evaluationReport
                          ),
                          'text/csv'
                        )
                      }
                    >
                      Anomalies CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                      onClick={() =>
                        triggerBrowserFileDownload(
                          `validation_checks_${benchmarkResult.metadata.mode}_seed_${benchmarkResult.metadata.seed}.csv`,
                          formatPhase8ValidationChecksCsv(
                            benchmarkResult.validationReport
                          ),
                          'text/csv'
                        )
                      }
                    >
                      Checks CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                      onClick={() =>
                        triggerBrowserFileDownload(
                          `ground_truth_comparison_${benchmarkResult.metadata.mode}_seed_${benchmarkResult.metadata.seed}.csv`,
                          formatPhase8GroundTruthComparisonCsv(
                            benchmarkResult.evaluationReport
                          ),
                          'text/csv'
                        )
                      }
                    >
                      Ground-Truth Comparison CSV
                    </Button>
                  </div>
                </div>

                {/* Summary KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-3">
                    <span className="text-[11px] text-[#777B63] block">
                      Seed, Scale &amp; Checksums
                    </span>
                    <strong className="font-mono text-sm text-[#292A25]">
                      {benchmarkResult.metadata.seed} (
                      {benchmarkResult.metadata.mode.toUpperCase()} · Deterministic)
                    </strong>
                  </div>
                  <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-3">
                    <span className="text-[11px] text-[#777B63] block">
                      Tickets / Messages / KB
                    </span>
                    <strong className="font-mono text-sm text-[#292A25]">
                      {(benchmarkResult.metadata.counts.tickets ?? 0).toLocaleString()}{' '}
                      /{' '}
                      {(benchmarkResult.metadata.counts.messages ?? 0).toLocaleString()}{' '}
                      /{' '}
                      {(
                        benchmarkResult.metadata.counts.knowledgeArticles ?? 0
                      ).toLocaleString()}
                    </strong>
                  </div>
                  <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-3">
                    <span className="text-[11px] text-[#777B63] block">
                      13 Data Quality Checks
                    </span>
                    <strong className="font-mono text-sm text-[#292A25]">
                      {
                        benchmarkResult.validationReport.checks.filter(
                          (c) => c.passed
                        ).length
                      }
                      /{benchmarkResult.validationReport.checks.length} Passed (0
                      Silent Repairs)
                    </strong>
                  </div>
                  <div className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-3">
                    <span className="text-[11px] text-[#777B63] block">
                      5-Anomaly F1 &amp; Isolation
                    </span>
                    <strong className="font-mono text-sm text-[#292A25]">
                      F1 ={' '}
                      {benchmarkResult.evaluationReport.overallMetrics.f1Score.toFixed(
                        4
                      )}{' '}
                      ({benchmarkResult.evaluationReport.totalDetectedAnomalies}/
                      {benchmarkResult.evaluationReport.totalGroundTruthAnomalies}{' '}
                      TP)
                    </strong>
                  </div>
                </div>

                {/* Section 6: 11 Explicit Evaluation Metrics with Numerator, Denominator & Population */}
                {benchmarkResult.evaluationReport.explicitMetrics && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#777B63] flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      11 Explicit Evaluation Metrics (Actual Numerators, Denominators &amp; Populations)
                    </h3>
                    <div className="overflow-x-auto rounded border border-[#292A25]/12">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#E8E4DC] text-[#292A25]">
                          <tr>
                            <th className="p-2.5 font-semibold">Metric</th>
                            <th className="p-2.5 font-semibold">
                              Engine / Detector (Num / Denom)
                            </th>
                            <th className="p-2.5 font-semibold">
                              Raw Benchmark Compliance
                            </th>
                            <th className="p-2.5 font-semibold">
                              Evaluation Population &amp; Mode
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#292A25]/10 bg-[#F8F7F3]">
                          {benchmarkResult.evaluationReport.explicitMetrics.map(
                            (m) => (
                              <tr key={m.metricId}>
                                <td className="p-2.5">
                                  <div className="font-semibold text-[#292A25]">
                                    {m.metricName}
                                  </div>
                                  <div className="font-mono text-[10px] text-[#777B63]">
                                    {m.metricId}
                                  </div>
                                </td>
                                <td className="p-2.5 font-mono text-[#292A25]">
                                  <strong>{m.percentage.toFixed(2)}%</strong> (
                                  {m.numerator.toLocaleString()} /{' '}
                                  {m.denominator.toLocaleString()})
                                </td>
                                <td className="p-2.5 font-mono text-[#292A25]/85">
                                  {m.rawOperationalNumerator !== undefined &&
                                  m.rawOperationalDenominator !== undefined
                                    ? `${(
                                        (m.rawOperationalRate ?? m.rate) * 100
                                      ).toFixed(2)}% (${m.rawOperationalNumerator.toLocaleString()} / ${m.rawOperationalDenominator.toLocaleString()})`
                                    : `${m.percentage.toFixed(2)}%`}
                                </td>
                                <td className="p-2.5 text-[11px] text-[#292A25]/80">
                                  <div>{m.evaluationPopulation}</div>
                                  <div className="font-mono text-[10px] text-[#777B63] mt-0.5">
                                    Mode: {m.evaluationMode} — {m.explanation}
                                  </div>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Section 4: 5 Anomaly Scenarios Detailed Verification */}
                {benchmarkResult.evaluationReport.fiveScenarioVerifications && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#777B63]">
                      5 Compliance Anomaly Scenarios — Detection &amp; Remediation Verification
                    </h3>
                    <div className="grid grid-cols-1 gap-3">
                      {benchmarkResult.evaluationReport.fiveScenarioVerifications.map(
                        (sc) => (
                          <div
                            key={sc.scenarioId}
                            className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-4 flex flex-col gap-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-[#777B63]">
                                  {sc.scenarioId}
                                </span>
                                <span className="text-sm font-semibold text-[#292A25]">
                                  {sc.scenarioTitle}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 font-mono text-[11px]">
                                <span className="px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                                  Record: {sc.sampleInputRecordId} · GT:{' '}
                                  {sc.sampleGroundTruthAnomalyId}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-[#777B63]/15 text-[#292A25] font-semibold">
                                  TP {sc.truePositives}/{sc.groundTruthCount} · FP{' '}
                                  {sc.falsePositives} · FN {sc.falseNegatives} ·{' '}
                                  {sc.passFailResult}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                              <div className="rounded bg-[#E8E4DC]/45 p-2.5">
                                <strong className="block text-[10px] uppercase text-[#777B63]">
                                  Expected Ground-Truth Outcome
                                </strong>
                                <span className="text-[#292A25]/85">
                                  {sc.expectedGroundTruthOutcome}
                                </span>
                              </div>
                              <div className="rounded bg-[#E8E4DC]/45 p-2.5">
                                <strong className="block text-[10px] uppercase text-[#777B63]">
                                  Observed Perturbed Benchmark Record
                                </strong>
                                <span className="text-[#292A25]/85">
                                  {sc.actualOperationalRecordObserved}
                                </span>
                              </div>
                              <div className="rounded bg-[#E8E4DC]/45 p-2.5">
                                <strong className="block text-[10px] uppercase text-[#777B63]">
                                  Actual System Detection &amp; Handling
                                </strong>
                                <span className="text-[#292A25]/85">
                                  {sc.actualSystemRemediationOutcome}
                                </span>
                              </div>
                            </div>
                            <div className="text-[11px] text-[#292A25]/75 pt-1 border-t border-[#292A25]/10">
                              <strong>Evidence &amp; Rule Trace ({sc.ruleReference}):</strong>{' '}
                              {sc.evidenceAndFailureExplanation}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Section 5: 12-Stage End-to-End Workflow Evaluation */}
                {benchmarkResult.evaluationReport.workflowStageEvaluations && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#777B63]">
                      12-Stage End-to-End Workflow Evaluation (Normal, Boundary, Failure &amp; Exception Scenarios)
                    </h3>
                    <div className="overflow-x-auto rounded border border-[#292A25]/12">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#E8E4DC] text-[#292A25]">
                          <tr>
                            <th className="p-2.5 font-semibold">Workflow Stage</th>
                            <th className="p-2.5 font-semibold">Population</th>
                            <th className="p-2.5 font-semibold">
                              Raw Dataset / Engine Accuracy
                            </th>
                            <th className="p-2.5 font-semibold">
                              Scenario Coverage (Norm / Bnd / Fail / Esc)
                            </th>
                            <th className="p-2.5 font-semibold">Verification Summary</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#292A25]/10 bg-[#F8F7F3]">
                          {benchmarkResult.evaluationReport.workflowStageEvaluations.map(
                            (st) => (
                              <tr key={st.stageCode}>
                                <td className="p-2.5 font-semibold text-[#292A25]">
                                  {st.stageName}
                                </td>
                                <td className="p-2.5 font-mono">
                                  {st.evaluatedPopulationCount.toLocaleString()}
                                </td>
                                <td className="p-2.5 font-mono">
                                  {(st.operationalComplianceRate * 100).toFixed(1)}% /{' '}
                                  <strong>
                                    {(st.engineHandlingAccuracy * 100).toFixed(1)}%
                                  </strong>
                                </td>
                                <td className="p-2.5 font-mono text-[11px]">
                                  {st.normalScenarioPass ? 'PASS' : 'FAIL'} /{' '}
                                  {st.boundaryScenarioPass ? 'PASS' : 'FAIL'} /{' '}
                                  {st.failureOrAnomalyScenarioPass ? 'PASS' : 'FAIL'}{' '}
                                  / {st.exceptionEscalationPass ? 'PASS' : 'FAIL'}
                                </td>
                                <td className="p-2.5 text-[11px] text-[#292A25]/80">
                                  {st.summaryExplanation}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Section 2: 11 Core Entities Validation Summary */}
                {benchmarkResult.validationReport.entityValidationSummary && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#777B63]">
                      11 Core Entities Structural &amp; Referential Integrity Summary
                    </h3>
                    <div className="overflow-x-auto rounded border border-[#292A25]/12">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#E8E4DC] text-[#292A25]">
                          <tr>
                            <th className="p-2.5 font-semibold"># · Entity</th>
                            <th className="p-2.5 font-semibold">Rows</th>
                            <th className="p-2.5 font-semibold">PK Format</th>
                            <th className="p-2.5 font-semibold">
                              Structural Violations
                            </th>
                            <th className="p-2.5 font-semibold">
                              Flagged Benchmark Anomalies
                            </th>
                            <th className="p-2.5 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#292A25]/10 bg-[#F8F7F3]">
                          {benchmarkResult.validationReport.entityValidationSummary.map(
                            (ent) => (
                              <tr key={ent.entityName}>
                                <td className="p-2.5 font-semibold text-[#292A25]">
                                  {ent.entityOrder}. {ent.entityName}
                                </td>
                                <td className="p-2.5 font-mono">
                                  {ent.totalRecords.toLocaleString()}
                                </td>
                                <td className="p-2.5 font-mono text-[11px] text-[#777B63]">
                                  {ent.primaryKeyFormat}
                                </td>
                                <td className="p-2.5 font-mono">
                                  {ent.structuralViolationCount}
                                </td>
                                <td className="p-2.5 font-mono">
                                  {ent.intentionalAnomalyCount}
                                </td>
                                <td className="p-2.5 font-mono">
                                  {ent.passed ? 'PASS' : 'FAILED'}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 13 Validation Checks List with Actionable Explanations */}
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#777B63]">
                    13 Automated Data Quality Checks &amp; Flagged Record Explanations
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {benchmarkResult.validationReport.checks.map((c) => (
                      <div
                        key={c.checkId}
                        className="rounded border border-[#292A25]/12 bg-[#F8F7F3] p-3 flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#292A25]">
                            {c.checkId}: {c.checkName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded ${
                              c.passed
                                ? 'bg-[#777B63]/15 text-[#292A25]'
                                : 'bg-[#8F3F34]/15 text-[#8F3F34]'
                            }`}
                          >
                            {c.passed ? (
                              <CheckCircle2 className="w-3 h-3 text-[#777B63]" />
                            ) : (
                              <AlertTriangle className="w-3 h-3 text-[#8F3F34]" />
                            )}
                            {c.passed ? 'PASS' : `FLAGGED (${c.violationCount})`}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#292A25]/75">{c.details}</p>
                        {c.sampleFindings.length > 0 && (
                          <div className="mt-1 rounded bg-[#E8E4DC]/55 p-2 font-mono text-[10px] text-[#292A25]/85 flex flex-col gap-0.5">
                            {c.sampleFindings.slice(0, 2).map((finding, idx) => (
                              <div key={idx}>• {finding}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 7: Fixed-Seed Reproducibility & Checksum Verification Status */}
                {benchmarkResult.reproducibilityReport && (
                  <div className="rounded border border-[#292A25]/15 bg-[#F8F7F3] p-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#292A25] flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-[#777B63]" />
                        Fixed-Seed Reproducibility &amp; SHA-256 Checksum Verification (Seed{' '}
                        {benchmarkResult.reproducibilityReport.seed})
                      </span>
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#777B63]/15 text-[#292A25] font-semibold">
                        Run 1 === Run 2:{' '}
                        {benchmarkResult.reproducibilityReport.run1EqualsRun2
                          ? 'VERIFIED IDENTICAL (100%)'
                          : 'MISMATCH'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono text-[#292A25]/80">
                      <div>
                        Bundle SHA-256:{' '}
                        {benchmarkResult.reproducibilityReport.checksumsRun1.entireBundleJson.slice(
                          0,
                          20
                        )}
                        ...
                      </div>
                      <div>
                        Validation SHA-256:{' '}
                        {benchmarkResult.reproducibilityReport.validationReportSha256Run1.slice(
                          0,
                          20
                        )}
                        ...
                      </div>
                      <div>
                        Evaluation SHA-256:{' '}
                        {benchmarkResult.reproducibilityReport.evaluationReportSha256Run1.slice(
                          0,
                          20
                        )}
                        ...
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* User Notification & Role-Scoped Governance Preferences */}
      <div className="rounded-md surface-elevated p-6 md:p-8">
        <Form
          title="Notification & Interface Preferences"
          description="Configure personal alert delivery and role-scoped workflow guardrails."
          onSubmit={handleSaveSettings}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setResetDialogOpen(true)}
              >
                Reset to Defaults
              </Button>
              <Button type="submit" variant="primary">
                Save Preferences
              </Button>
            </>
          }
        >
          <SelectField
            label="Notification Delivery Preference"
            value={emailDigestCadence}
            onChange={(e) => setEmailDigestCadence(e.target.value)}
            options={[
              {
                value: 'immediate',
                label: 'Notify on Request Stage Transitions',
              },
              {
                value: 'summary',
                label: 'Periodic Summary Digest',
              },
              {
                value: 'escalations-only',
                label: 'Escalation & Resolution Updates Only',
              },
            ]}
          />

          <CheckboxField
            label="Notify me when a request transitions between intake, review, and resolution stages."
            checked={notifyStageTransitions}
            onChange={(e) => setNotifyStageTransitions(e.target.checked)}
          />

          <CheckboxField
            label="Include policy reference context in notification summaries."
            checked={notifyPolicyCitations}
            onChange={(e) => setNotifyPolicyCitations(e.target.checked)}
          />

          {canConfigureDepartmentRouting && (
            <div className="pt-6 mt-2 border-t border-[#292A25]/12 flex flex-col gap-4">
              <div>
                <div className="text-xs font-semibold text-[#777B63]">
                  Departmental Routing Configuration
                </div>
                <p className="text-xs text-[#292A25]/70 mt-0.5">
                  Available to Academic Administrators and Platform
                  Administrators.
                </p>
              </div>

              <SelectField
                label="Departmental Queue Routing Mode"
                value={routingMode}
                onChange={(e) => setRoutingMode(e.target.value)}
                options={[
                  {
                    value: 'category-based',
                    label: 'Route by Request Category & Academic Unit',
                  },
                  {
                    value: 'triage-first',
                    label: 'Route via Support Staff Intake Triage First',
                  },
                  {
                    value: 'escalation-review',
                    label: 'Direct Escalated Cases to Administrative Review',
                  },
                ]}
              />
            </div>
          )}

          {canConfigurePlatformGovernance && (
            <div className="pt-6 mt-2 border-t border-[#292A25]/12 flex flex-col gap-4">
              <div>
                <div className="text-xs font-semibold text-[#777B63]">
                  Platform Governance Guardrails
                </div>
                <p className="text-xs text-[#292A25]/70 mt-0.5">
                  Available to Platform Administrators.
                </p>
              </div>

              <CheckboxField
                label="Require policy reference attachment before an escalated case is marked Resolved."
                checked={strictCitationEnforcement}
                onChange={(e) => setStrictCitationEnforcement(e.target.checked)}
              />
            </div>
          )}

          {!canConfigureDepartmentRouting && !canConfigurePlatformGovernance && (
            <div className="pt-4 border-t border-[#292A25]/10 flex items-center gap-2.5 text-xs text-[#292A25]/65">
              <Lock
                className="w-3.5 h-3.5 text-[#777B63] shrink-0"
                aria-hidden="true"
              />
              <span>
                Departmental routing configuration is restricted to
                administrative roles ({actorMeta.label} view).
              </span>
            </div>
          )}
        </Form>
      </div>

      <ConfirmationDialog
        isOpen={resetDialogOpen}
        title="Reset Workspace Preferences"
        description="Restore all notification and configuration controls on this screen to their default values?"
        confirmLabel="Restore Defaults"
        cancelLabel="Cancel"
        onConfirm={handleConfirmResetDefaults}
        onCancel={() => setResetDialogOpen(false)}
      />
    </div>
  );
};
