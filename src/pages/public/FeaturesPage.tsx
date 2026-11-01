import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, Layers } from 'lucide-react';
import { ActorRole, AuthorizedAction } from '../../types/domain';
import { ACTOR_METADATA, canActorPerformAction } from '../../utils/rbac';

const CAPABILITY_MODULES = [
  {
    id: '01',
    title: 'Structured Request Intake & Classification',
    scope: 'Learner · Instructor · Support Staff',
    mechanism:
      'Role-tailored forms validate request subject, category, target unit, priority level, and factual summary before submission.',
    outcome:
      'Ensures incoming requests include structured routing context from the start.',
  },
  {
    id: '02',
    title: 'Policy-Grounded Answer Retrieval Interface',
    scope: 'All Five Actors · Role-Scoped View',
    mechanism:
      'Provides a dedicated AI Policy Assistant and Knowledge Base interface for querying institutional policy documentation.',
    outcome:
      'Supports consistent, policy-grounded guidance and smooth handoff to formal requests when human review is needed.',
  },
  {
    id: '03',
    title: 'Departmental Routing & Lifecycle Tracking',
    scope: 'Support Staff · Academic Administrator',
    mechanism:
      'Tracks requests across intake, review, policy verification, escalation, and resolution stages with clear status indicators.',
    outcome:
      'Keeps learners, instructors, and reviewing units aligned on current case status.',
  },
  {
    id: '04',
    title: 'Escalation Review & Workspace Governance',
    scope: 'Academic Administrator · Platform Administrator',
    mechanism:
      'Provides role-appropriate views for reviewing escalated cases and configuring routing categories and workspace settings.',
    outcome:
      'Separates administrative review and platform configuration from standard request submission views.',
  },
];

const MATRIX_ACTIONS: { action: AuthorizedAction; label: string }[] = [
  {
    action: AuthorizedAction.SubmitAcademicPetition,
    label: 'Submit Learner Academic / Support Request',
  },
  {
    action: AuthorizedAction.SubmitFacultyCourseRequest,
    label: 'Submit Instructor Course / Syllabus Request',
  },
  {
    action: AuthorizedAction.TriageSupportQueue,
    label: 'Triage & Route Support Queue View',
  },
  {
    action: AuthorizedAction.ApprovePolicyEscalation,
    label: 'Review & Adjudicate Escalated Academic Cases',
  },
  {
    action: AuthorizedAction.ProposePolicyRevision,
    label: 'Propose Knowledge Base Policy Note',
  },
  {
    action: AuthorizedAction.PublishKnowledgeArticle,
    label: 'Publish Official Knowledge Base Policy Entry',
  },
  {
    action: AuthorizedAction.ConfigureDepartmentRouting,
    label: 'Configure Departmental Routing Rules View',
  },
  {
    action: AuthorizedAction.ConfigurePlatformGovernance,
    label: 'Configure Platform Governance & Layout Settings',
  },
];

export const FeaturesPage: React.FC = () => {
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<ActorRole | 'all'>(
    'all'
  );

  return (
    <div className="flex flex-col">
      {/* Header */}
      <section className="border-b border-[#292A25]/12 bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
              <span>Platform Capabilities</span>
              <span aria-hidden="true">·</span>
              <span>Five-Role Institutional Governance</span>
            </div>
            <h1
              className="font-serif-display text-3xl md:text-5xl text-[#292A25] tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Capabilities structured for university request and policy workflows.
            </h1>
            <p className="text-base md:text-lg text-[#292A25]/80 leading-relaxed">
              Explore the core functional modules of CampusResolve AI and inspect
              how workspace actions are organized across the five institutional
              actor views.
            </p>
          </div>

          {/* Subtle 3D Layered Perspective Card in Header */}
          <div className="lg:col-span-5 perspective-stage">
            <div className="rounded-md bg-[#292A25] text-[#F8F7F3] p-6 border border-[#292A25] isometric-plane shadow-lg flex flex-col gap-4">
              <div className="flex items-center justify-between text-xs text-[#B5A58D] border-b border-[#F8F7F3]/12 pb-3">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Connected Workflow Architecture</span>
                </span>
                <span className="font-mono-tabular">4 CORE MODULES</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded bg-[#F8F7F3]/[0.06] border border-[#F8F7F3]/10">
                  <div className="text-[#B5A58D] font-semibold">01. Intake</div>
                  <div className="text-[#E8E4DC]/80 mt-1">
                    Role-scoped request forms
                  </div>
                </div>
                <div className="p-3 rounded bg-[#F8F7F3]/[0.06] border border-[#F8F7F3]/10">
                  <div className="text-[#B5A58D] font-semibold">02. Policy AI</div>
                  <div className="text-[#E8E4DC]/80 mt-1">
                    Grounded reference lookup
                  </div>
                </div>
                <div className="p-3 rounded bg-[#F8F7F3]/[0.06] border border-[#F8F7F3]/10">
                  <div className="text-[#B5A58D] font-semibold">03. Routing</div>
                  <div className="text-[#E8E4DC]/80 mt-1">
                    Departmental queue tracking
                  </div>
                </div>
                <div className="p-3 rounded bg-[#F8F7F3]/[0.06] border border-[#F8F7F3]/10">
                  <div className="text-[#B5A58D] font-semibold">04. Escalation</div>
                  <div className="text-[#E8E4DC]/80 mt-1">
                    Administrative review path
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capability Modules */}
      <section className="border-b border-[#292A25]/12 bg-[#E8E4DC]/35">
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-2 gap-8">
          {CAPABILITY_MODULES.map((cap) => (
            <div
              key={cap.id}
              className="rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6"
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs text-[#777B63] font-medium">
                  <span className="font-mono-tabular">MODULE {cap.id}</span>
                  <span>{cap.scope}</span>
                </div>
                <h2 className="font-serif-display text-2xl text-[#292A25]">
                  {cap.title}
                </h2>
                <div className="pt-2 flex flex-col gap-3 text-sm text-[#292A25]/80 leading-relaxed">
                  <div>
                    <span className="font-semibold text-[#292A25]">
                      Interface Mechanism:{' '}
                    </span>
                    {cap.mechanism}
                  </div>
                  <div>
                    <span className="font-semibold text-[#292A25]">
                      Workflow Outcome:{' '}
                    </span>
                    {cap.outcome}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Five-Actor UI Layout Preview Matrix */}
      <section className="bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 flex flex-col gap-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="flex flex-col gap-2 max-w-2xl">
              <div className="text-xs font-medium text-[#777B63]">
                Role-Scoped Capabilities
              </div>
              <h2 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
                Institutional Role Capability Matrix
              </h2>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                Compare the operational capabilities, review queues, and
                administrative controls available to each institutional role
                across CampusResolve AI.
              </p>
            </div>

            <div
              role="group"
              aria-label="Filter matrix by actor role"
              className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-[#E8E4DC]/75 border border-[#292A25]/12"
            >
              <button
                type="button"
                onClick={() => setSelectedRoleFilter('all')}
                aria-pressed={selectedRoleFilter === 'all'}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedRoleFilter === 'all'
                    ? 'bg-[#292A25] text-[#F8F7F3]'
                    : 'text-[#292A25]/75 hover:text-[#292A25]'
                }`}
              >
                All Five Actors
              </button>
              {Object.values(ActorRole).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRoleFilter(role)}
                  aria-pressed={selectedRoleFilter === role}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    selectedRoleFilter === role
                      ? 'bg-[#777B63] text-[#F8F7F3]'
                      : 'text-[#292A25]/75 hover:text-[#292A25]'
                  }`}
                >
                  {ACTOR_METADATA[role].shortLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full rounded-md surface-elevated overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <caption className="sr-only">
                Role capability matrix across the five CampusResolve AI institutional roles
              </caption>
              <thead>
                <tr className="border-b border-[#292A25]/12 bg-[#E8E4DC]/65 text-xs font-semibold text-[#292A25]">
                  <th scope="col" className="px-4 py-3.5">
                    Workspace Action / Capability
                  </th>
                  {Object.values(ActorRole)
                    .filter(
                      (r) =>
                        selectedRoleFilter === 'all' || r === selectedRoleFilter
                    )
                    .map((role) => (
                      <th
                        key={role}
                        scope="col"
                        className="px-4 py-3.5 text-center whitespace-nowrap"
                      >
                        {ACTOR_METADATA[role].label}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292A25]/10 text-sm">
                {MATRIX_ACTIONS.map((row) => (
                  <tr
                    key={row.action}
                    className="hover:bg-[#E8E4DC]/35 transition-colors"
                  >
                    <td className="px-4 py-3.5 font-medium text-[#292A25]">
                      {row.label}
                    </td>
                    {Object.values(ActorRole)
                      .filter(
                        (r) =>
                          selectedRoleFilter === 'all' || r === selectedRoleFilter
                      )
                      .map((role) => {
                        const allowed = canActorPerformAction(role, row.action);
                        return (
                          <td
                            key={role}
                            className="px-4 py-3.5 text-center font-mono-tabular text-xs"
                          >
                            {allowed ? (
                              <span className="inline-flex items-center gap-1 text-[#4A5D46] font-semibold">
                                <Check
                                  className="w-4 h-4 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Authorized</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[#292A25]/45">
                                <Minus
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Restricted</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[#292A25]/10">
            <p className="text-xs text-[#292A25]/65">
              Role permissions are enforced across workspace views and
              administrative workflows.
            </p>
            <Link
              to="/workspace/dashboard"
              className="px-5 py-2.5 text-xs font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors whitespace-nowrap"
            >
              Open Institutional Workspace
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
