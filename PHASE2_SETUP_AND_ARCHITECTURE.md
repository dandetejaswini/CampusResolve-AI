# CampusResolve AI — Phase 2 Authentication, Identity Architecture & Google Apps Script + Gmail Setup Guide

## 1. Unified Identity Mapping & Database Relationships

CampusResolve AI supports two distinct authentication providers that converge into a single application identity table (`public.app_profiles`):

| Field | PostgreSQL Type | Description |
| :--- | :--- | :--- |
| `id` | `uuid` (`PRIMARY KEY`) | Internal immutable application profile ID (`gen_random_uuid()`). All future Phase 3+ tables (`requests`, `messages`, `notifications`) reference `app_profiles(id)`. |
| `auth_provider` | `auth_provider_type` | `'supabase_email'` or `'firebase_google'`. Derived from the verified JWT `iss` claim. |
| `provider_subject` | `text` | Provider-specific subject (`auth.jwt() ->> 'sub'`). Holds a UUID string for Supabase Auth users and a 28-character UID for Firebase Auth users. |
| `verified_email` | `text` | Lowercase email address verified by the provider. |
| `email_verified` | `boolean` | Indicates whether the authentication provider has verified the email address. |
| `display_name` | `text` | User's display name. |
| `department` | `text` | Academic department or administrative unit. |
| `actor_role` | `actor_role_type` | Production RBAC role (`learner`, `instructor`, `academic_administrator`, `support_staff`, `platform_administrator`). **Always defaults to `learner` on registration.** |
| `requested_role_note` | `text` | Optional unprivileged note recording the role selected during Sign Up for later administrative verification. |
| `account_status` | `account_status_type` | `pending_verification`, `active`, `suspended`, or `archived`. |
| `welcome_email_sent_at` | `timestamptz` | Timestamp when the one-time activation welcome email was dispatched via Google Apps Script (`campusresolveai@gmail.com`). |
| `created_at` / `updated_at` | `timestamptz` | Audit timestamps. |

### Persistent Welcome Email Delivery Log (`public.welcome_email_log`)

| Field | PostgreSQL Type | Description |
| :--- | :--- | :--- |
| `id` | `uuid` (`PRIMARY KEY`) | Delivery log ID (`gen_random_uuid()`). |
| `profile_id` | `uuid` (`UNIQUE`, FK → `app_profiles.id`) | Application user ID. Enforces at most one welcome email record per user. |
| `recipient_email` | `text` | Verified recipient email address. |
| `email_type` | `text` | Fixed to `'welcome_email'`. Composite `UNIQUE (profile_id, email_type)`. |
| `auth_provider` | `auth_provider_type` | `'supabase_email'` or `'firebase_google'`. |
| `sender_email` | `text` | Defaults to `'campusresolveai@gmail.com'`. |
| `delivery_status` | `text` | `'pending'`, `'request_accepted'`, `'apps_script_succeeded'`, `'sent'`, `'failed'`, or `'skipped_unconfigured'`. |
| `attempt_count` | `integer` | Tracks retry attempts if a previous delivery failed. |
| `failure_details` | `text` | Error details recorded when Apps Script or network delivery fails. |
| `created_at` / `updated_at` | `timestamptz` | Log creation and last attempt timestamps. |
| `sent_at` | `timestamptz` | Populated only when `MailApp.sendEmail` succeeds in Google Apps Script. |

---

## 2. Step-by-Step Google Apps Script + Gmail Setup (`campusresolveai@gmail.com`)

### Step 1: Open Google Apps Script using `campusresolveai@gmail.com`
1. Sign in to Google in your browser exclusively using the dedicated notification account: **`campusresolveai@gmail.com`**.
2. Open [https://script.google.com/](https://script.google.com/).

### Step 2: Create the CampusResolve AI Email Automation Project
1. Click **New project** in the top-left corner.
2. Rename the project from *Untitled project* to **`CampusResolve AI — Welcome Email Service`**.

### Step 3: Add the Apps Script Code
1. Open the default `Code.gs` file in the editor and replace its entire contents with the code from [`/google-apps-script/WelcomeEmailWebApp.gs`](./google-apps-script/WelcomeEmailWebApp.gs).
2. Click the **Save project** icon (or press `Ctrl+S` / `Cmd+S`).

### Step 4: Set Script Properties Securely
1. In the left sidebar of Google Apps Script, click **Project Settings** (the gear icon).
2. Scroll down to **Script Properties** and click **Add script property**.
3. Add the following properties:
   - `APPS_SCRIPT_SHARED_SECRET`: Generate a long random secret (at least 32 characters, e.g., `openssl rand -hex 32`).
   - `EXPECTED_SENDER_EMAIL`: `campusresolveai@gmail.com`
   - `APPLICATION_BASE_URL`: Your deployed application URL (e.g., `https://your-app.vercel.app`).
4. Click **Save script properties**.

### Step 5: Deploy the Script as a Web App
1. In the top-right corner of the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Enter description: `CampusResolve AI Welcome Email Webhook v1`.

### Step 6: Configure Deployment Access for the Trusted Integration
1. Set **Execute as**: **`Me (campusresolveai@gmail.com)`** so `MailApp.sendEmail` sends from `campusresolveai@gmail.com`.
2. Set **Who has access**: **`Anyone`** (required so your Vercel Serverless Function `/api/auth/welcome-email` can send server-to-server HTTP POST requests without interactive browser cookies; requests are authenticated via your `APPS_SCRIPT_SHARED_SECRET` inside `doPost`).
3. Click **Deploy** and complete the Google authorization prompt for `campusresolveai@gmail.com` to allow sending email (`script.send_mail`).
4. Copy the generated **Web app URL** (`https://script.google.com/macros/s/.../exec`).

### Step 7: Add the Web App URL and Shared Secret to Vercel Server-Side Environment Variables
1. Open your project in the **Vercel Dashboard → Settings → Environment Variables** (or local `.env.local`).
2. Add these **server-only** variables (do **NOT** prefix them with `VITE_`):
   - `APPS_SCRIPT_WEB_APP_URL` = `<Your Web App URL from Step 6>`
   - `APPS_SCRIPT_SHARED_SECRET` = `<Your exact secret from Step 4>`

### Step 8: Configure the Application Base URL
1. Set `APPLICATION_BASE_URL` in Vercel Environment Variables to your actual deployed URL (e.g. `https://campusresolve-ai.vercel.app`).
2. The welcome email template uses this URL to construct the **Sign In to CampusResolve AI** button (`<APPLICATION_BASE_URL>/sign-in`).

### Step 9: Test a Welcome Email
1. Register a new account via `/sign-up` (Supabase Email/Password) or `/sign-in` → **Continue with Google** (Firebase Google Auth).
2. Upon account verification and first profile activation, the frontend calls `/api/auth/welcome-email` with `Authorization: Bearer <jwt>`.
3. The backend verifies your identity against `public.app_profiles` in Supabase, forwards the signed request to Google Apps Script, and dispatches the Warm-Neutral HTML welcome email from `campusresolveai@gmail.com`.

### Step 10: Verify Duplicate Prevention and Delivery Logs
1. Refresh the browser, sign out and sign back in, or trigger a token refresh.
2. Inspect `public.welcome_email_log` and `public.app_profiles.welcome_email_sent_at` in Supabase:
   - `welcome_email_log.delivery_status` is `'sent'` with `attempt_count = 1`.
   - Subsequent logins or refreshes detect `welcome_email_sent_at IS NOT NULL` (and `delivery_status = 'sent'`) and skip re-sending.
   - Even if a duplicate HTTP POST reaches Google Apps Script, `PropertiesService.getScriptProperties()` (`WELCOME_SENT_<profileId>`) blocks any second email.

---

## 3. Supabase & Firebase Setup Checklist

1. **Supabase SQL Migration**: Run `/supabase/migrations/20261030000001_phase2_auth_profiles_and_rls.sql` in the Supabase SQL Editor.
2. **Supabase Third-Party Auth**: Under **Authentication → Third-Party Auth**, add **Firebase Auth** with Firebase Project ID **`campusresolveai`**.
3. **Firebase Authorized Domains (`campusresolveai` / `671221539968`)**: Under **Authentication → Settings → Authorized domains**, add `localhost` and your Vercel domain.
4. **Firebase Admin Claim Endpoint (`/api/auth/firebase-claim`)**: Configure server-only `FIREBASE_ADMIN_PROJECT_ID="campusresolveai"`, `FIREBASE_ADMIN_CLIENT_EMAIL`, and `FIREBASE_ADMIN_PRIVATE_KEY` in Vercel so Firebase Google users receive `{ role: "authenticated" }` for Supabase RLS on the free Spark plan.
