# CampusResolve AI — Authentication, Identity Architecture & Email Setup Guide

## 1. Unified Identity Architecture

CampusResolve AI supports two authentication providers that connect to a unified application identity table: `public.app_profiles`.

| Field | Description |
|---|---|
| `id` | Unique application profile ID. |
| `auth_provider` | Authentication provider: Supabase Email or Firebase Google. |
| `provider_subject` | Unique user ID from the authentication provider. |
| `verified_email` | Verified email address. |
| `email_verified` | Email verification status. |
| `display_name` | User's display name. |
| `department` | Academic department or administrative unit. |
| `actor_role` | Application role. Defaults to `learner` during registration. |
| `requested_role_note` | Optional role request for administrative verification. |
| `account_status` | Account status: pending, active, suspended, or archived. |
| `welcome_email_sent_at` | Welcome email dispatch timestamp. |
| `created_at` / `updated_at` | Record timestamps. |

### Welcome Email Delivery Log

The `public.welcome_email_log` table tracks welcome email delivery.

| Field | Description |
|---|---|
| `id` | Unique delivery log ID. |
| `profile_id` | Associated application profile ID. |
| `recipient_email` | Verified recipient email. |
| `email_type` | Welcome email event type. |
| `auth_provider` | Authentication provider. |
| `sender_email` | Configured sender address. |
| `delivery_status` | Current email delivery status. |
| `attempt_count` | Number of delivery attempts. |
| `failure_details` | Error information, if delivery fails. |
| `created_at` / `updated_at` | Log timestamps. |
| `sent_at` | Successful email delivery timestamp. |

---

## 2. Google Apps Script and Gmail Setup

### Step 1: Open Google Apps Script

1. Sign in using the dedicated application email account.
2. Open https://script.google.com/.
3. Click **New Project**.

### Step 2: Create the Email Automation Project

1. Rename the project to `CampusResolve AI - Welcome Email Service`.
2. Open the default `Code.gs` file.

### Step 3: Add the Apps Script Code

1. Copy the contents of `google-apps-script/WelcomeEmailWebApp.gs`.
2. Replace the contents of `Code.gs`.
3. Save the project.

### Step 4: Configure Script Properties

Open **Project Settings → Script Properties**.

Add the following properties:

| Property | Value |
|---|---|
| `APPS_SCRIPT_SHARED_SECRET` | A randomly generated secret of at least 32 characters. |
| `EXPECTED_SENDER_EMAIL` | Your configured application sender email. |
| `APPLICATION_BASE_URL` | Your deployed application URL. |

Generate a secure random secret locally:

    openssl rand -hex 32

Never publish or commit the generated secret.

### Step 5: Deploy as a Web App

1. Click **Deploy → New Deployment**.
2. Select **Web App**.
3. Add the description: `CampusResolve AI Welcome Email Webhook`.
4. Configure the deployment.

### Step 6: Configure Deployment Access

- **Execute as:** Me (the dedicated email account).
- **Who has access:** Anyone, if required for server-to-server integration.
- Authorize the required email-sending permissions.
- Deploy the application.
- Copy the generated Web App URL.

The endpoint must validate the shared secret before processing requests. Never expose the secret in frontend code or public repositories.

### Step 7: Configure Server Environment Variables

Open **Vercel → Project → Settings → Environment Variables**.

Add:

| Variable | Value |
|---|---|
| `APPS_SCRIPT_WEB_APP_URL` | Your deployed Apps Script Web App URL. |
| `APPS_SCRIPT_SHARED_SECRET` | The same secret configured in Script Properties. |
| `APPLICATION_BASE_URL` | Your deployed application URL. |

These variables must remain server-side. Do not prefix them with `VITE_`.

### Step 8: Configure the Application URL

Set `APPLICATION_BASE_URL` to your deployed application URL.

The welcome email uses this value to generate the sign-in link:

`<APPLICATION_BASE_URL>/sign-in`

### Step 9: Test Welcome Email Delivery

1. Register a new account through `/sign-up` or Google Sign-In.
2. Complete the required account verification.
3. The application calls `/api/auth/welcome-email`.
4. The backend verifies the authenticated user and application profile.
5. The backend sends an authenticated request to Google Apps Script.
6. Apps Script dispatches the welcome email.

### Step 10: Verify Delivery and Duplicate Prevention

Check the following Supabase records:

- `public.welcome_email_log`
- `public.app_profiles`

Verify that:

- The delivery status is `sent` after successful delivery.
- The attempt count is recorded.
- The `welcome_email_sent_at` timestamp is populated.
- Subsequent logins do not trigger another welcome email.
- Apps Script prevents duplicate sends using its persistent script properties.

---

## 3. Supabase and Firebase Setup Checklist

1. **Supabase Migration:** Run `20261030000001_phase2_auth_profiles_and_rls.sql` in the Supabase SQL Editor, if it has not already been applied.

2. **Supabase Third-Party Authentication:** Configure Firebase Authentication as a third-party identity provider using your own Firebase project details.

3. **Firebase Authorized Domains:** Open Firebase Console → Authentication → Settings → Authorized Domains. Add:
   - `localhost`
   - Your deployed Vercel domain.

4. **Firebase Admin Configuration:** Add the following server-only environment variables in Vercel:

   - `FIREBASE_ADMIN_PROJECT_ID`
   - `FIREBASE_ADMIN_CLIENT_EMAIL`
   - `FIREBASE_ADMIN_PRIVATE_KEY`

5. **Firebase Claim Endpoint:** The `/api/auth/firebase-claim` endpoint verifies Firebase users and assigns the required authenticated claim for Supabase RLS.

6. **Security:** Never commit Firebase service account files, private keys, API secrets, or shared webhook secrets to GitHub.

---

## 4. Environment Variable Security

Keep all sensitive configuration in your local `.env` file or Vercel Environment Variables.

Never publish:

- Supabase service-role keys.
- Firebase Admin private keys.
- Apps Script shared secrets.
- Gemini API keys.
- Private service account credentials.

The `.env.example` file should contain placeholder values only.
