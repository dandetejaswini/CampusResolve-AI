# CampusResolve AI

Enterprise academic support and policy resolution platform designed for higher education institutions.

### Platform Overview
- **Core Purpose**: Streamlines and orchestrates the end-to-end lifecycle of student and faculty academic requests.
- **Institutional Domains**: Financial Aid, Registration & Records, IT Services, and Accessibility Accommodations.
- **Key Capabilities**: Automated departmental triage, business-hour SLA deadline tracking, compliance anomaly detection, and immutable administrative audit trails.

### Policy-Grounded AI & Guardrails
- **Retrieval-Augmented Generation (RAG)**: Grounds student and faculty inquiries in verified institutional policies and knowledge base articles.
- **Authoritative Citations**: Directly references exact policy IDs, article numbers, and effective dates.
- **Compliance Guardrails**: Automatically detects and rejects citations to expired or superseded policies.
- **Hallucination Blocking**: Blocks unverified factual claims without citations and requests clarification for ambiguous student inquiries.

### Multi-Actor Role Architecture
- **Learner**: Submits academic petitions, tracks real-time progress, and provides post-resolution feedback.
- **Instructor**: Coordinates classroom accommodations and provides faculty attestations for student appeals.
- **Support Staff**: Triages incoming tickets, validates policy citations, and manages initial resolutions.
- **Academic Administrator**: Reviews escalated cases, approves policy exceptions, and publishes governing documentation.
- **Platform Administrator**: Configures institutional SLA rules, business hours, and monitors platform health.
- **Role Switcher**: In-app role selector in the top navigation bar allows instant role switching for evaluation and review.

### Synthetic Benchmark & Evaluation
- **Deterministic Generation**: Generated with fixed seed `20261022` and anchor date `2026-09-01T13:30:00+05:30`.
- **Dataset Scale**: Exactly 5,000 tickets, 20,000 messages, 200 knowledge articles, and 24 policy documents.
- **Realistic Surges**: Simulates peak term volumes (add/drop windows, financial aid deadlines) and diverse student writing styles.
- **Benchmark Performance**: 98.6% overall accuracy, 100% precision, and a 0.9637 F1 score across 5 negative compliance scenarios.

### Getting Started & Local Development
- **Clone & Install**:
  ```bash
  git clone https://github.com/dandetejaswini/CampusResolve-AI.git
  cd CampusResolve-AI
  npm install
  ```
- **Configuration**: Copy `.env.example` to `.env` and provide your Supabase and Firebase keys.
- **Run Application**:
  - `npm run dev`: Launch local development server at `http://localhost:3000`.
  - `npm test`: Run complete automated validation and regression suite (112 tests).
  - `npm run lint`: Run TypeScript typechecks without emitting files.
  - `npm run generate:dataset`: Deterministically regenerate synthetic benchmark dataset and checksums.

### Documentation & Reference Guides
All technical architecture specifications and evaluation methodologies are organized in `docs/`:
- [Data Dictionary (All 11 Entities)](docs/DATA_DICTIONARY.md) — Comprehensive schema specifications, data types, constraints, and validation rules.
- [Testing & Evaluation Methodology](docs/TESTING_AND_EVALUATION.md) — Baseline comparison metrics, confusion matrices, and validation reports.
- [Architecture & Design Decisions](docs/ARCHITECTURE_AND_DESIGN_DECISIONS.md) — Technical architecture, state machine DAGs, and RAG design principles.
- [Video Demonstration Script](docs/DEMO_VIDEO_SCRIPT.md) — Timed 2-minute 45-second screen walkthrough script and recording checklist.
- [Setup & Cloud Architecture](docs/SETUP_AND_ARCHITECTURE.md) — Environment setup, Supabase PostgreSQL migrations, and Firebase Auth bridge.
- [Synthetic Architecture & Schema Details](docs/DATA_DICTIONARY_AND_ARCHITECTURE.md) — Relational mappings, bridge tables, and generation mechanics.
- [Limitations & Future Roadmap](docs/LIMITATIONS_AND_FUTURE_IMPROVEMENTS.md) — Current institutional constraints and planned SIS integrations.
- [AI Usage & Prompt History](docs/AI_USAGE_AND_PROMPT_HISTORY.md) — Transparent disclosure of AI assistance and developer oversight.

### Live Application
- **Production URL**: [https://campus-resolve-ai.vercel.app](https://campus-resolve-ai.vercel.app)
- **Live Features**: Role-based access switching, operational tickets, and policy-grounded query testing.
