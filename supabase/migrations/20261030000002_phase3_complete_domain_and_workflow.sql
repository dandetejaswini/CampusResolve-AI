-- ============================================================================
-- CAMPUSRESOLVE AI — PHASE 3 PRODUCTION DATABASE RECOVERY MIGRATION
-- Complete 18-Entity Domain Schema, Triggers, RLS Policies, and Governance Masters
-- Target Database: Supabase PostgreSQL (https://llotsqzeppiltosllxvx.supabase.co)
-- Prerequisite: Phase 2 Authentication (public.app_profiles & public.welcome_email_log)
-- Production Data Policy: ZERO synthetic tickets, users, requesters, or fake policies.
-- Safe to re-run; strictly idempotent; fully preserves Phase 2 objects.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. IDEMPOTENT UPDATED_AT TRIGGER FUNCTION
-- Declared before any trigger definitions to prevent 42883 function missing error.
-- Reuses existing working Phase 2 authentication functions without modifying their return types:
--   - public.is_valid_authenticated_jwt() -> boolean
--   - public.current_auth_provider() -> public.auth_provider_type
--   - public.current_jwt_sub() -> text
--   - public.current_jwt_issuer() -> text
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_updated_at_timestamp() TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 1. MASTER TABLE: ROLES (public.roles)
-- Maps the 5 official institutional roles defined in Phase 2 actor_role_type.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  role_id text PRIMARY KEY CHECK (role_id ~ '^ROLE-[A-Z_]+$'),
  role_code public.actor_role_type NOT NULL UNIQUE,
  role_name text NOT NULL,
  institutional_scope text NOT NULL,
  description text NOT NULL,
  allowed_actions text[] NOT NULL DEFAULT '{}',
  can_be_assigned_tickets boolean NOT NULL DEFAULT false,
  can_publish_policies boolean NOT NULL DEFAULT false,
  can_approve_escalations boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL DEFAULT '2025-08-01',
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_roles_effective_dates CHECK (effective_to IS NULL OR effective_from <= effective_to)
);

-- ----------------------------------------------------------------------------
-- 2. MASTER TABLE: ACADEMIC TERMS (public.terms)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.terms (
  term_id text PRIMARY KEY CHECK (term_id ~ '^TERM-[0-9]{4}-(SPRING|SUMMER|FALL)$'),
  term_code text NOT NULL UNIQUE,
  term_name text NOT NULL,
  academic_year integer NOT NULL CHECK (academic_year BETWEEN 2020 AND 2035),
  start_date date NOT NULL,
  end_date date NOT NULL,
  add_drop_deadline date NOT NULL,
  withdrawal_deadline date NOT NULL,
  aid_disbursement_date date NOT NULL,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('archived', 'active', 'upcoming')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_terms_date_order CHECK (
    start_date <= add_drop_deadline
    AND add_drop_deadline <= withdrawal_deadline
    AND withdrawal_deadline <= end_date
  )
);

-- ----------------------------------------------------------------------------
-- 3. MASTER TABLE: CATEGORIES (public.categories)
-- Strictly enforces the 4 challenge categories and routing rules.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  category_id text PRIMARY KEY CHECK (category_id IN ('CAT-FINAID', 'CAT-REG', 'CAT-IT', 'CAT-ACCESS')),
  category_name text NOT NULL UNIQUE CHECK (
    category_name IN ('Financial Aid', 'Registration', 'IT', 'Accessibility')
  ),
  domain_code text NOT NULL UNIQUE CHECK (
    domain_code IN ('FINAID', 'REG', 'IT', 'ACCESS')
  ),
  default_assigned_team text NOT NULL,
  escalation_team text NOT NULL,
  routing_rule_id text NOT NULL,
  description text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT '2025-08-01',
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. CORE ENTITY 1: REQUESTERS (public.requesters)
-- Integrates 1:1 with authenticated Phase 2 app_profiles.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.requesters (
  requester_id text PRIMARY KEY CHECK (requester_id ~ '^REQ-(2026-[0-9]{6}|USR-[A-Z0-9]+)$'),
  app_profile_id uuid UNIQUE REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  role_id text NOT NULL REFERENCES public.roles(role_id),
  primary_term_id text REFERENCES public.terms(term_id),
  verified_email text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) >= 2),
  department text NOT NULL,
  program_or_unit text,
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'inactive', 'suspended')),
  is_synthetic_eval boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_requesters_effective_dates CHECK (effective_to IS NULL OR effective_from <= effective_to)
);

ALTER TABLE public.requesters ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.requesters ALTER COLUMN primary_term_id DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_requesters_updated_at ON public.requesters;
CREATE TRIGGER trg_requesters_updated_at
  BEFORE UPDATE ON public.requesters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE OR REPLACE FUNCTION public.enforce_requester_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'authenticated' THEN
    IF NEW.app_profile_id IS DISTINCT FROM OLD.app_profile_id THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: app_profile_id cannot be changed.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      IF public.current_app_actor_role() NOT IN ('platform_administrator') THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: role_id can only be modified by a platform administrator.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_requester_immutability ON public.requesters;
CREATE TRIGGER trg_enforce_requester_immutability
  BEFORE UPDATE ON public.requesters
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_requester_immutability();

CREATE INDEX IF NOT EXISTS idx_requesters_app_profile ON public.requesters(app_profile_id);
CREATE INDEX IF NOT EXISTS idx_requesters_role ON public.requesters(role_id);
CREATE INDEX IF NOT EXISTS idx_requesters_term ON public.requesters(primary_term_id);

-- ----------------------------------------------------------------------------
-- 5. CORE ENTITY 4: POLICY DOCUMENTS (public.policy_documents)
-- Verified institutional policy documentation repository.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_documents (
  policy_id text PRIMARY KEY CHECK (policy_id ~ '^POL-(FINAID|REG|IT|ACCESS)-2026-[0-9]{3}$'),
  domain text NOT NULL CHECK (domain IN ('FINAID', 'REG', 'IT', 'ACCESS')),
  category_id text NOT NULL REFERENCES public.categories(category_id),
  title text NOT NULL CHECK (char_length(trim(title)) >= 5),
  version text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+$'),
  effective_date date NOT NULL,
  expiration_date date,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('draft', 'active', 'expired', 'superseded')),
  supersedes_policy_id text REFERENCES public.policy_documents(policy_id),
  superseded_by_policy_id text REFERENCES public.policy_documents(policy_id),
  summary text NOT NULL,
  content text NOT NULL CHECK (char_length(trim(content)) >= 10),
  authoritative_section_ref text NOT NULL DEFAULT 'Section 1.0',
  source_name text,
  source_url text,
  dataset_or_doc_version text DEFAULT '1.0',
  retrieval_date date NOT NULL DEFAULT CURRENT_DATE,
  license_terms text,
  attribution text,
  transformations_performed text,
  discarded_fields text,
  is_synthetic_policy boolean NOT NULL DEFAULT false,
  published_by_profile_id uuid REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_policy_dates CHECK (expiration_date IS NULL OR effective_date <= expiration_date)
);

ALTER TABLE public.policy_documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'policy_documents') THEN
    ALTER TABLE public.policy_documents ALTER COLUMN source_url DROP NOT NULL;
    ALTER TABLE public.policy_documents ALTER COLUMN source_url DROP DEFAULT;
    ALTER TABLE public.policy_documents ALTER COLUMN attribution DROP NOT NULL;
    ALTER TABLE public.policy_documents ALTER COLUMN attribution DROP DEFAULT;
    ALTER TABLE public.policy_documents ALTER COLUMN source_name DROP NOT NULL;
    ALTER TABLE public.policy_documents ALTER COLUMN source_name DROP DEFAULT;
    ALTER TABLE public.policy_documents ALTER COLUMN license_terms DROP NOT NULL;
    ALTER TABLE public.policy_documents ALTER COLUMN license_terms DROP DEFAULT;
    ALTER TABLE public.policy_documents ALTER COLUMN transformations_performed DROP NOT NULL;
    ALTER TABLE public.policy_documents ALTER COLUMN transformations_performed DROP DEFAULT;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_policy_documents_updated_at ON public.policy_documents;
CREATE TRIGGER trg_policy_documents_updated_at
  BEFORE UPDATE ON public.policy_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_policy_documents_category ON public.policy_documents(category_id);
CREATE INDEX IF NOT EXISTS idx_policy_documents_domain_state ON public.policy_documents(domain, lifecycle_state);

-- ----------------------------------------------------------------------------
-- 6. AUDIT ENTITY: POLICY VERSION HISTORY (public.policy_version_history)
-- Immutable version history snapshots. Contains change_summary and text history_id.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_version_history (
  history_id text PRIMARY KEY,
  policy_id text NOT NULL REFERENCES public.policy_documents(policy_id) ON DELETE CASCADE,
  version text NOT NULL,
  effective_date date NOT NULL,
  expiration_date date,
  lifecycle_state text NOT NULL,
  change_summary text NOT NULL,
  authoritative_section_ref text NOT NULL DEFAULT 'Section 1.0',
  title text,
  content text,
  recorded_reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_policy_version_snapshot UNIQUE (policy_id, version)
);

-- Idempotent column and type repair block for policy_version_history
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'policy_version_history'
  ) THEN
    ALTER TABLE public.policy_version_history ADD COLUMN IF NOT EXISTS change_summary text;
    ALTER TABLE public.policy_version_history ADD COLUMN IF NOT EXISTS authoritative_section_ref text DEFAULT 'Section 1.0';
    ALTER TABLE public.policy_version_history ADD COLUMN IF NOT EXISTS title text;
    ALTER TABLE public.policy_version_history ADD COLUMN IF NOT EXISTS content text;
    ALTER TABLE public.policy_version_history ADD COLUMN IF NOT EXISTS recorded_reason text;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'policy_version_history' 
        AND column_name = 'history_id' AND data_type = 'uuid'
    ) THEN
      ALTER TABLE public.policy_version_history ALTER COLUMN history_id TYPE text;
    END IF;

    ALTER TABLE public.policy_version_history ALTER COLUMN title DROP NOT NULL;
    ALTER TABLE public.policy_version_history ALTER COLUMN content DROP NOT NULL;
    ALTER TABLE public.policy_version_history ALTER COLUMN recorded_reason DROP NOT NULL;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. CORE ENTITY 5: KNOWLEDGE ARTICLES (public.knowledge_articles)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_articles (
  article_id text PRIMARY KEY CHECK (article_id ~ '^KB-[0-9]{6}$'),
  category_id text NOT NULL REFERENCES public.categories(category_id),
  primary_policy_id text NOT NULL REFERENCES public.policy_documents(policy_id) ON DELETE CASCADE,
  primary_policy_version text NOT NULL,
  title text NOT NULL CHECK (char_length(trim(title)) >= 5),
  version text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+$'),
  effective_date date NOT NULL,
  expiration_date date,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('draft', 'published', 'expired', 'archived')),
  summary text NOT NULL,
  content text NOT NULL CHECK (char_length(trim(content)) >= 10),
  tags text[] NOT NULL DEFAULT '{}',
  source_url text,
  dataset_or_doc_version text DEFAULT '1.0',
  retrieval_date date NOT NULL DEFAULT CURRENT_DATE,
  license_terms text,
  attribution text,
  transformations_performed text,
  discarded_fields text,
  is_synthetic_article boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_kb_dates CHECK (expiration_date IS NULL OR effective_date <= expiration_date)
);

ALTER TABLE public.knowledge_articles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'knowledge_articles') THEN
    ALTER TABLE public.knowledge_articles ALTER COLUMN source_url DROP NOT NULL;
    ALTER TABLE public.knowledge_articles ALTER COLUMN source_url DROP DEFAULT;
    ALTER TABLE public.knowledge_articles ALTER COLUMN attribution DROP NOT NULL;
    ALTER TABLE public.knowledge_articles ALTER COLUMN attribution DROP DEFAULT;
    ALTER TABLE public.knowledge_articles ALTER COLUMN license_terms DROP NOT NULL;
    ALTER TABLE public.knowledge_articles ALTER COLUMN license_terms DROP DEFAULT;
    ALTER TABLE public.knowledge_articles ALTER COLUMN transformations_performed DROP NOT NULL;
    ALTER TABLE public.knowledge_articles ALTER COLUMN transformations_performed DROP DEFAULT;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_knowledge_articles_updated_at ON public.knowledge_articles;
CREATE TRIGGER trg_knowledge_articles_updated_at
  BEFORE UPDATE ON public.knowledge_articles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_kb_category ON public.knowledge_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_kb_policy ON public.knowledge_articles(primary_policy_id);
CREATE INDEX IF NOT EXISTS idx_kb_lifecycle ON public.knowledge_articles(lifecycle_state);

-- ----------------------------------------------------------------------------
-- 8. BRIDGE TABLE: POLICY ARTICLE LINKS (public.policy_article_links)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policy_article_links (
  link_id text PRIMARY KEY,
  policy_id text NOT NULL REFERENCES public.policy_documents(policy_id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  article_id text NOT NULL REFERENCES public.knowledge_articles(article_id) ON DELETE CASCADE,
  article_version text NOT NULL,
  relationship_type text NOT NULL CHECK (
    relationship_type IN ('primary_governance', 'supporting_reference', 'superseded_reference', 'historical_reference')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_policy_article_pair UNIQUE (policy_id, policy_version, article_id, article_version)
);

DO $$
DECLARE
  rec RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'policy_article_links') THEN
    FOR rec IN (
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'policy_article_links'
        AND tc.constraint_type = 'CHECK'
        AND ccu.column_name = 'relationship_type'
    ) LOOP
      EXECUTE 'ALTER TABLE public.policy_article_links DROP CONSTRAINT ' || quote_ident(rec.constraint_name);
    END LOOP;

    ALTER TABLE public.policy_article_links DROP CONSTRAINT IF EXISTS policy_article_links_relationship_type_check;

    ALTER TABLE public.policy_article_links ADD CONSTRAINT policy_article_links_relationship_type_check
      CHECK (relationship_type IN ('primary_governance', 'supporting_reference', 'superseded_reference', 'historical_reference'));
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. CORE ENTITY 6: TICKETS (public.tickets)
-- The primary operational request record.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tickets (
  ticket_id text PRIMARY KEY CHECK (ticket_id ~ '^TKT-2026-[0-9]{6}$'),
  requester_id text NOT NULL REFERENCES public.requesters(requester_id),
  requester_profile_id uuid REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  category_id text NOT NULL REFERENCES public.categories(category_id),
  category_name text NOT NULL CHECK (
    category_name IN ('Financial Aid', 'Registration', 'IT', 'Accessibility')
  ),
  term_id text REFERENCES public.terms(term_id),
  subject text NOT NULL CHECK (char_length(trim(subject)) >= 5),
  description text NOT NULL CHECK (char_length(trim(description)) >= 10),
  priority text NOT NULL CHECK (
    priority IN (
      'Standard Priority',
      'Time-Sensitive Academic Priority',
      'Administrative Escalation Priority'
    )
  ),
  lifecycle_status text NOT NULL CHECK (
    lifecycle_status IN (
      'draft',
      'submitted',
      'under_review',
      'policy_verified',
      'escalated',
      'resolved',
      'closed'
    )
  ),
  current_assigned_team text NOT NULL,
  current_routing_rule_id text NOT NULL,
  referenced_policy_id text REFERENCES public.policy_documents(policy_id),
  referenced_policy_version text,
  referenced_article_id text REFERENCES public.knowledge_articles(article_id),
  referenced_article_version text,
  requires_escalation boolean NOT NULL DEFAULT false,
  is_escalated boolean NOT NULL DEFAULT false,
  escalation_reason text,
  resolution_summary text,
  is_synthetic_eval boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT chk_ticket_resolution_dates CHECK (
    (resolved_at IS NULL OR submitted_at <= resolved_at)
    AND (closed_at IS NULL OR submitted_at <= closed_at)
  )
);

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.tickets ALTER COLUMN term_id DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON public.tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_tickets_requester ON public.tickets(requester_id);
CREATE INDEX IF NOT EXISTS idx_tickets_profile ON public.tickets(requester_profile_id);
CREATE INDEX IF NOT EXISTS idx_tickets_category_status ON public.tickets(category_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_tickets_submitted_at ON public.tickets(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_synthetic ON public.tickets(is_synthetic_eval);

-- ----------------------------------------------------------------------------
-- 10. BRIDGE TABLES: TICKET POLICIES & ARTICLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_policy_links (
  link_id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  policy_id text NOT NULL REFERENCES public.policy_documents(policy_id),
  policy_version text NOT NULL,
  applicability_status text NOT NULL CHECK (applicability_status IN ('applicable_current', 'expired_at_citation', 'superseded_at_citation')),
  linked_by_actor text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ticket_policy_version UNIQUE (ticket_id, policy_id, policy_version)
);

CREATE TABLE IF NOT EXISTS public.ticket_article_links (
  link_id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  article_id text NOT NULL REFERENCES public.knowledge_articles(article_id),
  article_version text NOT NULL,
  applicability_status text NOT NULL CHECK (applicability_status IN ('applicable_current', 'expired_at_citation', 'archived_at_citation')),
  linked_by_actor text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ticket_article_version UNIQUE (ticket_id, article_id, article_version)
);

-- ----------------------------------------------------------------------------
-- 11. AUDIT ENTITY: TICKET LIFECYCLE EVENTS (public.ticket_lifecycle_events)
-- Immutable state transition audit log.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_lifecycle_events (
  event_id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  previous_state text,
  new_state text NOT NULL CHECK (
    new_state IN (
      'draft',
      'submitted',
      'under_review',
      'policy_verified',
      'escalated',
      'resolved',
      'closed'
    )
  ),
  transition_reason text NOT NULL,
  actor_profile_id uuid REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  actor_display_name text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_ticket ON public.ticket_lifecycle_events(ticket_id, recorded_at ASC);

-- ----------------------------------------------------------------------------
-- 12. CORE ENTITY 7: MESSAGES (public.messages)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  message_id text PRIMARY KEY CHECK (message_id ~ '^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$'),
  ticket_id text NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  sender_actor_id text,
  sender_profile_id uuid REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  sender_role text NOT NULL,
  sender_display_name text NOT NULL,
  message_type text NOT NULL CHECK (
    message_type IN (
      'requester_inquiry',
      'system_acknowledgement',
      'system_routing_note',
      'staff_response',
      'ai_grounded_reply',
      'policy_clarification',
      'escalation_notice',
      'resolution_delivery'
    )
  ),
  body text NOT NULL CHECK (char_length(trim(body)) >= 5),
  policy_citation text,
  cited_policy_id text,
  cited_policy_version text,
  cited_article_id text,
  cited_article_version text,
  is_internal boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_message_ticket_seq UNIQUE (ticket_id, sequence_number)
);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS cited_policy_id text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS cited_policy_version text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS cited_article_id text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS cited_article_version text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'messages'
  ) THEN
    ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_id_check;
    ALTER TABLE public.messages ADD CONSTRAINT messages_message_id_check
      CHECK (message_id ~ '^MSG-TKT-2026-[0-9]{6}-[0-9]{3}$');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_messages_ticket ON public.messages(ticket_id, sequence_number ASC);

-- ----------------------------------------------------------------------------
-- 13. CORE ENTITY 9: ASSIGNMENTS (public.assignments)
-- Explainable rule-based routing and reassignment history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assignments (
  assignment_id text PRIMARY KEY CHECK (assignment_id ~ '^ASG-TKT-2026-[0-9]{6}-[0-9]{2}$'),
  ticket_id text NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  assigned_team text NOT NULL,
  assigned_actor_id text,
  assigned_actor_role public.actor_role_type NOT NULL,
  routing_rule_id text NOT NULL,
  assignment_reason text NOT NULL,
  previous_assignment_id text REFERENCES public.assignments(assignment_id),
  previous_assigned_team text,
  requires_human_review boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  CONSTRAINT uq_assignment_ticket_seq UNIQUE (ticket_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_assignments_ticket ON public.assignments(ticket_id, sequence_number ASC);

-- ----------------------------------------------------------------------------
-- 14. CORE ENTITY 10: SLA RECORDS (public.slas)
-- Exact 1:1 relationship with Ticket.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.slas (
  sla_id text PRIMARY KEY CHECK (sla_id ~ '^SLA-TKT-2026-[0-9]{6}$'),
  ticket_id text NOT NULL UNIQUE REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  sla_rule_id text NOT NULL,
  applicable_category text NOT NULL CHECK (
    applicable_category IN ('Financial Aid', 'Registration', 'IT', 'Accessibility')
  ),
  rule_classification text NOT NULL DEFAULT 'CONFIRMED_CHALLENGE_REQUIREMENT' CHECK (
    rule_classification IN ('CONFIRMED_CHALLENGE_REQUIREMENT', 'PROPOSED_CONFIGURABLE_RULE', 'SYNTHETIC_EVAL_SCENARIO')
  ),
  target_business_minutes integer NOT NULL CHECK (target_business_minutes > 0),
  start_timestamp timestamptz NOT NULL,
  due_timestamp timestamptz NOT NULL,
  evaluated_timestamp timestamptz NOT NULL,
  elapsed_wall_clock_minutes integer NOT NULL CHECK (elapsed_wall_clock_minutes >= 0),
  elapsed_business_minutes integer NOT NULL CHECK (elapsed_business_minutes >= 0),
  calculation_mode text NOT NULL CHECK (
    calculation_mode IN ('business_hours_configured', 'wall_clock_24x7')
  ),
  business_schedule_code text NOT NULL,
  breach_status boolean NOT NULL,
  escalation_status text NOT NULL CHECK (
    escalation_status IN ('not_required', 'pending_escalation', 'escalated', 'escalation_missed')
  ),
  calculation_explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sla_timestamps CHECK (
    start_timestamp <= due_timestamp
    AND start_timestamp <= evaluated_timestamp
  )
);

ALTER TABLE public.slas ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_slas_updated_at ON public.slas;
CREATE TRIGGER trg_slas_updated_at
  BEFORE UPDATE ON public.slas
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ----------------------------------------------------------------------------
-- 15. CORE ENTITY 11: RESOLUTION FEEDBACK (public.resolution_feedbacks)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resolution_feedbacks (
  feedback_id text PRIMARY KEY CHECK (feedback_id ~ '^FDB-TKT-2026-[0-9]{6}$'),
  ticket_id text NOT NULL UNIQUE REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  requester_id text NOT NULL REFERENCES public.requesters(requester_id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  was_helpful boolean NOT NULL,
  resolution_accepted boolean NOT NULL,
  policy_clarity_score integer NOT NULL CHECK (policy_clarity_score BETWEEN 1 AND 5),
  comments text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 16. AUDIT ENTITY: AI RETRIEVAL LOGS (public.ai_retrieval_logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_retrieval_logs (
  query_id text PRIMARY KEY,
  requester_profile_id uuid REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  actor_role public.actor_role_type NOT NULL DEFAULT 'learner',
  user_query text NOT NULL,
  detected_category text,
  retrieved_policy_ids text[] NOT NULL DEFAULT '{}',
  retrieved_policy_versions text[] NOT NULL DEFAULT '{}',
  retrieved_article_ids text[] NOT NULL DEFAULT '{}',
  retrieved_article_versions text[] NOT NULL DEFAULT '{}',
  expired_sources_excluded text[] NOT NULL DEFAULT '{}',
  generated_response text NOT NULL,
  retrieval_confidence numeric(4,3) NOT NULL DEFAULT 0.000,
  evidence_status text NOT NULL CHECK (
    evidence_status IN (
      'supported',
      'partial_or_ambiguous',
      'unsupported_or_missing',
      'expired_only'
    )
  ),
  escalation_triggered boolean NOT NULL DEFAULT false,
  escalation_reason text,
  escalated_ticket_id text REFERENCES public.tickets(ticket_id) ON DELETE SET NULL,
  feedback_helpful boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_profile ON public.ai_retrieval_logs(requester_profile_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 17. NOTIFICATIONS: WORKSPACE NOTIFICATIONS (public.workspace_notifications)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_notifications (
  notification_id text PRIMARY KEY,
  recipient_profile_id uuid NOT NULL REFERENCES public.app_profiles(id) ON DELETE CASCADE,
  ticket_id text REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN ('ticket_created', 'routing_assigned', 'policy_verified', 'escalated', 'resolved', 'message_posted')
  ),
  category text NOT NULL CHECK (category IN ('escalations', 'policy', 'lifecycle')),
  title text NOT NULL,
  summary text NOT NULL,
  policy_reference text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.workspace_notifications(recipient_profile_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 18. IDEMPOTENT TRIGGER FOR PHASE 2 WELCOME EMAIL LOG
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'welcome_email_log'
  ) THEN
    ALTER TABLE public.welcome_email_log ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    DROP TRIGGER IF EXISTS trg_welcome_email_log_updated_at ON public.welcome_email_log;
    CREATE TRIGGER trg_welcome_email_log_updated_at
      BEFORE UPDATE ON public.welcome_email_log
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 19. RLS HELPER FUNCTIONS
-- Resolves caller profile ID and actor role from authenticated session using auth.uid() only.
-- Verified against Phase 2 public.app_profiles schema (id uuid, provider_subject text, actor_role actor_role_type).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.app_profiles p
  WHERE p.provider_subject = coalesce(auth.jwt() ->> 'sub', auth.uid()::text)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_actor_role()
RETURNS public.actor_role_type
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.actor_role
  FROM public.app_profiles p
  WHERE p.provider_subject = coalesce(auth.jwt() ->> 'sub', auth.uid()::text)
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 20. ROW LEVEL SECURITY (RLS) ACTIVATION & FORCING
-- ----------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms FORCE ROW LEVEL SECURITY;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;

ALTER TABLE public.requesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requesters FORCE ROW LEVEL SECURITY;

ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_documents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.policy_version_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_version_history FORCE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_articles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.policy_article_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_article_links FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_policy_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_policy_links FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_article_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_article_links FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_lifecycle_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.slas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slas FORCE ROW LEVEL SECURITY;

ALTER TABLE public.resolution_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resolution_feedbacks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ai_retrieval_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_retrieval_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_notifications FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 21. RESTRICTIVE RLS POLICIES FOR ALL 18 TABLES
-- ----------------------------------------------------------------------------

-- Reference tables (Readable by all authenticated university users)
DROP POLICY IF EXISTS roles_read_all ON public.roles;
DROP POLICY IF EXISTS roles_select_auth ON public.roles;
CREATE POLICY roles_select_auth ON public.roles FOR SELECT TO authenticated 
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS terms_read_all ON public.terms;
DROP POLICY IF EXISTS terms_select_auth ON public.terms;
CREATE POLICY terms_select_auth ON public.terms FOR SELECT TO authenticated 
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS categories_read_all ON public.categories;
DROP POLICY IF EXISTS categories_select_auth ON public.categories;
CREATE POLICY categories_select_auth ON public.categories FOR SELECT TO authenticated 
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS categories_update_admin ON public.categories;
CREATE POLICY categories_update_admin ON public.categories FOR UPDATE TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
)
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
);

-- Requesters: Users read their own profile; staff/admins read for ticket operations
DROP POLICY IF EXISTS requesters_select ON public.requesters;
DROP POLICY IF EXISTS requesters_select_scoped ON public.requesters;
CREATE POLICY requesters_select_scoped ON public.requesters FOR SELECT TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND (
    app_profile_id = public.current_app_profile_id()
    OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
  )
);

DROP POLICY IF EXISTS requesters_insert_own ON public.requesters;
CREATE POLICY requesters_insert_own ON public.requesters FOR INSERT TO authenticated
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND app_profile_id = public.current_app_profile_id()
);

-- Requester update policy: no self-referencing subquery.
-- Role immutability and app_profile_id protection are strictly enforced by trg_enforce_requester_immutability.
DROP POLICY IF EXISTS requesters_update_own ON public.requesters;
CREATE POLICY requesters_update_own ON public.requesters FOR UPDATE TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND (
    app_profile_id = public.current_app_profile_id()
    OR public.current_app_actor_role() IN ('platform_administrator')
  )
)
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND (
    app_profile_id = public.current_app_profile_id()
    OR public.current_app_actor_role() IN ('platform_administrator')
  )
);

-- Policies & Knowledge Base: Authenticated users can read; admins can manage
-- Policies & Knowledge Base: Authenticated users can read; admins can manage
DROP POLICY IF EXISTS policy_documents_read ON public.policy_documents;
DROP POLICY IF EXISTS policy_documents_admin_write ON public.policy_documents;
DROP POLICY IF EXISTS policies_select_auth ON public.policy_documents;
CREATE POLICY policies_select_auth ON public.policy_documents FOR SELECT TO authenticated 
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS policies_insert_scoped ON public.policy_documents;
CREATE POLICY policies_insert_scoped ON public.policy_documents FOR INSERT TO authenticated
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND (
    public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
    OR (
      public.current_app_actor_role() IN ('instructor', 'support_staff')
      AND lifecycle_state = 'draft'
    )
  )
);

DROP POLICY IF EXISTS policies_update_admin ON public.policy_documents;
CREATE POLICY policies_update_admin ON public.policy_documents FOR UPDATE TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
)
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
);

DROP POLICY IF EXISTS policy_version_read ON public.policy_version_history;
DROP POLICY IF EXISTS policy_version_admin_write ON public.policy_version_history;
DROP POLICY IF EXISTS policy_history_select_auth ON public.policy_version_history;
CREATE POLICY policy_history_select_auth ON public.policy_version_history FOR SELECT TO authenticated
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS policy_history_insert_scoped ON public.policy_version_history;
CREATE POLICY policy_history_insert_scoped ON public.policy_version_history FOR INSERT TO authenticated
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator', 'instructor', 'support_staff')
);

DROP POLICY IF EXISTS knowledge_articles_read ON public.knowledge_articles;
DROP POLICY IF EXISTS knowledge_articles_admin_write ON public.knowledge_articles;
DROP POLICY IF EXISTS kb_select_auth ON public.knowledge_articles;
CREATE POLICY kb_select_auth ON public.knowledge_articles FOR SELECT TO authenticated 
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS kb_insert_scoped ON public.knowledge_articles;
CREATE POLICY kb_insert_scoped ON public.knowledge_articles FOR INSERT TO authenticated
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND (
    public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
    OR (
      public.current_app_actor_role() IN ('instructor', 'support_staff')
      AND lifecycle_state = 'draft'
    )
  )
);

DROP POLICY IF EXISTS kb_update_admin ON public.knowledge_articles;
CREATE POLICY kb_update_admin ON public.knowledge_articles FOR UPDATE TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
)
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator')
);

DROP POLICY IF EXISTS policy_article_links_read ON public.policy_article_links;
DROP POLICY IF EXISTS policy_article_links_select_auth ON public.policy_article_links;
CREATE POLICY policy_article_links_select_auth ON public.policy_article_links FOR SELECT TO authenticated
USING (public.is_valid_authenticated_jwt());

DROP POLICY IF EXISTS policy_article_links_insert_scoped ON public.policy_article_links;
CREATE POLICY policy_article_links_insert_scoped ON public.policy_article_links FOR INSERT TO authenticated
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND public.current_app_actor_role() IN ('academic_administrator', 'platform_administrator', 'instructor', 'support_staff')
);

-- Operational Tickets: Users only read/submit their own; staff/admins read queue
DROP POLICY IF EXISTS tickets_select ON public.tickets;
DROP POLICY IF EXISTS tickets_select_scoped ON public.tickets;
CREATE POLICY tickets_select_scoped ON public.tickets FOR SELECT TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND is_synthetic_eval = false
  AND (
    requester_profile_id = public.current_app_profile_id()
    OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
  )
);

DROP POLICY IF EXISTS tickets_insert ON public.tickets;
DROP POLICY IF EXISTS tickets_insert_scoped ON public.tickets;
CREATE POLICY tickets_insert_scoped ON public.tickets FOR INSERT TO authenticated
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND is_synthetic_eval = false
  AND requester_profile_id = public.current_app_profile_id()
);

DROP POLICY IF EXISTS tickets_update ON public.tickets;
DROP POLICY IF EXISTS tickets_update_scoped ON public.tickets;
CREATE POLICY tickets_update_scoped ON public.tickets FOR UPDATE TO authenticated
USING (
  public.is_valid_authenticated_jwt()
  AND is_synthetic_eval = false
  AND (
    requester_profile_id = public.current_app_profile_id()
    OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
  )
)
WITH CHECK (
  public.is_valid_authenticated_jwt()
  AND is_synthetic_eval = false
  AND (
    requester_profile_id = public.current_app_profile_id()
    OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
  )
);

-- Ticket Bridge Links: inherit ticket authorization (parent ticket ownership or authorized staff)
DROP POLICY IF EXISTS ticket_policy_links_select ON public.ticket_policy_links;
DROP POLICY IF EXISTS ticket_policy_links_select_auth ON public.ticket_policy_links;
DROP POLICY IF EXISTS ticket_policy_links_select_scoped ON public.ticket_policy_links;
CREATE POLICY ticket_policy_links_select_scoped ON public.ticket_policy_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = ticket_policy_links.ticket_id
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS ticket_policy_links_insert ON public.ticket_policy_links;
DROP POLICY IF EXISTS ticket_policy_links_insert_scoped ON public.ticket_policy_links;
CREATE POLICY ticket_policy_links_insert_scoped ON public.ticket_policy_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = ticket_policy_links.ticket_id
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS ticket_article_links_select ON public.ticket_article_links;
DROP POLICY IF EXISTS ticket_article_links_select_auth ON public.ticket_article_links;
DROP POLICY IF EXISTS ticket_article_links_select_scoped ON public.ticket_article_links;
CREATE POLICY ticket_article_links_select_scoped ON public.ticket_article_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = ticket_article_links.ticket_id
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS ticket_article_links_insert ON public.ticket_article_links;
DROP POLICY IF EXISTS ticket_article_links_insert_scoped ON public.ticket_article_links;
CREATE POLICY ticket_article_links_insert_scoped ON public.ticket_article_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = ticket_article_links.ticket_id
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

-- Messages: Scoped to authorized ticket viewers
DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_select_scoped ON public.messages;
CREATE POLICY messages_select_scoped ON public.messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = messages.ticket_id
      AND t.is_synthetic_eval = false
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS messages_insert ON public.messages;
DROP POLICY IF EXISTS messages_insert_scoped ON public.messages;
CREATE POLICY messages_insert_scoped ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = messages.ticket_id
      AND t.is_synthetic_eval = false
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

-- Assignments: Inherit ticket access scope (mutations strictly server-side via service_role)
DROP POLICY IF EXISTS assignments_select ON public.assignments;
DROP POLICY IF EXISTS assignments_select_scoped ON public.assignments;
CREATE POLICY assignments_select_scoped ON public.assignments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = assignments.ticket_id
      AND t.is_synthetic_eval = false
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS assignments_insert ON public.assignments;
DROP POLICY IF EXISTS assignments_insert_scoped ON public.assignments;
DROP POLICY IF EXISTS assignments_update ON public.assignments;
DROP POLICY IF EXISTS assignments_update_scoped ON public.assignments;

-- SLAs: Scoped to authorized ticket viewers (mutations strictly server-side via service_role)
DROP POLICY IF EXISTS slas_select ON public.slas;
DROP POLICY IF EXISTS slas_write ON public.slas;
DROP POLICY IF EXISTS slas_select_scoped ON public.slas;
CREATE POLICY slas_select_scoped ON public.slas FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = slas.ticket_id
      AND t.is_synthetic_eval = false
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS slas_insert ON public.slas;
DROP POLICY IF EXISTS slas_insert_scoped ON public.slas;
DROP POLICY IF EXISTS slas_update ON public.slas;
DROP POLICY IF EXISTS slas_update_scoped ON public.slas;

-- Lifecycle Events: Scoped to authorized ticket viewers (Audit log written strictly by trusted server-side code)
DROP POLICY IF EXISTS events_select_scoped ON public.ticket_lifecycle_events;
DROP POLICY IF EXISTS ticket_lifecycle_events_select ON public.ticket_lifecycle_events;
CREATE POLICY events_select_scoped ON public.ticket_lifecycle_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = ticket_lifecycle_events.ticket_id
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

-- Note: All client-side authenticated INSERT/UPDATE policies on ticket_lifecycle_events are removed.
-- Audit lifecycle transitions are performed exclusively through trusted server-side code (service_role).
DROP POLICY IF EXISTS events_insert_scoped ON public.ticket_lifecycle_events;
DROP POLICY IF EXISTS ticket_lifecycle_events_insert ON public.ticket_lifecycle_events;

-- Feedback: Requesters submit and read their own feedback
DROP POLICY IF EXISTS feedback_select_scoped ON public.resolution_feedbacks;
DROP POLICY IF EXISTS feedback_select ON public.resolution_feedbacks;
CREATE POLICY feedback_select_scoped ON public.resolution_feedbacks FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = resolution_feedbacks.ticket_id
      AND (
        t.requester_profile_id = public.current_app_profile_id()
        OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
      )
  )
);

DROP POLICY IF EXISTS feedback_insert_scoped ON public.resolution_feedbacks;
DROP POLICY IF EXISTS feedback_insert ON public.resolution_feedbacks;
CREATE POLICY feedback_insert_scoped ON public.resolution_feedbacks FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = resolution_feedbacks.ticket_id
      AND t.requester_profile_id = public.current_app_profile_id()
  )
);

DROP POLICY IF EXISTS feedback_update_scoped ON public.resolution_feedbacks;
CREATE POLICY feedback_update_scoped ON public.resolution_feedbacks FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = resolution_feedbacks.ticket_id
      AND t.requester_profile_id = public.current_app_profile_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.ticket_id = resolution_feedbacks.ticket_id
      AND t.requester_profile_id = public.current_app_profile_id()
  )
);

-- AI Retrieval Logs: Scoped to querying user for read-only inspection
-- (Audit logs written strictly by trusted server-side AI evaluation routes using service_role)
DROP POLICY IF EXISTS ai_logs_select_own ON public.ai_retrieval_logs;
DROP POLICY IF EXISTS ai_retrieval_logs_select ON public.ai_retrieval_logs;
CREATE POLICY ai_logs_select_own ON public.ai_retrieval_logs FOR SELECT TO authenticated
USING (requester_profile_id = public.current_app_profile_id());

-- Note: All client-side authenticated INSERT/UPDATE policies on ai_retrieval_logs are removed.
DROP POLICY IF EXISTS ai_logs_insert_own ON public.ai_retrieval_logs;
DROP POLICY IF EXISTS ai_logs_update_own ON public.ai_retrieval_logs;
DROP POLICY IF EXISTS ai_retrieval_logs_insert ON public.ai_retrieval_logs;

-- Workspace Notifications: Scoped to recipient
DROP POLICY IF EXISTS notifications_select ON public.workspace_notifications;
DROP POLICY IF EXISTS notifications_select_own ON public.workspace_notifications;
CREATE POLICY notifications_select_own ON public.workspace_notifications FOR SELECT TO authenticated
USING (recipient_profile_id = public.current_app_profile_id());

DROP POLICY IF EXISTS notifications_insert_own ON public.workspace_notifications;
CREATE POLICY notifications_insert_own ON public.workspace_notifications FOR INSERT TO authenticated
WITH CHECK (
  recipient_profile_id = public.current_app_profile_id()
  OR public.current_app_actor_role() IN ('support_staff', 'academic_administrator', 'platform_administrator')
);

DROP POLICY IF EXISTS notifications_update_own ON public.workspace_notifications;
CREATE POLICY notifications_update_own ON public.workspace_notifications FOR UPDATE TO authenticated
USING (recipient_profile_id = public.current_app_profile_id())
WITH CHECK (recipient_profile_id = public.current_app_profile_id());

-- ----------------------------------------------------------------------------
-- 22. IDEMPOTENT FOUNDATIONAL CONFIGURATION (ROLES, CATEGORIES, TERMS ONLY)
-- Seeds ONLY structural reference governance tables so foreign keys are satisfied.
-- ZERO synthetic tickets, users, requesters, or fake policies are seeded.
-- ----------------------------------------------------------------------------
INSERT INTO public.roles (
  role_id, role_code, role_name, institutional_scope, description,
  allowed_actions, can_be_assigned_tickets, can_publish_policies, can_approve_escalations,
  effective_from, effective_to
) VALUES
  ('ROLE-LEARNER', 'learner', 'Learner', 'Enrolled Undergraduate & Graduate Student Body',
   'Submits academic, financial aid, registration, IT, and accessibility requests; queries the AI Policy Assistant; tracks resolution and submits feedback.',
   ARRAY['submit_ticket', 'query_policy_assistant', 'submit_feedback'], false, false, false, '2025-08-01', NULL),
  ('ROLE-INSTRUCTOR', 'instructor', 'Instructor', 'Academic Faculty & Course Coordinators',
   'Submits instructional, classroom IT, curriculum, and accommodation coordination requests; proposes draft policy revisions.',
   ARRAY['submit_ticket', 'query_policy_assistant', 'propose_policy_revision', 'submit_feedback'], false, false, false, '2025-08-01', NULL),
  ('ROLE-SUPPORT_STAFF', 'support_staff', 'Support Staff', 'Operational Intake & Departmental Triage Units',
   'Triages incoming tickets across the four supported categories, verifies policy applicability, posts grounded responses, and escalates complex cases.',
   ARRAY['triage_support_queue', 'post_staff_response', 'transition_ticket_state', 'escalate_ticket'], true, false, false, '2025-08-01', NULL),
  ('ROLE-ACADEMIC_ADMIN', 'academic_administrator', 'Academic Administrator', 'Deans, Registrar Governance & Compliance Committees',
   'Reviews escalated petitions, approves policy exceptions, and publishes institutional policy versions and knowledge base articles.',
   ARRAY['approve_policy_escalation', 'publish_knowledge_article', 'configure_department_routing', 'transition_ticket_state'], true, true, true, '2025-08-01', NULL),
  ('ROLE-PLATFORM_ADMIN', 'platform_administrator', 'Platform Administrator', 'Enterprise Systems, Identity & Security Governance',
   'Audits platform security, manages SLA and routing configurations, oversees IT infrastructure escalations, and monitors retrieval integrity.',
   ARRAY['configure_platform_governance', 'configure_department_routing', 'publish_knowledge_article', 'approve_policy_escalation'], true, true, true, '2025-08-01', NULL)
ON CONFLICT (role_id) DO NOTHING;

INSERT INTO public.categories (
  category_id, category_name, domain_code, default_assigned_team, escalation_team,
  routing_rule_id, description, keywords, is_active, effective_from
) VALUES
  ('CAT-FINAID', 'Financial Aid', 'FINAID',
   'Financial Aid Operations Team',
   'Financial Aid Escalation Team',
   'RULE-FINAID-001',
   'Configurable operational intake and escalation queue for Financial Aid requests.',
   ARRAY['fafsa', 'scholarship', 'disbursement', 'sap', 'pell', 'aid', 'tuition'], true, '2025-08-01'),
  ('CAT-REG', 'Registration', 'REG',
   'Registration Operations Team',
   'Registration Escalation Team',
   'RULE-REG-001',
   'Configurable operational intake and escalation queue for Registration requests.',
   ARRAY['registration', 'enrollment', 'add/drop', 'withdrawal', 'waitlist', 'transcript', 'overload'], true, '2025-08-01'),
  ('CAT-IT', 'IT', 'IT',
   'IT Operations Team',
   'IT Escalation Team',
   'RULE-IT-001',
   'Configurable operational intake and escalation queue for IT requests.',
   ARRAY['sso', 'mfa', 'canvas', 'lms', 'vpn', 'wifi', 'password', 'license'], true, '2025-08-01'),
  ('CAT-ACCESS', 'Accessibility', 'ACCESS',
   'Accessibility Operations Team',
   'Accessibility Escalation Team',
   'RULE-ACCESS-001',
   'Configurable operational intake and escalation queue for Accessibility requests.',
   ARRAY['accommodation', 'accessibility', 'disability', 'captioning', 'extended time', 'section 504', 'assistive'], true, '2025-08-01')
ON CONFLICT (category_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 23. PERMISSIONS & SCHEMA RELOAD
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.roles, public.terms, public.categories, public.policy_documents, public.policy_version_history, public.knowledge_articles, public.policy_article_links TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.categories, public.policy_documents, public.policy_version_history, public.knowledge_articles, public.policy_article_links TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.requesters, public.tickets, public.ticket_policy_links, public.ticket_article_links, public.messages, public.resolution_feedbacks, public.workspace_notifications TO authenticated, service_role;

-- Assignments, SLAs, Lifecycle events, and AI retrieval logs:
-- Authenticated users can SELECT according to ticket scoping;
-- mutations are strictly reserved for trusted server-side code (service_role).
GRANT SELECT ON public.assignments, public.slas, public.ticket_lifecycle_events, public.ai_retrieval_logs TO authenticated;
GRANT ALL ON public.assignments, public.slas, public.ticket_lifecycle_events, public.ai_retrieval_logs TO service_role;

GRANT EXECUTE ON FUNCTION public.set_updated_at_timestamp() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_app_profile_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_app_actor_role() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
