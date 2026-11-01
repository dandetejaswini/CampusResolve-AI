# Architecture and Design Decisions — CampusResolve AI

**Document Version:** 2026.10-Phase4  
**Platform Architecture:** Enterprise Academic Service Desk & Deterministic Policy Governance Engine  
**Deployment Target:** Vercel Edge / Serverless Functions + Supabase PostgreSQL  

---

## 1. Problem Statement and Solution Overview
- **Institutional Problem**:
  - Higher education institutions process high volumes of student inquiries across Financial Aid, Registration, IT, and Accessibility.
  - Legacy ticketing systems lack policy grounding, leading to inconsistent guidance.
  - Manual triage causes SLA breaches, lack of auditability, and staff burnout.
- **CampusResolve AI Solution**:
  - Enterprise-grade academic support workspace with policy-grounded AI (RAG).
  - Business-hour SLA tracking with calendar awareness.
  - Five-perspective role-based access control (RBAC).
  - Robust Supabase PostgreSQL persistence with dual Firebase/Supabase authentication.

---

## 2. High-Level System Architecture
```mermaid
graph TD
    Client[React 19 SPA / Vite] -->|HTTPS / Bearer JWT| Server[Node.js / Express Serverless API]
    Server -->|RS256 JWT Verify| FB[Firebase Auth / Google Sign-In]
    Server -->|Row Level Security / RPC| SB[(Supabase PostgreSQL Database)]
    Server -->|Policy RAG & Extraction| Gemini[Google Gemini 2.5 Flash API]
    Server -->|Deterministic RAG Fallback| Fallback[Local Synthetic Knowledge Engine]
    Server -->|Welcome Email Dispatch| GAS[Google Apps Script MailApp]
```

---

## 3. Frontend Architecture
- **Framework & Styling**: Built with React 19, TypeScript, Tailwind CSS, and React Router.
- **State Management**: Modular context providers (`AuthContext`, `WorkspaceContext`) and domain hooks.
- **View Separation**: Clear demarcation between public marketing pages and authenticated workspace sections.
- **Interactive Role Switcher**: Top navigation selector enables instant preview of all five institutional roles without re-authenticating.

---

## 4. Backend and API Architecture
- **Server Framework**: Dual-mode Express server (`server.ts`) for local development and standalone Vercel Serverless Functions (`/api/*`).
- **Core API Endpoints**:
  - `POST /api/auth/firebase-claim`: Server-side token verification and profile auto-provisioning.
  - `POST /api/auth/welcome-email`: Welcome email dispatch via Google Apps Script.
  - `GET /api/ops/workspace`: Workspace operational bootstrap, ticket queues, metrics, and KB pagination.
  - `POST /api/ops/workspace`: Ticket creation, lifecycle state transitions, team reassignments, and feedback.
  - `POST /api/ai/policy-assistant`: Policy RAG retrieval, citation verification, and escalation linking.

---

## 5. Supabase Database Architecture
- **Engine**: PostgreSQL managed through Supabase with Row Level Security (RLS) on all tables.
- **Data Model**: 18 relational tables linking master entities, transactions, SLAs, and lifecycle events.
- **Atomic Operations**: Database RPC `atomic_reassign_ticket_workflow` ensures ACID transactions across assignments, tickets, and audit trails.

---

## 6. Authentication and Authorization Boundaries
- **Supported Providers**: Supabase Email/Password and Firebase Google Sign-In (`campusresolveai`).
- **Five Institutional Roles**:
  - **Learner**: Submits petitions, tracks status, reads articles, submits ratings.
  - **Instructor**: Reviews academic inquiries, attaches course attestations, recommends routing.
  - **Support Staff**: Triages queues, validates policy citations, posts internal notes.
  - **Academic Administrator**: Adjudicates escalations, approves policy exceptions, publishes governing policies.
  - **Platform Administrator**: Configures business hours, SLA targets, and oversees benchmark evaluations.

---

## 7. Key Architectural Decisions and Trade-Offs

### Decision 1: Date-Aware Policy RAG & Supersession Tracking
- **Challenge**: Standard vector search ignores policy lifecycle dates, risking citations to expired rules.
- **Implementation**:
  - Filters candidate policies against `effective_date` and `expiration_date` relative to ticket submission time.
  - Flags outdated versions as `superseded` or `expired`.
  - Excludes inactive versions from generative citations.

### Decision 2: Standardized ISO 8601 Timestamps with Explicit Offset (+05:30)
- **Challenge**: Inconsistent or unqualified date strings break chronological ordering and SLA calculations.
- **Implementation**:
  - Standardized all 11 entities to strict `YYYY-MM-DDTHH:mm:ss+05:30` format.
  - Normalizes calculations via epoch milliseconds while preserving the institutional timezone offset.

### Decision 3: Expanded 24-Document Policy Corpus
- **Challenge**: Initial 12 documents were insufficient for 200 articles and complex exception scenarios.
- **Implementation**:
  - Expanded corpus to 24 authoritative policies (6 per institutional domain).
  - Modeled version progressions (v1.0 expired, v2.0 active, v2.1 revised) and explicit section citations.

### Decision 4: Deterministic RAG Fallback
- **Challenge**: Cloud LLM API latency, network drops, or rate limits during automated benchmark evaluation.
- **Implementation**:
  - Added deterministic, rule-grounded synthesizer triggered on API timeout or missing API keys.
  - Guarantees 100% test reproducibility and zero hallucination during automated testing.

### Decision 5: Atomic Reassignment RPC Migration
- **Challenge**: Sequential multi-table HTTP writes risk race conditions and orphaned assignments.
- **Implementation**:
  - Deployed PostgreSQL function `atomic_reassign_ticket_workflow`.
  - Executes assignment retirement, new assignment insertion, ticket status updates, and lifecycle logging in a single atomic database transaction.
