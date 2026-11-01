import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  GitBranch,
  Scale,
  ShieldCheck,
  FileText,
  Layers,
} from 'lucide-react';
import { RequestStatus } from '../../types/domain';
import { StatusIndicator } from '../../components/ui/StatusIndicator';
import { WorkflowSpatialDiagram } from '../../components/ui/WorkflowSpatialDiagram';
import { UniversityVisualCard } from '../../components/ui/UniversityVisuals';
import { useAuth } from '../../context/AuthContext';

export const HomePage: React.FC = () => {
  const { status, profile } = useAuth();
  const isAuthenticated = status === 'authenticated' && Boolean(profile);
  return (
    <div className="flex flex-col">
      {/* 1. Premium Hero Section with 3D Layered Workflow Stack */}
      <section className="border-b border-[#292A25]/12 bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-between gap-8">
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#777B63]">
                <span>University Request Routing</span>
                <span aria-hidden="true">·</span>
                <span>Policy-Grounded Answers</span>
                <span aria-hidden="true">·</span>
                <span>Resolution & Escalation Tracking</span>
              </div>

              <h1
                className="font-serif-display text-[#292A25] tracking-tight leading-[1.12]"
                style={{
                  fontSize: 'clamp(2.35rem, 4.2vw, 3.75rem)',
                  textWrap: 'balance',
                }}
              >
                Policy-grounded academic request routing and resolution tracking.
              </h1>

              <p className="text-base md:text-lg text-[#292A25]/80 leading-relaxed max-w-2xl">
                CampusResolve AI provides a structured platform for routing
                learner and instructor requests, retrieving policy-grounded
                answers from institutional references, and tracking resolution
                and escalation across university departments.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-2">
              <Link
                to="/workspace/dashboard"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors whitespace-nowrap shrink-0 shadow-xs"
              >
                <span>Open Workspace</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link
                to="/features"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-medium text-[#292A25] border border-[#292A25]/25 rounded-md hover:border-[#292A25] hover:bg-[#E8E4DC]/65 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Explore Platform Capabilities</span>
              </Link>
            </div>
          </div>

          {/* Right Column: Subtle 3D Layered Workflow Architecture */}
          <div className="lg:col-span-5 flex">
            <WorkflowSpatialDiagram />
          </div>
        </div>
      </section>

      {/* 2. Clear Description of the Platform & University Environment Visuals */}
      <section className="border-b border-[#292A25]/12 bg-[#E8E4DC]/45">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 flex flex-col gap-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <div className="text-xs font-medium text-[#777B63] mb-2">
                Platform Foundation
              </div>
              <h2 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight leading-snug">
                Calm, structured governance for academic and administrative workflows.
              </h2>
            </div>
            <div className="lg:col-span-7 flex flex-col gap-4 text-sm md:text-base text-[#292A25]/80 leading-relaxed">
              <p>
                University communities depend on clear communication between
                learners, instructors, support staff, and academic
                administrators. When requests are scattered across disconnected
                channels, finding the applicable policy and identifying the
                responsible reviewing office becomes difficult.
              </p>
              <p>
                CampusResolve AI organizes intake, policy reference lookup,
                departmental routing, and escalation tracking inside a unified
                interface designed for five distinct university actor views.
              </p>
            </div>
          </div>

          {/* Relevant University Visual Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <UniversityVisualCard
              variant="campus"
              kicker="Campus Operations"
              title="Connected Academic Departments"
              caption="Coordinates request routing across academic departments, advising offices, and operational support units."
            />
            <UniversityVisualCard
              variant="library"
              kicker="Policy Reference"
              title="Library & Handbook Grounding"
              caption="Connects questions and requests with published institutional policy references rather than unverified summaries."
            />
            <UniversityVisualCard
              variant="collaboration"
              kicker="Learner & Faculty Support"
              title="Collaborative Case Resolution"
              caption="Supports transparent communication between learners, course instructors, and reviewing administrators."
            />
          </div>
        </div>
      </section>

      {/* 3. Student and Faculty Support Workflow */}
      <section className="border-b border-[#292A25]/12 bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-12">
          <div className="max-w-3xl flex flex-col gap-3">
            <div className="text-xs font-medium text-[#777B63]">
              01 · Student & Faculty Support Workflow
            </div>
            <h2 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
              Structured intake for learners and instructors.
            </h2>
            <p className="text-sm md:text-base text-[#292A25]/75 leading-relaxed">
              Dedicated intake views help learners and instructors submit complete
              requests while referencing relevant academic context upfront.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
                  <span>Actor View: Learner</span>
                  <span aria-hidden="true">·</span>
                  <span>Academic & Support Inquiries</span>
                </div>
                <h3 className="text-xl font-serif-display text-[#292A25]">
                  Learner Request Pathway
                </h3>
                <p className="text-sm text-[#292A25]/75 leading-relaxed">
                  Learners submit enrollment inquiries, schedule questions, and
                  academic support requests through a guided form that captures
                  the necessary context before routing to the appropriate office.
                </p>
              </div>
              <div className="pt-4 border-t border-[#292A25]/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#292A25]/70">
                <span>Initial Intake Status</span>
                <StatusIndicator status={RequestStatus.Submitted} showCode />
              </div>
            </div>

            <div className="rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
                  <span>Actor View: Instructor</span>
                  <span aria-hidden="true">·</span>
                  <span>Course & Instructional Support</span>
                </div>
                <h3 className="text-xl font-serif-display text-[#292A25]">
                  Instructor Support & Case Input Pathway
                </h3>
                <p className="text-sm text-[#292A25]/75 leading-relaxed">
                  Instructors submit course policy inquiries, classroom support
                  requests, and faculty case input while consulting the same
                  policy-grounded reference system.
                </p>
              </div>
              <div className="pt-4 border-t border-[#292A25]/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#292A25]/70">
                <span>Policy Context Status</span>
                <StatusIndicator status={RequestStatus.PolicyVerified} showCode />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. AI Policy Assistant Explanation (with Layered 3D Relationship Diagram) */}
      <section className="border-b border-[#292A25]/12 bg-[#292A25] text-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 flex flex-col gap-5">
            <div className="text-xs font-medium text-[#B5A58D]">
              02 · AI Policy Assistant Explanation
            </div>
            <h2 className="font-serif-display text-3xl md:text-4xl text-[#F8F7F3] tracking-tight leading-tight">
              Retrieving policy-grounded answers with clear reference context.
            </h2>
            <p className="text-sm md:text-base text-[#E8E4DC]/80 leading-relaxed">
              The AI Policy Assistant is designed to retrieve answers grounded in
              institutional policy documentation rather than generating
              unverified advice. When a question requires formal human review,
              the workflow transitions smoothly into a tracked request.
            </p>
            <div className="flex flex-col gap-4 pt-2 border-t border-[#F8F7F3]/12">
              <div>
                <h3 className="text-sm font-semibold text-[#F8F7F3]">
                  Policy-Grounded Retrieval
                </h3>
                <p className="text-xs text-[#E8E4DC]/75 mt-1 leading-relaxed">
                  Connects learner, instructor, and staff questions to indexed
                  policy sections so users can inspect the underlying reference.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#F8F7F3]">
                  Clear Escalation Handoff
                </h3>
                <p className="text-xs text-[#E8E4DC]/75 mt-1 leading-relaxed">
                  When an inquiry requires departmental discretion or formal
                  approval, users can initiate a structured request for human
                  review.
                </p>
              </div>
            </div>
          </div>

          {/* Layered 3D Perspective Diagram showing Request -> Policy -> Department -> Resolution */}
          <div className="lg:col-span-6 perspective-stage">
            <div className="rounded-md border border-[#F8F7F3]/15 bg-[#F8F7F3]/[0.04] p-6 md:p-8 flex flex-col gap-5 isometric-plane shadow-xl">
              <div className="flex items-center justify-between border-b border-[#F8F7F3]/12 pb-3 text-xs text-[#B5A58D]">
                <span className="flex items-center gap-2">
                  <BookOpenCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Layered Policy-to-Resolution Architecture</span>
                </span>
                <span className="font-mono-tabular">POLICY & ROUTING WORKFLOW</span>
              </div>

              <div className="flex flex-col gap-3.5 text-xs">
                <div className="p-4 rounded bg-[#292A25] border border-[#B5A58D]/40 shadow-md translate-x-0">
                  <div className="text-[#B5A58D] font-medium mb-1">
                    Layer 1 · Incoming Question or Request
                  </div>
                  <p className="text-[#E8E4DC]/80 leading-relaxed">
                    A learner or instructor frames a policy question or academic
                    support inquiry within their role-scoped workspace view.
                  </p>
                </div>

                <div className="p-4 rounded bg-[#292A25] border border-[#F8F7F3]/15 shadow-md translate-x-2">
                  <div className="text-[#B5A58D] font-medium mb-1">
                    Layer 2 · Policy Reference Retrieval
                  </div>
                  <p className="text-[#E8E4DC]/80 leading-relaxed">
                    Relevant institutional policy passages are surfaced to ground
                    the response or attach context to a formal request.
                  </p>
                </div>

                <div className="p-4 rounded bg-[#292A25] border border-[#F8F7F3]/15 shadow-md translate-x-4">
                  <div className="text-[#B5A58D] font-medium mb-1">
                    Layer 3 · Departmental Routing & Resolution
                  </div>
                  <p className="text-[#E8E4DC]/80 leading-relaxed">
                    If action is needed, the request routes to the appropriate
                    department and tracks progress through resolution or escalation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Request Routing & Tracking + 6. Resolution & Escalation Explanation */}
      <section className="border-b border-[#292A25]/12 bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Request Routing and Tracking */}
          <div className="lg:col-span-6 rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
                <GitBranch className="w-4 h-4" aria-hidden="true" />
                <span>03 · Request Routing & Tracking</span>
              </div>
              <h2 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
                Structured routing and transparent status visibility.
              </h2>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                Submitted requests are classified by category and directed to the
                relevant academic or support unit. Participants can follow the
                request’s progress across clearly defined lifecycle stages.
              </p>
              <ul className="flex flex-col gap-2.5 text-sm text-[#292A25]/80 pt-2">
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono-tabular text-xs text-[#777B63] font-semibold">
                    01.
                  </span>
                  <span>
                    Category-driven routing to academic departments, advising,
                    or operational support queues.
                  </span>
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono-tabular text-xs text-[#777B63] font-semibold">
                    02.
                  </span>
                  <span>
                    Clear status indicators showing whether a request is submitted,
                    under review, policy-verified, escalated, or resolved.
                  </span>
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono-tabular text-xs text-[#777B63] font-semibold">
                    03.
                  </span>
                  <span>
                    Request-linked messages and notifications so updates remain
                    organized in one place.
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Resolution and Escalation */}
          <div className="lg:col-span-6 rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
                <Scale className="w-4 h-4" aria-hidden="true" />
                <span>04 · Resolution & Escalation Tracking</span>
              </div>
              <h2 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
                Coordinated escalation and documented resolution.
              </h2>
              <p className="text-sm text-[#292A25]/75 leading-relaxed">
                When a request requires administrative review or cross-unit
                coordination, CampusResolve AI supports structured escalation to
                Academic Administrators while preserving full context.
              </p>
              <ul className="flex flex-col gap-2.5 text-sm text-[#292A25]/80 pt-2">
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono-tabular text-xs text-[#777B63] font-semibold">
                    01.
                  </span>
                  <span>
                    Escalation handoff from initial intake or instructor review to
                    academic administrative oversight.
                  </span>
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono-tabular text-xs text-[#777B63] font-semibold">
                    02.
                  </span>
                  <span>
                    Preserves attached policy context and prior review notes
                    throughout the escalation lifecycle.
                  </span>
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono-tabular text-xs text-[#777B63] font-semibold">
                    03.
                  </span>
                  <span>
                    Role-appropriate workspace views designed to separate learner,
                    faculty, support, and administrative responsibilities.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Features Section */}
      <section className="bg-[#F8F7F3]">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="max-w-2xl flex flex-col gap-2">
              <div className="text-xs font-medium text-[#777B63]">
                05 · Platform Capabilities
              </div>
              <h2 className="font-serif-display text-3xl text-[#292A25] tracking-tight">
                Designed for five institutional actor perspectives.
              </h2>
            </div>
            <Link
              to="/features"
              className="inline-flex items-center gap-2 text-sm font-medium text-[#777B63] hover:text-[#292A25] transition-colors whitespace-nowrap"
            >
              <span>View Full Capabilities & Role Matrix</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <div className="w-9 h-9 rounded-md bg-[#E8E4DC] flex items-center justify-center text-[#777B63]">
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-[#292A25]">
                  01. Role-Scoped Institutional Workspaces
                </h3>
                <p className="text-sm text-[#292A25]/75 leading-relaxed">
                  Dedicated workspace views for Learners, Instructors, Academic
                  Administrators, Support Staff, and Platform Administrators
                  ensure each participant sees the intake forms, queues, and
                  governance tools relevant to their role.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#777B63] pt-2 border-t border-[#292A25]/10">
                <span>Learner</span>
                <span aria-hidden="true">·</span>
                <span>Instructor</span>
                <span aria-hidden="true">·</span>
                <span>Academic Administrator</span>
                <span aria-hidden="true">·</span>
                <span>Support Staff</span>
                <span aria-hidden="true">·</span>
                <span>Platform Administrator</span>
              </div>
            </div>

            <div className="rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <div className="w-9 h-9 rounded-md bg-[#E8E4DC] flex items-center justify-center text-[#777B63]">
                  <FileText className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-[#292A25]">
                  02. Policy Knowledge Base Interface
                </h3>
                <p className="text-sm text-[#292A25]/75 leading-relaxed">
                  Structured repository view for browsing institutional policy
                  references and connecting them to incoming requests.
                </p>
              </div>
              <div className="text-xs text-[#292A25]/60 pt-2 border-t border-[#292A25]/10">
                Policy Reference Structure
              </div>
            </div>

            <div className="rounded-md surface-elevated surface-elevated-interactive p-8 flex flex-col justify-between gap-6">
              <div className="flex flex-col gap-3">
                <div className="w-9 h-9 rounded-md bg-[#E8E4DC] flex items-center justify-center text-[#777B63]">
                  <Layers className="w-4 h-4" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-[#292A25]">
                  03. Resolution & Escalation Views
                </h3>
                <p className="text-sm text-[#292A25]/75 leading-relaxed">
                  Clear lifecycle status indicators, business-hour service level
                  tracking, and structured escalation paths from initial
                  submission through final determination.
                </p>
              </div>
              <div className="text-xs text-[#292A25]/60 pt-2 border-t border-[#292A25]/10">
                End-to-End Lifecycle Visibility
              </div>
            </div>

            <div className="md:col-span-2 rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/55 p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex flex-col gap-2 max-w-xl">
                <h3 className="text-lg font-serif-display text-[#292A25]">
                  Access the CampusResolve AI Workspace
                </h3>
                <p className="text-sm text-[#292A25]/75 leading-relaxed">
                  Sign in to submit academic or instructional requests, consult
                  policy-grounded guidance, and track case resolution across
                  university departments.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Link
                  to="/workspace/dashboard"
                  className="px-5 py-2.5 text-xs font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors whitespace-nowrap"
                >
                  Open Workspace
                </Link>
                {!isAuthenticated && status !== 'loading' && (
                  <Link
                    to="/sign-in"
                    className="px-5 py-2.5 text-xs font-medium text-[#292A25] border border-[#292A25]/25 rounded-md hover:border-[#292A25] bg-[#F8F7F3] transition-colors whitespace-nowrap"
                  >
                    Sign In
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
