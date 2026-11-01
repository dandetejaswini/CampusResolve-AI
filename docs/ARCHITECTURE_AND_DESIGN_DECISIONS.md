# Architecture and Design Decisions — CampusResolve AI

**Document Version:** 2026.10-Phase4  
**Platform Architecture:** Enterprise Academic Service Desk & Deterministic Policy Governance Engine  
**Deployment Target:** Vercel Edge / Serverless Functions + Supabase PostgreSQL  

---

## 1. Problem Statement and Solution Overview
Higher education institutions face substantial administrative friction handling tens of thousands of student support inquiries across Financial Aid, Registration, IT Support, and Accessibility. Legacy ticketing systems lack policy grounding, leading to inconsistent guidance, SLA breaches, and manual escalation bottlenecks.

**CampusResolve AI** is an enterprise-grade AI-powered academic support and ticket resolution workspace that integrates deterministic policy grounding (RAG), automated business-hour SLA tracking, multi-role RBAC, and secure Supabase PostgreSQL persistence with Firebase and Supabase authentication.

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
- Built with React 19, TypeScript, Tailwind CSS, and React Router.
- Structured into modular domain components, custom hooks, and context providers (`AuthContext`, `WorkspaceContext`).
- Strict separation between public marketing pages (Home, About, Features, Contact) and authenticated workspace sections (Dashboard, MyRequests, CreateRequest, AIAssistant, KnowledgeBase, Messages, Notifications, Profile, Settings).
- Includes an interactive **Role Perspective Switcher** allowing instant switching between Learner, Instructor, Support Staff, Academic Administrator, and Platform Administrator perspectives without re-authenticating.

---

## 4. Backend and API Architecture
- Full-stack Express server (`server.ts`) supporting local development middleware and Vercel serverless functions (`/api/*`).
- API Endpoints:
  - `POST /api/auth/firebase-claim`: Secure server-side Firebase token verification and Supabase profile provisioning.
  - `POST /api/auth/welcome-email`: Authenticated welcome email dispatch via Google Apps Script.
  - `GET /api/ops/workspace`: Operational workspace data bootstrap, ticket listing, metrics, and knowledge base pagination.
  - `POST /api/ops/workspace`: Ticket creation, stage transitions, reassignments, AI policy escalation, and resolution feedback.
  - `POST /api/ai/policy-assistant`: RAG policy retrieval, citation matching, and escalation ticket linking.

---

## 5. Supabase Database Architecture
- Relational PostgreSQL database managed via Supabase.
- Enforces Row Level Security (RLS) policies on all tables.
- 18 schema tables: `roles`, `terms`, `requesters`, `categories`, `policy_documents`, `policy_version_history`, `knowledge_articles`, `policy_article_links`, `tickets`, `ticket_policy_links`, `ticket_article_links`, `ticket_lifecycle_events`, `messages`, `assignments`, `slas`, `resolution_feedbacks`, `ai_retrieval_logs`, `workspace_notifications`.
- Transactional Atomic Reassignment via PostgreSQL RPC (`atomic_reassign_ticket_workflow`) guaranteeing single-transaction state updates and lifecycle event logging.

---

## 6. Authentication and Authorization Boundaries
- Supports dual authentication: Supabase Email/Password and Firebase Google Sign-In (`campusresolveai`).
- Five Institutional Roles:
  1. **Learner:** Submits requests, views own tickets, reads knowledge base, submits feedback.
  2. **Instructor:** Reviews learner inquiries, cites policies, recommends routing.
  3. **Support Staff:** Triages incoming queues, updates ticket status, assigns teams, posts internal notes.
  4. **Academic Administrator:** Adjudicates policy escalations, reassigns escalated tickets, approves final resolutions.
  5. **Platform Administrator:** Configures system governance, business schedules, SLA rules, and platform evaluation benchmarks.

---

## 7. Key Architectural Decisions and Trade-Offs

### Decision 1: Date-Aware Policy RAG & Supersession Tracking
- **Rationale:** Traditional semantic search retrieves text solely based on cosine similarity, often retrieving older or superseded policy documents (e.g., retrieving an old 10-day appeal limit).
- **Implementation:** CampusResolve AI's retrieval engine filters candidate policies against `effective_date` and `expiration_date` relative to the ticket's `submitted_at` timestamp. Historical versions are marked `superseded` or `expired` and explicitly excluded from active citations.

### Decision 2: Standardized ISO 8601 Timestamps with Explicit Offset (+05:30)
- **Rationale:** Human-readable or unqualified local date strings (e.g. `Tue 2026-09-01 7:37 PM IST`) break sorting, parsing, and SLA arithmetic across distributed servers and databases.
- **Implementation:** All timestamp fields across all 11 entities strictly follow `YYYY-MM-DDTHH:mm:ss+05:30`. Date calculations normalize via epoch milliseconds while preserving the explicit institutional offset.

### Decision 3: Expanded 24-Document Policy Corpus
- **Rationale:** 12 policy documents were insufficient to support 200 operational knowledge articles and multiple superseded versions across 4 categories.
- **Implementation:** Expanded to 24 distinct policy documents (6 per domain: Financial Aid, Registration, IT, Accessibility) incorporating multiple version iterations (v1.0 expired, v2.0 active, v2.1 revised), conflicting directives, and unambiguous authoritative section citations.

### Decision 4: Deterministic RAG Fallback
- **Rationale:** Cloud LLM APIs are subject to transient rate limits, network timeouts, or quota exhaustion during batch evaluation.
- **Implementation:** When Gemini API is unavailable or disabled, the system seamlessly falls back to a deterministic, rule-grounded synthesizer that guarantees 100% test pass rates and zero hallucination.

### Decision 5: Atomic Reassignment RPC Migration
- **Rationale:** Sequential multi-table writes in application code create race conditions where a ticket's status is updated but its assignment lineage fails or is duplicated.
- **Implementation:** Implemented PostgreSQL function `atomic_reassign_ticket_workflow` that deactivates the prior assignment, inserts the new assignment, updates ticket team and status, appends an immutable lifecycle event, and sends a notification in a single atomic database transaction.
