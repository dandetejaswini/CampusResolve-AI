import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  generateDeterministicDataset,
  DETERMINISTIC_SEED,
  BASE_ANCHOR_DATE_ISO,
  GeneratedDatasetBundle,
} from '../src/services/dataGenerator';
import {
  runDatasetValidationSuite,
  evaluateOperationalAnomaliesAgainstGroundTruth,
  evaluateComparativeBaselines,
  formatBaselineComparisonCsv,
  formatConfusionMatrixCsv,
  formatPhase8AnomalyScenariosCsv,
  formatPhase8EvaluationMetricsCsv,
  formatPhase8GroundTruthComparisonCsv,
  formatPhase8ValidationChecksCsv,
} from '../src/services/validationAndEvaluationEngine';
import {
  CONFIGURABLE_SLA_RULES,
  DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
  DOCUMENTED_ROUTING_RULES,
} from '../src/services/workflowEngine';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function toCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const raw = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ];
  return lines.join('\n') + '\n';
}

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    const items = val.map(
      (item) => `'${String(item).replace(/'/g, "''")}'`
    );
    return `ARRAY[${items.join(', ')}]::text[]`;
  }
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

function toSqlInsertBlock<T extends Record<string, unknown>>(
  tableName: string,
  rows: T[],
  conflictTarget: string
): string {
  if (rows.length === 0) return `-- No rows for public.${tableName}\n`;
  const cols = Object.keys(rows[0]);
  const valueLines = rows.map(
    (r) => `  (${cols.map((c) => sqlLiteral(r[c])).join(', ')})`
  );
  return [
    `-- Master-first deterministic synthetic export for public.${tableName} (${rows.length} rows)`,
    `INSERT INTO public.${tableName} (${cols.join(', ')})`,
    `VALUES`,
    `${valueLines.join(',\n')}`,
    `ON CONFLICT (${conflictTarget}) DO NOTHING;\n`,
  ].join('\n');
}

function buildSqlBenchmarkExport(bundle: GeneratedDatasetBundle): string {
  const header = [
    `-- ============================================================================`,
    `-- CAMPUSRESOLVE AI — PHASE 4 DETERMINISTIC SYNTHETIC BENCHMARK SQL EXPORT`,
    `-- Fixed Deterministic Seed: ${bundle.metadata.seed}`,
    `-- Anchor Timestamp: ${bundle.metadata.generatedAtAnchor}`,
    `-- Mode: ${bundle.metadata.mode} (Isolated synthetic records: is_synthetic_eval = true)`,
    `-- Provenance: CC0-1.0 Synthetic Demonstration & Evaluation Corpus (Non-Regulatory)`,
    `-- Safety: Uses ON CONFLICT DO NOTHING and never overwrites live user records.`,
    `-- Ground-truth evaluation labels are strictly excluded from operational SQL.`,
    `-- ============================================================================\n`,
    `BEGIN;\n`,
  ].join('\n');

  const blocks = [
    toSqlInsertBlock('roles', bundle.roles as unknown as Record<string, unknown>[], 'role_id'),
    toSqlInsertBlock('terms', bundle.terms as unknown as Record<string, unknown>[], 'term_id'),
    toSqlInsertBlock('categories', bundle.categories as unknown as Record<string, unknown>[], 'category_id'),
    toSqlInsertBlock('requesters', bundle.requesters as unknown as Record<string, unknown>[], 'requester_id'),
    toSqlInsertBlock('policy_documents', bundle.policyDocuments as unknown as Record<string, unknown>[], 'policy_id'),
    toSqlInsertBlock('knowledge_articles', bundle.knowledgeArticles as unknown as Record<string, unknown>[], 'article_id'),
    toSqlInsertBlock('policy_article_links', bundle.policyArticleLinks as unknown as Record<string, unknown>[], 'link_id'),
    toSqlInsertBlock('tickets', bundle.tickets as unknown as Record<string, unknown>[], 'ticket_id'),
    toSqlInsertBlock('ticket_policy_links', bundle.ticketPolicyLinks as unknown as Record<string, unknown>[], 'link_id'),
    toSqlInsertBlock('ticket_article_links', bundle.ticketArticleLinks as unknown as Record<string, unknown>[], 'link_id'),
    toSqlInsertBlock('ticket_lifecycle_events', bundle.ticketLifecycleEvents as unknown as Record<string, unknown>[], 'event_id'),
    toSqlInsertBlock('messages', bundle.messages as unknown as Record<string, unknown>[], 'message_id'),
    toSqlInsertBlock('assignments', bundle.assignments as unknown as Record<string, unknown>[], 'assignment_id'),
    toSqlInsertBlock('slas', bundle.slas as unknown as Record<string, unknown>[], 'sla_id'),
    toSqlInsertBlock('resolution_feedbacks', bundle.resolutionFeedbacks as unknown as Record<string, unknown>[], 'feedback_id'),
  ];

  return `${header}${blocks.join('\n')}\nCOMMIT;\n`;
}

function computeDatasetEntityHashes(bundle: GeneratedDatasetBundle) {
  return {
    requesters: sha256(JSON.stringify(bundle.requesters)),
    roles: sha256(JSON.stringify(bundle.roles)),
    terms: sha256(JSON.stringify(bundle.terms)),
    policyDocuments: sha256(JSON.stringify(bundle.policyDocuments)),
    knowledgeArticles: sha256(JSON.stringify(bundle.knowledgeArticles)),
    categories: sha256(JSON.stringify(bundle.categories)),
    tickets: sha256(JSON.stringify(bundle.tickets)),
    messages: sha256(JSON.stringify(bundle.messages)),
    assignments: sha256(JSON.stringify(bundle.assignments)),
    slas: sha256(JSON.stringify(bundle.slas)),
    resolutionFeedbacks: sha256(JSON.stringify(bundle.resolutionFeedbacks)),
    policyArticleLinks: sha256(JSON.stringify(bundle.policyArticleLinks)),
    ticketPolicyLinks: sha256(JSON.stringify(bundle.ticketPolicyLinks)),
    ticketArticleLinks: sha256(JSON.stringify(bundle.ticketArticleLinks)),
    ticketLifecycleEvents: sha256(JSON.stringify(bundle.ticketLifecycleEvents)),
    groundTruthAnomalies: sha256(JSON.stringify(bundle.groundTruthAnomalies)),
    groundTruthTicketEvaluations: sha256(
      JSON.stringify(bundle.groundTruthTicketEvaluations)
    ),
    entireBundleJson: sha256(JSON.stringify(bundle)),
  };
}

async function main() {
  console.log(
    `[CampusResolve AI — Phase 4] Running deterministic dataset generator twice with fixed seed ${DETERMINISTIC_SEED}...`
  );

  // Run 1 (Full Challenge Scale: 5,000 tickets, 200 knowledge articles, 20,000 messages)
  const fullRun1 = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode: 'full',
  });
  const fullHashes1 = computeDatasetEntityHashes(fullRun1);

  // Run 2 (Verify 100% Determinism & Identical Checksums)
  const fullRun2 = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode: 'full',
  });
  const fullHashes2 = computeDatasetEntityHashes(fullRun2);

  for (const key of Object.keys(fullHashes1) as Array<keyof typeof fullHashes1>) {
    if (fullHashes1[key] !== fullHashes2[key]) {
      throw new Error(
        `Determinism verification failed for entity ${key}: ${fullHashes1[key]} !== ${fullHashes2[key]}`
      );
    }
  }

  console.log(
    `[CampusResolve AI — Phase 4] Determinism Verified! Run 1 and Run 2 SHA-256 checksums match 100% across all 11 entities, bridge tables, and ground truth.`
  );

  // Run 13-point validation (+ distributions/coverage) & 5-scenario ground-truth evaluation on both runs
  const fullValidationReport1 = runDatasetValidationSuite(fullRun1);
  const fullValidationReport2 = runDatasetValidationSuite(fullRun2);
  const fullEvaluationReport1 =
    evaluateOperationalAnomaliesAgainstGroundTruth(fullRun1);
  const fullEvaluationReport2 =
    evaluateOperationalAnomaliesAgainstGroundTruth(fullRun2);

  const valHash1 = sha256(JSON.stringify(fullValidationReport1));
  const valHash2 = sha256(JSON.stringify(fullValidationReport2));
  const evalHash1 = sha256(JSON.stringify(fullEvaluationReport1));
  const evalHash2 = sha256(JSON.stringify(fullEvaluationReport2));

  if (valHash1 !== valHash2 || evalHash1 !== evalHash2) {
    throw new Error(
      'Validation or Evaluation report SHA-256 checksum differed between Run 1 and Run 2.'
    );
  }

  // Also generate starter bundle twice for SQL export & lightweight inspection
  const starterRun1 = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode: 'starter',
  });
  const starterRun2 = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode: 'starter',
  });
  const sqlExport1 = buildSqlBenchmarkExport(starterRun1);
  const sqlExport2 = buildSqlBenchmarkExport(starterRun2);
  const sqlExportHash1 = sha256(sqlExport1);
  const sqlExportHash2 = sha256(sqlExport2);

  if (sqlExportHash1 !== sqlExportHash2) {
    throw new Error('SQL export SHA-256 checksum differed between Run 1 and Run 2.');
  }

  const datasetsDir = path.resolve(process.cwd(), 'datasets');
  const csvDir = path.join(datasetsDir, 'csv');
  const jsonDir = path.join(datasetsDir, 'json');
  const sqlDir = path.join(datasetsDir, 'sql');
  fs.mkdirSync(csvDir, { recursive: true });
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(sqlDir, { recursive: true });

  // 1. Write starter_dataset.json (all 11 entities in starter mode, strictly excluding ground truth)
  const {
    groundTruthAnomalies: _starterGtA,
    groundTruthTicketEvaluations: _starterGtT,
    ...starterOperationalEntities
  } = starterRun1;
  fs.writeFileSync(
    path.join(datasetsDir, 'starter_dataset.json'),
    JSON.stringify(starterOperationalEntities, null, 2),
    'utf8'
  );

  // 2. Write per-entity JSON exports for all 11 required entities (full scale) in datasets/json/
  const entityJsonFiles: Record<string, unknown[]> = {
    'requesters.json': fullRun1.requesters,
    'roles.json': fullRun1.roles,
    'terms.json': fullRun1.terms,
    'policy_documents.json': fullRun1.policyDocuments,
    'knowledge_articles.json': fullRun1.knowledgeArticles,
    'categories.json': fullRun1.categories,
    'tickets.json': fullRun1.tickets,
    'messages.json': fullRun1.messages,
    'assignments.json': fullRun1.assignments,
    'slas.json': fullRun1.slas,
    'resolution_feedbacks.json': fullRun1.resolutionFeedbacks,
  };

  const jsonExportChecksums: Record<string, string> = {};
  for (const [fileName, dataArr] of Object.entries(entityJsonFiles)) {
    const content = JSON.stringify(dataArr, null, 2);
    fs.writeFileSync(path.join(jsonDir, fileName), content, 'utf8');
    jsonExportChecksums[fileName] = sha256(content);
  }

  // 3. Write separate ground_truth.json and ground_truth.csv from the full 5,000-ticket benchmark
  const groundTruthJsonContent = JSON.stringify(
    {
      seed: DETERMINISTIC_SEED,
      mode: 'full',
      generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
      isolationNotice:
        'STRICT GROUND-TRUTH ISOLATION: This file is used exclusively by validationAndEvaluationEngine.ts for benchmark verification and is never accessible to operational routing, SLA calculation, or AI RAG synthesis.',
      totalGroundTruthAnomalies: fullRun1.groundTruthAnomalies.length,
      totalTicketEvaluations: fullRun1.groundTruthTicketEvaluations.length,
      anomalies: fullRun1.groundTruthAnomalies,
      ticketEvaluationsSample: fullRun1.groundTruthTicketEvaluations.slice(
        0,
        250
      ),
    },
    null,
    2
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'ground_truth.json'),
    groundTruthJsonContent,
    'utf8'
  );

  const groundTruthCsvContent = toCsv(
    fullRun1.groundTruthAnomalies as unknown as Record<string, unknown>[]
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'ground_truth.csv'),
    groundTruthCsvContent,
    'utf8'
  );

  // 4. Write complete CSV exports for all 11 core entities (plus sample CSVs for backward compatibility)
  const csvExportsMap: Record<string, Record<string, unknown>[]> = {
    'requesters.csv': fullRun1.requesters as unknown as Record<string, unknown>[],
    'roles.csv': fullRun1.roles as unknown as Record<string, unknown>[],
    'terms.csv': fullRun1.terms as unknown as Record<string, unknown>[],
    'policy_documents.csv': fullRun1.policyDocuments as unknown as Record<string, unknown>[],
    'knowledge_articles.csv': fullRun1.knowledgeArticles as unknown as Record<string, unknown>[],
    'categories.csv': fullRun1.categories as unknown as Record<string, unknown>[],
    'tickets.csv': fullRun1.tickets as unknown as Record<string, unknown>[],
    'messages.csv': fullRun1.messages as unknown as Record<string, unknown>[],
    'assignments.csv': fullRun1.assignments as unknown as Record<string, unknown>[],
    'slas.csv': fullRun1.slas as unknown as Record<string, unknown>[],
    'resolution_feedbacks.csv': fullRun1.resolutionFeedbacks as unknown as Record<string, unknown>[],
    'messages_sample.csv': fullRun1.messages.slice(0, 1000) as unknown as Record<string, unknown>[],
    'assignments_sample.csv': fullRun1.assignments.slice(0, 1000) as unknown as Record<string, unknown>[],
    'slas_sample.csv': fullRun1.slas.slice(0, 1000) as unknown as Record<string, unknown>[],
    'resolution_feedbacks_sample.csv': fullRun1.resolutionFeedbacks.slice(0, 1000) as unknown as Record<string, unknown>[],
  };

  const csvExportChecksums: Record<string, string> = {};
  for (const [csvName, rows] of Object.entries(csvExportsMap)) {
    const csvText = toCsv(rows);
    fs.writeFileSync(path.join(csvDir, csvName), csvText, 'utf8');
    csvExportChecksums[csvName] = sha256(csvText);
  }

  // 5. Write SQL export in datasets/sql/phase4_synthetic_benchmark_export.sql
  fs.writeFileSync(
    path.join(sqlDir, 'phase4_synthetic_benchmark_export.sql'),
    sqlExport1,
    'utf8'
  );

  // 6. Write validation_report.json, evaluation_report.json, and Phase 8 specialized JSON/CSV evaluation artifacts
  fs.writeFileSync(
    path.join(datasetsDir, 'validation_report.json'),
    JSON.stringify(fullValidationReport1, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'evaluation_report.json'),
    JSON.stringify(fullEvaluationReport1, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'evaluation_metrics_report.json'),
    JSON.stringify(
      {
        seed: DETERMINISTIC_SEED,
        mode: 'full',
        generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
        totalTicketsEvaluated: fullEvaluationReport1.totalTicketsEvaluated,
        overallMetrics: fullEvaluationReport1.overallMetrics,
        explicitMetrics: fullEvaluationReport1.explicitMetrics,
        workflowStageEvaluations:
          fullEvaluationReport1.workflowStageEvaluations,
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'anomaly_detection_results.json'),
    JSON.stringify(
      {
        seed: DETERMINISTIC_SEED,
        mode: 'full',
        generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
        totalTicketsEvaluated: fullEvaluationReport1.totalTicketsEvaluated,
        totalGroundTruthAnomalies:
          fullEvaluationReport1.totalGroundTruthAnomalies,
        totalDetectedAnomalies: fullEvaluationReport1.totalDetectedAnomalies,
        groundTruthSeparationVerified:
          fullEvaluationReport1.groundTruthSeparationVerified,
        byAnomalyType: fullEvaluationReport1.byAnomalyType,
        fiveScenarioVerifications:
          fullEvaluationReport1.fiveScenarioVerifications,
        sampleDetectedAnomalies: fullEvaluationReport1.sampleDetectedAnomalies,
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'ground_truth_comparison_report.json'),
    JSON.stringify(
      {
        seed: DETERMINISTIC_SEED,
        mode: 'full',
        generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
        groundTruthSeparationVerified:
          fullEvaluationReport1.groundTruthSeparationVerified,
        groundTruthComparisonSummary:
          fullEvaluationReport1.groundTruthComparisonSummary,
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'reproducibility_report.json'),
    JSON.stringify(
      {
        seed: DETERMINISTIC_SEED,
        mode: 'full',
        verifiedAtAnchor: BASE_ANCHOR_DATE_ISO,
        run1EqualsRun2: true,
        entityCountsMatch: true,
        deterministicIdsMatch: true,
        groundTruthOutputsMatch: true,
        validationReportsMatch: valHash1 === valHash2,
        evaluationReportsMatch: evalHash1 === evalHash2,
        operationalProductionRecordsUntouched: true,
        entityCounts: fullRun1.metadata.counts,
        checksumsRun1: fullHashes1,
        checksumsRun2: fullHashes2,
        validationReportSha256Run1: valHash1,
        validationReportSha256Run2: valHash2,
        evaluationReportSha256Run1: evalHash1,
        evaluationReportSha256Run2: evalHash2,
        sqlExportSha256Run1: sqlExportHash1,
        sqlExportSha256Run2: sqlExportHash2,
      },
      null,
      2
    ),
    'utf8'
  );

  // Write Phase 8 CSV evaluation artifacts in datasets/csv/
  const comparativeReport = evaluateComparativeBaselines(fullRun1);
  const baselineComparisonCsv = formatBaselineComparisonCsv(comparativeReport);
  const confusionMatrixCsv = formatConfusionMatrixCsv(comparativeReport);

  fs.writeFileSync(path.join(csvDir, 'baseline_comparison.csv'), baselineComparisonCsv, 'utf8');
  fs.writeFileSync(path.join(csvDir, 'confusion_matrix.csv'), confusionMatrixCsv, 'utf8');
  csvExportChecksums['baseline_comparison.csv'] = sha256(baselineComparisonCsv);
  csvExportChecksums['confusion_matrix.csv'] = sha256(confusionMatrixCsv);

  fs.writeFileSync(
    path.join(jsonDir, 'baseline_comparison.json'),
    JSON.stringify(comparativeReport, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'baseline_comparison.json'),
    JSON.stringify(comparativeReport, null, 2),
    'utf8'
  );
  jsonExportChecksums['baseline_comparison.json'] = sha256(
    JSON.stringify(comparativeReport, null, 2)
  );

  const comprehensiveEvaluationSummary = {
    seed: DETERMINISTIC_SEED,
    generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
    totalTicketsEvaluated: fullEvaluationReport1.totalTicketsEvaluated,
    totalGroundTruthAnomalies: fullEvaluationReport1.totalGroundTruthAnomalies,
    totalDetectedAnomalies: fullEvaluationReport1.totalDetectedAnomalies,
    overallMetrics: fullEvaluationReport1.overallMetrics,
    byAnomalyType: fullEvaluationReport1.byAnomalyType,
    comparativeBaselines: {
      splitStrategy: comparativeReport.splitStrategy,
      heldOutEvaluationCount: comparativeReport.heldOutEvaluationCount,
      totalPopulationCount: comparativeReport.totalPopulationCount,
      trainDevCount: comparativeReport.trainDevCount,
      approaches: comparativeReport.approaches,
    },
  };

  fs.writeFileSync(
    path.join(jsonDir, 'evaluation_summary.json'),
    JSON.stringify(comprehensiveEvaluationSummary, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(datasetsDir, 'evaluation_summary.json'),
    JSON.stringify(comprehensiveEvaluationSummary, null, 2),
    'utf8'
  );
  jsonExportChecksums['evaluation_summary.json'] = sha256(
    JSON.stringify(comprehensiveEvaluationSummary, null, 2)
  );

  const phase8CsvArtifacts: Record<string, string> = {
    'validation_checks_report.csv':
      formatPhase8ValidationChecksCsv(fullValidationReport1),
    'evaluation_metrics_report.csv':
      formatPhase8EvaluationMetricsCsv(fullEvaluationReport1),
    'anomaly_detection_results.csv':
      formatPhase8AnomalyScenariosCsv(fullEvaluationReport1),
    'ground_truth_comparison_sample.csv':
      formatPhase8GroundTruthComparisonCsv(fullEvaluationReport1),
  };
  for (const [evalCsvName, evalCsvText] of Object.entries(phase8CsvArtifacts)) {
    fs.writeFileSync(path.join(csvDir, evalCsvName), evalCsvText, 'utf8');
    csvExportChecksums[evalCsvName] = sha256(evalCsvText);
  }

  // 7. Write seed_configuration.json and source_provenance_manifest.json
  const seedConfig = {
    seed: DETERMINISTIC_SEED,
    prngAlgorithm: 'Mulberry32 (32-bit deterministic integer state)',
    anchorTimestampIso: BASE_ANCHOR_DATE_ISO,
    masterFirstGenerationOrder: fullRun1.metadata.generationOrder,
    fullScaleParameters: {
      ticketCount: 5000,
      knowledgeArticleCount: 200,
      messagesPerTicket: 4,
      totalMessages: 20000,
      requesterCount: 500,
      policyDocumentCount: 24,
      categoryCount: 4,
      roleCount: 5,
      termCount: 4,
    },
    identifierPatterns: {
      Ticket: '^TKT-2026-[0-9]{6}$',
      Message: '^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$',
      KnowledgeArticle: '^KB-[0-9]{6}$',
      PolicyDocument: '^POL-(FINAID|REG|IT|ACCESS)-2026-[0-9]{3}$',
      SLA: '^SLA-TKT-2026-[0-9]{6}$',
      Assignment: '^ASG-TKT-2026-[0-9]{6}-[0-9]{2}$',
      ResolutionFeedback: '^FDB-TKT-2026-[0-9]{6}$',
      Requester: '^REQ-2026-[0-9]{6}$',
      GroundTruthAnomaly: '^ANM-2026-[0-9]{6}$',
    },
  };
  fs.writeFileSync(
    path.join(datasetsDir, 'seed_configuration.json'),
    JSON.stringify(seedConfig, null, 2),
    'utf8'
  );

  const provenanceManifest = {
    manifestVersion: '2026.10-phase4',
    seed: DETERMINISTIC_SEED,
    generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
    lawfulSyntheticProvenanceDeclaration:
      'All records in this benchmark dataset are 100% synthetic, deterministically generated using seed 20261022 under CC0-1.0 for the YottaFlex AI Code Challenge. No real student PII, real university administrative records, or copyrighted institutional policy texts are used. Synthetic email addresses use the RFC 2606 reserved .invalid TLD (@synthetic.campusresolve.invalid) and synthetic URIs use the urn:campusresolve:synthetic-* namespace.',
    classifications: {
      CONFIRMED_CHALLENGE_REQUIREMENT: [
        '11 Core Entities: Requester, Role, Term, PolicyDocument, KnowledgeArticle, Category, Ticket, Message, Assignment, SLA, ResolutionFeedback',
        '4 Official Ticket Categories: Financial Aid, Registration, IT, Accessibility',
        'Exact Identifier Formats: TKT-2026-000001, MSG-TKT-2026-000001-001 (3-digit zero-padded), KB-000001, POL-<domain>-2026-001, SLA-TKT-2026-000001',
        'Baseline Volumes: 5,000 tickets, 200 knowledge articles, 20,000 messages',
        'Fixed Deterministic Seed: 20261022',
        '5 Required Anomaly Scenarios: expired_policy_citation, unauthorized_team_routing, unsupported_factual_claim, sla_clock_ignores_business_hours, required_escalation_not_triggered',
        'Strict Ground-Truth Separation: ground_truth.csv and ground_truth.json isolated from operational features',
      ],
      PROPOSED_CONFIGURABLE_RULE: {
        description:
          'Institutional routing rules, SLA business-hour schedules, and target business minutes are explicitly labeled as configurable operational parameters rather than invented official mandates.',
        businessSchedule: DEFAULT_CONFIGURABLE_BUSINESS_SCHEDULE,
        routingRules: DOCUMENTED_ROUTING_RULES,
        slaRules: CONFIGURABLE_SLA_RULES,
      },
      SYNTHETIC_EVAL_SCENARIO: {
        totalTickets: fullRun1.tickets.length,
        totalAnomalies: fullRun1.groundTruthAnomalies.length,
        anomalyBreakdown:
          fullValidationReport1.distributionsAndCoverage?.anomalyDistribution.byScenarioType,
      },
    },
  };
  fs.writeFileSync(
    path.join(datasetsDir, 'source_provenance_manifest.json'),
    JSON.stringify(provenanceManifest, null, 2),
    'utf8'
  );

  // 8. Write seed_summary_and_checksums.json
  const summaryManifest = {
    seed: DETERMINISTIC_SEED,
    generatedAtAnchor: BASE_ANCHOR_DATE_ISO,
    generatedOrder: fullRun1.metadata.generationOrder,
    fullScaleRowCounts: fullRun1.metadata.counts,
    starterScaleRowCounts: starterRun1.metadata.counts,
    determinismVerification: {
      run1EqualsRun2: true,
      sha256ChecksumsRun1: fullHashes1,
      sha256ChecksumsRun2: fullHashes2,
      validationReportSha256Run1: valHash1,
      validationReportSha256Run2: valHash2,
      evaluationReportSha256Run1: evalHash1,
      evaluationReportSha256Run2: evalHash2,
      sqlExportSha256Run1: sqlExportHash1,
      sqlExportSha256Run2: sqlExportHash2,
      groundTruthJsonSha256: sha256(groundTruthJsonContent),
      groundTruthCsvSha256: sha256(groundTruthCsvContent),
      csvExportChecksums,
      jsonExportChecksums,
    },
    validationSummary: {
      overallStructuralPass: fullValidationReport1.overallStructuralPass,
      passedChecks: fullValidationReport1.checks.filter((c) => c.passed).length,
      totalChecks: fullValidationReport1.checks.length,
      silentRepairsPerformed: fullValidationReport1.silentRepairsPerformed,
      distributionsAndCoverage: fullValidationReport1.distributionsAndCoverage,
    },
    evaluationSummary: {
      totalTicketsEvaluated: fullEvaluationReport1.totalTicketsEvaluated,
      totalGroundTruthAnomalies: fullEvaluationReport1.totalGroundTruthAnomalies,
      totalDetectedAnomalies: fullEvaluationReport1.totalDetectedAnomalies,
      overallMetrics: fullEvaluationReport1.overallMetrics,
      byAnomalyType: fullEvaluationReport1.byAnomalyType,
    },
  };

  fs.writeFileSync(
    path.join(datasetsDir, 'seed_summary_and_checksums.json'),
    JSON.stringify(summaryManifest, null, 2),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        status: 'SUCCESS',
        seed: DETERMINISTIC_SEED,
        fullScaleRowCounts: summaryManifest.fullScaleRowCounts,
        determinismVerified:
          summaryManifest.determinismVerification.run1EqualsRun2,
        entireBundleSha256Run1: fullHashes1.entireBundleJson,
        entireBundleSha256Run2: fullHashes2.entireBundleJson,
        validationReportSha256: valHash1,
        evaluationReportSha256: evalHash1,
        sqlExportSha256: sqlExportHash1,
        validationSummary: {
          overallStructuralPass: summaryManifest.validationSummary.overallStructuralPass,
          passedChecks: summaryManifest.validationSummary.passedChecks,
          totalChecks: summaryManifest.validationSummary.totalChecks,
          silentRepairsPerformed: summaryManifest.validationSummary.silentRepairsPerformed,
        },
        evaluationSummary: summaryManifest.evaluationSummary,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[Phase 4 Generator Error]:', err);
  process.exit(1);
});
