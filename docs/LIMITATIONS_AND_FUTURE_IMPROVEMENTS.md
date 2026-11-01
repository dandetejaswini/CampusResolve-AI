# Limitations and Future Improvements — CampusResolve AI

**Document Version:** 2026.10-Phase4  
**Project State:** Production-Ready Challenge Submission (112 / 112 Tests Passed)  

---

## 1. Current Technical Limitations & Known Edge Cases

### A. Evaluator Benchmark Limitations
1. **Rule-Based Generator vs. Evaluator Alignment:** When synthetic anomaly generation rules are identical to the detection rules, naive benchmarks produce artificial 1.0 precision, recall, and F1 scores. We addressed this by implementing independent baselines (Baseline A: Keyword-Only, Baseline B: Simple Rules) and evaluating against an isolated 80/20 held-out evaluation subset. In messy student text distributions, our detector achieves 93.0% recall on the held-out test set (186/200 anomalies detected), reflecting realistic false negatives on multi-issue tickets.
2. **Deterministic Simulation vs. Cloud LLM Inference:** In offline/local environments without `GEMINI_API_KEY`, the Policy Assistant operates via its deterministic rule-grounded synthesizer. While this ensures 100% test reproducibility, production deployments will benefit from continuous live Gemini 2.5 Flash execution.

### B. Ingestion & Multi-Issue Routing Boundaries
1. **Physical Accommodation Paperwork OCR:** Currently, medical documentation and Section 504 accommodation letters require manual or digital text entry. Future phases will integrate layout-aware vision models for automated PDF/image intake.
2. **Multi-Domain Petitions:** Requests containing multiple unrelated issues (e.g., tuition refund appeal combined with an IT Canvas login lockout) are routed to the dominant category with an administrative triage flag. Future work will support sub-ticket branching.

### C. External Infrastructure Dependencies
1. **Google Apps Script Quotas:** Welcome email delivery via Google Apps Script (`campusresolveai@gmail.com`) is subject to standard daily Google Workspace email limits. Enterprise deployments should transition to direct SMTP (SendGrid or AWS SES).
2. **Academic Calendar Sync:** Institutional holidays and add/drop deadlines are currently configured via synthetic JSON/SQL calendar profiles. Integration with live campus SIS (Ellucian Banner, PeopleSoft, Canvas LMS) is planned.

---

## 2. Completed Phase 4 Improvements (Summary)
- Standardized 100% of timestamps to strict ISO 8601 with explicit `+05:30` IST offset across all 11 entities.
- Expanded policy document corpus from 12 to 24 distinct documents covering all 4 categories, multiple version iterations, and conflicting policy cases.
- Implemented realistic, non-uniform category and lifecycle distributions across 5,000 tickets and 20,000 messages.
- Added comprehensive data quality metrics tracking text diversity, Hinglish phrasing, typos, and multi-issue coverage.
- Created standalone `DATA_DICTIONARY.md` and 2–3 minute video demo plan `docs/DEMO_VIDEO_SCRIPT.md`.
- Maintained 100% fixed-seed SHA-256 reproducibility (`7840a95b7c...`).

---

## 3. Future Roadmap

1. **Enterprise SIS / LMS Connectors:** Direct bidirectional LTI 1.3 integrations with Canvas, Blackboard, and Workday Student.
2. **Multilingual Speech & Text Translation:** Real-time translation for international students querying in Spanish, Hindi, Mandarin, or Hinglish.
3. **Automated Playwright E2E Suite:** Containerized headless browser test suite running in GitHub Actions CI/CD.
4. **Predictive Workload & SLA Analytics:** Machine learning models forecasting end-of-term registration bottlenecks and staff scheduling.
