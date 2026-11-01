# Deployment and Setup Guide — CampusResolve AI

## 1. Prerequisites
- Node.js version 18.x or higher (recommended: Node 20+).
- npm (v9+) or bun.
- A Supabase project (PostgreSQL).
- A Firebase project (Authentication & Google Provider enabled).
- A Google Gemini API Key (`@google/genai`).
- A Vercel account for production deployment.

## 2. Repository Setup and Dependencies
```bash
git clone https://github.com/dandetejaswini/CampusResolve-AI.git
cd CampusResolve-AI
npm install
```

## 3. Environment Variable Configuration
Copy `.env.example` to `.env` and configure your credentials:
```env
PORT=3000
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
VITE_FIREBASE_APP_ID=your-firebase-app-id

FIREBASE_ADMIN_PROJECT_ID=your-firebase-project-id
FIREBASE_ADMIN_CLIENT_EMAIL=your-service-account@iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

GEMINI_API_KEY=your-gemini-api-key
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_SHARED_SECRET=your-high-entropy-secret
```

> [!CAUTION] Never commit `.env` or `.env.local` to GitHub.

## 4. Local Development
```bash
npm run dev
```
Access the application at `http://localhost:3000`.

## 5. Running Tests and Verification
```bash
npm test
npm run lint
npm run build
npm run generate:dataset
```

## 6. Supabase Database Migration
Execute the migration scripts in your Supabase SQL Editor in numerical order:
1. `supabase/migrations/20261030000001_phase2_auth_profiles_and_rls.sql`
2. `supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql`
3. `supabase/migrations/20261030000003_phase5_atomic_workflow_rpcs.sql`

## 7. Vercel Production Deployment
1. Import the repository into Vercel.
2. Add all required environment variables under **Project Settings > Environment Variables**.
3. Deploy with default framework settings (Vite / Output directory: `dist`).
