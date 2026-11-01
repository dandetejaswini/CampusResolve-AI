# AI Usage and Prompt History — CampusResolve AI

## 1. Overview
- **Scope**: Comprehensive disclosure of AI-assisted engineering tools, prompts, workflows, and developer verification procedures.
- **Project**: CampusResolve AI for the YottaFlex AI Code Challenge.
- **Standard**: Complete traceability of AI generation paired with manual human review and empirical test validation.

## 2. AI Tools Used
- **Google AI Studio / Gemini Code Assistant**:
  - Full-stack code generation, database migration scripts, and RAG retrieval design.
  - Test suite development, data generation scripts, and validation engine.
- **GPT-4o / Claude 3.5 Sonnet Equivalents**:
  - Architectural review and threat modeling.
  - Security inspection of Supabase Row-Level Security (RLS) policies.
  - Markdown compliance auditing and structured documentation reviews.

## 3. Workflow & AI Contribution by Phase

### Phase 1 & 2: Architecture & Authentication
- **AI Contribution**:
  - Designed Firebase-to-Supabase identity mapping architecture.
  - Built server-side token verification and profile auto-provisioning (`/api/auth/firebase-claim.ts`).
- **Developer Review & Validation**:
  - Validated RSA-SHA256 signature verification using Google's X.509 SecureToken certificates.
  - Confirmed unauthenticated client mutations to `app_profiles` are blocked by RLS policies.

### Phase 3 & 4: Database Design & Synthetic Dataset Generation
- **AI Contribution**:
  - Structured 11-table relational PostgreSQL schema (`supabase/migrations/`).
  - Implemented deterministic synthetic dataset generator with fixed seed `20261022`.
- **Developer Review & Validation**:
  - Verified multi-run SHA-256 hash reproducibility across all 11 tables.
  - Validated exact record counts: 5,000 tickets, 20,000 messages, 200 articles, and 24 policies.

### Phase 5 & 6: Workflow Engine, SLA Calculation & RAG Policy Assistant
- **AI Contribution**:
  - Implemented strict state machine DAG transitions in `src/services/workflowEngine.ts`.
  - Configured business-hour SLA target calculations across calendar schedules.
  - Built Gemini 2.5 Flash policy retrieval and citation synthesizer (`/api/ai/policy-assistant.ts`).
- **Developer Review & Validation**:
  - Tested 12-second request timeout fallback to deterministic policy synthesis.
  - Verified ticket ID linkage during escalation and atomic database transactions.

### Phase 7 & 8: Evaluation & Compliance Auditing
- **AI Contribution**:
  - Created automated evaluation engine benchmarked across 5 negative compliance scenarios.
  - Generated confusion matrices, precision/recall calculations, and comparative baseline reports.
- **Developer Review & Validation**:
  - Confirmed all automated unit and integration tests execute cleanly (`112 / 112 passed`).
  - Verified ground-truth isolation so evaluation labels never leak into operational models.

### Phase 9 & 10: Production Readiness & Bug Repair
- **AI Contribution**:
  - Diagnosed plain-text HTTP 500 error responses from Vercel Lambda runtimes.
  - Refactored `authorizedJsonFetch` to inspect raw responses before JSON parsing.
- **Developer Review & Validation**:
  - Verified clean client production bundles (`npm run build`) and strict type checks (`npm run lint`).
  - Added dedicated regression suite (`src/services/workspaceServerlessRegression.test.ts`).

## 4. Key Prompts and Iterations
- **Authentication Hardening**:
  - *Prompt*: "Audit the authentication flow between Firebase Google sign-in and Supabase app_profiles. Eliminate direct client-side RLS violations and enforce server-side token verification."
  - *Outcome*: Implemented `/api/auth/firebase-claim.ts` with server-side token verification and profile creation.
- **Serverless Resilience**:
  - *Prompt*: "Fix the production bug where Vercel serverless 500 errors return plain text 'A server error has occurred' and crash the client with unexpected token JSON parse errors."
  - *Outcome*: Added `res.text()` inspection in `authorizedJsonFetch` with graceful fallback handling.
- **Comprehensive Test Coverage**:
  - *Prompt*: "Conduct an exhaustive test suite covering all 24 workflow scenarios, 15 evaluation areas, and serverless regression tests."
  - *Outcome*: Built a 112-test automated suite with 100% pass rate.

## 5. Areas Requiring Human Verification
- **Live Cloud Secrets**: Manual entry of Supabase Service Keys, Firebase Keys, and Gemini API Keys in Vercel settings.
- **OAuth Domain Configuration**: Manual whitelisting of Vercel production domains in Firebase Console and Supabase Auth.
- **Database Migrations**: Manual execution of SQL migration files in Supabase PostgreSQL Editor.
