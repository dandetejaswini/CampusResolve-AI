import React from 'react';
import { Link } from 'react-router-dom';
import { ACTOR_METADATA } from '../../utils/rbac';
import { ActorRole } from '../../types/domain';
import { UniversityVisualCard } from '../../components/ui/UniversityVisuals';

export const AboutPage: React.FC = () => {
  return (
    <div className="flex flex-col">
      {/* Page Header */}
      <section className="border-b border-[#292A25]/12 bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
              <span>Platform Purpose</span>
              <span aria-hidden="true">·</span>
              <span>Academic Workflow Governance</span>
            </div>
            <h1
              className="font-serif-display text-3xl md:text-5xl text-[#292A25] tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Structured routing and policy-grounded support for university communities.
            </h1>
            <p className="text-base md:text-lg text-[#292A25]/80 leading-relaxed">
              CampusResolve AI is designed to streamline how learner and
              instructor requests are submitted, grounded in institutional
              policy, routed to the appropriate unit, and tracked through
              resolution or escalation.
            </p>
          </div>

          <div className="lg:col-span-5">
            <UniversityVisualCard
              variant="faculty"
              kicker="Academic Governance"
              title="Policy-Grounded Review Environment"
              caption="Supports clear coordination between learners, faculty, support staff, and academic administrators."
            />
          </div>
        </div>
      </section>

      {/* Core Problem & Architectural Philosophy */}
      <section className="border-b border-[#292A25]/12 bg-[#E8E4DC]/45">
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-12 gap-10">
          <div className="md:col-span-5 flex flex-col gap-3">
            <div className="text-xs font-medium text-[#777B63]">
              01 · Operational Challenge
            </div>
            <h2 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
              Why academic support workflows require structure.
            </h2>
          </div>

          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="rounded-md surface-elevated p-6 flex flex-col gap-2">
              <h3 className="text-base font-semibold text-[#292A25]">
                Clear Request Routing
              </h3>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                Academic and operational inquiries often span multiple offices.
                Structured intake categories ensure requests are directed to the
                appropriate reviewing unit.
              </p>
            </div>

            <div className="rounded-md surface-elevated p-6 flex flex-col gap-2">
              <h3 className="text-base font-semibold text-[#292A25]">
                Policy-Grounded Answers
              </h3>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                Retrieving answers directly from institutional policy
                documentation helps learners, instructors, and staff rely on
                consistent guidance.
              </p>
            </div>

            <div className="rounded-md surface-elevated p-6 flex flex-col gap-2">
              <h3 className="text-base font-semibold text-[#292A25]">
                Transparent Escalation Tracking
              </h3>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                When an inquiry requires administrative review or exception
                handling, structured escalation stages keep progress visible.
              </p>
            </div>

            <div className="rounded-md surface-elevated p-6 flex flex-col gap-2">
              <h3 className="text-base font-semibold text-[#292A25]">
                Role-Appropriate Workspace Views
              </h3>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                Different institutional actors require tailored views and
                controls aligned with their responsibilities.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Five Actor Governance Model */}
      <section className="border-b border-[#292A25]/12 bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 flex flex-col gap-10">
          <div className="max-w-3xl flex flex-col gap-3">
            <div className="text-xs font-medium text-[#777B63]">
              02 · Five-Actor Institutional Model
            </div>
            <h2 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
              Workspace views tailored for five university roles.
            </h2>
            <p className="text-sm md:text-base text-[#292A25]/75 leading-relaxed">
              CampusResolve AI provides dedicated workspace views for five
              institutional roles, aligning request intake, triage, policy
              consultation, and escalation review with university governance
              responsibilities.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.values(ActorRole).map((role, idx) => {
              const meta = ACTOR_METADATA[role];
              return (
                <div
                  key={role}
                  className="rounded-md surface-elevated surface-elevated-interactive p-6 flex flex-col justify-between gap-5"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between text-xs text-[#777B63] font-medium">
                      <span>Role 0{idx + 1}</span>
                      <span>{meta.shortLabel}</span>
                    </div>
                    <h3 className="text-lg font-serif-display text-[#292A25]">
                      {meta.label}
                    </h3>
                    <p className="text-xs text-[#292A25]/65 font-medium">
                      {meta.institutionalScope}
                    </p>
                    <p className="text-sm text-[#292A25]/75 leading-relaxed">
                      {meta.description}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-[#292A25]/10 flex flex-col gap-1.5">
                    <div className="text-xs font-semibold text-[#292A25]">
                      Role Governance Scope:
                    </div>
                    <p className="text-xs text-[#292A25]/70 leading-relaxed">
                      {meta.restrictedCapabilities[0]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Architectural CTA */}
      <section className="bg-[#292A25] text-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex flex-col gap-2 max-w-xl">
            <h2 className="font-serif-display text-2xl md:text-3xl text-[#F8F7F3]">
              Explore the CampusResolve AI workspace.
            </h2>
            <p className="text-sm text-[#E8E4DC]/80 leading-relaxed">
              Access the workspace to submit requests, consult verified
              institutional policies, or coordinate departmental reviews.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              to="/workspace/dashboard"
              className="px-5 py-3 text-xs font-medium text-[#292A25] bg-[#F8F7F3] rounded-md hover:bg-[#B5A58D] transition-colors whitespace-nowrap"
            >
              Open Workspace
            </Link>
            <Link
              to="/contact"
              className="px-5 py-3 text-xs font-medium text-[#F8F7F3] border border-[#F8F7F3]/25 rounded-md hover:border-[#F8F7F3] transition-colors whitespace-nowrap"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
