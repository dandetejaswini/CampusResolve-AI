# Limitations and Future Improvements — CampusResolve AI

**Document Version:** 2026.10-Phase4  
**Project State:** Production-Ready Challenge Submission (112 / 112 Tests Passed)  

---

## 1. Technical Limitations & Known Edge Cases

### A. Evaluator Benchmark Limitations
- **Rule-Based Generator vs. Evaluator Alignment**:
  - Direct rule alignment risks producing artificially inflated 1.0 metric scores.
  - Mitigated via two independent baselines (Baseline A: Keyword-Only, Baseline B: Simple Rules).
  - Evaluated on an isolated 80/20 held-out dataset partition.
  - Achieves realistic 93.0% recall (186/200 anomalies detected) on messy student writing distributions.
- **Deterministic Simulation vs. Cloud LLM Inference**:
  - Operates via a deterministic rule-grounded synthesizer in offline environments without `GEMINI_API_KEY`.
  - Guarantees 100% test reproducibility across CI pipelines.
  - Production deployments seamlessly benefit from live Gemini 2.5 Flash execution.

### B. Ingestion & Multi-Issue Routing Boundaries
- **Physical Accommodation Paperwork OCR**:
  - Medical records and Section 504 documentation currently require manual or digital text entry.
  - Future iterations will introduce vision models for automated intake of PDF and handwritten forms.
- **Multi-Domain Petitions**:
  - Complex requests spanning multiple categories (e.g., tuition appeal with IT Canvas lockout) route to the primary category.
  - Flagged for administrative triage; future releases will support hierarchical sub-ticket branching.

### C. External Infrastructure Dependencies
- **Google Apps Script Email Quotas**:
  - Automated welcome emails operate via Google Apps Script subject to daily Workspace sending quotas.
  - Recommended path for large-scale enterprise deployments is direct SMTP integration (SendGrid or AWS SES).
- **Academic Calendar Synchronization**:
  - Institutional holidays and deadlines currently load from configurable JSON/SQL calendar profiles.
  - Live SIS synchronization (Ellucian Banner, PeopleSoft, Canvas LMS) is scheduled for subsequent phases.

---

## 2. Completed Phase 4 Improvements (Summary)
- **Timestamp Standardization**: 100% of timestamps formatted to ISO 8601 with explicit `+05:30` IST offset across all 11 entities.
- **Corpus Expansion**: Expanded policy document corpus from 12 to 24 distinct policies across 4 institutional categories with version iterations.
- **Realistic Distributions**: Calibrated realistic, non-uniform distributions across 5,000 tickets and 20,000 messages.
- **Data Quality Tracking**: Added tracking metrics for text diversity, informal/Hinglish phrasing, typos, and multi-issue coverage.
- **Dedicated Documentation**: Created standalone `docs/DATA_DICTIONARY.md` and 2-minute 45-second screen walkthrough script `docs/DEMO_VIDEO_SCRIPT.md`.
- **Deterministic Checksums**: Maintained exact fixed-seed SHA-256 reproducibility (`7840a95b7c...`).

---

## 3. Future Roadmap
- **Enterprise SIS / LMS Connectors**: Bidirectional LTI 1.3 integrations with Canvas, Blackboard, and Workday Student.
- **Multilingual Speech & Text Translation**: Real-time translation for diverse student populations querying in Spanish, Hindi, or Hinglish.
- **Automated Playwright E2E Suite**: Containerized headless browser test suite running in GitHub Actions CI/CD.
- **Predictive Workload & SLA Analytics**: Machine learning models forecasting end-of-term bottlenecks and automated staff scheduling.
