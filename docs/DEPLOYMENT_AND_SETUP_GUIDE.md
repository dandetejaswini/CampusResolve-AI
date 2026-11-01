# Deployment and Setup Guide — CampusResolve AI

- **Application Name**: CampusResolve AI
- **Live Production URL**: [https://campus-resolve-ai-red.vercel.app/](https://campus-resolve-ai-red.vercel.app/)
- **Repository**: [https://github.com/dandetejaswini/CampusResolve-AI](https://github.com/dandetejaswini/CampusResolve-AI)
- **Deployment Platform**: Vercel (Edge / Serverless Node.js + Static Client Bundle)
- **Database Engine**: Supabase Managed PostgreSQL with Row Level Security (RLS)
- **Authentication**: Dual Firebase Google Sign-In & Supabase Email/Password
- **Email Delivery**: Google Apps Script MailApp Integration with Bearer Authentication

---

## 1. System Prerequisites

- **Node.js Runtime**: Version 18.x, 20.x, or 22.x (Recommended: Node 20+ LTS).
- **Package Manager**: npm (v9+) or pnpm.
- **Supabase Cloud Project**: Dedicated PostgreSQL database instance with RLS enabled.
- **Firebase Project**: Google Sign-In enabled under Firebase Authentication.
- **Google Cloud / Gemini**: API key for Gemini 2.5 Flash (`@google/genai`).
- **Google Workspace / Gmail**: Active account for Google Apps Script email dispatch.
- **Vercel Account**: For automated continuous deployment via Git.

---

## 2. Local Repository Installation

- **Clone Repository**:
  ```bash
  git clone https://github.com/dandetejaswini/CampusResolve-AI.git
  cd CampusResolve-AI
  ```
- **Install Dependencies**:
  ```bash
  npm install
  ```
- **Verify Toolchain**:
  ```bash
  npm run build
  ```

---

## 3. Environment Variables Configuration

- **Create Local Configuration**:
  ```bash
  cp .env.example .env
  ```
- **Variable Reference Table**:

| Variable Name | Environment Scope | Required For |
|---|---|---|
| `PORT` | Local Development | Local Express / Vite dev server port (`3000`) |
| `VITE_SUPABASE_URL` | Public Client / Server | Supabase project REST & Auth URL |
| `VITE_SUPABASE_ANON_KEY` | Public Client / Server | Supabase client public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Serverless Only | Admin privileges for user claims & RLS bypass |
| `VITE_FIREBASE_API_KEY` | Public Client | Firebase web app API client key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Public Client | Firebase authentication OAuth domain |
| `VITE_FIREBASE_PROJECT_ID` | Public Client | Firebase project identifier (`campusresolveai`) |
| `VITE_FIREBASE_APP_ID` | Public Client | Firebase application ID |
| `FIREBASE_ADMIN_PROJECT_ID` | Serverless Only | Firebase Admin token verification project ID |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Serverless Only | Google Cloud service account email |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Serverless Only | Google Cloud service account private RSA key |
| `GEMINI_API_KEY` | Serverless Only | Google Gemini 2.5 Flash RAG generative model |
| `APPS_SCRIPT_WEB_APP_URL` | Serverless Only | Google Apps Script webhook endpoint URL |
| `APPS_SCRIPT_SHARED_SECRET` | Serverless Only | 32+ character bearer token for Apps Script |

- **Security Note**: Never commit `.env` or `.env.local` to version control.

---

## 4. Supabase Database Migration Setup

- **Execute SQL Migrations**: Run the following SQL scripts in numerical sequence within the Supabase SQL Editor:
  1. `supabase/migrations/20261030000001_phase2_auth_profiles_and_rls.sql`
     - Creates `public.app_profiles` unified identity table.
     - Creates `public.welcome_email_log` delivery audit table.
     - Configures Row Level Security (RLS) policies.
  2. `supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql`
     - Provisions all 11 core domain tables: tickets, messages, assignments, slas, policy_documents, knowledge_articles, terms, roles, requesters, categories, resolution_feedbacks.
     - Installs foreign keys, status enum checks, and composite index constraints.
  3. `supabase/migrations/20261030000003_phase5_atomic_workflow_rpcs.sql`
     - Installs `atomic_reassign_ticket_workflow` PostgreSQL stored procedure.
     - Guarantees ACID compliance across assignments, lifecycle events, and audit logs.

---

## 5. Google Apps Script Welcome Email Setup

- **Step 1 — Create Project**:
  - Sign in to [https://script.google.com/](https://script.google.com/) with institutional Google account.
  - Create new project named `CampusResolve AI - Welcome Email Service`.
- **Step 2 — Paste Code**:
  - Replace `Code.gs` contents with code from `google-apps-script/WelcomeEmailWebApp.gs`.
- **Step 3 — Set Script Properties**:
  - Open **Project Settings → Script Properties**.
  - Add `APPS_SCRIPT_SHARED_SECRET`: Cryptographically strong random secret.
  - Add `EXPECTED_SENDER_EMAIL`: Institutional mailbox address.
  - Add `APPLICATION_BASE_URL`: `https://campus-resolve-ai-red.vercel.app`.
- **Step 4 — Deploy Web App**:
  - Click **Deploy → New Deployment → Web App**.
  - Execute as: `Me` (mailbox owner).
  - Who has access: `Anyone` (authenticated via shared secret header).
  - Authorize Gmail `MailApp` permissions and copy the Web App URL.
- **Step 5 — Link in Vercel**:
  - Add `APPS_SCRIPT_WEB_APP_URL` and `APPS_SCRIPT_SHARED_SECRET` to Vercel Environment Variables.

---

## 6. Vercel Production Deployment

- **Step 1 — Connect Repository**:
  - Link `https://github.com/dandetejaswini/CampusResolve-AI` to Vercel.
- **Step 2 — Configure Build Settings**:
  - Framework Preset: `Vite`
  - Build Command: `npm run build`
  - Output Directory: `dist`
  - Node.js Version: `20.x` or `22.x`
- **Step 3 — Input Environment Variables**:
  - Add all client (`VITE_*`) and server-side secret variables in Vercel project settings.
- **Step 4 — Deploy & Verify**:
  - Trigger deployment.
  - Confirm live status at [https://campus-resolve-ai-red.vercel.app/](https://campus-resolve-ai-red.vercel.app/).

---

## 7. Verification and Testing Commands

- **Unit and Workflow Tests**:
  - `npm test`: Executes complete Node.js test suite across all workflow phases.
- **TypeScript Type Verification**:
  - `npx tsc --noEmit`: Verifies zero type errors across client and server.
- **Synthetic Dataset Regeneration**:
  - `npm run generate:dataset`: Deterministically generates reference 5,000 tickets, 200 KB articles, and 24 policies.
- **Local Dev Server Execution**:
  - `npm run dev`: Boots local development server on `http://localhost:3000`.
