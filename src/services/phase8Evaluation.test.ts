import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ActorRole, RequestStatus } from '../types/domain';
import {
  generateDeterministicDataset,
  DETERMINISTIC_SEED,
  BASE_ANCHOR_DATE_ISO,
} from './dataGenerator';
import {
  runDatasetValidationSuite,
  evaluateOperationalAnomaliesAgainstGroundTruth,
  detectOperationalAnomaliesFromRecords,
  stripGroundTruthFromOperationalBundle,
  verifyFixedSeedReproducibility,
  computeBundleEntityChecksums,
  sha256Hex,
  formatPhase8ValidationChecksCsv,
  formatPhase8EvaluationMetricsCsv,
  formatPhase8AnomalyScenariosCsv,
  formatPhase8GroundTruthComparisonCsv,
} from './validationAndEvaluationEngine';
import { processWorkspaceOperationRequest } from '../../api/ops/workspace';

describe('Phase 8: Comprehensive Evaluation and Validation Suite (15 Required Areas)', () => {
  // Generate starter deterministic bundle for fast unit mutation tests
  const baseBundle = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode: 'starter',
  });

  // 1. Primary-key uniqueness
  it('1. Primary-key uniqueness: passes on clean dataset and detects duplicate or malformed primary keys', () => {
    const cleanValidation = runDatasetValidationSuite(baseBundle);
    const pkCheck = cleanValidation.checks.find(
      (c) => c.checkId === 'VAL-01-PK-UNIQUENESS'
    );
    assert.ok(pkCheck);
    assert.equal(pkCheck.passed, true);
    assert.equal(pkCheck.violationCount, 0);

    // Mutate: duplicate a ticket_id and introduce a malformed requester_id
    const mutated = structuredClone(baseBundle);
    mutated.tickets.push({
      ...mutated.tickets[0],
    });
    mutated.requesters[0].requester_id = 'INVALID-PK-FORMAT';

    const mutatedValidation = runDatasetValidationSuite(mutated);
    const mutatedPkCheck = mutatedValidation.checks.find(
      (c) => c.checkId === 'VAL-01-PK-UNIQUENESS'
    );
    assert.ok(mutatedPkCheck);
    assert.equal(mutatedPkCheck.passed, false);
    assert.ok(mutatedPkCheck.violationCount >= 2);
    assert.equal(
      mutatedPkCheck.structuredFailures?.some(
        (f) => f.entity === 'Ticket' && f.reason.includes('Duplicate ticket_id')
      ),
      true
    );
    assert.equal(
      mutatedPkCheck.structuredFailures?.some(
        (f) => f.entity === 'Requester' && f.reason.includes('Invalid requester_id format')
      ),
      true
    );
  });

  // 2. Foreign-key integrity
  it('2. Foreign-key integrity: passes on clean dataset and detects broken parent-child foreign keys across entities', () => {
    const cleanValidation = runDatasetValidationSuite(baseBundle);
    const fkCheck = cleanValidation.checks.find(
      (c) => c.checkId === 'VAL-02-FK-INTEGRITY'
    );
    assert.ok(fkCheck);
    assert.equal(fkCheck.passed, true);
    assert.equal(fkCheck.violationCount, 0);

    // Mutate: break ticket.requester_id and message.ticket_id
    const mutated = structuredClone(baseBundle);
    mutated.tickets[0].requester_id = 'REQ-2026-999999';
    mutated.messages[0].ticket_id = 'TKT-2026-999999';

    const mutatedValidation = runDatasetValidationSuite(mutated);
    const mutatedFkCheck = mutatedValidation.checks.find(
      (c) => c.checkId === 'VAL-02-FK-INTEGRITY'
    );
    assert.ok(mutatedFkCheck);
    assert.equal(mutatedFkCheck.passed, false);
    assert.ok(mutatedFkCheck.violationCount >= 2);
    assert.equal(
      mutatedFkCheck.structuredFailures?.some(
        (f) => f.entity === 'Ticket' && f.field === 'requester_id'
      ),
      true
    );
    assert.equal(
      mutatedFkCheck.structuredFailures?.some(
        (f) => f.entity === 'Message' && f.field === 'ticket_id'
      ),
      true
    );
  });

  // 3. Invalid enum detection
  it('3. Invalid enum detection: passes on valid enums and catches invalid status, role, category, SLA mode, or rating bounds', () => {
    const cleanValidation = runDatasetValidationSuite(baseBundle);
    const enumCheck = cleanValidation.checks.find(
      (c) => c.checkId === 'VAL-03-ENUM-VALIDITY'
    );
    assert.ok(enumCheck);
    assert.equal(enumCheck.passed, true);

    // Mutate: invalid ticket lifecycle_status, invalid role_code, and out-of-bounds feedback rating
    const mutated = structuredClone(baseBundle);
    (mutated.tickets[0] as unknown as { lifecycle_status: string }).lifecycle_status =
      'NonExistentStatus';
    (mutated.roles[0] as unknown as { role_code: string }).role_code = 'SuperUser';
    mutated.resolutionFeedbacks[0].rating = 99;

    const mutatedValidation = runDatasetValidationSuite(mutated);
    const mutatedEnumCheck = mutatedValidation.checks.find(
      (c) => c.checkId === 'VAL-03-ENUM-VALIDITY'
    );
    assert.ok(mutatedEnumCheck);
    assert.equal(mutatedEnumCheck.passed, false);
    assert.ok(mutatedEnumCheck.violationCount >= 3);
    assert.equal(
      mutatedEnumCheck.structuredFailures?.some(
        (f) => f.entity === 'Ticket' && f.field === 'lifecycle_status'
      ),
      true
    );
    assert.equal(
      mutatedEnumCheck.structuredFailures?.some(
        (f) => f.entity === 'Role' && f.field === 'role_code'
      ),
      true
    );
    assert.equal(
      mutatedEnumCheck.structuredFailures?.some(
        (f) => f.entity === 'ResolutionFeedback' && f.field === 'rating'
      ),
      true
    );
  });

  // 4. Invalid date ordering
  it('4. Invalid date ordering: passes on valid chronology and catches inverted term, ticket, policy, or SLA dates', () => {
    const cleanValidation = runDatasetValidationSuite(baseBundle);
    const dateCheck = cleanValidation.checks.find(
      (c) => c.checkId === 'VAL-04-DATE-ORDERING'
    );
    assert.ok(dateCheck);
    assert.equal(dateCheck.passed, true);

    // Mutate: invert term start_date > end_date and ticket submitted_at > updated_at
    const mutated = structuredClone(baseBundle);
    mutated.terms[0].start_date = '2027-12-31';
    mutated.terms[0].end_date = '2026-01-01';
    mutated.tickets[0].submitted_at = '2027-05-01T00:00:00.000Z';
    mutated.tickets[0].updated_at = '2026-01-01T00:00:00.000Z';

    const mutatedValidation = runDatasetValidationSuite(mutated);
    const mutatedDateCheck = mutatedValidation.checks.find(
      (c) => c.checkId === 'VAL-04-DATE-ORDERING'
    );
    assert.ok(mutatedDateCheck);
    assert.equal(mutatedDateCheck.passed, false);
    assert.ok(mutatedDateCheck.violationCount >= 2);
    assert.equal(
      mutatedDateCheck.structuredFailures?.some((f) => f.entity === 'Term'),
      true
    );
    assert.equal(
      mutatedDateCheck.structuredFailures?.some((f) => f.entity === 'Ticket'),
      true
    );
  });

  // 5. Lifecycle consistency
  it('5. Lifecycle consistency: verifies DAG transitions and detects illegal status transitions or terminal event mismatches', () => {
    const cleanValidation = runDatasetValidationSuite(baseBundle);
    const lifecycleCheck = cleanValidation.checks.find(
      (c) => c.checkId === 'VAL-07-LIFECYCLE-TRANSITIONS'
    );
    assert.ok(lifecycleCheck);
    assert.equal(lifecycleCheck.passed, true);

    // Mutate: introduce an illegal transition closed -> under_review
    const mutated = structuredClone(baseBundle);
    mutated.ticketLifecycleEvents[1].previous_state = RequestStatus.Closed;
    mutated.ticketLifecycleEvents[1].new_state = RequestStatus.UnderReview;

    const mutatedValidation = runDatasetValidationSuite(mutated);
    const mutatedLifecycleCheck = mutatedValidation.checks.find(
      (c) => c.checkId === 'VAL-07-LIFECYCLE-TRANSITIONS'
    );
    assert.ok(mutatedLifecycleCheck);
    assert.equal(mutatedLifecycleCheck.passed, false);
    assert.ok(mutatedLifecycleCheck.violationCount >= 1);
    assert.equal(
      mutatedLifecycleCheck.structuredFailures?.some((f) =>
        f.reason.includes('invalid transition')
      ),
      true
    );
  });

  // 6. Assignment authorization
  it('6. Assignment authorization: detects unauthorized team routing (Scenario 2) and verifies RBAC role authorization', () => {
    const cleanValidation = runDatasetValidationSuite(baseBundle);
    const assignmentCheck = cleanValidation.checks.find(
      (c) => c.checkId === 'VAL-09-ASSIGNMENT-VALIDITY'
    );
    assert.ok(assignmentCheck);
    assert.equal(assignmentCheck.passed, true);

    // Verify Scenario 2 (unauthorized_team_routing) is detected & remediated in the benchmark
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);
    const scenario2 = evalReport.fiveScenarioVerifications?.find(
      (s) => s.anomalyType === 'unauthorized_team_routing'
    );
    assert.ok(scenario2);
    assert.equal(scenario2.passFailResult, 'PASS');
    assert.equal(scenario2.wasDetected, true);
    assert.equal(scenario2.wasHandledCorrectly, true);
    assert.ok(scenario2.groundTruthCount > 0);
    assert.equal(scenario2.truePositives, scenario2.groundTruthCount);

    // Also mutate an assignment to use an unauthorized learner role and verify VAL-09 flags it as a structural failure
    const mutated = structuredClone(baseBundle);
    mutated.assignments[0].assigned_actor_role = ActorRole.Learner;
    const mutatedValidation = runDatasetValidationSuite(mutated);
    const mutatedAssignmentCheck = mutatedValidation.checks.find(
      (c) => c.checkId === 'VAL-09-ASSIGNMENT-VALIDITY'
    );
    assert.ok(mutatedAssignmentCheck);
    assert.equal(mutatedAssignmentCheck.passed, false);
    assert.equal(
      mutatedAssignmentCheck.structuredFailures?.some(
        (f) =>
          f.field === 'assigned_actor_role' &&
          f.reason.includes('unauthorized actor role')
      ),
      true
    );
  });

  // 7. Expired-policy citation detection
  it('7. Expired-policy citation detection: detects Scenario 1 (expired v1.0 policy cited) and verifies active v2.0 remediation', () => {
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);
    const scenario1 = evalReport.fiveScenarioVerifications?.find(
      (s) => s.anomalyType === 'expired_policy_citation'
    );
    assert.ok(scenario1);
    assert.equal(scenario1.passFailResult, 'PASS');
    assert.equal(scenario1.wasDetected, true);
    assert.equal(scenario1.wasHandledCorrectly, true);
    assert.ok(scenario1.groundTruthCount > 0);
    assert.equal(scenario1.truePositives, scenario1.groundTruthCount);
    assert.match(scenario1.sampleTicketId, /^TKT-2026-\d{6}$/);
  });

  // 8. Unsupported-claim detection
  it('8. Unsupported-claim detection: detects Scenario 3 (unverified policy facts without citations) and verifies RAG guardrail blocking', () => {
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);
    const scenario3 = evalReport.fiveScenarioVerifications?.find(
      (s) => s.anomalyType === 'unsupported_factual_claim'
    );
    assert.ok(scenario3);
    assert.equal(scenario3.passFailResult, 'PASS');
    assert.equal(scenario3.wasDetected, true);
    assert.equal(scenario3.wasHandledCorrectly, true);
    assert.ok(scenario3.groundTruthCount > 0);
    assert.equal(scenario3.truePositives, scenario3.groundTruthCount);
  });

  // 9. Business-hour SLA validation
  it('9. Business-hour SLA validation: detects Scenario 4 (SLA clock ignores business hours over weekend) and recomputes valid target due dates', () => {
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);
    const scenario4 = evalReport.fiveScenarioVerifications?.find(
      (s) => s.anomalyType === 'sla_clock_ignores_business_hours'
    );
    assert.ok(scenario4);
    assert.equal(scenario4.passFailResult, 'PASS');
    assert.equal(scenario4.wasDetected, true);
    assert.equal(scenario4.wasHandledCorrectly, true);
    assert.ok(scenario4.groundTruthCount > 0);
    assert.equal(scenario4.truePositives, scenario4.groundTruthCount);
  });

  // 10. Missing escalation detection
  it('10. Missing escalation detection: detects Scenario 5 (required escalation not triggered) and triggers mandatory escalation', () => {
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);
    const scenario5 = evalReport.fiveScenarioVerifications?.find(
      (s) => s.anomalyType === 'required_escalation_not_triggered'
    );
    assert.ok(scenario5);
    assert.equal(scenario5.passFailResult, 'PASS');
    assert.equal(scenario5.wasDetected, true);
    assert.equal(scenario5.wasHandledCorrectly, true);
    assert.ok(scenario5.groundTruthCount > 0);
    assert.equal(scenario5.truePositives, scenario5.groundTruthCount);
  });

  // 11. Ground-truth isolation
  it('11. Ground-truth isolation: strips ground-truth labels before operational detection and blocks Learner/Instructor roles on API', async () => {
    // Verify operational stripping removes groundTruthAnomalies and groundTruthTicketEvaluations
    const { operationalBundle, leakedGroundTruthFieldsCount, verifiedIsolated } =
      stripGroundTruthFromOperationalBundle(baseBundle);
    assert.equal(leakedGroundTruthFieldsCount, 0);
    assert.equal(verifiedIsolated, true);
    assert.equal(
      'groundTruthAnomalies' in (operationalBundle as unknown as Record<string, unknown>),
      false
    );
    assert.equal(
      'groundTruthTicketEvaluations' in (operationalBundle as unknown as Record<string, unknown>),
      false
    );

    // Verify operational anomaly detection runs strictly on operationalBundle
    const detected = detectOperationalAnomaliesFromRecords(operationalBundle);
    assert.equal(detected.detectedRecords.length, baseBundle.groundTruthAnomalies.length);

    // Verify leaked attribute detection catches any injected forbidden key on operational tickets
    const pollutedBundle = structuredClone(baseBundle);
    (pollutedBundle.tickets[0] as unknown as Record<string, unknown>).expected_assigned_team =
      'Financial Aid Operations & Verification Team';
    const pollutedCheck = stripGroundTruthFromOperationalBundle(pollutedBundle);
    assert.ok(pollutedCheck.leakedGroundTruthFieldsCount > 0);
    assert.equal(pollutedCheck.verifiedIsolated, false);

    // Verify API endpoint blocks Learner and Instructor from accessing evaluation_benchmark
    for (const forbiddenRole of [ActorRole.Learner, ActorRole.Instructor]) {
      const result = await processWorkspaceOperationRequest(
        'GET',
        { action: 'evaluation_benchmark', mode: 'starter' },
        {},
        {},
        {
          profile: {
            id: '00000000-0000-0000-0000-000000000001',
            provider_subject: '00000000-0000-0000-0000-000000000001',
            verified_email: 'requester@campusresolve.edu',
            display_name: 'Requester User',
            actor_role: forbiddenRole,
            department: 'Student Affairs',
            office_or_cohort: 'Fall 2026 Cohort',
            account_status: 'active',
            auth_provider: 'supabase_email',
          },
          client: {} as never,
        }
      );
      assert.equal(result.status, 403);
      assert.equal(result.body.code, 'FORBIDDEN_ROLE');
    }

    // Verify API endpoint allows AcademicAdministrator
    const adminResult = await processWorkspaceOperationRequest(
      'GET',
      { action: 'evaluation_benchmark', mode: 'starter' },
      {},
      {},
      {
        profile: {
          id: '00000000-0000-0000-0000-000000000002',
          provider_subject: '00000000-0000-0000-0000-000000000002',
          verified_email: 'admin@campusresolve.edu',
          display_name: 'Admin User',
          actor_role: ActorRole.AcademicAdministrator,
          department: 'Office of Academic Governance',
          office_or_cohort: 'Academic Administration',
          account_status: 'active',
          auth_provider: 'supabase_email',
        },
        client: {} as never,
      }
    );
    assert.equal(adminResult.status, 200);
    assert.ok(adminResult.body.validationReport);
    assert.ok(adminResult.body.evaluationReport);
    assert.ok(adminResult.body.reproducibilityReport);
  });

  // 12. Metric calculation correctness
  it('12. Metric calculation correctness: calculates all 11 required metrics with explicit numerators, denominators, and populations', () => {
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);
    assert.equal(evalReport.explicitMetrics?.length, 11);

    const expectedMetricIds = [
      'METRIC-01-ROUTING-ACCURACY',
      'METRIC-02-ASSIGNMENT-AUTHORIZATION-ACCURACY',
      'METRIC-03-POLICY-RETRIEVAL-PRECISION-RECALL',
      'METRIC-04-CITATION-VALIDITY-RATE',
      'METRIC-05-CURRENT-POLICY-APPLICABILITY-RATE',
      'METRIC-06-UNSUPPORTED-CLAIM-DETECTION-RATE',
      'METRIC-07-ANOMALY-DETECTION-PRECISION-RECALL-F1',
      'METRIC-08-SLA-CALCULATION-ACCURACY',
      'METRIC-09-ESCALATION-DETECTION-RATE',
      'METRIC-10-LIFECYCLE-VALIDATION-PASS-RATE',
      'METRIC-11-REFERENTIAL-INTEGRITY-PASS-RATE',
    ];

    assert.deepEqual(
      evalReport.explicitMetrics?.map((m) => m.metricId),
      expectedMetricIds
    );

    for (const metric of evalReport.explicitMetrics || []) {
      assert.ok(metric.denominator > 0);
      assert.ok(metric.numerator >= 0);
      assert.ok(metric.numerator <= metric.denominator);
      assert.ok(Math.abs(metric.rate - metric.numerator / metric.denominator) < 0.001);
      assert.ok(metric.evaluationPopulation.length > 10);
      assert.equal(metric.passed, true);
    }

    // Verify 12 workflow stages are also evaluated across normal, boundary, failure, and exception scenarios
    assert.equal(evalReport.workflowStageEvaluations?.length, 12);
    assert.equal(
      evalReport.workflowStageEvaluations?.every(
        (s) =>
          s.normalScenarioPass &&
          s.boundaryScenarioPass &&
          s.failureOrAnomalyScenarioPass &&
          s.exceptionEscalationPass &&
          s.historicalTraceabilityPass
      ),
      true
    );
  });

  // 13. Fixed-seed reproducibility
  it('13. Fixed-seed reproducibility: repeated runs with seed 20261022 produce identical records, counts, IDs, and evaluation outputs', () => {
    assert.equal(DETERMINISTIC_SEED, 20261022);
    assert.equal(BASE_ANCHOR_DATE_ISO, '2026-09-01T13:30:00+05:30');
    assert.equal(baseBundle.metadata.generatedAtAnchor, '2026-09-01T13:30:00+05:30');

    const reproReport = verifyFixedSeedReproducibility({
      seed: DETERMINISTIC_SEED,
      mode: 'starter',
    });
    assert.equal(reproReport.seed, 20261022);
    assert.equal(reproReport.run1EqualsRun2, true);
    assert.equal(reproReport.entityCountsMatch, true);
    assert.equal(reproReport.deterministicIdsMatch, true);
    assert.equal(reproReport.groundTruthOutputsMatch, true);
    assert.equal(reproReport.validationReportsMatch, true);
    assert.equal(reproReport.evaluationReportsMatch, true);
    assert.equal(reproReport.operationalProductionRecordsUntouched, true);
  });

  // 14. Checksum comparison
  it('14. Checksum comparison: pure TypeScript sha256Hex matches Node crypto SHA-256 and produces identical entity hashes across runs', () => {
    const samplePayloads = [
      '',
      'CampusResolve AI Phase 8 Seed 20261022',
      JSON.stringify(baseBundle.categories),
      JSON.stringify(baseBundle.policyDocuments),
    ];

    for (const payload of samplePayloads) {
      const expectedNodeHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
      const actualPureTsHash = sha256Hex(payload);
      assert.equal(actualPureTsHash, expectedNodeHash);
    }

    const run1Checksums = computeBundleEntityChecksums(
      generateDeterministicDataset({ seed: DETERMINISTIC_SEED, mode: 'starter' })
    );
    const run2Checksums = computeBundleEntityChecksums(
      generateDeterministicDataset({ seed: DETERMINISTIC_SEED, mode: 'starter' })
    );
    assert.deepEqual(run1Checksums, run2Checksums);
  });

  // 15. Export integrity
  it('15. Export integrity: generates valid JSON and CSV evaluation artifacts with complete headers and rows', () => {
    const valReport = runDatasetValidationSuite(baseBundle);
    const evalReport = evaluateOperationalAnomaliesAgainstGroundTruth(baseBundle);

    const validationCsv = formatPhase8ValidationChecksCsv(valReport);
    const metricsCsv = formatPhase8EvaluationMetricsCsv(evalReport);
    const scenariosCsv = formatPhase8AnomalyScenariosCsv(evalReport);
    const gtComparisonCsv = formatPhase8GroundTruthComparisonCsv(evalReport);

    // Check headers and line counts
    const valLines = validationCsv.trim().split('\n');
    assert.ok(
      valLines[0].includes(
        'check_id,check_name,passed,structural_integrity_valid,total_inspected,violation_count'
      )
    );
    assert.equal(valLines.length, valReport.checks.length + 1);

    const metricLines = metricsCsv.trim().split('\n');
    assert.ok(
      metricLines[0].includes(
        'metric_id,metric_name,numerator,denominator,rate,percentage'
      )
    );
    assert.equal(metricLines.length, (evalReport.explicitMetrics?.length || 0) + 1);

    const scenarioLines = scenariosCsv.trim().split('\n');
    assert.ok(
      scenarioLines[0].includes(
        'scenario_number,scenario_id,anomaly_type,scenario_title,sample_input_record_id,sample_ticket_id'
      )
    );
    assert.equal(scenarioLines.length, 6); // 1 header + 5 scenarios

    const gtLines = gtComparisonCsv.trim().split('\n');
    assert.ok(
      gtLines[0].includes(
        'ticket_id,category_match,expected_assigned_team,observed_assigned_team,engine_recommended_team'
      )
    );
    assert.equal(
      gtLines.length,
      (evalReport.groundTruthComparisonSummary?.sampleComparisons.length || 0) + 1
    );
  });
});
