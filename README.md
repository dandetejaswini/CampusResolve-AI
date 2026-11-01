# CampusResolve AI

Enterprise academic support and deterministic policy governance platform designed for higher education institutions.

- **Live Production Application**: [https://campus-resolve-ai-red.vercel.app/](https://campus-resolve-ai-red.vercel.app/)
- **GitHub Repository**: [https://github.com/dandetejaswini/CampusResolve-AI](https://github.com/dandetejaswini/CampusResolve-AI)

---

### Platform Highlights

- **End-to-End Academic Support**: Orchestrates student petitions and faculty inquiries across Financial Aid, Registration, IT Services, and Accessibility.
- **Date-Aware Policy RAG**: Grounds responses in active institutional policies while proactively rejecting expired or superseded versions.
- **Business-Hour SLA Engine**: Tracks response and resolution deadlines using institutional business hours, excluding weekends and academic holidays.
- **Role-Governed UI & Workflows**: Features and permissions are strictly bounded by authenticated institutional roles.
- **One-Click Quick Demo Accounts**: Instant preview for all 5 institutional roles directly from the sign-in and sign-up pages.

---

### Institutional Roles

- **Student / Learner**: Submits academic requests, consults policy-grounded AI guidance, and tracks SLA resolution timelines.
- **Instructor / Faculty**: Submits course-related petitions, provides faculty attestations, and requests policy clarifications.
- **Operations Support Staff**: Coordinates intake triage desk, assigns departmental queues, and manages SLA compliance.
- **Academic Administrator / Dean**: Adjudicates complex escalations, approves policy exceptions, and oversees governing documentation.
- **Platform Administrator**: Configures institutional operating hours, SLA target thresholds, and executes benchmark evaluations.

---

### Policy-Grounded AI & Guardrails

- **Authoritative Citations**: Cites exact policy document identifiers, version numbers, and relevant section passages.
- **Date & Version Awareness**: Checks policy lifecycle state against inquiry dates to exclude superseded guidance.
- **Conflict & Ambiguity Handling**: Detects conflicting active rules, highlights discrepancies, and triggers human escalation.
- **Deterministic Client Fallback**: Automatically provides local deterministic retrieval if external LLM APIs experience timeouts or latency.

---

### Synthetic Benchmark & Reproducibility

- **Fixed-Seed Generation**: Seed `20261022` with anchor date `2026-09-01T13:30:00+05:30`.
- **Dataset Scale**: Exactly 5,000 tickets, 20,000 messages, 200 knowledge articles, and 24 policy documents across 11 core relational tables.
- **Evaluation Performance**: Achieves 98.6% overall accuracy, 100% precision, and 0.9637 F1-score across 5 negative anomaly scenarios on held-out test data.

---

### Quick Start & Local Development

- **Clone Repository**:
  ```bash
  git clone https://github.com/dandetejaswini/CampusResolve-AI.git
  cd CampusResolve-AI
  npm install
  ```
- **Configure Environment**:
  - Copy `.env.example` to `.env` and configure Supabase and Firebase keys.
- **Run Application**:
  - `npm run dev`: Start local development server at `http://localhost:3000`.
  - `npm test`: Execute complete test suite (112 / 112 passed).
  - `npm run build`: Compile production client and serverless API bundles.
  - `npm run generate:dataset`: Deterministically regenerate synthetic benchmark dataset.

---

### Technical Documentation Directory (`docs/`)

- [Architecture & Design Decisions](docs/ARCHITECTURE_AND_DESIGN_DECISIONS.md) — High-level system architecture, dual-provider auth, and RAG design principles.
- [Data Dictionary (All 11 Entities)](docs/DATA_DICTIONARY.md) — Comprehensive schema specifications, data types, constraints, and validation rules.
- [Deployment & Setup Guide](docs/DEPLOYMENT_AND_SETUP_GUIDE.md) — Vercel production setup, live URL configuration, and Google Apps Script email webhook.
- [Testing & Evaluation Methodology](docs/TESTING_AND_EVALUATION.md) — Baseline benchmarking, confusion matrices, and anomaly detection results.
- [Limitations & Future Roadmap](docs/LIMITATIONS_AND_FUTURE_IMPROVEMENTS.md) — Institutional edge cases, OCR boundaries, and planned SIS connectors.
- [AI Usage & Prompt History](docs/AI_USAGE_AND_PROMPT_HISTORY.md) — Traceability of AI engineering assistance and developer verification procedures.
- [Demo Video Script](docs/DEMO_VIDEO_SCRIPT.md) — Structured 2-minute 45-second screen walkthrough script and recording checklist.
