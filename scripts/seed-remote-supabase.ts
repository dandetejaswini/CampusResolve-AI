import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  DETERMINISTIC_SEED,
  generateDeterministicDataset,
} from '../src/services/dataGenerator';

async function batchUpsert<T extends Record<string, unknown>>(
  client: any,
  table: string,
  rows: T[],
  conflictColumn: string,
  batchSize = 250
) {
  let insertedOrVerified = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await client.from(table).upsert(chunk, {
      onConflict: conflictColumn,
      ignoreDuplicates: true,
    });
    if (error) {
      throw new Error(
        `Failed upserting into public.${table} (code=${error.code}): ${error.message}`
      );
    }
    insertedOrVerified += chunk.length;
  }
  return insertedOrVerified;
}

async function main() {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://llotsqzeppiltosllxvx.supabase.co'
  ).trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY.'
    );
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Pre-flight check that Phase 3 migration has been applied on remote PostgreSQL
  const probe = await client.from('roles').select('role_id').limit(1);
  if (
    probe.status === 404 ||
    probe.error?.code === 'PGRST205' ||
    probe.error?.code === '42P01'
  ) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: 'DATABASE_SCHEMA_NOT_APPLIED',
          remoteSupabaseUrl: supabaseUrl,
          errorCode: probe.error?.code || 'HTTP_404',
          errorMessage:
            probe.error?.message ||
            "Could not find the table 'public.roles' in the schema cache",
          requiredAction:
            'Execute supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql in the Supabase SQL Editor for project llotsqzeppiltosllxvx, then re-run npm run db:seed:remote with SUPABASE_SERVICE_ROLE_KEY.',
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: 'SERVICE_ROLE_KEY_REQUIRED_FOR_BULK_SEED',
          message:
            'Bulk seeding synthetic evaluation records (is_synthetic_eval = true) requires SUPABASE_SERVICE_ROLE_KEY because RLS restricts authenticated user inserts to their own non-synthetic records (is_synthetic_eval = false).',
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const mode = process.argv.includes('--starter') ? 'starter' : 'full';
  console.log(
    `[CampusResolve AI — Remote Seed] Generating deterministic dataset (seed=${DETERMINISTIC_SEED}, mode=${mode})...`
  );
  const bundle = generateDeterministicDataset({
    seed: DETERMINISTIC_SEED,
    mode,
  });

  // Strict Parent -> Child insertion order
  const counts: Record<string, number> = {};

  // 1. Roles and Categories are already canonically provisioned by the database migration
  const { data: existingRoles } = await client.from('roles').select('role_id');
  counts.roles = existingRoles?.length || 5;

  const { data: existingCategories } = await client.from('categories').select('category_id');
  counts.categories = existingCategories?.length || 4;

  // 2. Terms must be seeded first as requesters reference primary_term_id
  counts.terms = await batchUpsert(client, 'terms', bundle.terms as any, 'term_id');

  // 3. Requesters
  counts.requesters = await batchUpsert(
    client,
    'requesters',
    bundle.requesters as any,
    'requester_id'
  );

  // 4. Policy Documents and Knowledge Articles
  counts.policy_documents = await batchUpsert(
    client,
    'policy_documents',
    bundle.policyDocuments as any,
    'policy_id'
  );
  counts.knowledge_articles = await batchUpsert(
    client,
    'knowledge_articles',
    bundle.knowledgeArticles as any,
    'article_id'
  );
  counts.policy_article_links = await batchUpsert(
    client,
    'policy_article_links',
    bundle.policyArticleLinks as any,
    'link_id'
  );

  // 5. Tickets
  counts.tickets = await batchUpsert(
    client,
    'tickets',
    bundle.tickets as any,
    'ticket_id'
  );
  counts.ticket_policy_links = await batchUpsert(
    client,
    'ticket_policy_links',
    bundle.ticketPolicyLinks as any,
    'link_id'
  );
  counts.ticket_article_links = await batchUpsert(
    client,
    'ticket_article_links',
    bundle.ticketArticleLinks as any,
    'link_id'
  );

  // 6. Ticket Lifecycle Events (mapped to DB schema: transition_reason, recorded_at)
  const mappedLifecycleEvents = bundle.ticketLifecycleEvents.map((ev) => ({
    event_id: ev.event_id,
    ticket_id: ev.ticket_id,
    previous_state: ev.previous_state,
    new_state: ev.new_state,
    transition_reason: ev.reason,
    actor_profile_id: null,
    actor_role: ev.actor_role,
    actor_display_name: ev.actor_id,
    recorded_at: ev.event_timestamp,
  }));
  counts.ticket_lifecycle_events = await batchUpsert(
    client,
    'ticket_lifecycle_events',
    mappedLifecycleEvents as any,
    'event_id'
  );

  // 7. Assignments
  counts.assignments = await batchUpsert(
    client,
    'assignments',
    bundle.assignments as any,
    'assignment_id'
  );

  // 8. Messages (mapped to DB schema: sender_actor_id, sender_display_name, sent_at, dbMessageType)
  const mappedMessages = bundle.messages.map((msg) => {
    const dbMessageType =
      msg.message_type === 'escalation_handoff'
        ? 'escalation_notice'
        : msg.message_type === 'resolution_summary'
        ? 'resolution_delivery'
        : msg.message_type;

    const policyCitation = msg.cited_policy_id
      ? `${msg.cited_policy_id}${
          msg.cited_policy_version ? ` v${msg.cited_policy_version}` : ''
        }`
      : null;

    return {
      message_id: msg.message_id,
      ticket_id: msg.ticket_id,
      sequence_number: msg.sequence_number,
      sender_actor_id: msg.sender_id,
      sender_profile_id: msg.sender_profile_id ?? null,
      sender_role: msg.sender_role,
      sender_display_name: msg.sender_name,
      message_type: dbMessageType,
      body: msg.body,
      policy_citation: policyCitation,
      cited_policy_id: msg.cited_policy_id ?? null,
      cited_policy_version: msg.cited_policy_version ?? null,
      cited_article_id: msg.cited_article_id ?? null,
      cited_article_version: msg.cited_article_version ?? null,
      is_internal: Boolean(msg.is_internal),
      sent_at: msg.created_at,
    };
  });
  counts.messages = await batchUpsert(
    client,
    'messages',
    mappedMessages as any,
    'message_id'
  );

  // 9. SLAs (mapped to DB schema)
  const mappedSlas = bundle.slas.map((s) => ({
    sla_id: s.sla_id,
    ticket_id: s.ticket_id,
    sla_rule_id: s.sla_rule_id,
    applicable_category: s.applicable_category,
    rule_classification: s.rule_classification,
    target_business_minutes: s.target_business_minutes,
    start_timestamp: s.start_timestamp,
    due_timestamp: s.due_timestamp,
    evaluated_timestamp: s.evaluated_timestamp,
    elapsed_wall_clock_minutes: s.elapsed_wall_clock_minutes,
    elapsed_business_minutes: s.elapsed_business_minutes,
    calculation_mode: s.calculation_mode,
    business_schedule_code: s.business_schedule_code,
    breach_status: s.breach_status,
    escalation_status: s.escalation_status,
    calculation_explanation: s.calculation_explanation,
    created_at: s.created_at,
  }));
  counts.slas = await batchUpsert(client, 'slas', mappedSlas as any, 'sla_id');

  // 10. Resolution Feedbacks
  counts.resolution_feedbacks = await batchUpsert(
    client,
    'resolution_feedbacks',
    bundle.resolutionFeedbacks as any,
    'feedback_id'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        seed: DETERMINISTIC_SEED,
        mode,
        upsertedRowCounts: counts,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[Remote Supabase Seed Error]:', err);
  process.exit(1);
});
