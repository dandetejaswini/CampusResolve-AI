export interface SupabaseEnvConfig {
  url: string;
  publishableKey: string;
  isConfigured: boolean;
  missingVars: string[];
}

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  isConfigured: boolean;
  missingVars: string[];
}

const PLACEHOLDER_PATTERNS = [
  'your-supabase-project-ref',
  'your_supabase_anon_or_publishable_key',
  'your_firebase_web_api_key',
  'your_firebase_web_app_id',
  'MY_GEMINI_API_KEY',
];

function readEnvVar(name: string): string {
  const metaEnv =
    typeof import.meta !== 'undefined' && (import.meta as any).env
      ? ((import.meta as any).env[name] as string | undefined)
      : undefined;
  const nodeEnv =
    typeof process !== 'undefined' && process.env
      ? process.env[name]
      : undefined;
  return (metaEnv ?? nodeEnv ?? '').trim();
}

function isRealValue(val: string): boolean {
  if (!val) return false;
  return !PLACEHOLDER_PATTERNS.some((pattern) =>
    val.toLowerCase().includes(pattern.toLowerCase())
  );
}

export function getSupabaseEnvConfig(): SupabaseEnvConfig {
  const url = readEnvVar('VITE_SUPABASE_URL');
  const publishableKey = readEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY');

  const missingVars: string[] = [];
  if (!isRealValue(url)) missingVars.push('VITE_SUPABASE_URL');
  if (!isRealValue(publishableKey)) missingVars.push('VITE_SUPABASE_PUBLISHABLE_KEY');

  return {
    url,
    publishableKey,
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}

export function getFirebaseEnvConfig(): FirebaseEnvConfig {
  const apiKey = readEnvVar('VITE_FIREBASE_API_KEY');
  const authDomain = readEnvVar('VITE_FIREBASE_AUTH_DOMAIN');
  const projectId = readEnvVar('VITE_FIREBASE_PROJECT_ID');
  const storageBucket = readEnvVar('VITE_FIREBASE_STORAGE_BUCKET');
  const messagingSenderId = readEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID');
  const appId = readEnvVar('VITE_FIREBASE_APP_ID');

  const missingVars: string[] = [];
  if (!isRealValue(apiKey)) missingVars.push('VITE_FIREBASE_API_KEY');
  if (!isRealValue(authDomain)) missingVars.push('VITE_FIREBASE_AUTH_DOMAIN');
  if (!isRealValue(projectId)) missingVars.push('VITE_FIREBASE_PROJECT_ID');
  if (!isRealValue(storageBucket)) missingVars.push('VITE_FIREBASE_STORAGE_BUCKET');
  if (!isRealValue(messagingSenderId)) missingVars.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
  if (!isRealValue(appId)) missingVars.push('VITE_FIREBASE_APP_ID');

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}
