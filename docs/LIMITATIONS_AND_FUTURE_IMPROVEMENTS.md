# Limitations and Future Improvements — CampusResolve AI

## 1. Implemented Features
- Full dual-provider authentication (Firebase Google Sign-In & Supabase Email/Password).
- 11-table Supabase PostgreSQL relational schema with Row Level Security (RLS).
- Automated ticket lifecycle state machine across 7 stages (draft, submitted, under_review, policy_verified, escalated, resolved, closed).
- Configurable business-hour SLA calculation and escalation review workflows.
- RAG policy retrieval and escalation citation matching using Google Gemini 2.5 Flash with deterministic fallback.
- 112 automated unit and integration tests passing successfully.

## 2. Technical Limitations
- **Browser E2E Automation:** Headless browser automation (Playwright/Cypress) is not installed in the preview runtime; UI validation relies on component unit tests and manual browser inspection.
- **Email Delivery:** Welcome email dispatch relies on a Google Apps Script Web App acting as a bridge to Gmail (`campusresolveai@gmail.com`), subject to Google Apps Script daily execution quotas.
- **RAG Latency:** External Gemini API calls may experience network latency or rate limits, which are mitigated by the 12-second `Promise.race` timeout and deterministic policy fallback.

## 3. Future Improvements
- Implement real-time WebSocket subscriptions for instant notification delivery across active workspace sessions.
- Add multi-language localization for international student populations.
- Expand automated end-to-end test coverage with Playwright.
- Integrate advanced analytics dashboard for administrative workload reporting.
