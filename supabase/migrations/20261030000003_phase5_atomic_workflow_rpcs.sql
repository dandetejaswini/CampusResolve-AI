-- =============================================================================
-- CAMPUSRESOLVE AI — PHASE 5: ATOMIC TICKET REASSIGNMENT WORKFLOW RPC
-- Migration: 20261030000003_phase5_atomic_workflow_rpcs.sql
--
-- NON-DESTRUCTIVE ADDITIVE MIGRATION:
-- 1. Preserves all Phase 2 tables (`app_profiles`, `welcome_email_log`) and
--    all 18 Phase 3 tables and forced RLS policies without modification.
-- 2. Does NOT drop, recreate, or modify `public.current_auth_provider()` or its
--    `public.auth_provider_type` return type.
-- 3. Defines a single transactional PostgreSQL RPC function:
--      - `public.atomic_reassign_ticket_workflow`
--    which validates the caller's Supabase/Firebase JWT (`is_valid_authenticated_jwt()`),
--    resolves the caller's profile and lowercase `actor_role_type`, validates the
--    target team against existing `public.categories` routing rows, derives
--    contiguous sequence numbers and canonical IDs (`ASG-...`, `MSG-...`, `EVT-...`)
--    from locked database rows, and atomically updates/inserts `assignments`,
--    `tickets`, `ticket_lifecycle_events`, `messages`, and `workspace_notifications`
--    inside a single PostgreSQL transaction.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.atomic_reassign_ticket_workflow(
  p_ticket_id text,
  p_new_assignment_id text,
  p_sequence_number integer,
  p_target_team text,
  p_assigned_actor_id text,
  p_assigned_actor_role public.actor_role_type,
  p_routing_rule_id text,
  p_assignment_reason text,
  p_requires_human_review boolean,
  p_message_id text,
  p_message_seq integer,
  p_notification_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller_profile_id uuid;
  v_caller_role public.actor_role_type;
  v_caller_display_name text;
  v_caller_status public.account_status_type;
  v_ticket public.tickets%ROWTYPE;
  v_prev_asg public.assignments%ROWTYPE;
  v_has_prev_asg boolean := false;
  v_clean_target_team text := trim(COALESCE(p_target_team, ''));
  v_clean_reason text := trim(COALESCE(p_assignment_reason, ''));
  v_resolved_rule_id text;
  v_next_asg_seq integer;
  v_derived_assignment_id text;
  v_next_msg_seq integer;
  v_derived_message_id text;
  v_next_evt_seq integer;
  v_derived_event_id text;
  v_derived_notification_id text;
  v_now timestamptz := timezone('utc', now());
BEGIN
  -- 1. Verify valid authenticated JWT (Supabase Email or Firebase Google)
  IF NOT COALESCE(public.is_valid_authenticated_jwt(), false) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_JWT: A valid, verified Supabase or Firebase Google JWT is required.'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Resolve caller profile ID, role, display name, and account status from public.app_profiles
  v_caller_profile_id := public.current_app_profile_id();
  v_caller_role := public.current_app_actor_role();

  IF v_caller_profile_id IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authenticated institutional profile required.'
      USING ERRCODE = '28000';
  END IF;

  SELECT p.display_name, p.account_status
  INTO v_caller_display_name, v_caller_status
  FROM public.app_profiles p
  WHERE p.id = v_caller_profile_id;

  IF NOT FOUND OR v_caller_status <> 'active' THEN
    RAISE EXCEPTION 'FORBIDDEN_ACCOUNT_STATUS: Active institutional profile required.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Enforce role-based reassignment authorization using lowercase public.actor_role_type values
  IF v_caller_role NOT IN ('support_staff', 'academic_administrator', 'platform_administrator') THEN
    RAISE EXCEPTION 'FORBIDDEN_REASSIGNMENT: Role % is not permitted to reassign tickets.', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  -- 4. Validate p_assigned_actor_role server-side (never allow assignment to learner or instructor)
  IF p_assigned_actor_role IS NULL
     OR p_assigned_actor_role NOT IN ('support_staff', 'academic_administrator', 'platform_administrator') THEN
    RAISE EXCEPTION 'INVALID_ASSIGNED_ROLE: Tickets can only be assigned to support_staff, academic_administrator, or platform_administrator (received %).', p_assigned_actor_role
      USING ERRCODE = '22023';
  END IF;

  -- 5. Validate assignment reason length
  IF char_length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT_REASON: Reassignment reason must be at least 5 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Lock target operational ticket row FOR UPDATE
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE ticket_id = p_ticket_id
    AND is_synthetic_eval = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND: Operational ticket % does not exist.', p_ticket_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 7. Reject reassignment of closed tickets, and restrict escalated ticket reassignment to administrators
  IF v_ticket.lifecycle_status = 'closed' THEN
    RAISE EXCEPTION 'TICKET_CLOSED: Closed tickets cannot be reassigned.'
      USING ERRCODE = '22023';
  END IF;

  IF v_ticket.lifecycle_status = 'escalated'
     AND v_caller_role NOT IN ('academic_administrator', 'platform_administrator') THEN
    RAISE EXCEPTION 'FORBIDDEN_ESCALATED_REASSIGNMENT: Escalated tickets can only be reassigned by academic_administrator or platform_administrator.'
      USING ERRCODE = '42501';
  END IF;

  -- 8. Validate p_target_team against existing public.categories routing configuration
  SELECT c.routing_rule_id
  INTO v_resolved_rule_id
  FROM public.categories c
  WHERE c.is_active = true
    AND (c.default_assigned_team = v_clean_target_team OR c.escalation_team = v_clean_target_team)
  ORDER BY (c.category_id = v_ticket.category_id) DESC, c.category_id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_TARGET_TEAM: Team "%" is not a configured default_assigned_team or escalation_team in public.categories.', v_clean_target_team
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_target_team = v_ticket.current_assigned_team THEN
    RAISE EXCEPTION 'NOOP_REASSIGNMENT: Ticket % is already assigned to %.', p_ticket_id, v_clean_target_team
      USING ERRCODE = '22023';
  END IF;

  -- 9. Lock existing assignment rows for this ticket and derive next sequence number safely
  PERFORM 1
  FROM public.assignments
  WHERE ticket_id = p_ticket_id
  FOR UPDATE;

  SELECT * INTO v_prev_asg
  FROM public.assignments
  WHERE ticket_id = p_ticket_id
    AND is_active = true
  ORDER BY sequence_number DESC
  LIMIT 1;

  v_has_prev_asg := FOUND;

  SELECT COALESCE(MAX(a.sequence_number), 0) + 1
  INTO v_next_asg_seq
  FROM public.assignments a
  WHERE a.ticket_id = p_ticket_id;

  IF v_next_asg_seq > 99 THEN
    RAISE EXCEPTION 'ASSIGNMENT_SEQUENCE_OVERFLOW: Ticket % exceeded 2-digit assignment sequence limit (99).', p_ticket_id
      USING ERRCODE = '22003';
  END IF;

  v_derived_assignment_id := format('ASG-%s-%s', p_ticket_id, lpad(v_next_asg_seq::text, 2, '0'));

  -- Reject duplicate caller-supplied assignment ID if it already exists
  IF p_new_assignment_id IS NOT NULL AND trim(p_new_assignment_id) <> '' THEN
    IF EXISTS (SELECT 1 FROM public.assignments WHERE assignment_id = trim(p_new_assignment_id)) THEN
      RAISE EXCEPTION 'DUPLICATE_ASSIGNMENT_ID: Assignment ID % already exists.', trim(p_new_assignment_id)
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 10. Lock existing message rows for this ticket and derive next 3-digit sequence number safely
  PERFORM 1
  FROM public.messages
  WHERE ticket_id = p_ticket_id
  FOR UPDATE;

  SELECT COALESCE(MAX(m.sequence_number), 0) + 1
  INTO v_next_msg_seq
  FROM public.messages m
  WHERE m.ticket_id = p_ticket_id;

  IF v_next_msg_seq > 999 THEN
    RAISE EXCEPTION 'MESSAGE_SEQUENCE_OVERFLOW: Ticket % exceeded 3-digit message sequence limit (999).', p_ticket_id
      USING ERRCODE = '22003';
  END IF;

  v_derived_message_id := format('MSG-%s-%s', p_ticket_id, lpad(v_next_msg_seq::text, 3, '0'));

  -- Reject duplicate caller-supplied message ID if it already exists
  IF p_message_id IS NOT NULL AND trim(p_message_id) <> '' THEN
    IF EXISTS (SELECT 1 FROM public.messages WHERE message_id = trim(p_message_id)) THEN
      RAISE EXCEPTION 'DUPLICATE_MESSAGE_ID: Message ID % already exists.', trim(p_message_id)
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 11. Lock existing lifecycle event rows for this ticket and derive next event_id safely
  PERFORM 1
  FROM public.ticket_lifecycle_events
  WHERE ticket_id = p_ticket_id
  FOR UPDATE;

  SELECT COALESCE(COUNT(*), 0) + 1
  INTO v_next_evt_seq
  FROM public.ticket_lifecycle_events e
  WHERE e.ticket_id = p_ticket_id;

  LOOP
    v_derived_event_id := format('EVT-%s-%s', p_ticket_id, lpad(v_next_evt_seq::text, 3, '0'));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.ticket_lifecycle_events WHERE event_id = v_derived_event_id
    );
    v_next_evt_seq := v_next_evt_seq + 1;
  END LOOP;

  -- 12. Deactivate previous active assignment row without overwriting its historical fields
  IF v_has_prev_asg THEN
    UPDATE public.assignments
    SET is_active = false,
        unassigned_at = v_now
    WHERE assignment_id = v_prev_asg.assignment_id;
  END IF;

  -- 13. Insert new active assignment record with lineage to previous assignment
  INSERT INTO public.assignments (
    assignment_id,
    ticket_id,
    sequence_number,
    assigned_team,
    assigned_actor_id,
    assigned_actor_role,
    routing_rule_id,
    assignment_reason,
    previous_assignment_id,
    previous_assigned_team,
    requires_human_review,
    is_active,
    assigned_at,
    unassigned_at
  ) VALUES (
    v_derived_assignment_id,
    p_ticket_id,
    v_next_asg_seq,
    v_clean_target_team,
    COALESCE(NULLIF(trim(COALESCE(p_assigned_actor_id, '')), ''), v_caller_profile_id::text),
    p_assigned_actor_role,
    v_resolved_rule_id,
    v_clean_reason,
    CASE WHEN v_has_prev_asg THEN v_prev_asg.assignment_id ELSE NULL END,
    CASE WHEN v_has_prev_asg THEN v_prev_asg.assigned_team ELSE v_ticket.current_assigned_team END,
    COALESCE(p_requires_human_review, false),
    true,
    v_now,
    NULL
  );

  -- 14. Update parent ticket's current assigned team and routing rule
  UPDATE public.tickets
  SET current_assigned_team = v_clean_target_team,
      current_routing_rule_id = v_resolved_rule_id,
      updated_at = v_now
  WHERE ticket_id = p_ticket_id;

  -- 15. Insert immutable audit record into public.ticket_lifecycle_events
  INSERT INTO public.ticket_lifecycle_events (
    event_id,
    ticket_id,
    previous_state,
    new_state,
    transition_reason,
    actor_profile_id,
    actor_role,
    actor_display_name,
    recorded_at
  ) VALUES (
    v_derived_event_id,
    p_ticket_id,
    v_ticket.lifecycle_status,
    v_ticket.lifecycle_status,
    format(
      'Reassigned from %s to %s (Rule %s): %s',
      COALESCE(v_prev_asg.assigned_team, v_ticket.current_assigned_team),
      v_clean_target_team,
      v_resolved_rule_id,
      v_clean_reason
    ),
    v_caller_profile_id,
    v_caller_role::text,
    v_caller_display_name,
    v_now
  );

  -- 16. Insert immutable system routing message into public.messages
  INSERT INTO public.messages (
    message_id,
    ticket_id,
    sequence_number,
    sender_actor_id,
    sender_profile_id,
    sender_role,
    sender_display_name,
    message_type,
    body,
    cited_policy_id,
    cited_policy_version,
    cited_article_id,
    cited_article_version,
    is_internal,
    sent_at
  ) VALUES (
    v_derived_message_id,
    p_ticket_id,
    v_next_msg_seq,
    'SYSTEM-ROUTER',
    v_caller_profile_id,
    v_caller_role::text,
    v_caller_display_name,
    'system_routing_note',
    format(
      'Ticket Reassigned (%s -> %s): %s',
      COALESCE(v_prev_asg.assigned_team, v_ticket.current_assigned_team),
      v_clean_target_team,
      v_clean_reason
    ),
    v_ticket.referenced_policy_id,
    v_ticket.referenced_policy_version,
    v_ticket.referenced_article_id,
    v_ticket.referenced_article_version,
    false,
    v_now
  );

  -- 17. Insert workspace notification with event_type = 'routing_assigned'
  IF v_ticket.requester_profile_id IS NOT NULL THEN
    v_derived_notification_id := COALESCE(
      NULLIF(trim(COALESCE(p_notification_id, '')), ''),
      format('NTF-%s-ASG-%s', p_ticket_id, lpad(v_next_asg_seq::text, 2, '0'))
    );

    INSERT INTO public.workspace_notifications (
      notification_id,
      recipient_profile_id,
      ticket_id,
      event_type,
      category,
      title,
      summary,
      policy_reference,
      is_read,
      created_at
    ) VALUES (
      v_derived_notification_id,
      v_ticket.requester_profile_id,
      p_ticket_id,
      'routing_assigned',
      'lifecycle',
      format('%s Reassigned to %s', p_ticket_id, v_clean_target_team),
      format(
        'Reassigned from %s to %s. Reason: %s',
        COALESCE(v_prev_asg.assigned_team, v_ticket.current_assigned_team),
        v_clean_target_team,
        v_clean_reason
      ),
      CASE WHEN v_ticket.referenced_policy_id IS NOT NULL
        THEN format('%s v%s', v_ticket.referenced_policy_id, v_ticket.referenced_policy_version)
        ELSE NULL
      END,
      false,
      v_now
    )
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'ticket_id', p_ticket_id,
    'assignment_id', v_derived_assignment_id,
    'sequence_number', v_next_asg_seq,
    'previous_assignment_id', v_prev_asg.assignment_id,
    'previous_assigned_team', COALESCE(v_prev_asg.assigned_team, v_ticket.current_assigned_team),
    'assigned_team', v_clean_target_team,
    'routing_rule_id', v_resolved_rule_id,
    'event_id', v_derived_event_id,
    'message_id', v_derived_message_id,
    'message_sequence_number', v_next_msg_seq,
    'notification_id', v_derived_notification_id
  );
END;
$function$;

-- Ensure function owner is postgres (which holds BYPASSRLS) so SECURITY DEFINER
-- can safely write to FORCE ROW LEVEL SECURITY tables (`assignments`, `ticket_lifecycle_events`)
-- after passing all strict in-function JWT, profile, role, and category-team validations.
ALTER FUNCTION public.atomic_reassign_ticket_workflow(
  text, text, integer, text, text, public.actor_role_type, text, text, boolean, text, integer, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.atomic_reassign_ticket_workflow(
  text, text, integer, text, text, public.actor_role_type, text, text, boolean, text, integer, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.atomic_reassign_ticket_workflow(
  text, text, integer, text, text, public.actor_role_type, text, text, boolean, text, integer, text
) TO authenticated, service_role;

COMMIT;
