# CampusResolve AI — Data Dictionary & Synthetic Data Architecture

## 1. Dataset Configuration
- **Generator Seed**: `20261022`
- **Anchor Timestamp**: `2026-09-01T13:30:00+05:30` (ISO 8601 with explicit IST offset)
- **Generation Command**: `npm run generate:dataset`
- **Schema Reference**: [Official Data Dictionary (All 11 Entities)](DATA_DICTIONARY.md)

### Dataset Record Counts
| Entity | Records |
|---|---:|
| Requesters | 500 |
| Roles | 5 |
| Academic Terms | 4 |
| Policy Documents | 24 |
| Knowledge Articles | 200 |
| Categories | 4 |
| Tickets | 5,000 |
| Messages | 20,000 |
| Assignments | 5,399 |
| SLAs | 5,000 |
| Resolution Feedback | 2,667 |

- **Synthetic Scope**: All records are synthetically generated for benchmark evaluation.

## 2. Entity Relationships
- **Role → Requester**: One institutional role maps to multiple requesters.
- **Term → Requester/Ticket**: Each requester and ticket references an active academic term.
- **Requester → Ticket**: A requester submits and tracks multiple support tickets.
- **Category → Policy/Article/Ticket**: Categorizes records into Financial Aid, Registration, IT, or Accessibility.
- **Policy → Knowledge Article**: Knowledge base articles cite authoritative governing policies.
- **Ticket → Message**: A ticket contains sequential conversation messages.
- **Ticket → Assignment**: A ticket tracks active and historical team assignments.
- **Ticket → SLA**: Each ticket binds to exactly one business-hour SLA tracking record.
- **Ticket → Resolution Feedback**: Resolved tickets capture student satisfaction ratings.

## 3. Identifier Formats
| Entity | Format Pattern | Example |
|---|---|---|
| Ticket | `TKT-YYYY-NNNNNN` | `TKT-2026-000001` |
| Message | `MSG-TKT-YYYY-NNNNNN-NNN` | `MSG-TKT-2026-000001-001` |
| Knowledge Article | `KB-NNNNNN` | `KB-000001` |
| Policy Document | `POL-{DOMAIN}-YYYY-NNN` | `POL-FINAID-2026-001` |
| Assignment | `ASG-TKT-YYYY-NNNNNN-NN` | `ASG-TKT-2026-000001-01` |
| SLA | `SLA-TKT-YYYY-NNNNNN` | `SLA-TKT-2026-000001` |
| Requester | `REQ-YYYY-NNNNNN` | `REQ-2026-000001` |
| Feedback | `FDB-TKT-YYYY-NNNNNN` | `FDB-TKT-2026-000001` |

- **Integrity**: Identifiers are generated deterministically and strictly checked for primary key uniqueness.

## 4. Core Data Entities
- **Requester**:
  - Captures student/faculty identity, department, cohort, and verification status.
- **Role**:
  - Defines institutional roles, permission boundaries, and authorized workflows.
- **Term**:
  - Models academic term dates, add/drop windows, and deadline milestones.
- **Policy Document**:
  - Stores authoritative policy text, version history, effective dates, and expiration markers.
- **Knowledge Article**:
  - Searchable FAQs and guidance articles mapped to underlying policy citations.
- **Category**:
  - Four institutional domains: Financial Aid, Registration, IT Support, Accessibility.
- **Ticket**:
  - Primary transaction entity storing issue details, urgency, state, and policy links.
- **Message**:
  - Immutable message threads containing public replies, internal notes, and citations.
- **Assignment**:
  - Historical and current departmental team assignments with reassignment reasoning.
- **SLA**:
  - Business-hour countdown tracking, target deadlines, elapsed time, and breach flags.
- **Resolution Feedback**:
  - Post-resolution student satisfaction ratings (helpfulness, policy clarity, satisfaction).

## 5. Master-First Generation Pipeline
- **Step 1**: Generate master roles and academic term schedules.
- **Step 2**: Generate student and faculty requester profiles.
- **Step 3**: Generate 24 policy documents and 200 knowledge base articles.
- **Step 4**: Generate institutional categories and 5,000 operational tickets.
- **Step 5**: Generate message threads and departmental assignment histories.
- **Step 6**: Compute business-hour SLA metrics and target deadlines.
- **Step 7**: Append resolution feedback records for resolved tickets.

### Data Integrity Validations
- Primary key uniqueness across all 11 tables.
- Foreign key referential integrity with zero dangling records.
- Chronological ordering of timestamps and term boundary dates.
- State machine transition legality across ticket lifecycles.
- Message sequence number consistency within each ticket thread.

## 6. Evaluation Anomaly Scenarios
| Scenario | Injected Defect | Expected Remediation |
|---|---|---|
| 1. Expired Policy Citation | References an expired policy (v1.0) | Remediate citation to current active policy (v2.0) |
| 2. Unauthorized Routing | Routed to unauthorized departmental team | Reassign ticket to correct authorized unit |
| 3. Unsupported Claim | AI response cites facts without policy evidence | Block output and require verified citations |
| 4. Incorrect SLA Calculation | Due date ignores weekends and business hours | Recompute target date using institutional calendar |
| 5. Missed Escalation | High-urgency repeated breach unescalated | Trigger mandatory escalation to Academic Administrator |

- **Sample Size**: 200 controlled synthetic cases per scenario (1,000 total anomaly cases).
- **Ground-Truth Isolation**: Stored in `datasets/ground_truth.json` separate from operational inputs.

## 7. Synthetic Provenance & Reproducibility
- **Seed Determinism**: Fixed seed `20261022` guarantees identical outputs across all environments.
- **Execution Command**:
  ```bash
  npm run generate:dataset
  ```
- **Verification**: Generates exact SHA-256 entity hashes documented in `datasets/seed_summary_and_checksums.json`.
- **Privacy Assurance**: 100% synthetic data with zero personally identifiable institutional data.
