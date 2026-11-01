import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnvConfig } from './envConfig';

let supabaseAuthClientInstance: SupabaseClient | null = null;

/**
 * Flow A — Standard Supabase client used for Email/Password authentication,
 * session management, email verification, password recovery, and RLS-backed
 * queries when authenticated with a Supabase Auth session.
 */
export function getSupabaseAuthClient(): SupabaseClient | null {
  const config = getSupabaseEnvConfig();
  if (!config.isConfigured) {
    return null;
  }

  if (!supabaseAuthClientInstance) {
    supabaseAuthClientInstance = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseAuthClientInstance;
}

/**
 * Flow B — Official Supabase Third-Party Authentication client for Firebase Auth.
 * Reference: https://supabase.com/docs/guides/auth/third-party/firebase-auth
 *
 * Uses the `accessToken` callback to attach the current Firebase Google ID token
 * to all Supabase PostgreSQL / PostgREST requests so Row Level Security (RLS)
 * evaluates `auth.jwt()` against the verified `campusresolveai` Firebase token.
 */
export function createSupabaseFirebaseDataClient(
  getFirebaseAccessToken: () => Promise<string | null>
): SupabaseClient | null {
  const config = getSupabaseEnvConfig();
  if (!config.isConfigured) {
    return null;
  }

  return createClient(config.url, config.publishableKey, {
    accessToken: async () => {
      return await getFirebaseAccessToken();
    },
  });
}
