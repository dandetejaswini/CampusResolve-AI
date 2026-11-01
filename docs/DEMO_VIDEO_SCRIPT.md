# CampusResolve AI — Official 2–3 Minute Video Demonstration Script & Production Plan

**Target Duration:** 2 minutes 45 seconds (165 seconds)  
**Resolution:** 1080p (1920x1080) at 60 FPS  
**Target Audience:** YottaFlex 72-Hour Challenge Evaluation Panel, Academic CTOs, Higher Education Administrators  
**Audio Track:** Clear spoken voiceover with subtle background ambient track (ducked at -24 dB during voiceover)  
**Status:** Pre-Production Demonstration Script & Recording Checklist (Ready for Screen Capture)  

---

## Timeline & Scene Overview

| Scene | Section Title | Timestamp | Duration | Key Visual & On-Screen Demonstration |
|---|---|---|---|---|
| **0** | **Opening & Platform Overview** | `0:00 – 0:30` | 30s | Landing Page, Problem Statement, Role Perspective Switcher |
| **1** | **Normal Ticket Intake & Auto-Routing** | `0:30 – 1:00` | 30s | New Request Form, Instant 4-Category Triage, Dynamic Business SLA, My Requests view |
| **2** | **Policy-Grounded AI Assistant** | `1:00 – 1:30` | 30s | AI Assistant interactive prompt, Grounded Answer with POL-FINAID-2026-002 v2.0 & Section 4.2 Citation |
| **3** | **Expired-Policy Anomaly Rejection** | `1:30 – 2:00` | 30s | Querying superseded 10-day rule, Red Anomaly Banner, Outdated Source Rejection |
| **4** | **Human Review & Administrative Escalation**| `2:00 – 2:30` | 30s | Ambiguous / exception request, Escalation handoff to Academic Senate Review Board |
| **5** | **Evaluation Metrics & Closing Summary** | `2:30 – 2:45` | 15s | Benchmarking Dashboard, 5 Anomaly Detection Rates, Value Summary |

---

## Detailed Storyboard & Voiceover Narration

### Scene 0: Opening & Architecture Overview (0:00 – 0:30)
- **Time:** `0:00 – 0:30` (30 seconds)
- **Visuals:**
  1. Open on CampusResolve AI live homepage with clean institutional dark header and serif headline: *"Intelligent Academic Request Routing & Policy-Grounded Resolution"*.
  2. Pan down to the architecture badges: *5,000 Deterministic Benchmark Tickets*, *20,000 Messages*, *24 Governing Policy Documents*, *Strict RLS & Multi-Actor Isolation*.
  3. Click into **Open Workspace** and highlight the **Role Perspective Switcher** in the top navigation bar (`Learner`, `Instructor`, `Academic Administrator`, `Support Staff`, `Platform Administrator`).
- **Narration Script:**
  > *"Welcome to CampusResolve AI. In modern universities, academic support is plagued by fragmented email queues, slow manual routing, outdated policy citations, and missed deadlines. CampusResolve AI solves this with an enterprise-grade platform uniting deterministic rule-based triage, date-aware policy retrieval, and a business-hour SLA engine. Today, we'll walk through four core operational workflows in under three minutes."*

---

### Scene 1: Normal Ticket Submission, Classification & SLA (0:30 – 1:00)
- **Time:** `0:30 – 1:00` (30 seconds)
- **Visuals:**
  1. Under the **Learner** perspective, click **New Academic Request**.
  2. Type in Subject: `Unable to select CS-101 lab section due to prerequisite hold`
  3. Type in Description: `I completed MATH-215 last term with an A-, but the portal is showing an unverified prerequisite hold for the Fall 2026 enrollment window.`
  4. Select Category: `Registration`. Priority dynamically badges as `Time-Sensitive Academic Priority`. Click **Submit Academic Request**.
  5. The screen immediately transitions to **My Requests**. Point out the generated ticket `TKT-2026-005001`:
     - Classified Category: `Registration`
     - Auto-assigned Team: `Office of the University Registrar`
     - Target SLA: `1,200 Business Minutes` (excluding weekends and overnight hours)
     - Initial Lifecycle Status: `Under Review`
- **Narration Script:**
  > *"Here, a student files a registration petition. In milliseconds, our intake engine resolves the inquiry to Registration, binds it to the Office of the University Registrar, and computes a reproducible business-hour SLA that automatically pauses over weekends and institutional holidays. The request appears instantly on the student ledger with full traceability."*

---

### Scene 2: Policy-Grounded AI Assistant & Authoritative Citations (1:00 – 1:30)
- **Time:** `1:00 – 1:30` (30 seconds)
- **Visuals:**
  1. Click **AI Policy Assistant** in the workspace sidebar.
  2. Type inquiry: `What is the deadline in business days to submit a Satisfactory Academic Progress (SAP) appeal under financial aid regulations?`
  3. Click **Ask AI Assistant**.
  4. Show the response card rendering:
     - Clear answer stating: *15 business days following formal disqualification notification, with a minimum 2.0 cumulative GPA*.
     - Cited Policy Badge: `[POL-FINAID-2026-002 v2.0, Section 4.2 (Current)]` (Effective: July 1, 2026).
     - Linked Knowledge Article: `[KB-000001 v2.0]`.
     - Confidence Score: `96.0%`.
- **Narration Script:**
  > *"Next, the AI Policy Assistant. When a student queries financial aid rules, the system retrieves only active, currently effective documents. It cites POL-FINAID-2026-002 version 2.0 and Section 4.2, delivering a verifiable, hallucination-free response with exact effective dates and policy provisions."*

---

### Scene 3: Anomaly Detection — Expired Policy Citation Rejection (1:30 – 2:00)
- **Time:** `1:30 – 2:00` (30 seconds)
- **Visuals:**
  1. In the AI Assistant prompt box, enter: `Under legacy policy POL-FINAID-2026-001 v1.0, do I still have 10 calendar days to submit my appeal?`
  2. Click **Ask AI Assistant**.
  3. Highlight the red caution callout:
     - *EXPIRED / SUPERSEDED POLICY REJECTED*
     - Rejection notice: `POL-FINAID-2026-001 v1.0 expired on 2026-06-30 and was superseded by POL-FINAID-2026-002 v2.0 on 2026-07-01.`
     - System advises that the current requirement is 15 business days, completely blocking the hallucinated citation of outdated guidance.
- **Narration Script:**
  > *"Here is Scenario 1 from the challenge: an inquiry citing an outdated policy. Instead of uncritically generating a plausible answer, CampusResolve AI's date-aware guardrail identifies that version 1.0 expired in June 2026 and was superseded by version 2.0. It rejects the expired citation and presents the current standard."*

---

### Scene 4: Ambiguous Inquiry & Human Administrative Escalation (2:00 – 2:30)
- **Time:** `2:00 – 2:30` (30 seconds)
- **Visuals:**
  1. In the AI Assistant or New Request form, type: `I missed the Week 8 drop deadline due to an emergency hospitalization and need a retroactive tuition refund and grade expungement.`
  2. System detects:
     - Multi-issue request spanning Registration and Financial Aid.
     - Retroactive exception outside routine support staff delegation.
  3. Click **Escalate to Review Board**.
  4. Switch Role Perspective to **Academic Administrator**:
     - The escalated petition appears immediately in the **Administrative Review Queue**.
     - Notice the reassignment record (`ASG-...-02`) routing the ticket to the *Academic Senate Registration Review Board*.
     - Full immutable lifecycle history shows: `Submitted -> Under Review -> Escalated`.
- **Narration Script:**
  > *"When an inquiry involves retroactive petitions, medical exceptions, or ambiguous multi-issue claims, CampusResolve AI avoids automated guesswork. It flags the exception, generates focused clarification prompts, and executes an atomic reassignment to the Senior Academic Senate Review Board with an unbroken audit trail."*

---

### Scene 5: Benchmark Evaluation, Baseline Comparison & Closing (2:30 – 2:45)
- **Time:** `2:30 – 2:45` (15 seconds)
- **Visuals:**
  1. Open the **Benchmarking & Evaluation Dashboard** or display `datasets/csv/baseline_comparison.csv`:
     - Proposed CampusResolve AI: **98.6% Accuracy | 1.000 Precision | 0.930 Recall | 0.9637 F1**
     - Baseline B (Simple Rules): **75.9% Accuracy | 0.4518 Precision | 0.6144 F1**
     - Baseline A (Keyword-Only): **61.8% Accuracy | 0.278 Precision | 0.3737 F1**
  2. Final closing slide showing GitHub repository URL, license (CC0 / MIT), and challenge readiness statement.
- **Narration Script:**
  > *"Evaluated against held-out test splits on 5,000 synthetic records, CampusResolve AI delivers 98.6% accuracy and 0.9637 F1, outperforming keyword and simple rule baselines across all five anomaly scenarios. Reliable, explainable, and production-ready for higher education."*

---

## Production Recording Checklist

- [ ] **Display Setup:** Native resolution set to 1920x1080 at 100% DPI scaling (no UI blurriness).
- [ ] **Browser Cleanliness:** Clean browser profile with bookmarks bar hidden and zero non-essential tabs.
- [ ] **Seed & State Verification:** Verify local dev server is running on `http://localhost:3000` with seed `20261022`.
- [ ] **Microphone & Levels:** Cardioid dynamic microphone calibrated with peak levels at -6 dB.
- [ ] **Screen Highlights:** Mouse cursor smoothing enabled; subtle click ripple highlights on key UI actions.
- [ ] **Timing Check:** Verify each section transition falls within +/- 3 seconds of the target storyboard timestamps.
- [ ] **Export Format:** MP4 container, H.264 video codec, AAC audio codec, 48 kHz stereo.
