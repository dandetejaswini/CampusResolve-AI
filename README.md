# CampusResolve AI

**Enterprise Academic Request Routing, Policy-Grounded Resolution, and SLA Governance Platform**

- **Challenge Context:** YottaFlex AI Code Challenge
- **Domain:** Higher Education Institutional Operations, Policy Retrieval, and Service-Level Governance
- **Supported Operational Categories:** `Financial Aid`, `Registration`, `IT`, `Accessibility`

---

## 1. Problem Statement

Universities process high volumes of learner and instructor service requests spanning financial aid eligibility, course registration and withdrawal deadlines, IT access and multi-factor authentication, and disability accommodations. Institutional operations face four recurring structural challenges:

- **Fragmented Request Routing:** Manual triage across decentralized departments causes misrouted requests, unauthorized queue assignments, and delayed first responses.
- **Temporal Policy Drift:** University regulations and knowledge articles evolve across academic terms (`v1.0` superseded by `v2.0`). Staff and automated assistants frequently cite expired or superseded policy clauses as active guidance.
- **Unverified AI Responses:** Standard generative models hallucinate filing fees, waive mandatory committee approvals, or resolve conflicting policy clauses arbitrarily without verifiable citations.
- **Inaccurate SLA and Escalation Tracking:** Conventional timers measure raw wall-clock hours rather than institutional business hours (`08:00`–`17:00`, Monday–Friday, excluding academic holidays and requester-wait pauses), leading to missed escalations or premature breach alerts.

---

## 2. Proposed Solution

CampusResolve AI provides an end-to-end institutional request-management and policy-governance platform that unifies deterministic workflow engineering with date-aware, citation-verified retrieval-augmented generation (RAG):

- **Deterministic Category Routing:** Automatically classifies incoming learner and instructor requests into `Financial Aid`, `Registration`, `IT`, or `Accessibility`, assigning each ticket to its authorized primary or escalation team under documented routing rules (`RULE-FINAID-001`, `RULE-REG-001`, `RULE-IT-001`, `RULE-ACCESS-001`, `RULE-UNMAPPED-999`).
- **Date-Aware Policy Grounding:** Filters `PolicyDocument` and `KnowledgeArticle` records against the inquiry reference date (`effective_date <= asOfDate` and `(expiration_date IS NULL OR expiration_date >= asOfDate)`), explicitly rejecting expired or superseded versions.
- **Structured AI Escalation:** Evaluates evidence completeness, source conflicts, and conditional ambiguity before generating responses, enabling one-click handoff from an AI policy session into an escalated human review ticket.
- **Business-Hour SLA and Escalation Engine:** Computes first-response and resolution targets across institutional business schedules and holiday calendars, pausing clocks during `WaitingOnRequester` states and enforcing idempotent escalation rules.
- **Reproducible Benchmark and Validation Suite:** Includes a deterministic synthetic data generator (`seed = 20261022`), 13 automated data integrity checks (`VAL-01` through `VAL-13`), and 5 anomaly detection benchmarks with strict ground-truth isolation.

---

## 3. User Roles

| Role | Identifier | Core Responsibilities and Access Scope |
| :--- | :--- | :--- |
| **Learner** | `learner` | Submit academic and administrative requests, query published policies via the AI Policy Assistant, exchange public ticket messages, track SLA progress, and submit resolution feedback on own requests. |
| **Instructor** | `instructor` | Submit instructional, classroom IT, and course-policy inquiries, consult active institutional regulations, track own requests, and communicate with assigned support teams. |
| **Support Staff** | `support_staff` | Triage departmental queues, transition ticket lifecycle states (`Triaged`, `Assigned`, `InProgress`, `WaitingOnRequester`, `Resolved`), record internal staff notes, reassign tickets across authorized teams, and execute SLA evaluations. |
| **Academic Administrator** | `academic_administrator` | Adjudicate escalated requests (`Escalated`), review policy exceptions and appeals, manage cross-departmental reassignments, and audit benchmark and SLA compliance reports. |
| **Platform Administrator** | `platform_administrator` | Full institutional governance across all queues, policy version histories, role-preview diagnostics, 13-check data integrity validation, and 5-scenario anomaly benchmark evaluations. |

---

## 4. Features

### Public Website
- Institutional overview, platform capabilities, governance architecture, and support contact directory (`/`, `/about`, `/features`, `/contact`).
- Role-aware authentication entry points for account registration, sign-in, and password recovery (`/sign-in`, `/sign-up`, `/reset-password`).

### Authentication and Identity
- **Dual-Provider Authentication:** Supports Email/Password authentication via Supabase Auth and Google Sign-In via Firebase Authentication (`campusresolveai`).
- **Unified Institutional Profile (`public.app_profiles`):** Synchronizes verified JWT claims into a single PostgreSQL identity table protected by Row Level Security (RLS), defaulting new self-service registrations to the least-privilege `learner` role.
- **Automated Welcome Email Dispatch:** Triggers an idempotent server-to-server welcome email via Google Apps Script and Gmail (`campusresolveai@gmail.com`) upon initial profile activation.

### Request Routing and Ticket Lifecycle
- **9-State Lifecycle State Machine:** Enforces valid transitions across `New`, `Triaged`, `Assigned`, `InProgress`, `WaitingOnRequester`, `Escalated`, `Resolved`, `Closed`, and `Reopened`.
- **Resolution Citation Prerequisites:** Requires a valid, active policy citation (`POL-...`) and resolution summary before a ticket can transition to `Resolved`.
- **Immutable Audit Trail:** Records every state transition in `public.ticket_lifecycle_events` and preserves chronological assignment chains (`ASG-TKT-2026-XXXXXX-XX`) with `superseded_at` timestamps.

### AI Policy Assistant
- **Policy-Grounded Q&A (`/workspace/assistant`):** Answers institutional policy questions using active `PolicyDocument` and `KnowledgeArticle` evidence.
- **Citation Verification:** Displays exact policy IDs, version numbers, authoritative section references, effective dates, and verbatim source passages.
- **Ambiguity and Conflict Handling:** Prompts users with targeted clarification questions when inquiries omit required parameters (such as academic week) and surfaces both provisions when active sources conflict.

### Knowledge Base and Policy Documents
- **Version-Controlled Repository (`/workspace/knowledge-base`):** Searchable catalog of institutional policy documents (`POL-FINAID-*`, `POL-REG-*`, `POL-IT-*`, `POL-ACCESS-*`), version lineage (`public.policy_version_history`), and linked operational knowledge articles (`KB-000001`–`KB-000200`).

### SLA and Escalation Management
- **Business-Hour & 24x7 Calendar Modes:** Applies `08:00`–`17:00` Monday–Friday business hours (`540` minutes/day, excluding `INSTITUTIONAL_HOLIDAYS_2026`) for standard requests and `24x7` calendar hours for `P1` critical IT incidents.
- **5 Deterministic Escalation Triggers:** Automatically detects `sla_breach_detected`, `approaching_sla_deadline` (`>= 80%` elapsed), `high_severity_priority_p1`, `policy_ambiguity_or_conflict`, and `missing_role_authorization`.

### Evaluation and Validation
- **Administrative Governance Suite (`/workspace/settings`):** Executes the 13-check data integrity suite (`VAL-01`–`VAL-13`), 5-scenario anomaly benchmark evaluation, 12-stage workflow verification, and fixed-seed reproducibility checks (`seed = 20261022`).

---

## 5. Unique and Distinguishing Features

- **Effective-Date and Version-Aware Retrieval:** Every retrieval query evaluates `effective_date`, `expiration_date`, and `lifecycle_state` against the request reference date, ensuring superseded `v1.0` rules are never cited as current authority.
- **Explicit Expired-Policy Rejection:** When a user explicitly asks about an expired policy version, the assistant identifies the historical record, explains why it is excluded as of the reference date, and cites the superseding `v2.0` regulation.
- **Unsupported Claim Refusal:** Detects inquiries asking for unestablished monetary fees, fines, or guaranteed approvals and refuses to fabricate figures while citing verified provisions from the governing policy.
- **Structured AI-to-Human Escalation Handoff:** Converts low-confidence, conflicting, or exception-based policy inquiries directly into routed support tickets linked back to `public.ai_retrieval_logs`.
- **Atomic PostgreSQL Reassignment RPC:** Executes ticket reassignments via `public.atomic_reassign_ticket_workflow`, locking the ticket row (`FOR UPDATE`) and transactionally updating `assignments`, `tickets`, `ticket_lifecycle_events`, `messages`, and `workspace_notifications`.
- **Pause-Aware Business-Hour SLA Arithmetic:** Deducts `WaitingOnRequester` hold intervals and non-business hours deterministically with step-by-step calculation logs.
- **Strict Ground-Truth Isolation:** Strips all benchmark ground-truth labels (`stripGroundTruthFromOperationalBundle`) prior to anomaly evaluation and blocks `Learner` and `Instructor` roles (`HTTP 403 FORBIDDEN_ROLE`) from accessing ground-truth endpoints.

---

## 6. AI Architecture

1. **Access Control and Query Validation (`/api/ai/policy-assistant.ts`):**
   - Verifies the caller's Supabase or Firebase Bearer JWT against `public.app_profiles`.
   - Blocks inactive accounts, role-elevation spoofing, cross-requester private data queries, and non-admin requests for unpublished `draft` policies.
2. **Temporal and Domain Retrieval (`retrieveApplicablePolicyEvidence`):**
   - Classifies the inquiry domain (`Financial Aid`, `Registration`, `IT`, `Accessibility`) and filters `policy_documents` and `knowledge_articles` by effective date and role visibility.
   - Partitioning separates **Applicable Active Sources** from **Excluded Expired/Superseded Sources**.
3. **Conflict, Ambiguity, and Unsupported-Fact Detection:**
   - Scans active sources for divergent numeric thresholds or deadlines (`hasConflictingSources`).
   - Checks whether conditional inquiries omit required context (`clarificationNeeded`) or request unestablished monetary/fee claims (`unsupportedClaimRequested`).
4. **Grounded Synthesis (`@google/genai` + Deterministic Guardrails):**
   - When `GEMINI_API_KEY` is configured on the server and non-conflicting active evidence exists, invokes `@google/genai` (`gemini-3-flash-preview` with fallback to `gemini-2.5-flash`) using a strict `responseSchema` (`Type.OBJECT`) requiring `groundedAnswer`, `explanation`, `supportedFacts`, and `missingOrUnestablishedFacts`.
   - Verifies that the primary `policy_id` and `version` appear in the synthesized answer.
   - If `GEMINI_API_KEY` is absent, rate-limited, or unreachable, seamlessly falls back to `buildDeterministicEvidenceSynthesis` (`deterministic-rule-engine`) so policy retrieval remains 100% available and reproducible.
5. **Audit Persistence (`public.ai_retrieval_logs`):**
   - Persists every query, retrieved policy/article ID and version array, excluded expired source list, confidence score, evidence status, escalation flag, and user helpfulness feedback.

---

## 7. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19, TypeScript, Vite 8 | Single-page institutional portal and role-aware operational workspace |
| **Routing & Styling** | React Router v7, Tailwind CSS v4, Lucide React | Client-side routing, warm-neutral editorial typography, and accessible UI components |
| **Serverless API & Dev Server** | Vercel Serverless Functions (`/api/**`), Express 4 (`server.ts`) | Production serverless endpoints on Vercel and unified local development server |
| **Database & Security** | Supabase PostgreSQL, Row Level Security (RLS), PL/pgSQL RPCs | 20 operational and identity tables with forced RLS and atomic transaction RPCs |
| **Authentication** | Supabase Auth (Email/Password) + Firebase Auth (Google Sign-In) + Firebase Admin SDK | Dual-provider JWT verification and custom claim bridging (`role: "authenticated"`) |
| **AI & RAG Engine** | Google GenAI SDK (`@google/genai`), Custom Date-Aware Retrieval Engine | Structured JSON policy synthesis (`gemini-3-flash-preview` / `gemini-2.5-flash`) and citation verification |
| **Email Automation** | Google Apps Script (`WelcomeEmailWebApp.gs`) + Gmail (`MailApp`) | Authenticated, idempotent welcome email dispatch from `campusresolveai@gmail.com` |
| **Testing & Validation** | Node.js Test Runner (`node:test`), `tsx`, TypeScript Compiler (`tsc`) | 97 automated unit, workflow, RAG, SLA, and benchmark evaluation tests |
| **Deployment Target** | Vercel | Static Vite SPA hosting (`dist/`) + Node.js Serverless Functions (`/api/*`) |

---

## 8. How to Access the Workspace

### Navigation Path
`Home (/) -> Sign In (/sign-in) or Create Account (/sign-up) -> Authentication -> Workspace Dashboard (/workspace/dashboard)`

### Application Route Map

| Route Path | Access Level | Description |
| :--- | :--- | :--- |
| `/` | Public | Institutional home page, domain overview, and entry points |
| `/about` | Public | Platform mission, institutional governance model, and architecture summary |
| `/features` | Public | Detailed breakdown of routing, RAG policy grounding, and SLA capabilities |
| `/contact` | Public | Departmental support directory and escalation contacts |
| `/sign-in` | Public | Email/Password and Google Sign-In authentication screen |
| `/sign-up` | Public | Institutional account registration with role and department selection |
| `/reset-password` | Public | Password recovery request and reset confirmation workflow |
| `/workspace` | Protected | Workspace root container (index redirects to `/workspace/dashboard`) |
| `/workspace/dashboard` | Protected | Role-aware operational KPIs, SLA health, category queues, and recent activity |
| `/workspace/requests` | Protected | Ticket queue, lifecycle transitions, atomic reassignment, SLA evaluation, and thread view |
| `/workspace/create-request` | Protected | Guided academic/administrative request submission with live routing preview |
| `/workspace/assistant` | Protected | AI Policy Assistant with version citations, expired-policy notices, and 1-click ticket escalation |
| `/workspace/knowledge-base` | Protected | Searchable repository of `PolicyDocument` and `KnowledgeArticle` versions |
| `/workspace/messages` | Protected | Ticket communication center with role-enforced internal note visibility |
| `/workspace/notifications` | Protected | Real-time workspace alerts for assignments, SLA warnings, escalations, and resolutions |
| `/workspace/profile` | Protected | Verified institutional identity, JWT provider metadata, and account status |
| `/workspace/settings` | Protected | Role preview (authorized staff/admin) and Evaluation & Benchmark Governance console |
| `*` | Public / Fallback | Unmatched client paths redirect to `/` |

---

## 9. Architecture

```mermaid
flowchart TB
  subgraph Client["Browser Client (React 19 + Vite 8 + Tailwind CSS v4)"]
    PublicUI["Public Portal\n(/, /about, /features, /contact, /sign-in, /sign-up)"]
    WorkspaceUI["Protected Workspace\n(/workspace/dashboard, /requests, /assistant, /knowledge-base, /settings)"]
  end

  subgraph AuthLayer["Dual-Provider Identity Layer"]
    SupaAuth["Supabase Auth\n(Email / Password JWT)"]
    FireAuth["Firebase Auth\n(Google Sign-In ID Token)"]
  end

  subgraph ServerlessAPI["Serverless API Routes (/api/*)"]
    ClaimAPI["POST /api/auth/firebase-claim\n(Firebase Admin Custom Claim Bridge)"]
    WelcomeAPI["POST /api/auth/welcome-email\n(Profile Verification + Apps Script Trigger)"]
    OpsAPI["GET/POST /api/ops/workspace\n(Tickets, Routing, Lifecycle, SLA, Evaluation)"]
    AiAPI["POST /api/ai/policy-assistant\n(Date-Aware RAG + Citation Verification)"]
  end

  subgraph DomainEngines["Core TypeScript Domain Engines (/src/services/*)"]
    WorkflowEngine["Workflow & SLA Engine\n(State Machine, Business Hours, 5 Escalation Rules)"]
    EvalEngine["Validation & Evaluation Engine\n(Seed 20261022, 13 Integrity Checks, 5 Anomaly Benchmarks)"]
  end

  subgraph ExternalServices["External Cloud & AI Services"]
    GeminiAPI["Google Gemini API\n(@google/genai: gemini-3-flash-preview)"]
    AppsScript["Google Apps Script Web App\n(campusresolveai@gmail.com)"]
  end

  subgraph Database["Supabase PostgreSQL (Forced RLS + Atomic RPC)"]
    IdentityTables[("app_profiles\nwelcome_email_log")]
    DomainTables[("18 Operational Tables\n(roles, terms, requesters, categories,\npolicy_documents, knowledge_articles,\ntickets, messages, assignments, slas,\nai_retrieval_logs, workspace_notifications, ...)")]
    AtomicRPC[["PL/pgSQL RPC\natomic_reassign_ticket_workflow"]]
  end

  PublicUI --> SupaAuth
  PublicUI --> FireAuth
  FireAuth --> ClaimAPI
  PublicUI --> WelcomeAPI
  WelcomeAPI --> AppsScript
  WelcomeAPI --> IdentityTables

  WorkspaceUI --> OpsAPI
  WorkspaceUI --> AiAPI

  OpsAPI --> WorkflowEngine
  OpsAPI --> EvalEngine
  OpsAPI --> DomainTables
  OpsAPI --> AtomicRPC

  AiAPI --> WorkflowEngine
  AiAPI --> GeminiAPI
  AiAPI --> DomainTables
```

### Serverless API Endpoints and Implemented Actions

| Endpoint | HTTP Method | Action Parameter (`action`) | Access Scope | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/api/auth/firebase-claim` | `POST` | *(N/A)* | Authenticated Firebase User | Verifies Firebase ID token and sets custom claim `role: "authenticated"` for PostgreSQL RLS |
| `/api/auth/welcome-email` | `POST` | *(N/A)* | Authenticated User | Verifies `app_profiles` record and dispatches idempotent welcome email via Google Apps Script |
| `/api/ai/policy-assistant` | `POST` | `query_policy_assistant` \| `escalate_to_ticket` | Authenticated User | Date-aware RAG policy retrieval, citation validation, and 1-click ticket escalation |
| `/api/ops/workspace` | `GET` | `bootstrap` *(default)* | Authenticated User | Loads role-scoped tickets, messages, assignments, SLAs, events, notifications, and KB |
| `/api/ops/workspace` | `GET` | `evaluation_benchmark` | Staff & Admin Only | Runs deterministic benchmark (`seed = 20261022`), 13 validation checks, and 5 anomaly evaluations |
| `/api/ops/workspace` | `POST` | `create_ticket` | Authenticated User | Creates ticket, links policies/articles, assigns queue, computes initial SLA, and logs audit events |
| `/api/ops/workspace` | `POST` | `post_message` | Ticket Owner / Staff / Admin | Appends public message or staff-only internal note (`is_internal`) with sequence retry |
| `/api/ops/workspace` | `POST` | `transition_ticket` | Role-Checked by State | Validates and executes lifecycle state transition, updates SLA, and appends lifecycle event |
| `/api/ops/workspace` | `POST` | `reassign_ticket` | Staff & Admin Only | Invokes `public.atomic_reassign_ticket_workflow` PL/pgSQL RPC and refreshes SLA metrics |
| `/api/ops/workspace` | `POST` | `submit_feedback` | Ticket Owner Only | Records post-resolution satisfaction and policy clarity feedback on `resolved`/`closed` tickets |
| `/api/ops/workspace` | `POST` | `publish_policy` | Instructor / Staff / Admin | Registers a new `PolicyDocument` and linked `KnowledgeArticle` (`active` for Admin, `draft` for Staff/Instructor) |
| `/api/ops/workspace` | `POST` | `mark_notifications_read` | Authenticated User | Marks all unread workspace notifications for the authenticated caller as read |
| `/api/ops/workspace` | `POST` | `evaluate_sla_and_escalation` | Staff & Admin Only | Evaluates configurable business-hour SLA deadlines, approaching warnings, and 5 escalation rules |

---

## 10. Installation and Local Setup

### Prerequisites
- Node.js `>= 20.x` and `npm` `>= 10.x`
- A configured Supabase project (PostgreSQL migrations located in `/supabase/migrations/`)
- Optional: Firebase project credentials for Google Sign-In, Gemini API key for live LLM synthesis, and Google Apps Script Web App credentials for welcome email dispatch

### Step-by-Step Local Setup

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repository-url>
   cd campusresolve-ai
   npm install
   ```

2. **Create your local environment file from the template:**
   ```bash
   cp .env.example .env
   ```
   Populate `.env` with your Supabase URL, Supabase Publishable Key, Firebase Web configuration, and optional server-side keys (see Section 11).

3. **Apply PostgreSQL migrations in Supabase SQL Editor (in chronological order):**
   - `supabase/migrations/20261030000001_phase2_auth_profiles_and_rls.sql`
   - `supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql`
   - `supabase/migrations/20261030000003_phase5_atomic_workflow_rpcs.sql`

4. **Verify remote Supabase schema readiness:**
   ```bash
   npm run db:verify:remote
   ```

5. **Optional — Seed remote Supabase database with reference and benchmark data:**
   ```bash
   npm run db:seed:remote
   ```

6. **Run the automated test suite, TypeScript check, and production build:**
   ```bash
   npm test -- --run
   npm run lint
   npm run build
   ```

7. **Start the local full-stack development server (port 3000):**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

### Available `npm` Scripts (`package.json`)

| Command | Script Definition | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `tsx server.ts` | Starts the local Express + Vite full-stack development server on port `3000` |
| `npm start` | `NODE_ENV=production tsx server.ts` | Starts the Express server serving compiled static assets from `dist/` |
| `npm run build` | `vite build` | Compiles and bundles the frontend SPA into `dist/` |
| `npm run preview` | `vite preview` | Previews the compiled Vite production bundle locally |
| `npm run clean` | `rm -rf dist server.js` | Removes build output artifacts |
| `npm run lint` | `tsc --noEmit` | Runs full TypeScript type-checking across client, server, and scripts |
| `npm test` / `npm test -- --run` | `tsx --test src/utils/validation.test.ts ...` | Executes all 7 automated test files (17 suites, 97 tests) |
| `npm run generate:dataset` | `tsx scripts/generate-and-verify-phase3.ts` | Regenerates deterministic `Seed 20261022` datasets and evaluation reports in `/datasets/` |
| `npm run db:verify:remote` | `tsx scripts/verify-remote-supabase.ts` | Verifies remote Supabase PostgreSQL tables, RLS policies, and seeded row counts |
| `npm run db:seed:remote` | `tsx scripts/seed-remote-supabase.ts` | Idempotently seeds remote Supabase PostgreSQL with reference catalogs and benchmark records |


## 11. Environment Configuration

All environment variables are documented in `.env.example` using safe placeholder values. Never commit `.env` files or secret keys to version control.

| Variable Name | Scope | Required | Placeholder Example | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Client & Server | Yes | `https://your-supabase-project-ref.supabase.co` | Supabase project base URL for Auth and PostgREST |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client & Server | Yes | `your_supabase_anon_or_publishable_key` | Public Supabase key enforced by PostgreSQL RLS |
| `VITE_FIREBASE_API_KEY` | Client | Yes (for Google Auth) | `your_firebase_web_api_key` | Firebase Web SDK API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Client | Yes (for Google Auth) | `campusresolveai.firebaseapp.com` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Client & Server | Yes (for Google Auth) | `campusresolveai` | Firebase project identifier |
| `VITE_FIREBASE_STORAGE_BUCKET` | Client | Yes (for Google Auth) | `campusresolveai.firebasestorage.app` | Firebase storage bucket identifier |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Client | Yes (for Google Auth) | `671221539968` | Firebase project number / sender ID |
| `VITE_FIREBASE_APP_ID` | Client | Yes (for Google Auth) | `your_firebase_web_app_id` | Firebase Web App ID |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Only | Optional (Recommended) | `your_supabase_service_role_secret_key` | Privileged server-side audit logging (`ticket_lifecycle_events`, `ai_retrieval_logs`) and remote dataset seeding |
| `GEMINI_API_KEY` | Server Only | Optional (Recommended) | `MY_GEMINI_API_KEY` | Google Gemini API key for `/api/ai/policy-assistant` (falls back deterministically if omitted) |
| `FIREBASE_ADMIN_PROJECT_ID` | Server Only | Optional | `campusresolveai` | Target Firebase project for custom claim assignment |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server Only | Optional | `firebase-adminsdk-xxxxx@campusresolveai.iam.gserviceaccount.com` | Firebase Admin service account email for `/api/auth/firebase-claim` |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server Only | Optional | `"-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"` | Firebase Admin service account private key |
| `APPS_SCRIPT_WEB_APP_URL` | Server Only | Optional | `https://script.google.com/macros/s/your-deployment-id/exec` | Deployed Google Apps Script Web App URL for welcome emails |
| `APPS_SCRIPT_SHARED_SECRET` | Server Only | Optional | `your-high-entropy-shared-secret-minimum-32-chars` | Shared HMAC/secret validated by `WelcomeEmailWebApp.gs` |
| `APPLICATION_BASE_URL` | Server Only | Optional | `https://your-application-domain.vercel.app` | Canonical base URL embedded in welcome email sign-in links |
| `APP_URL` | Server Only | Optional | `https://your-application-domain.vercel.app` | Fallback base URL alias for sign-in links |

---

## 12. Dataset and Evaluation

### Fixed-Seed Synthetic Dataset (`Seed 20261022`)
- **PRNG Algorithm:** Deterministic Mulberry32 (`seed = 20261022`) anchored to `2026-09-01T08:00:00.000Z`.
- **Reproducibility Guarantee:** Running `npm run generate:dataset` executes two independent full-scale generation passes in memory and verifies identical SHA-256 digests across all 11 core entities (`Run 1 === Run 2`).

### Generated Entity Counts (`56,315` Operational Records)

| Entity | Table / Export Name | Full-Scale Record Count | ID Format |
| :--- | :--- | :--- | :--- |
| **Roles** | `roles` | `5` | `ROLE-*` |
| **Academic Terms** | `terms` | `4` | `TERM-2026-*` |
| **Categories** | `categories` | `4` | `CAT-*` |
| **Requesters** | `requesters` | `600` | `REQ-2026-000001`..`000600` |
| **Policy Documents** | `policy_documents` | `12` | `POL-(FINAID\|REG\|IT\|ACCESS)-2026-001`..`003` |
| **Knowledge Articles** | `knowledge_articles` | `200` | `KB-000001`..`000200` |
| **Tickets** | `tickets` | `5,000` | `TKT-2026-000001`..`005000` |
| **Messages** | `messages` | `20,000` | `MSG-TKT-2026-XXXXXX-001`..`004` |
| **Assignments** | `assignments` | `6,800` | `ASG-TKT-2026-XXXXXX-01`..`02` |
| **SLAs** | `slas` | `5,000` | `SLA-TKT-2026-000001`..`005000` |
| **Resolution Feedbacks** | `resolution_feedbacks` | `2,290` | `FDB-TKT-2026-XXXXXX` |

### 5 Embedded Challenge Anomaly Scenarios (`1,000` Perturbed Tickets / `20.0%`)
1. `expired_policy_citation` (`200` tickets): Cites expired `v1.0` policies after their expiration date.
2. `unauthorized_team_routing` (`200` tickets): Assigns tickets to queues outside documented category routing rules.
3. `unsupported_factual_claim` (`200` tickets): Contains unverified monetary fees or fabricated policy guarantees lacking source support.
4. `sla_clock_ignores_business_hours` (`200` tickets): Computes SLA due dates or breach flags using raw wall-clock hours instead of business hours and pause windows.
5. `required_escalation_not_triggered` (`200` tickets): Fails to transition to `Escalated` despite SLA breach, `P1` priority, or policy conflict.

### Ground-Truth Isolation and Evaluation Workflow
- Operational exports (`/datasets/csv/*.csv`, `/datasets/json/*.json`, `/datasets/starter_dataset.json`) contain **zero** ground-truth columns (`has_anomaly`, `anomaly_type`, `root_cause`).
- Ground-truth labels are stored exclusively in `/datasets/ground_truth.csv` and `/datasets/ground_truth.json`.
- The evaluation engine (`src/services/validationAndEvaluationEngine.ts`) strips any ground-truth properties from input bundles before running operational anomaly detectors, then compares detected flags against the isolated ground-truth manifest to compute precision, recall, F1, and 11 explicit compliance metrics (`/datasets/evaluation_metrics_report.json`).

---

## 13. Repository Structure

```text
.
├── api/                                # Vercel Serverless Functions & Express API handlers
│   ├── ai/
│   │   └── policy-assistant.ts         # Grounded RAG policy assistant endpoint
│   ├── auth/
│   │   ├── firebase-claim.ts           # Firebase Admin custom claim bridge
│   │   └── welcome-email.ts            # Verified welcome email trigger endpoint
│   └── ops/
│       └── workspace.ts                # Core ticket, routing, lifecycle, SLA & benchmark API
├── datasets/                           # Deterministic benchmark exports & evaluation reports
│   ├── csv/                            # 11 entity CSV exports & validation/metric CSVs
│   ├── json/                           # 11 entity JSON exports
│   ├── sql/                            # SQL seed benchmark export
│   ├── anomaly_detection_results.json  # Per-scenario anomaly detection & remediation results
│   ├── evaluation_metrics_report.json  # 11 explicit evaluation metrics with numerators/denominators
│   ├── evaluation_report.json          # End-to-end benchmark & 12-stage workflow evaluation
│   ├── ground_truth.csv                # Isolated ground-truth anomaly labels (CSV)
│   ├── ground_truth.json               # Isolated ground-truth anomaly labels (JSON)
│   ├── reproducibility_report.json     # Run 1 vs Run 2 SHA-256 checksum verification
│   ├── seed_configuration.json         # Fixed-seed (20261022) parameters
│   ├── source_provenance_manifest.json # Authoritative policy & entity provenance manifest
│   ├── starter_dataset.json            # Compact 50-ticket operational starter bundle
│   └── validation_report.json          # 13-check (VAL-01..VAL-13) data integrity report
├── google-apps-script/
│   └── WelcomeEmailWebApp.gs           # Google Apps Script Gmail dispatch web app
├── scripts/
│   ├── generate-and-verify-phase3.ts   # Deterministic dataset & evaluation generator CLI
│   ├── seed-remote-supabase.ts         # Idempotent remote Supabase PostgreSQL seeder
│   └── verify-remote-supabase.ts       # Remote schema & table count verification CLI
├── src/
│   ├── components/                     # Layout, navigation, and route protection components
│   ├── context/                        # Unified AuthContext (Supabase + Firebase + Workspace state)
│   ├── data/                           # Static reference catalogs
│   ├── lib/                            # Supabase, Firebase, and environment config clients
│   ├── pages/
│   │   ├── public/                     # Home, About, Features, Contact, SignIn, SignUp, ResetPassword
│   │   └── workspace/                  # Dashboard, MyRequests, CreateRequest, AIAssistant, KnowledgeBase, etc.
│   ├── services/                       # Workflow, SLA, RAG, Data Generator, Validation & Test Suites
│   ├── types/                          # Domain and database TypeScript interfaces
│   ├── utils/                          # Formatting and UI helper utilities
│   ├── App.tsx                         # Application router
│   └── main.tsx                        # React DOM entry point
├── supabase/
│   └── migrations/                     # PostgreSQL schema, forced RLS, and atomic RPC migrations
├── .env.example                        # Safe environment variable template
├── index.html                          # HTML entry point
├── package.json                        # Scripts and dependencies
├── server.ts                           # Local full-stack Express + Vite server
├── tsconfig.json                       # TypeScript compiler configuration
├── vercel.json                         # Vercel build and SPA/API routing configuration
└── vite.config.ts                      # Vite bundler configuration
```

---

## 14. Security and Privacy

- **Forced Row Level Security (RLS):** All 20 PostgreSQL tables in `public` enable and force RLS (`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`).
- **Dual-Issuer JWT Validation in SQL:** Database helper `public.is_valid_authenticated_jwt()` strictly validates that the caller token carries `role = 'authenticated'` and originates from either the project's Supabase Auth endpoint (`%/auth/v1`) or the verified Firebase project (`https://securetoken.google.com/campusresolveai`).
- **Role-Based Access Control (RBAC):** Self-service profile creation is constrained to `actor_role = 'learner'`. Only `support_staff`, `academic_administrator`, and `platform_administrator` roles can transition operational states, reassign queues, or view internal staff notes.
- **Internal Note Redaction:** Messages marked `is_internal = true` are filtered out at both the PostgreSQL RLS layer and the `/api/ops/workspace` serialization layer when the caller is a `Learner` or `Instructor`.
- **Ground-Truth Access Restriction:** Benchmark ground-truth APIs (`GET /api/ops/workspace?action=evaluation_benchmark`) and UI views enforce strict role checks, returning `HTTP 403 FORBIDDEN_ROLE` for `Learner` and `Instructor` callers.
- **Server-Side Secret Isolation:** `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_ADMIN_PRIVATE_KEY`, and `APPS_SCRIPT_SHARED_SECRET` are read exclusively inside Node.js serverless endpoints (`/api/**`) and are never bundled into client code.

---

## 15. Limitations

- **Firebase Free Spark Plan Custom Claims:** Because Google Cloud Identity Platform (GCIP) blocking functions require a paid Blaze plan, new Firebase Google sign-ins rely on `/api/auth/firebase-claim` (using `FIREBASE_ADMIN_CLIENT_EMAIL` and `FIREBASE_ADMIN_PRIVATE_KEY`) to stamp `role: "authenticated"` onto the Firebase user record and refresh the ID token.
- **Google Apps Script Daily Quotas:** Welcome email dispatch through `WelcomeEmailWebApp.gs` is subject to standard Google consumer/Workspace `MailApp` daily recipient quotas and depends on recipient mail server spam filtering for final inbox placement (`inboxDeliveryGuaranteed: false`).
- **In-Memory Benchmark Execution on Serverless:** The `evaluation_benchmark` action regenerates and validates the deterministic benchmark in memory (`seed = 20261022`) to avoid mutating live operational tickets in Supabase.
- **Serverless Idempotency Cache Scope:** The in-memory idempotency cache in `/api/ops/workspace.ts` deduplicates rapid retries within a warm serverless instance, while PostgreSQL primary keys, unique constraints, and `atomic_reassign_ticket_workflow` row locks (`FOR UPDATE`) enforce durable database-level idempotency across cold starts.

---

## 16. Deployment

### Deploying to Vercel

1. **Push the repository to GitHub:**
   Ensure `.env` is excluded (verified via `.gitignore`) and commit all source files, migrations, and `/datasets/` artifacts.
2. **Import Project in Vercel:**
   - Sign in to Vercel and click **Add New... -> Project**.
   - Select the GitHub repository.
   - Vercel automatically reads `vercel.json`:
     - **Framework Preset:** `Vite`
     - **Build Command:** `npm run build`
     - **Output Directory:** `dist`
3. **Configure Environment Variables in Vercel Project Settings:**
   Add all required variables from `.env.example` under **Settings -> Environment Variables** (for `Production`, `Preview`, and `Development`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
   - `FIREBASE_ADMIN_PROJECT_ID`
   - `FIREBASE_ADMIN_CLIENT_EMAIL`
   - `FIREBASE_ADMIN_PRIVATE_KEY`
   - `APPS_SCRIPT_WEB_APP_URL`
   - `APPS_SCRIPT_SHARED_SECRET`
   - `APPLICATION_BASE_URL` (set to your production Vercel URL, e.g., `https://your-project.vercel.app`)
4. **Authorize the Production Domain in External Providers:**
   - **Firebase Console:** Go to **Authentication -> Settings -> Authorized domains** and add your `.vercel.app` domain.
   - **Supabase Dashboard:** Go to **Authentication -> URL Configuration**, set **Site URL** to `https://your-project.vercel.app`, and add `https://your-project.vercel.app/**` and `https://your-project.vercel.app/reset-password` to **Redirect URLs**.
5. **Deploy and Verify:**
   Click **Deploy** and run the post-deployment smoke tests against the live Vercel URL.

---

## 17. GitHub Submission Checklist

- [x] Production build (`npm run build`) completes with zero bundler or asset errors.
- [x] TypeScript compiler check (`npm run lint`) passes with zero type errors.
- [x] All 97 automated tests across 17 suites (`npm test -- --run`) pass.
- [x] `.gitignore` excludes `node_modules/`, `dist/`, `.env`, `.env.*` (while retaining `!.env.example`).
- [x] Zero secret API keys, private keys, or service-role tokens exist in tracked source files.
- [x] All 3 PostgreSQL migrations (`20261030000001`, `20261030000002`, `20261030000003`) are committed in `/supabase/migrations/`.
- [x] Deterministic benchmark datasets, provenance manifests, and validation/evaluation reports are committed in `/datasets/`.
- [x] `vercel.json` is configured for Vite static output (`dist/`) and `/api/*` serverless routing with SPA fallback.
