# Testing and Evaluation — CampusResolve AI

## 1. Test Environment and Execution
- **Test Runner:** Node.js built-in test runner (`node --test` via `tsx`).
- **Command:** `npm test`
- **Total Automated Tests:** 112 tests across 18 test suites.
- **Test Breakdown:**
  - **46 Unit Tests:** Pure validation functions, form validators, RBAC role permissions, and identity hashing.
  - **59 Integration Tests:** Relational database schema validation, foreign-key integrity, workflow engine state machine transitions, SLA calculation, RAG policy retrieval, and evaluation metrics.
  - **7 Serverless Regression Tests:** Vercel serverless response serialization, `Unexpected token 'A'` prevention, idempotent requester provisioning, and welcome email message sanitization.
- **Browser End-to-End Tests:** Automated headless browser tests (Playwright/Cypress) are intentionally **not installed** in this preview environment. All UI interactions are verified via unit/integration simulation and manual browser inspection.

## 2. Test Suite Execution Results
- `npm test`: **112 / 112 passed** (0 failed).
- `npm run lint`: **0 errors**.
- `npm run build`: **Successful Vite production bundle**.

## 3. Mandatory Anomaly Scenarios Verified
1. **Scenario 1 (Expired Policy Citation):** Detects expired v1.0 policy citation and successfully enforces active v2.0 remediation.
2. **Scenario 2 (Unauthorized Team Routing):** Blocks unauthorized team assignment routing and enforces valid category routing rules.
3. **Scenario 3 (Unsupported Claim Detection):** Detects unverified policy claims without citations and triggers RAG guardrail blocking.
4. **Scenario 4 (Business-Hour SLA Over Weekend):** Enforces business-hour SLA calculation that correctly ignores weekend hours.
5. **Scenario 5 (Missing Escalation Detection):** Detects mandatory escalation triggers on breached tickets and transitions them to the escalation review queue.

## 4. Dataset Validation & Fixed-Seed Reproducibility
- **Seed:** `20261022`
- **Reproducibility Test:** Repeated runs with seed `20261022` produce identical SHA-256 hashes (`40f38c72...`) across all 11 core entities and ground truth evaluation outputs.
- **Generated Dataset Counts:**
  - `tickets.csv`: 5,001 lines (5,000 data rows).
  - `knowledge_articles.csv`: 201 lines (200 data rows).
  - `messages.csv`: 20,001 lines (20,000 data rows).
