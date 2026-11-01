# CampusResolve AI — Phase 3 & Phase 4 Authoritative Data Dictionary, Entity Relationships & Synthetic Data Architecture

## 1. Challenge Constants, Master-First Generation Order & Fixed Seed

- **Fixed Deterministic Generator Seed**: `20261022` (Mulberry32 32-bit PRNG, zero uncontrolled randomness)
- **Anchor Timestamp**: `2026-09-01T08:00:00.000Z`
- **Generator Command**: `npm run generate:dataset` (`tsx scripts/generate-and-verify-phase3.ts`)
- **Master-First Parent-to-Child Generation Order**:
  1. `Requester` (`public.requesters` — bound to master `Role` and `Term` references)
  2. `Role` (`public.roles`)
  3. `Term` (`public.terms`)
  4. `PolicyDocument` (`public.policy_documents`)
  5. `KnowledgeArticle` (`public.knowledge_articles`)
  6. `Category` (`public.categories` — instantiated before `PolicyDocument`, `KnowledgeArticle`, and `Ticket` for FK integrity)
  7. `Ticket` (`public.tickets`)
  8. `Message` (`public.messages`)
  9. `Assignment` (`public.assignments`)
  10. `SLA` (`public.slas`)
  11. `ResolutionFeedback` (`public.resolution_feedbacks`)
- **Full Challenge Baseline Volumes**:
  - `5,000` Tickets (`TKT-2026-000001` .. `TKT-2026-005000`)
  - `200` Knowledge Articles (`KB-000001` .. `KB-000200`)
  - `20,000` Messages (`MSG-TKT-2026-000001-001` .. `MSG-TKT-2026-005000-004`, 4 messages per ticket)
  - `500` Requesters (`REQ-2026-000001` .. `REQ-2026-000500`)
  - `12` Versioned Policy Documents (`POL-<domain>-2026-001` .. `003`, 8 active + 4 expired)
  - `4` Official Categories (`Financial Aid`, `Registration`, `IT`, `Accessibility`)
  - `5` Institutional Roles (`ROLE-LEARNER`, `ROLE-INSTRUCTOR`, `ROLE-SUPPORT_STAFF`, `ROLE-ACADEMIC_ADMIN`, `ROLE-PLATFORM_ADMIN`)
  - `4` Academic Terms (`TERM-2025-FALL`, `TERM-2026-SPRING`, `TERM-2026-SUMMER`, `TERM-2026-FALL`)
  - `5,000` Assignments (`ASG-TKT-2026-000001-01` .. `ASG-TKT-2026-005000-01`)
  - `5,000` SLAs (`SLA-TKT-2026-000001` .. `SLA-TKT-2026-005000`)
  - `3,600` Resolution Feedbacks (`FDB-TKT-2026-000001` .. on all resolved tickets)

---

## 2. Exact Identifier Formats & Validation Patterns

| Entity | Format Pattern | Regex Constraint | Example |
| :--- | :--- | :--- | :--- |
| `Ticket` | `TKT-2026-000001` | `^TKT-2026-[0-9]{6}$` | `TKT-2026-000001` (Benchmark), `TKT-2026-100001` (Live User) |
| `Message` | `MSG-<ticket-id>-001` | `^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$` | `MSG-TKT-2026-000001-001` (3-digit zero-padded sequence) |
| `KnowledgeArticle` | `KB-000001` | `^KB-[0-9]{6}$` | `KB-000001` |
| `PolicyDocument` | `POL-<domain>-2026-001` | `^POL-(FINAID\|REG\|IT\|ACCESS)-2026-[0-9]{3}$` | `POL-FINAID-2026-001` |
| `SLA` | `SLA-<ticket-id>` | `^SLA-TKT-2026-[0-9]{6}$` | `SLA-TKT-2026-000001` |
| `Assignment` | `ASG-<ticket-id>-01` | `^ASG-TKT-2026-[0-9]{6}-[0-9]{2}$` | `ASG-TKT-2026-000001-01` |
| `ResolutionFeedback` | `FDB-<ticket-id>` | `^FDB-TKT-2026-[0-9]{6}$` | `FDB-TKT-2026-000001` |
| `Requester` | `REQ-2026-000001` | `^REQ-(2026-[0-9]{6}\|USR-[A-Z0-9]+)$` | `REQ-2026-000001` |
| `GroundTruthAnomaly` | `ANM-2026-000001` | `^ANM-2026-[0-9]{6}$` | `ANM-2026-000001` (Isolated in `ground_truth.*`) |

---

## 3. Entity Relationship Model & Cardinalities

- `Role` (`1:N`) `Requester`: Each requester references one institutional role (`requesters.role_id -> roles.role_id`).
- `Term` (`1:N`) `Requester`, `Ticket`: Requesters and tickets belong to an academic term (`requesters.primary_term_id -> terms.term_id`, `tickets.term_id -> terms.term_id`).
- `Requester` (`1:N`) `Ticket`: One requester submits zero or many tickets (`tickets.requester_id -> requesters.requester_id`).
- `Requester` (`0..1:1`) `public.app_profiles`: Links an authenticated Phase 2 user profile (`requesters.app_profile_id -> public.app_profiles.id`); `NULL` for synthetic benchmark requesters.
- `Category` (`1:N`) `PolicyDocument`, `KnowledgeArticle`, `Ticket`: Every policy, article, and ticket belongs to one of the 4 official categories (`category_id -> categories.category_id`).
- `PolicyDocument` (`1:N`) `KnowledgeArticle`: Each knowledge article references its primary governing policy (`knowledge_articles.primary_policy_id -> policy_documents.policy_id`) and is also linked `M:N` via `policy_article_links`.
- `Ticket` (`1:N`) `Message`: Each ticket has an ordered, contiguous sequence of messages (`messages.ticket_id -> tickets.ticket_id`, unique `(ticket_id, sequence_number)`).
- `Ticket` (`1:N`) `Assignment`: Each ticket has one or more routing/escalation assignments (`assignments.ticket_id -> tickets.ticket_id`, unique `(ticket_id, sequence_number)`).
- `Ticket` (`1:1`) `SLA`: Each ticket has exactly one reproducible SLA tracking record (`slas.ticket_id -> tickets.ticket_id` `UNIQUE`).
- `Ticket` (`1:0..1`) `ResolutionFeedback`: Resolved tickets record requester feedback (`resolution_feedbacks.ticket_id -> tickets.ticket_id` `UNIQUE`, `resolution_feedbacks.requester_id -> requesters.requester_id`).

---

## 4. Granular Data Dictionary (All 11 Required Entities)

### Entity 1: `Requester` (`public.requesters` / `RequesterRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `requester_id` | `text` / `string` | **PK** | `NOT NULL` | `^REQ-(2026-[0-9]{6}\|USR-[A-Z0-9]+)$` | Unique primary key; referenced by `tickets.requester_id` and `resolution_feedbacks.requester_id` | `SOURCE_DATA` (Deterministic sequence from seed) |
| `app_profile_id` | `uuid` / `string \| null` | **FK** -> `app_profiles(id)` | `NULL` | Valid UUID or `NULL` | `UNIQUE`; `NULL` for synthetic benchmark requesters; links live Phase 2 user profiles | `SOURCE_DATA` |
| `role_id` | `text` / `string` | **FK** -> `roles(role_id)` | `NOT NULL` | `ROLE-LEARNER`, `ROLE-INSTRUCTOR`, `ROLE-SUPPORT_STAFF`, `ROLE-ACADEMIC_ADMIN`, `ROLE-PLATFORM_ADMIN` | Must exist in `public.roles` | `SOURCE_DATA` |
| `primary_term_id` | `text` / `string` | **FK** -> `terms(term_id)` | `NOT NULL` | `TERM-2025-FALL`, `TERM-2026-SPRING`, `TERM-2026-SUMMER`, `TERM-2026-FALL` | Must exist in `public.terms` | `SOURCE_DATA` |
| `verified_email` | `text` / `string` | — | `NOT NULL` | Lowercase email; synthetic uses `@synthetic.campusresolve.invalid` (RFC 2606) | Unique across synthetic requesters; non-empty | `DERIVED_DATA` (Derived from `display_name` + `requester_id` index) |
| `display_name` | `text` / `string` | — | `NOT NULL` | Non-empty full name string | Length >= 2 | `SOURCE_DATA` |
| `department` | `text` / `string` | — | `NOT NULL` | Academic department or administrative unit name | Non-empty string | `SOURCE_DATA` |
| `program_or_unit` | `text` / `string \| null` | — | `NULL` | Cohort year (`Class of 2026..2029`) or `<department> Faculty` | Derived from `role_id` and `department` | `DERIVED_DATA` (Derived from `role_id` & `department`) |
| `account_status` | `text` / `string` | — | `NOT NULL` | `'active' \| 'inactive' \| 'suspended'` | SQL `CHECK` constraint | `SOURCE_DATA` |
| `is_synthetic_eval` | `boolean` / `boolean` | — | `NOT NULL` | `true` (benchmark) \| `false` (live user) | Isolates benchmark records from live user workspaces | `SOURCE_DATA` |
| `effective_from` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | `effective_to IS NULL OR effective_from <= effective_to` | `SOURCE_DATA` |
| `effective_to` | `timestamptz` / `string \| null` | — | `NULL` | ISO-8601 timestamp or `NULL` | Chronological bound check | `SOURCE_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | `<= updated_at` | `SOURCE_DATA` |
| `updated_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Updated via trigger `set_updated_at_timestamp()` | `DERIVED_DATA` |

---

### Entity 2: `Role` (`public.roles` / `RoleRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `role_id` | `text` / `string` | **PK** | `NOT NULL` | `ROLE-LEARNER`, `ROLE-INSTRUCTOR`, `ROLE-SUPPORT_STAFF`, `ROLE-ACADEMIC_ADMIN`, `ROLE-PLATFORM_ADMIN` | Referenced by `requesters.role_id` | `SOURCE_DATA` |
| `role_code` | `actor_role_type` / `ActorRole` | — | `NOT NULL` | `learner`, `instructor`, `support_staff`, `academic_administrator`, `platform_administrator` | `UNIQUE`; matches Phase 2 `public.actor_role_type` enum | `SOURCE_DATA` |
| `role_name` | `text` / `string` | — | `NOT NULL` | `Learner`, `Instructor`, `Support Staff`, `Academic Administrator`, `Platform Administrator` | Non-empty display label | `SOURCE_DATA` |
| `institutional_scope` | `text` / `string` | — | `NOT NULL` | Non-empty scope description | Documents actor governance boundary | `SOURCE_DATA` |
| `description` | `text` / `string` | — | `NOT NULL` | Non-empty role description | — | `SOURCE_DATA` |
| `allowed_actions` | `text[]` / `string[]` | — | `NOT NULL` | Array of `AuthorizedAction` identifiers | Matches `src/utils/rbac.ts` | `SOURCE_DATA` |
| `can_be_assigned_tickets` | `boolean` / `boolean` | — | `NOT NULL` | `true` for staff/admin roles; `false` for learner/instructor | Enforced in assignment validation | `DERIVED_DATA` (Derived from `role_code`) |
| `can_publish_policies` | `boolean` / `boolean` | — | `NOT NULL` | `true` for Academic/Platform Admin; `false` otherwise | Enforced in `publish_policy` API & RLS | `DERIVED_DATA` (Derived from `allowed_actions`) |
| `can_approve_escalations` | `boolean` / `boolean` | — | `NOT NULL` | `true` for Academic/Platform Admin; `false` otherwise | Enforced in escalation adjudication | `DERIVED_DATA` (Derived from `allowed_actions`) |
| `effective_from` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | `effective_to IS NULL OR effective_from <= effective_to` | `SOURCE_DATA` |
| `effective_to` | `date` / `string \| null` | — | `NULL` | `YYYY-MM-DD` or `NULL` | — | `SOURCE_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `SOURCE_DATA` |

---

### Entity 3: `Term` (`public.terms` / `TermRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `term_id` | `text` / `string` | **PK** | `NOT NULL` | `^TERM-[0-9]{4}-(SPRING\|SUMMER\|FALL\|WINTER)$` | Referenced by `requesters.primary_term_id` and `tickets.term_id` | `SOURCE_DATA` |
| `term_code` | `text` / `string` | — | `NOT NULL` | `FA2025`, `SP2026`, `SU2026`, `FA2026` | `UNIQUE` short code | `SOURCE_DATA` |
| `term_name` | `text` / `string` | — | `NOT NULL` | Human-readable semester title | Non-empty | `SOURCE_DATA` |
| `academic_year` | `integer` / `number` | — | `NOT NULL` | `2020..2035` | SQL `CHECK (academic_year BETWEEN 2020 AND 2035)` | `SOURCE_DATA` |
| `start_date` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | Must satisfy `start_date <= add_drop_deadline <= withdrawal_deadline <= end_date` | `SOURCE_DATA` |
| `add_drop_deadline` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | Chronological check `chk_term_date_order` | `DERIVED_DATA` (Derived from `start_date` + term rules) |
| `withdrawal_deadline` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | Chronological check `chk_term_date_order` | `DERIVED_DATA` (Derived from `start_date` + Week 8 rule) |
| `end_date` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | Chronological check `chk_term_date_order` | `SOURCE_DATA` |
| `aid_disbursement_date` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | 10 days prior to `start_date` per `POL-FINAID-2026-003` | `DERIVED_DATA` (`start_date - 10 days`) |
| `lifecycle_state` | `text` / `TermLifecycleState` | — | `NOT NULL` | `'archived' \| 'active' \| 'upcoming'` | Derived by comparing `start_date`/`end_date` against anchor date | `DERIVED_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `SOURCE_DATA` |

---

### Entity 4: `PolicyDocument` (`public.policy_documents` / `PolicyDocumentRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `policy_id` | `text` / `string` | **PK** | `NOT NULL` | `^POL-(FINAID\|REG\|IT\|ACCESS)-2026-[0-9]{3}$` | Exact challenge ID format; referenced by `knowledge_articles` and `tickets` | `SOURCE_DATA` |
| `domain` | `text` / `PolicyDomainCode` | — | `NOT NULL` | `'FINAID' \| 'REG' \| 'IT' \| 'ACCESS'` | Matches domain segment in `policy_id` | `SOURCE_DATA` |
| `category_id` | `text` / `string` | **FK** -> `categories(category_id)` | `NOT NULL` | `CAT-FINAID`, `CAT-REG`, `CAT-IT`, `CAT-ACCESS` | Must match `domain` | `DERIVED_DATA` (Mapped from `domain`) |
| `title` | `text` / `string` | — | `NOT NULL` | Non-empty policy title | — | `SOURCE_DATA` |
| `version` | `text` / `string` | — | `NOT NULL` | `'1.0'`, `'2.0'`, etc. | Used in composite version checks | `SOURCE_DATA` |
| `effective_date` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | `expiration_date IS NULL OR effective_date <= expiration_date` | `SOURCE_DATA` |
| `expiration_date` | `date` / `string \| null` | — | `NULL` | `YYYY-MM-DD` or `NULL` | Non-null for expired v1.0 policies | `SOURCE_DATA` |
| `lifecycle_state` | `text` / `PolicyLifecycleState` | — | `NOT NULL` | `'draft' \| 'active' \| 'expired' \| 'superseded'` | Consistent with `expiration_date` relative to `2026-09-01` | `DERIVED_DATA` (Derived from `effective_date` & `expiration_date`) |
| `supersedes_policy_id` | `text` / `string \| null` | Self-Ref | `NULL` | `POL-<domain>-2026-001` or `NULL` | Links v2.0 active policy to v1.0 expired policy | `SOURCE_DATA` |
| `superseded_by_policy_id` | `text` / `string \| null` | Self-Ref | `NULL` | `POL-<domain>-2026-002` or `NULL` | Links v1.0 expired policy to v2.0 active replacement | `SOURCE_DATA` |
| `summary` | `text` / `string` | — | `NOT NULL` | Non-empty summary labeled `[SYNTHETIC DEMONSTRATION POLICY]` | — | `SOURCE_DATA` |
| `content` | `text` / `string` | — | `NOT NULL` | Full policy text | Grounding source for AI RAG & Scenario 3 verification | `SOURCE_DATA` |
| `authoritative_section_ref` | `text` / `string` | — | `NOT NULL` | e.g., `Section 4.2 (Current)` | Cited in tickets and AI responses | `SOURCE_DATA` |
| `source_name` | `text` / `string` | — | `NOT NULL` | Synthetic corpus provenance name | — | `SOURCE_DATA` |
| `source_url` | `text` / `string` | — | `NOT NULL` | `urn:campusresolve:synthetic-policy:<policy_id>` | Non-fabricated URN namespace | `DERIVED_DATA` (Derived from `policy_id`) |
| `dataset_or_doc_version` | `text` / `string` | — | `NOT NULL` | `2026.10-seed-20261022-v<version>` | — | `DERIVED_DATA` |
| `retrieval_date` | `date` / `string` | — | `NOT NULL` | `2026-09-01` | — | `SOURCE_DATA` |
| `license_terms` | `text` / `string` | — | `NOT NULL` | `CC0-1.0 Synthetic Demonstration & Evaluation Corpus (Non-Regulatory)` | Lawful synthetic provenance | `SOURCE_DATA` |
| `attribution` | `text` / `string` | — | `NOT NULL` | Explicit synthetic non-regulatory attribution | — | `SOURCE_DATA` |
| `transformations_performed` | `text` / `string` | — | `NOT NULL` | Normalization audit note | — | `SOURCE_DATA` |
| `discarded_fields` | `text` / `string \| null` | — | `NULL` | Optional discarded field note | — | `SOURCE_DATA` |
| `is_synthetic_policy` | `boolean` / `boolean` | — | `NOT NULL` | `true` (benchmark) \| `false` | — | `SOURCE_DATA` |
| `published_by_profile_id` | `uuid` / `string \| null` | **FK** -> `app_profiles(id)` | `NULL` | UUID or `NULL` | `NULL` for seeded synthetic policies | `SOURCE_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Derived from `effective_date` | `DERIVED_DATA` |
| `updated_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `DERIVED_DATA` |

---

### Entity 5: `KnowledgeArticle` (`public.knowledge_articles` / `KnowledgeArticleRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `article_id` | `text` / `string` | **PK** | `NOT NULL` | `^KB-[0-9]{6}$` (`KB-000001` .. `KB-000200`) | Exact challenge ID format; 200 articles | `SOURCE_DATA` |
| `category_id` | `text` / `string` | **FK** -> `categories(category_id)` | `NOT NULL` | `CAT-FINAID`, `CAT-REG`, `CAT-IT`, `CAT-ACCESS` | Inherited from `primary_policy_id` | `DERIVED_DATA` (Derived from parent `PolicyDocument.category_id`) |
| `primary_policy_id` | `text` / `string` | **FK** -> `policy_documents(policy_id)` | `NOT NULL` | `POL-<domain>-2026-XXX` | Must exist in `public.policy_documents` | `SOURCE_DATA` |
| `primary_policy_version` | `text` / `string` | — | `NOT NULL` | Matches `PolicyDocument.version` | Verified by `VAL-10` | `DERIVED_DATA` (Derived from parent `PolicyDocument.version`) |
| `title` | `text` / `string` | — | `NOT NULL` | Domain topic + policy reference | Non-empty | `DERIVED_DATA` |
| `version` | `text` / `string` | — | `NOT NULL` | `'1.0'`, `'2.0'`, `'2.1'` | — | `SOURCE_DATA` |
| `effective_date` | `date` / `string` | — | `NOT NULL` | `YYYY-MM-DD` | Aligned with parent policy `effective_date` | `DERIVED_DATA` (Inherited from parent `PolicyDocument`) |
| `expiration_date` | `date` / `string \| null` | — | `NULL` | `YYYY-MM-DD` or `NULL` | Aligned with parent policy `expiration_date` | `DERIVED_DATA` (Inherited from parent `PolicyDocument`) |
| `lifecycle_state` | `text` / `ArticleLifecycleState` | — | `NOT NULL` | `'draft' \| 'published' \| 'expired' \| 'archived'` | `'expired'` when parent policy is expired; `'published'` when active | `DERIVED_DATA` (Derived from parent policy `lifecycle_state`) |
| `summary` | `text` / `string` | — | `NOT NULL` | Summary referencing `primary_policy_id` | — | `DERIVED_DATA` |
| `content` | `text` / `string` | — | `NOT NULL` | Operational guidance incorporating parent policy content | — | `DERIVED_DATA` |
| `tags` | `text[]` / `string[]` | — | `NOT NULL` | Domain, policy ID, and lifecycle tags | — | `DERIVED_DATA` |
| `source_url` | `text` / `string` | — | `NOT NULL` | `urn:campusresolve:synthetic-kb:<article_id>` | Non-fabricated URN namespace | `DERIVED_DATA` |
| `dataset_or_doc_version` | `text` / `string` | — | `NOT NULL` | `2026.10-seed-20261022-kb-v<version>` | — | `DERIVED_DATA` |
| `retrieval_date` | `date` / `string` | — | `NOT NULL` | `2026-09-01` | — | `SOURCE_DATA` |
| `license_terms` | `text` / `string` | — | `NOT NULL` | `CC0-1.0 Synthetic Demonstration & Evaluation Corpus` | — | `SOURCE_DATA` |
| `attribution` | `text` / `string` | — | `NOT NULL` | Explicit synthetic provenance statement | — | `SOURCE_DATA` |
| `transformations_performed` | `text` / `string` | — | `NOT NULL` | Indexing & date-binding transformation log | — | `SOURCE_DATA` |
| `discarded_fields` | `text` / `string \| null` | — | `NULL` | `NULL` | — | `SOURCE_DATA` |
| `is_synthetic_article` | `boolean` / `boolean` | — | `NOT NULL` | `true` | — | `SOURCE_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `DERIVED_DATA` |
| `updated_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `DERIVED_DATA` |

---

### Entity 6: `Category` (`public.categories` / `CategoryRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `category_id` | `text` / `string` | **PK** | `NOT NULL` | `'CAT-FINAID' \| 'CAT-REG' \| 'CAT-IT' \| 'CAT-ACCESS'` | Referenced by `policy_documents`, `knowledge_articles`, and `tickets` | `SOURCE_DATA` |
| `category_name` | `text` / `OfficialCategoryName` | — | `NOT NULL` | `'Financial Aid' \| 'Registration' \| 'IT' \| 'Accessibility'` | `UNIQUE`; exact 4 official challenge categories | `SOURCE_DATA` (`CONFIRMED_CHALLENGE_REQUIREMENT`) |
| `domain_code` | `text` / `PolicyDomainCode` | — | `NOT NULL` | `'FINAID' \| 'REG' \| 'IT' \| 'ACCESS'` | `UNIQUE` | `SOURCE_DATA` |
| `default_assigned_team` | `text` / `string` | — | `NOT NULL` | Configurable primary support unit for category | Used by routing engine & `VAL-09` | `SOURCE_DATA` (`PROPOSED_CONFIGURABLE_RULE`) |
| `escalation_team` | `text` / `string` | — | `NOT NULL` | Configurable escalation review unit for category | Used by routing engine & `VAL-09` | `SOURCE_DATA` (`PROPOSED_CONFIGURABLE_RULE`) |
| `routing_rule_id` | `text` / `string` | — | `NOT NULL` | `RULE-FINAID-001`, `RULE-REG-001`, `RULE-IT-001`, `RULE-ACCESS-001` | — | `SOURCE_DATA` |
| `description` | `text` / `string` | — | `NOT NULL` | Routing rule scope description | — | `SOURCE_DATA` |
| `keywords` | `text[]` / `string[]` | — | `NOT NULL` | Classification keyword array | — | `SOURCE_DATA` |
| `is_active` | `boolean` / `boolean` | — | `NOT NULL` | `true` | — | `SOURCE_DATA` |
| `effective_from` | `date` / `string` | — | `NOT NULL` | `2025-08-01` | — | `SOURCE_DATA` |
| `effective_to` | `date` / `string \| null` | — | `NULL` | `NULL` | — | `SOURCE_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `SOURCE_DATA` |

---

### Entity 7: `Ticket` (`public.tickets` / `TicketRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ticket_id` | `text` / `string` | **PK** | `NOT NULL` | `^TKT-2026-[0-9]{6}$` (`TKT-2026-000001` .. `005000`) | Referenced by `messages`, `assignments`, `slas`, `resolution_feedbacks`, and link tables | `SOURCE_DATA` |
| `requester_id` | `text` / `string` | **FK** -> `requesters(requester_id)` | `NOT NULL` | `REQ-2026-XXXXXX` | Must exist in `public.requesters` | `SOURCE_DATA` |
| `requester_profile_id` | `uuid` / `string \| null` | **FK** -> `app_profiles(id)` | `NULL` | UUID or `NULL` | `NULL` for synthetic benchmark tickets; populated for live user tickets | `DERIVED_DATA` (Copied from `Requester.app_profile_id`) |
| `category_id` | `text` / `string` | **FK** -> `categories(category_id)` | `NOT NULL` | `CAT-FINAID`, `CAT-REG`, `CAT-IT`, `CAT-ACCESS` | Must exist in `public.categories` | `SOURCE_DATA` |
| `category_name` | `text` / `OfficialCategoryName` | — | `NOT NULL` | `'Financial Aid' \| 'Registration' \| 'IT' \| 'Accessibility'` | Denormalized from `Category.category_name` | `DERIVED_DATA` (Derived from `category_id`) |
| `term_id` | `text` / `string` | **FK** -> `terms(term_id)` | `NOT NULL` | `TERM-2026-FALL`, etc. | Inherited from `Requester.primary_term_id` | `DERIVED_DATA` (Derived from `Requester.primary_term_id`) |
| `subject` | `text` / `string` | — | `NOT NULL` | Non-empty ticket subject | Reflects category, policy, and escalation status | `DERIVED_DATA` |
| `description` | `text` / `string` | — | `NOT NULL` | Non-empty inquiry body | — | `DERIVED_DATA` |
| `priority` | `text` / `TicketPriorityLevel` | — | `NOT NULL` | `'Standard Priority' \| 'Time-Sensitive Academic Priority' \| 'Administrative Escalation Priority'` | SQL `CHECK` constraint | `SOURCE_DATA` |
| `lifecycle_status` | `text` / `RequestStatus` | — | `NOT NULL` | `'draft' \| 'submitted' \| 'under_review' \| 'policy_verified' \| 'escalated' \| 'resolved' \| 'closed'` | Reconciled with terminal `ticket_lifecycle_events` state | `DERIVED_DATA` (Terminal state of ticket lifecycle sequence) |
| `current_assigned_team` | `text` / `string` | — | `NOT NULL` | Active `Assignment.assigned_team` | Synchronized with active `AssignmentRecord` | `DERIVED_DATA` (Derived from active `Assignment.assigned_team`) |
| `current_routing_rule_id` | `text` / `string` | — | `NOT NULL` | Active `Assignment.routing_rule_id` | Synchronized with active `AssignmentRecord` | `DERIVED_DATA` (Derived from active `Assignment.routing_rule_id`) |
| `referenced_policy_id` | `text` / `string \| null` | **FK** -> `policy_documents(policy_id)` | `NULL` | `POL-<domain>-2026-XXX` | Evaluated by `VAL-05` for effective-date applicability | `DERIVED_DATA` (Selected from category policy pool) |
| `referenced_policy_version` | `text` / `string \| null` | — | `NULL` | Matches `PolicyDocument.version` | Verified by `VAL-10` | `DERIVED_DATA` (Derived from `referenced_policy_id`) |
| `referenced_article_id` | `text` / `string \| null` | **FK** -> `knowledge_articles(article_id)` | `NULL` | `KB-XXXXXX` | Linked to `referenced_policy_id` | `DERIVED_DATA` (Selected from policy's article pool) |
| `referenced_article_version` | `text` / `string \| null` | — | `NULL` | Matches `KnowledgeArticle.version` | Verified by `VAL-10` | `DERIVED_DATA` (Derived from `referenced_article_id`) |
| `requires_escalation` | `boolean` / `boolean` | — | `NOT NULL` | `true` \| `false` | Evaluated by `VAL-07` against `is_escalated` (Scenario 5) | `DERIVED_DATA` (Derived from routing & exception criteria) |
| `is_escalated` | `boolean` / `boolean` | — | `NOT NULL` | `true` when `lifecycle_status = 'escalated'` | — | `DERIVED_DATA` (`lifecycle_status === 'escalated'`) |
| `escalation_reason` | `text` / `string \| null` | — | `NULL` | Non-null when `requires_escalation = true` | — | `DERIVED_DATA` |
| `resolution_summary` | `text` / `string \| null` | — | `NULL` | Non-null when `lifecycle_status IN ('resolved', 'closed')` | — | `DERIVED_DATA` |
| `is_synthetic_eval` | `boolean` / `boolean` | — | `NOT NULL` | `true` (benchmark) \| `false` (live user) | Enforced by RLS and workspace query filters | `SOURCE_DATA` |
| `submitted_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | `submitted_at <= updated_at` | `SOURCE_DATA` |
| `updated_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Latest lifecycle/message timestamp | `DERIVED_DATA` |
| `resolved_at` | `timestamptz` / `string \| null` | — | `NULL` | ISO-8601 timestamp when resolved; `NULL` otherwise | `submitted_at <= resolved_at` | `DERIVED_DATA` |
| `closed_at` | `timestamptz` / `string \| null` | — | `NULL` | ISO-8601 timestamp or `NULL` | `resolved_at <= closed_at` | `DERIVED_DATA` |

---

### Entity 8: `Message` (`public.messages` / `MessageRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `message_id` | `text` / `string` | **PK** | `NOT NULL` | `^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$` | Derived as `MSG-${ticket_id}-${sequence_number.padStart(3, '0')}` | `DERIVED_DATA` (Derived from `ticket_id` + 3-digit `sequence_number`) |
| `ticket_id` | `text` / `string` | **FK** -> `tickets(ticket_id)` | `NOT NULL` | `TKT-2026-XXXXXX` | Must exist in `public.tickets` | `SOURCE_DATA` |
| `sequence_number` | `integer` / `number` | — | `NOT NULL` | Positive integer (`1..4` in benchmark) | Composite `UNIQUE (ticket_id, sequence_number)`; contiguous `1..N` | `SOURCE_DATA` |
| `sender_id` | `text` / `string` | — | `NOT NULL` | `Requester.requester_id`, `SYSTEM-ROUTER`, or `ACTOR-OPS-<domain>` | Derived from parent ticket requester or assigned unit | `DERIVED_DATA` |
| `sender_profile_id` | `uuid` / `string \| null` | **FK** -> `app_profiles(id)` | `NULL` | UUID or `NULL` | `NULL` for synthetic benchmark messages | `DERIVED_DATA` |
| `sender_role` | `actor_role_type` / `ActorRole` | — | `NOT NULL` | `learner`, `instructor`, `support_staff`, `academic_administrator`, `platform_administrator` | Matches sender's institutional role | `DERIVED_DATA` |
| `sender_name` | `text` / `string` | — | `NOT NULL` | Sender display name | Derived from `Requester.display_name` or support unit | `DERIVED_DATA` |
| `message_type` | `text` / `MessageRecordType` | — | `NOT NULL` | `'requester_inquiry' \| 'staff_response' \| 'ai_grounded_reply' \| 'system_routing_note' \| 'escalation_handoff' \| 'resolution_summary'` | SQL `CHECK` constraint | `SOURCE_DATA` |
| `body` | `text` / `string` | — | `NOT NULL` | Message content | Evaluated by `VAL-10` against cited policy content (Scenario 3) | `DERIVED_DATA` |
| `cited_policy_id` | `text` / `string \| null` | **FK** -> `policy_documents(policy_id)` | `NULL` | `POL-<domain>-2026-XXX` or `NULL` | Inherited from parent ticket on policy-citing messages | `DERIVED_DATA` |
| `cited_policy_version` | `text` / `string \| null` | — | `NULL` | Version string or `NULL` | Matches `cited_policy_id` version | `DERIVED_DATA` |
| `cited_article_id` | `text` / `string \| null` | **FK** -> `knowledge_articles(article_id)` | `NULL` | `KB-XXXXXX` or `NULL` | Inherited from parent ticket on policy-citing messages | `DERIVED_DATA` |
| `cited_article_version` | `text` / `string \| null` | — | `NULL` | Version string or `NULL` | Matches `cited_article_id` version | `DERIVED_DATA` |
| `is_internal` | `boolean` / `boolean` | — | `NOT NULL` | `false` \| `true` (staff-only internal notes) | Requesters forbidden from setting `is_internal = true` | `SOURCE_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Strictly monotonic: `Ticket.submitted_at + sequence_number * 25m` | `DERIVED_DATA` (Derived from `Ticket.submitted_at` + `sequence_number`) |

---

### Entity 9: `Assignment` (`public.assignments` / `AssignmentRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `assignment_id` | `text` / `string` | **PK** | `NOT NULL` | `^ASG-TKT-2026-[0-9]{6}-[0-9]{2}$` | Derived as `ASG-${ticket_id}-${sequence_number.padStart(2, '0')}` | `DERIVED_DATA` |
| `ticket_id` | `text` / `string` | **FK** -> `tickets(ticket_id)` | `NOT NULL` | `TKT-2026-XXXXXX` | Must exist in `public.tickets` | `SOURCE_DATA` |
| `sequence_number` | `integer` / `number` | — | `NOT NULL` | Positive integer (`1..N`) | Composite `UNIQUE (ticket_id, sequence_number)` | `SOURCE_DATA` |
| `assigned_team` | `text` / `string` | — | `NOT NULL` | Target operational or escalation team | Audited by `VAL-09` against `Category` routing rules (Scenario 2) | `DERIVED_DATA` (Computed by routing engine; perturbed in Scenario 2) |
| `assigned_actor_id` | `text` / `string \| null` | — | `NULL` | `ACTOR-OPS-<domain>` | — | `DERIVED_DATA` |
| `assigned_actor_role` | `actor_role_type` / `ActorRole` | — | `NOT NULL` | `support_staff`, `academic_administrator`, `platform_administrator` | Must have `can_be_assigned_tickets = true` | `DERIVED_DATA` |
| `routing_rule_id` | `text` / `string` | — | `NOT NULL` | `RULE-FINAID-001`, `RULE-REG-001`, `RULE-IT-001`, `RULE-ACCESS-001`, `RULE-EXCEPTION-HUMAN-TRIAGE` | — | `DERIVED_DATA` |
| `assignment_reason` | `text` / `string` | — | `NOT NULL` | Rule-based routing justification | — | `DERIVED_DATA` |
| `previous_assignment_id` | `text` / `string \| null` | — | `NULL` | Prior assignment ID or `NULL` | `NULL` for initial assignment (`sequence_number = 1`) | `DERIVED_DATA` |
| `previous_assigned_team` | `text` / `string \| null` | — | `NULL` | Prior team name or `NULL` | — | `DERIVED_DATA` |
| `requires_human_review` | `boolean` / `boolean` | — | `NOT NULL` | `true` \| `false` | Synchronized with `Ticket.requires_escalation` | `DERIVED_DATA` |
| `is_active` | `boolean` / `boolean` | — | `NOT NULL` | `true` \| `false` | `true` for current active assignment | `DERIVED_DATA` |
| `assigned_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Matches `Ticket.submitted_at` for initial intake routing | `DERIVED_DATA` |
| `unassigned_at` | `timestamptz` / `string \| null` | — | `NULL` | ISO-8601 timestamp or `NULL` | `NULL` while `is_active = true` | `DERIVED_DATA` |

---

### Entity 10: `SLA` (`public.slas` / `SLARecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `sla_id` | `text` / `string` | **PK** | `NOT NULL` | `^SLA-TKT-2026-[0-9]{6}$` | Derived as `SLA-${ticket_id}` | `DERIVED_DATA` (Derived from `ticket_id`) |
| `ticket_id` | `text` / `string` | **FK** -> `tickets(ticket_id)` | `NOT NULL` | `TKT-2026-XXXXXX` | `UNIQUE` (`1:1` with `public.tickets`) | `SOURCE_DATA` |
| `sla_rule_id` | `text` / `string` | — | `NOT NULL` | `SLA-RULE-FINAID-CFG`, `SLA-RULE-REG-CFG`, `SLA-RULE-IT-CFG`, `SLA-RULE-ACCESS-CFG` | Mapped from `applicable_category` | `DERIVED_DATA` |
| `applicable_category` | `text` / `OfficialCategoryName` | — | `NOT NULL` | `'Financial Aid' \| 'Registration' \| 'IT' \| 'Accessibility'` | Inherited from `Ticket.category_name` | `DERIVED_DATA` (Derived from `Ticket.category_name`) |
| `rule_classification` | `text` / `SLARuleClassification` | — | `NOT NULL` | `'CONFIRMED_CHALLENGE_REQUIREMENT' \| 'PROPOSED_CONFIGURABLE_RULE' \| 'SYNTHETIC_EVAL_SCENARIO'` | Explicitly distinguishes configurable rules from official requirements | `SOURCE_DATA` |
| `target_business_minutes` | `integer` / `number` | — | `NOT NULL` | Positive integer (`> 0`): configurable target minutes | Derived from `CONFIGURABLE_SLA_RULES[applicable_category]` | `DERIVED_DATA` |
| `start_timestamp` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Equals `Ticket.submitted_at`; `start_timestamp <= due_timestamp` | `DERIVED_DATA` (Copied from `Ticket.submitted_at`) |
| `due_timestamp` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Calculated via `calculateDueTimestampByBusinessMinutes(start_timestamp, target_business_minutes)` | `DERIVED_DATA` |
| `evaluated_timestamp` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | Equals `Ticket.updated_at` / `resolved_at` | `DERIVED_DATA` |
| `elapsed_wall_clock_minutes` | `integer` / `number` | — | `NOT NULL` | Integer `>= 0` | `Math.round((evaluated_timestamp - start_timestamp) / 60000)` | `DERIVED_DATA` |
| `elapsed_business_minutes` | `integer` / `number` | — | `NOT NULL` | Integer `>= 0` | Reproducibly computed via `calculateElapsedBusinessMinutes()` over Mon–Fri 08:00–17:00 UTC | `DERIVED_DATA` |
| `calculation_mode` | `text` / `SLACalculationMode` | — | `NOT NULL` | `'business_hours_configured' \| 'wall_clock_24x7'` | `'wall_clock_24x7'` used in Scenario 4 (`sla_clock_ignores_business_hours`) | `SOURCE_DATA` |
| `business_schedule_code` | `text` / `string` | — | `NOT NULL` | `'MON_FRI_0800_1700_UTC_CONFIGURABLE'` | — | `SOURCE_DATA` |
| `breach_status` | `boolean` / `boolean` | — | `NOT NULL` | `true` \| `false` | `elapsed > target_business_minutes` (under `calculation_mode`); audited by `VAL-11` | `DERIVED_DATA` |
| `escalation_status` | `text` / `SLAEscalationStatus` | — | `NOT NULL` | `'not_required' \| 'pending_escalation' \| 'escalated' \| 'escalation_missed'` | Derived from `Ticket.requires_escalation` & `Ticket.is_escalated` | `DERIVED_DATA` |
| `calculation_explanation` | `text` / `string` | — | `NOT NULL` | Auditable human-readable formula trace | Documents exact elapsed business vs wall-clock minutes | `DERIVED_DATA` |
| `created_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `DERIVED_DATA` |
| `updated_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | — | `DERIVED_DATA` |

---

### Entity 11: `ResolutionFeedback` (`public.resolution_feedbacks` / `ResolutionFeedbackRecord`)

| Field Name | Data Type (SQL / TS) | PK / FK | Nullable | Allowed Values / Format | Validation Rules & Relationships | Source vs. Derived |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `feedback_id` | `text` / `string` | **PK** | `NOT NULL` | `^FDB-TKT-2026-[0-9]{6}$` | Derived as `FDB-${ticket_id}` | `DERIVED_DATA` (Derived from `ticket_id`) |
| `ticket_id` | `text` / `string` | **FK** -> `tickets(ticket_id)` | `NOT NULL` | `TKT-2026-XXXXXX` | `UNIQUE` (`1:0..1` with `public.tickets`); generated only when `Ticket.lifecycle_status = 'resolved'` | `SOURCE_DATA` |
| `requester_id` | `text` / `string` | **FK** -> `requesters(requester_id)` | `NOT NULL` | `REQ-2026-XXXXXX` | Must equal parent `Ticket.requester_id` | `DERIVED_DATA` (Copied from `Ticket.requester_id`) |
| `rating` | `integer` / `number` | — | `NOT NULL` | Integer `1..5` | SQL `CHECK (rating BETWEEN 1 AND 5)` | `DERIVED_DATA` (`5` on compliant resolution; `2` when ticket has operational anomaly) |
| `was_helpful` | `boolean` / `boolean` | — | `NOT NULL` | `true` \| `false` | Consistent with `rating >= 4` | `DERIVED_DATA` |
| `resolution_accepted` | `boolean` / `boolean` | — | `NOT NULL` | `true` \| `false` | Consistent with `was_helpful` | `DERIVED_DATA` |
| `policy_clarity_score` | `integer` / `number` | — | `NOT NULL` | Integer `1..5` | SQL `CHECK (policy_clarity_score BETWEEN 1 AND 5)` | `DERIVED_DATA` |
| `comments` | `text` / `string \| null` | — | `NULL` | Requester feedback text | — | `DERIVED_DATA` |
| `submitted_at` | `timestamptz` / `string` | — | `NOT NULL` | ISO-8601 timestamp | `Ticket.resolved_at + 15 minutes` (`submitted_at >= Ticket.resolved_at`) | `DERIVED_DATA` (Derived from `Ticket.resolved_at`) |

---

## 5. Five Challenge-Required Anomaly Scenarios & Ground-Truth Separation

All 5 required anomaly scenarios are deterministically embedded in the operational benchmark dataset (`seed = 20261022`) without silent repair, while their anomaly labels and expected outcomes are stored **exclusively** in `datasets/ground_truth.json` and `datasets/ground_truth.csv`:

| # | Scenario Identifier (`anomaly_type`) | Deterministic Rule (`tIdx % 25`) | Full-Scale Count | Affected Operational Entity & Field | Expected Correct Decision (Stored in Ground Truth) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `expired_policy_citation` | `tIdx % 25 === 3` | `200` | `Ticket.referenced_policy_id` (`TKT-2026-000003`, `000028`, ..) cites `v1.0` policy expired prior to `submitted_at` | Exclude expired `v1.0` policy and cite active superseding `v2.0` policy (`POL-<domain>-2026-002`) |
| **2** | `unauthorized_team_routing` | `tIdx % 25 === 7` | `200` | `Assignment.assigned_team` (`ASG-TKT-2026-000007-01`, `000032`, ..) routes ticket to wrong department's unit | Route ticket to `Category.default_assigned_team` under `Category.routing_rule_id` |
| **3** | `unsupported_factual_claim` | `tIdx % 25 === 11` | `200` | `Message.body` (`MSG-TKT-2026-000011-003`, `000036`, ..) asserts unverified `$5,000 cash grant and 45-day deadline waiver` | Restrict response strictly to facts stated in cited active `PolicyDocument.content` |
| **4** | `sla_clock_ignores_business_hours` | `tIdx % 25 === 15` | `200` | `SLA.breach_status` (`SLA-TKT-2026-000015`, `000040`, ..) evaluates Fri 15:30 -> Mon 09:30 UTC under `wall_clock_24x7` (`3960m`) as breached | Compute `elapsed_business_minutes = 180m` under `MON_FRI_0800_1700_UTC_CONFIGURABLE` -> `breach_status = false` |
| **5** | `required_escalation_not_triggered` | `tIdx % 25 === 19` | `200` | `Ticket.lifecycle_status` (`TKT-2026-000019`, `000044`, ..) has `requires_escalation = true` but resolves directly (`is_escalated = false`) | Transition ticket to `'escalated'` (`is_escalated = true`) and assign to `Category.escalation_team` |

---

## 6. Lawful Synthetic Data Provenance & Export Deliverables

- **CSV Exports (All 11 Entities)**: `/datasets/csv/requesters.csv`, `roles.csv`, `terms.csv`, `policy_documents.csv`, `knowledge_articles.csv`, `categories.csv`, `tickets.csv`, `messages.csv`, `assignments.csv`, `slas.csv`, `resolution_feedbacks.csv`
- **JSON Exports (All 11 Entities + Starter Bundle)**: `/datasets/json/*.json` and `/datasets/starter_dataset.json`
- **SQL Benchmark Export**: `/datasets/sql/phase4_synthetic_benchmark_export.sql`
- **Ground-Truth Exports (Strictly Isolated)**: `/datasets/ground_truth.csv` and `/datasets/ground_truth.json`
- **Machine-Readable Validation & Evaluation Summaries**: `/datasets/validation_report.json` and `/datasets/evaluation_report.json`
- **Seed & Provenance Manifests**: `/datasets/seed_configuration.json`, `/datasets/source_provenance_manifest.json`, and `/datasets/seed_summary_and_checksums.json`
