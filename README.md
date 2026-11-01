# CampusResolve AI

CampusResolve AI is an enterprise academic support and policy resolution platform designed for higher education institutions. It streamlines and orchestrates the end-to-end lifecycle of student and faculty requests across four key institutional domains: Financial Aid, Registration, IT Services, and Accessibility Accommodations. The system automates departmental triage, tracks business-hour SLA deadlines, detects compliance anomalies, and maintains historical audit trails for administrative escalations.

### Policy-Grounded AI & Guardrails

At the core of the platform is an AI Policy Assistant powered by Retrieval-Augmented Generation (RAG). When students or faculty submit inquiries, the assistant matches their questions against published institutional policies and knowledge base articles, citing authoritative section numbers and effective dates. To ensure compliance, the engine proactively detects and rejects citations to expired or superseded policies, blocks unsupported factual claims, and requests clarification whenever student inquiries contain ambiguous or contradictory details.

### Multi-Actor Role Architecture

CampusResolve AI provides tailored workspaces and role-based access control (RBAC) across five institutional perspectives. Learners submit academic petitions and provide post-resolution feedback. Instructors coordinate course accommodations and attest to student appeals. Support Staff triage incoming tickets and verify policy citations. Academic Administrators review escalated cases, approve exceptions, and publish governing policies. Platform Administrators configure institutional SLA rules and monitor system integrity. Reviewers can preview each role instantly using the in-app role switcher in the top navigation bar.

### Synthetic Benchmark & Comparative Evaluation

The repository includes a complete, deterministic synthetic dataset generated with fixed seed `20261022` and anchor date `2026-09-01T13:30:00+05:30`. The dataset contains exactly 5,000 tickets, 20,000 messages, 200 knowledge articles, and 24 policy documents. It accurately reflects academic term surges (such as add/drop and financial aid deadlines) and features diverse, messy student writing styles, including urgent deadline requests and informal phrasing. A held-out evaluation framework benchmarks the system against keyword and heuristic baselines across five negative scenarios, achieving 98.6% overall accuracy, 100% precision, and a 0.9637 F1 score.

### Getting Started & Local Development

To run the application locally, clone the repository, install dependencies using `npm install`, and copy `.env.example` to `.env` with your Supabase and Firebase configuration keys. Start the application by running `npm run dev`, and access the local workspace at `http://localhost:3000`. You can execute the automated test suite with `npm test`, run TypeScript typechecks with `npm run lint`, or deterministically regenerate the dataset and verification checksums using `npm run generate:dataset`.

### Documentation & Reference Guides

All technical documentation, schemas, and challenge submission guides are located in the `docs/` directory:

- [Data Dictionary (All 11 Entities)](docs/DATA_DICTIONARY.md) — Comprehensive schema specifications, data types, constraints, and validation rules.
- [Testing & Evaluation Methodology](docs/TESTING_AND_EVALUATION.md) — Baseline comparison metrics, confusion matrices, and validation reports.
- [Architecture & Design Decisions](docs/ARCHITECTURE_AND_DESIGN_DECISIONS.md) — Technical architecture, state machine DAGs, and RAG design principles.
- [Video Demonstration Script](docs/DEMO_VIDEO_SCRIPT.md) — Timed 2-minute 45-second screen walkthrough script and recording checklist.
- [Setup & Cloud Architecture](docs/SETUP_AND_ARCHITECTURE.md) — Environment setup, Supabase PostgreSQL migrations, and Firebase Auth bridge.
- [Synthetic Architecture & Schema Details](docs/DATA_DICTIONARY_AND_ARCHITECTURE.md) — Relational mappings, bridge tables, and generation mechanics.
- [Limitations & Future Roadmap](docs/LIMITATIONS_AND_FUTURE_IMPROVEMENTS.md) — Current institutional constraints and planned SIS integrations.
- [AI Usage & Prompt History](docs/AI_USAGE_AND_PROMPT_HISTORY.md) — Transparent disclosure of AI assistance and developer oversight.

### Live Application

CampusResolve AI is hosted live on Vercel at [https://campusresolve-ai.vercel.app](https://campusresolve-ai.vercel.app). Reviewers can test all workflows directly or sign in with Google to experience live workspace synchronization.
