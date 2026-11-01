# CampusResolve AI — Authentication, Identity Architecture & Email Setup Guide

## 1. Unified Identity Architecture
- **Dual Authentication**: Connects Supabase Email and Firebase Google Sign-In to a single identity table: `public.app_profiles`.
- **Identity Schema**:

| Field | Description |
|---|---|
| `id` | Unique application profile ID. |
| `auth_provider` | Provider: `supabase_email` or `firebase_google`. |
| `provider_subject` | Unique external user ID from the provider. |
| `verified_email` | Institutional verified email address. |
| `email_verified` | Email verification confirmation flag. |
| `display_name` | User's full name. |
| `department` | Academic department or administrative unit. |
| `actor_role` | Application role (defaults to `learner`). |
| `requested_role_note` | Optional role escalation request for admin approval. |
| `account_status` | Status: `pending`, `active`, `suspended`, or `archived`. |
| `welcome_email_sent_at` | Timestamp of first welcome email dispatch. |
| `created_at` / `updated_at` | Audit timestamps. |

### Welcome Email Delivery Audit Log
- **Audit Table**: `public.welcome_email_log` records each email dispatch attempt.

| Field | Description |
|---|---|
| `id` | Unique delivery log ID. |
| `profile_id` | Associated application profile ID. |
| `recipient_email` | Verified recipient email. |
| `email_type` | Event trigger (e.g. `welcome_email`). |
| `auth_provider` | Originating authentication provider. |
| `sender_email` | Configured administrative sender address. |
| `delivery_status` | Status (`sent`, `failed`, `skipped`). |
| `attempt_count` | Number of dispatch attempts. |
| `failure_details` | Error stack trace if delivery fails. |
| `sent_at` | Exact delivery timestamp. |

---

## 2. Google Apps Script and Gmail Setup

### Step 1: Open Google Apps Script
- Sign in using the designated institutional email account.
- Navigate to [https://script.google.com/](https://script.google.com/).
- Click **New Project**.

### Step 2: Initialize Project
- Rename the project to `CampusResolve AI - Welcome Email Service`.
- Open the editor on `Code.gs`.

### Step 3: Insert Automation Script
- Copy the code from `google-apps-script/WelcomeEmailWebApp.gs`.
- Paste into `Code.gs` and save the script.

### Step 4: Configure Script Properties
- Open **Project Settings → Script Properties**.
- Add the following key-value pairs:
  - `APPS_SCRIPT_SHARED_SECRET`: Secure random secret of 32+ characters (`openssl rand -hex 32`).
  - `EXPECTED_SENDER_EMAIL`: Configured institutional sender address.
  - `APPLICATION_BASE_URL`: Live deployed application URL.
- *Security Requirement*: Never commit or publish the shared secret.

### Step 5: Deploy Web App
- Click **Deploy → New Deployment**.
- Select type: **Web App**.
- Description: `CampusResolve AI Welcome Email Webhook`.

### Step 6: Access & Permission Grants
- **Execute as**: `Me` (the dedicated institutional mailbox).
- **Who has access**: `Anyone` (secured cryptographically via bearer shared secret).
- Authorize requested Gmail sending permissions.
- Deploy and copy the resulting Web App URL.

### Step 7: Configure Server Environment Variables
- Open **Vercel → Project Settings → Environment Variables**.
- Configure the following server-side variables:
  - `APPS_SCRIPT_WEB_APP_URL`: Deployed Google Apps Script endpoint.
  - `APPS_SCRIPT_SHARED_SECRET`: Secret matching the Apps Script property.
  - `APPLICATION_BASE_URL`: Production application URL.
- *Security Requirement*: Never prefix these server secrets with `VITE_`.

### Step 8: Configure Base URL Link Routing
- Set `APPLICATION_BASE_URL` to your production domain (e.g. `https://campus-resolve-ai.vercel.app`).
- Generates sign-in deep links: `<APPLICATION_BASE_URL>/sign-in`.

### Step 9: Verify Email Dispatch Flow
- Register a test account at `/sign-up` or via Google Sign-In.
- Frontend dispatches authenticated POST to `/api/auth/welcome-email`.
- Serverless handler validates caller session and invokes Apps Script webhook.
- Apps Script transmits styled welcome notification to student mailbox.

### Step 10: Deduplication & Idempotency Checks
- Check database records in `public.welcome_email_log` and `public.app_profiles`.
- Verify delivery status records as `sent`.
- Verify `welcome_email_sent_at` timestamp is populated.
- Confirm repeated sign-ins do not trigger redundant duplicate emails.

---

## 3. Cloud Provider Setup Checklist
- **Supabase Migration**:
  - Run SQL migrations in numerical order via Supabase SQL Editor.
- **Firebase OAuth Setup**:
  - Enable Google Sign-In under Firebase Authentication.
  - Whitelist `localhost` and your Vercel deployment domain in Authorized Domains.
- **Firebase Admin Credentials**:
  - Add `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, and `FIREBASE_ADMIN_PRIVATE_KEY` in Vercel settings.
- **Token Verification Bridge**:
  - `/api/auth/firebase-claim` handles dual-token verification and sets Supabase RLS claims.

---

## 4. Environment Variable Security Guidelines
- **Strict Server Separation**:
  - Store private secrets exclusively in server-side Vercel Environment Variables.
  - Never prefix service keys with `VITE_`.
- **Restricted Credentials**:
  - Never commit Supabase service-role keys.
  - Never commit Firebase private keys or service account JSON files.
  - Never commit Gemini API keys or webhook secrets.
- **Example Template**:
  - `.env.example` must contain only generic placeholder values.
