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
  counts.roles = await batchUpsert(client, 'roles', bundle.roles as any, 'role_id');
  counts.terms = await batchUpsert(client, 'terms', bundle.terms as any, 'term_id');
  counts.categories = await batchUpsert(
    client,
    'categories',
    bundle.categories as any,
    'category_id'
  );
  counts.requesters = await batchUpsert(
    client,
    'requesters',
    bundle.requesters as any,
    'requester_id'
  );
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
  counts.ticket_lifecycle_events = await batchUpsert(
    client,
    'ticket_lifecycle_events',
    bundle.ticketLifecycleEvents as any,
    'event_id'
  );
  counts.assignments = await batchUpsert(
    client,
    'assignments',
    bundle.assignments as any,
    'assignment_id'
  );
  counts.messages = await batchUpsert(
    client,
    'messages',
    bundle.messages as any,
    'message_id'
  );
  counts.slas = await batchUpsert(client, 'slas', bundle.slas as any, 'sla_id');
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
