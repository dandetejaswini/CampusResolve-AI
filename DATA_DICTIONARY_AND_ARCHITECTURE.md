# CampusResolve AI — Data Dictionary & Synthetic Data Architecture

## 1. Dataset Configuration

- **Generator Seed:** `20261022`
- **Anchor Timestamp:** `2026-09-01T13:30:00+05:30` (ISO 8601 with explicit IST offset)
- **Generation Command:** `npm run generate:dataset`
- **Comprehensive Reference:** See the standalone [Official Data Dictionary (All 11 Entities)](DATA_DICTIONARY.md) for field-level constraints, validation regex, and cardinalities.

### Dataset Summary

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

All records are synthetically generated for demonstration and evaluation.

## 2. Entity Relationships

- **Role → Requester:** One role can belong to multiple requesters.
- **Term → Requester/Ticket:** Each requester and ticket is associated with an academic term.
- **Requester → Ticket:** A requester can submit multiple tickets.
- **Category → Policy/Article/Ticket:** Each record belongs to a category.
- **Policy → Knowledge Article:** Articles reference their governing policies.
- **Ticket → Message:** A ticket can contain multiple messages.
- **Ticket → Assignment:** A ticket can have multiple assignment records.
- **Ticket → SLA:** Each ticket has one SLA record.
- **Ticket → Resolution Feedback:** Resolved tickets can have one feedback record.

## 3. Identifier Formats

| Entity | Example |
|---|---|
| Ticket | `TKT-2026-000001` |
| Message | `MSG-TKT-2026-000001-001` |
| Knowledge Article | `KB-000001` |
| Policy Document | `POL-FINAID-2026-001` |
| Assignment | `ASG-TKT-2026-000001-01` |
| SLA | `SLA-TKT-2026-000001` |
| Requester | `REQ-2026-000001` |
| Feedback | `FDB-TKT-2026-000001` |

Identifiers are generated deterministically and validated for uniqueness and format.

## 4. Core Data Entities

The platform uses 11 primary entities:

### Requester
Stores requester identity, role, department, academic term, and account status.

### Role
Defines institutional roles, permissions, and authorized actions.

### Term
Stores academic term details, dates, deadlines, and lifecycle status.

### Policy Document
Stores policy content, category, version, effective dates, and expiration details.

### Knowledge Article
Contains searchable guidance linked to relevant policy documents.

### Category
Defines the four request categories:
- Financial Aid
- Registration
- IT
- Accessibility

### Ticket
Stores request details, requester, category, priority, lifecycle status, assignment, and policy references.

### Message
Maintains ticket conversations, sender details, message types, and policy citations.

### Assignment
Records routing decisions, assigned teams, assignment history, and reassignment details.

### SLA
Tracks response deadlines, resolution targets, elapsed time, and escalation status.

### Resolution Feedback
Stores requester ratings, helpfulness, policy clarity, and resolution feedback.

## 5. Data Generation and Validation

The dataset follows a master-first generation process:

1. Generate roles and academic terms.
2. Generate requesters.
3. Generate policies and knowledge articles.
4. Generate categories and tickets.
5. Generate messages and assignments.
6. Generate SLA records.
7. Generate resolution feedback.

Validation covers:

- Primary key uniqueness.
- Foreign key integrity.
- Required fields and allowed values.
- Date and effective-version consistency.
- Ticket lifecycle consistency.
- Message sequence integrity.
- Assignment and SLA consistency.
- Duplicate record detection.

## 6. Anomaly Scenarios

Five deterministic anomaly scenarios are included for evaluation.

| Scenario | Description | Expected Handling |
|---|---|---|
| Expired Policy Citation | Ticket references an expired policy. | Use the current applicable policy. |
| Unauthorized Routing | Ticket is assigned to an incorrect team. | Route to the authorized team. |
| Unsupported Claim | Response contains an unsupported policy statement. | Restrict answers to verified sources. |
| Incorrect SLA Calculation | SLA ignores configured business hours. | Recalculate using the configured schedule. |
| Missed Escalation | Required escalation is not triggered. | Escalate and assign for human review. |

Each scenario contains 200 synthetic cases.

Ground-truth labels are stored separately from operational records to prevent evaluation leakage.

## 7. Synthetic Data Provenance

- All benchmark records are synthetic.
- Policy and knowledge content is created for demonstration.
- Synthetic policy records are explicitly identified as non-regulatory.
- No confidential institutional records are required.
- Dataset generation uses a fixed seed for reproducibility.

## 8. Export Files

### CSV
`datasets/csv/`

Contains structured exports for all 11 entities and evaluation reports.

### JSON
`datasets/json/`

Contains entity-level JSON records and the starter dataset.

### SQL
`datasets/sql/`

Contains the synthetic benchmark SQL export.

### Ground Truth
- `datasets/ground_truth.csv`
- `datasets/ground_truth.json`

### Evaluation and Validation
- `datasets/validation_report.json`
- `datasets/evaluation_report.json`
- `datasets/evaluation_metrics_report.json`
- `datasets/anomaly_detection_results.json`
- `datasets/reproducibility_report.json`

### Configuration and Provenance
- `datasets/seed_configuration.json`
- `datasets/source_provenance_manifest.json`
- `datasets/seed_summary_and_checksums.json`

## 9. Reproducibility

Run the dataset generator:

    npm run generate:dataset

The fixed seed ensures consistent synthetic records across repeated runs. Generated checksums and validation reports support reproducibility verification.

## 10. Evaluation Notes

- Evaluation uses controlled synthetic benchmark data.
- Ground-truth labels remain separate from operational inputs.
- Metrics are calculated from predefined expected outcomes.
- Synthetic benchmark results do not guarantee real-world performance.
- Configurable routing and SLA assumptions should not be interpreted as official institutional policies.
