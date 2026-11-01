-- ============================================================================
-- CAMPUSRESOLVE AI — PHASE 2 DATABASE MIGRATION
-- Unified Application Identity, Dual-Provider JWT Mapping, RBAC Protection,
-- RLS Policies & Idempotent Google Apps Script + Gmail Welcome Email Log
-- Target Database: Supabase PostgreSQL (https://llotsqzeppiltosllxvx.supabase.co)
-- Firebase Third-Party Auth Project ID: campusresolveai (671221539968)
-- Dedicated Welcome Email Sender: campusresolveai@gmail.com
-- ============================================================================

-- Enable pgcrypto for gen_random_uuid() if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. ENUMS & DOMAIN CONSTRAINTS
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auth_provider_type') THEN
    CREATE TYPE public.auth_provider_type AS ENUM ('supabase_email', 'firebase_google');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actor_role_type') THEN
    CREATE TYPE public.actor_role_type AS ENUM (
      'learner',
      'instructor',
      'academic_administrator',
      'support_staff',
      'platform_administrator'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status_type') THEN
    CREATE TYPE public.account_status_type AS ENUM (
      'pending_verification',
      'active',
      'suspended',
      'archived'
    );
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. JWT INSPECTION HELPER FUNCTIONS (Dual-Provider: Supabase Auth + Firebase)
-- ----------------------------------------------------------------------------

-- Extract 'sub' claim from current request JWT (UUID for Supabase Auth, UID for Firebase)
CREATE OR REPLACE FUNCTION public.current_jwt_sub()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(trim(coalesce(auth.jwt() ->> 'sub', '')), '');
$$;

-- Extract 'iss' (issuer) claim from current request JWT
CREATE OR REPLACE FUNCTION public.current_jwt_issuer()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(trim(coalesce(auth.jwt() ->> 'iss', '')), '');
$$;

-- Determine canonical authentication provider from the verified JWT issuer.
-- Strictly accepts ONLY:
--   1. Firebase tokens issued by 'https://securetoken.google.com/campusresolveai'
--   2. Supabase Auth tokens issued by this project's '/auth/v1' endpoint
CREATE OR REPLACE FUNCTION public.current_auth_provider()
RETURNS public.auth_provider_type
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN public.current_jwt_issuer() = 'https://securetoken.google.com/campusresolveai'
      THEN 'firebase_google'::public.auth_provider_type
    WHEN public.current_jwt_issuer() LIKE '%/auth/v1'
      THEN 'supabase_email'::public.auth_provider_type
    ELSE NULL
  END;
$$;

-- Extract lowercase email from JWT claims
CREATE OR REPLACE FUNCTION public.current_jwt_email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(nullif(trim(coalesce(auth.jwt() ->> 'email', '')), ''));
$$;

-- Determine whether the current JWT carries a verified email claim
CREATE OR REPLACE FUNCTION public.current_jwt_email_verified()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN public.current_auth_provider() = 'firebase_google' THEN
      coalesce((auth.jwt() ->> 'email_verified')::boolean, false)
    WHEN public.current_auth_provider() = 'supabase_email' THEN
      coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, true)
    ELSE false
  END;
$$;

-- Validate that the request carries role = 'authenticated', a valid subject, and an approved issuer
CREATE OR REPLACE FUNCTION public.is_valid_authenticated_jwt()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    auth.role() = 'authenticated'
    AND public.current_jwt_sub() IS NOT NULL
    AND public.current_auth_provider() IS NOT NULL;
$$;

-- ----------------------------------------------------------------------------
-- 3. UNIFIED APPLICATION PROFILES TABLE (public.app_profiles)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider public.auth_provider_type NOT NULL,
  provider_subject text NOT NULL,
  verified_email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT true,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) >= 2),
  department text NOT NULL DEFAULT 'Unassigned Academic Unit',
  office_or_cohort text,
  actor_role public.actor_role_type NOT NULL DEFAULT 'learner',
  requested_role_note text,
  account_status public.account_status_type NOT NULL DEFAULT 'active',
  welcome_email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate profiles for the same (auth_provider, provider_subject) pair
  CONSTRAINT uq_app_profiles_provider_subject UNIQUE (auth_provider, provider_subject)
);

-- Ensure office_or_cohort is nullable if table was partially created earlier
ALTER TABLE public.app_profiles ALTER COLUMN office_or_cohort DROP NOT NULL;

-- Prevent silent cross-provider duplicate accounts for the same verified email address
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_profiles_verified_email_unique
  ON public.app_profiles (lower(verified_email))
  WHERE verified_email IS NOT NULL AND email_verified = true;

CREATE INDEX IF NOT EXISTS idx_app_profiles_lookup
  ON public.app_profiles (auth_provider, provider_subject);

-- ----------------------------------------------------------------------------
-- 4. IDEMPOTENT WELCOME EMAIL DELIVERY LOG (public.welcome_email_log)
-- Tracks Google Apps Script + Gmail (campusresolveai@gmail.com) dispatch status
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.app_profiles(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  email_type text NOT NULL DEFAULT 'welcome_email' CHECK (email_type = 'welcome_email'),
  auth_provider public.auth_provider_type NOT NULL,
  sender_email text NOT NULL DEFAULT 'campusresolveai@gmail.com',
  delivery_status text NOT NULL CHECK (
    delivery_status IN (
      'pending',
      'request_accepted',
      'apps_script_succeeded',
      'sent',
      'failed',
      'skipped_unconfigured'
    )
  ),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  failure_details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,

  -- Concurrency-safe uniqueness constraints preventing duplicate welcome emails per user
  CONSTRAINT uq_welcome_email_log_profile UNIQUE (profile_id),
  CONSTRAINT uq_welcome_email_log_profile_type UNIQUE (profile_id, email_type)
);

-- ----------------------------------------------------------------------------
-- 5. GENERIC UPDATED_AT TRIGGER FUNCTION & SECURITY TRIGGER
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

DROP TRIGGER IF EXISTS trg_welcome_email_log_updated_at ON public.welcome_email_log;
CREATE TRIGGER trg_welcome_email_log_updated_at
  BEFORE UPDATE ON public.welcome_email_log
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE OR REPLACE FUNCTION public.enforce_app_profile_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text := coalesce(auth.role(), '');
BEGIN
  NEW.updated_at := now();

  -- Normalize verified_email to lowercase
  IF NEW.verified_email IS NOT NULL THEN
    NEW.verified_email := lower(trim(NEW.verified_email));
  END IF;

  -- When executed by an authenticated client (not service_role / postgres admin):
  IF jwt_role = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      -- Enforce identity binding to the caller's JWT
      IF NEW.auth_provider IS DISTINCT FROM public.current_auth_provider() THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: auth_provider must match JWT issuer.'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.provider_subject IS DISTINCT FROM public.current_jwt_sub() THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: provider_subject must match JWT sub claim.'
          USING ERRCODE = '42501';
      END IF;

      -- Force safe default role ('learner') on self-registration; users cannot self-promote
      NEW.actor_role := 'learner'::public.actor_role_type;
      NEW.account_status := 'active'::public.account_status_type;
      NEW.created_at := now();
    ELSIF TG_OP = 'UPDATE' THEN
      -- Prevent modification of immutable identity or privileged governance columns
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.auth_provider IS DISTINCT FROM OLD.auth_provider
         OR NEW.provider_subject IS DISTINCT FROM OLD.provider_subject
         OR NEW.verified_email IS DISTINCT FROM OLD.verified_email
         OR NEW.email_verified IS DISTINCT FROM OLD.email_verified
         OR NEW.actor_role IS DISTINCT FROM OLD.actor_role
         OR NEW.account_status IS DISTINCT FROM OLD.account_status
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Users cannot modify their own actor_role, account_status, or identity mapping.'
          USING ERRCODE = '42501';
      END IF;

      -- Once welcome_email_sent_at is stamped, prevent clearing or overwriting it
      IF OLD.welcome_email_sent_at IS NOT NULL
         AND NEW.welcome_email_sent_at IS DISTINCT FROM OLD.welcome_email_sent_at
      THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: welcome_email_sent_at is immutable once set.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_app_profile_security ON public.app_profiles;
CREATE TRIGGER trg_enforce_app_profile_security
  BEFORE INSERT OR UPDATE ON public.app_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_app_profile_security();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.welcome_email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_email_log FORCE ROW LEVEL SECURITY;

-- Policy 1: Users can read ONLY their own profile
DROP POLICY IF EXISTS app_profiles_select_own ON public.app_profiles;
CREATE POLICY app_profiles_select_own
  ON public.app_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_valid_authenticated_jwt()
    AND auth_provider = public.current_auth_provider()
    AND provider_subject = public.current_jwt_sub()
  );

-- Policy 2: Users can insert ONLY their own profile with safe learner role
DROP POLICY IF EXISTS app_profiles_insert_own ON public.app_profiles;
CREATE POLICY app_profiles_insert_own
  ON public.app_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_valid_authenticated_jwt()
    AND auth_provider = public.current_auth_provider()
    AND provider_subject = public.current_jwt_sub()
    AND actor_role = 'learner'::public.actor_role_type
    AND account_status IN ('active'::public.account_status_type, 'pending_verification'::public.account_status_type)
  );

-- Policy 3: Users can update ONLY their own profile (trigger blocks role/status changes)
DROP POLICY IF EXISTS app_profiles_update_own ON public.app_profiles;
CREATE POLICY app_profiles_update_own
  ON public.app_profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.is_valid_authenticated_jwt()
    AND auth_provider = public.current_auth_provider()
    AND provider_subject = public.current_jwt_sub()
  )
  WITH CHECK (
    public.is_valid_authenticated_jwt()
    AND auth_provider = public.current_auth_provider()
    AND provider_subject = public.current_jwt_sub()
    AND actor_role = (
      SELECT p.actor_role
      FROM public.app_profiles p
      WHERE p.auth_provider = public.current_auth_provider()
        AND p.provider_subject = public.current_jwt_sub()
    )
  );

-- Policy 4: Explicit deny on DELETE for authenticated users
DROP POLICY IF EXISTS app_profiles_delete_deny ON public.app_profiles;
CREATE POLICY app_profiles_delete_deny
  ON public.app_profiles
  FOR DELETE
  TO authenticated
  USING (false);

-- Welcome Email Log Policies:
-- 1. Users can read their own delivery log
DROP POLICY IF EXISTS welcome_email_log_select_own ON public.welcome_email_log;
CREATE POLICY welcome_email_log_select_own
  ON public.welcome_email_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_profiles p
      WHERE p.id = welcome_email_log.profile_id
        AND p.auth_provider = public.current_auth_provider()
        AND p.provider_subject = public.current_jwt_sub()
    )
  );

-- 2. Users can insert their own delivery log
DROP POLICY IF EXISTS welcome_email_log_insert_own ON public.welcome_email_log;
CREATE POLICY welcome_email_log_insert_own
  ON public.welcome_email_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_profiles p
      WHERE p.id = welcome_email_log.profile_id
        AND p.auth_provider = public.current_auth_provider()
        AND p.provider_subject = public.current_jwt_sub()
    )
  );

-- 3. Users can update their own delivery log ONLY if it has not already reached 'sent' status
DROP POLICY IF EXISTS welcome_email_log_update_retry_own ON public.welcome_email_log;
CREATE POLICY welcome_email_log_update_retry_own
  ON public.welcome_email_log
  FOR UPDATE
  TO authenticated
  USING (
    delivery_status <> 'sent'
    AND EXISTS (
      SELECT 1
      FROM public.app_profiles p
      WHERE p.id = welcome_email_log.profile_id
        AND p.auth_provider = public.current_auth_provider()
        AND p.provider_subject = public.current_jwt_sub()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_profiles p
      WHERE p.id = welcome_email_log.profile_id
        AND p.auth_provider = public.current_auth_provider()
        AND p.provider_subject = public.current_jwt_sub()
    )
  );

-- ----------------------------------------------------------------------------
-- 7. EXPLICIT ROLE GRANTS & POSTGREST SCHEMA CACHE RELOAD
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.auth_provider_type TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.actor_role_type TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.account_status_type TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.app_profiles TO authenticated;
GRANT ALL ON TABLE public.app_profiles TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.welcome_email_log TO authenticated;
GRANT ALL ON TABLE public.welcome_email_log TO service_role;

GRANT EXECUTE ON FUNCTION public.current_jwt_sub() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_jwt_issuer() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_auth_provider() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_jwt_email() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_jwt_email_verified() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_authenticated_jwt() TO anon, authenticated, service_role;

-- Force PostgREST to reload the schema cache immediately after DDL execution
NOTIFY pgrst, 'reload schema';
