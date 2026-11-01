import React, { useState } from 'react';
import { Layers, BookOpenCheck, GitBranch, CheckCircle2 } from 'lucide-react';

interface SpatialPlane {
  id: string;
  tier: string;
  title: string;
  actorScope: string;
  summary: string;
  elevationNote: string;
}

const SPATIAL_PLANES: SpatialPlane[] = [
  {
    id: 'plane-intake',
    tier: 'Layer 01 · Intake Plane',
    title: 'Learner & Instructor Request Intake',
    actorScope: 'Learner · Instructor',
    summary:
      'Captures structured academic petitions and instructional support requests with role-scoped category classification before routing.',
    elevationNote: 'Top Architectural Plane',
  },
  {
    id: 'plane-policy',
    tier: 'Layer 02 · Policy Grounding Plane',
    title: 'Institutional Policy Retrieval & Citation',
    actorScope: 'AI Policy Assistant · Knowledge Base',
    summary:
      'Connects incoming inquiries with published university catalog clauses and handbook guidance so answers remain grounded in official documentation.',
    elevationNote: 'Middle Verification Plane',
  },
  {
    id: 'plane-routing',
    tier: 'Layer 03 · Routing & Resolution Plane',
    title: 'Departmental Triage, Escalation & Resolution',
    actorScope: 'Support Staff · Academic Admin · Platform Admin',
    summary:
      'Routes requests to the responsible academic or support unit, tracks lifecycle stages, and manages formal escalation paths.',
    elevationNote: 'Foundation Governance Plane',
  },
];

export const WorkflowSpatialDiagram: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const activePlane = SPATIAL_PLANES[activeIndex];

  return (
    <div className="w-full rounded-md bg-[#292A25] text-[#F8F7F3] border border-[#292A25] p-6 md:p-8 flex flex-col justify-between gap-6 shadow-[0_20px_40px_-18px_rgba(41,42,37,0.35)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#F8F7F3]/12 pb-4">
        <div>
          <div className="text-xs text-[#B5A58D] font-medium flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            <span>3D Layered Workflow Architecture</span>
          </div>
          <h2 className="text-lg font-serif-display text-[#F8F7F3] mt-0.5">
            Connected University Operations Stack
          </h2>
        </div>
        <span className="font-mono-tabular text-xs text-[#E8E4DC]/65">
          3-PLANE TOPOLOGY
        </span>
      </div>

      {/* Subtle 3D Isometric Layered Stack Visualization */}
      <div
        className="perspective-stage py-3 px-2 flex flex-col items-center justify-center"
        aria-label="Interactive 3D layered workflow stack"
      >
        <div className="w-full max-w-md flex flex-col gap-3">
          {SPATIAL_PLANES.map((plane, idx) => {
            const isSelected = idx === activeIndex;
            const translateZ = isSelected ? 'translate-x-1 -translate-y-1' : '';
            return (
              <button
                key={plane.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                aria-pressed={isSelected}
                style={{
                  transform: isSelected
                    ? 'perspective(900px) rotateX(8deg) rotateY(-5deg) translateZ(10px)'
                    : 'perspective(900px) rotateX(8deg) rotateY(-5deg) translateZ(0px)',
                }}
                className={`w-full text-left rounded-md p-4 border transition-all duration-250 ${translateZ} ${
                  isSelected
                    ? 'bg-[#777B63]/35 border-[#B5A58D] shadow-[0_12px_24px_-8px_rgba(0,0,0,0.45)]'
                    : 'bg-[#F8F7F3]/[0.04] border-[#F8F7F3]/12 hover:border-[#B5A58D]/60 hover:bg-[#F8F7F3]/[0.07]'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-[#B5A58D]">
                  <span className="font-mono-tabular">{plane.tier}</span>
                  <span className="text-[11px] text-[#E8E4DC]/75">
                    {plane.actorScope}
                  </span>
                </div>
                <div className="text-sm font-semibold text-[#F8F7F3] mt-1 flex items-center justify-between">
                  <span>{plane.title}</span>
                  {idx === 0 && (
                    <BookOpenCheck
                      className="w-4 h-4 text-[#B5A58D] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {idx === 1 && (
                    <GitBranch
                      className="w-4 h-4 text-[#B5A58D] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {idx === 2 && (
                    <CheckCircle2
                      className="w-4 h-4 text-[#B5A58D] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Layer Inspection Detail */}
      <div className="rounded-md bg-[#F8F7F3]/[0.06] border border-[#F8F7F3]/12 p-4 flex flex-col gap-1.5 transition-all duration-200">
        <div className="flex items-center justify-between text-xs text-[#B5A58D]">
          <span className="font-semibold">{activePlane.tier}</span>
          <span>{activePlane.elevationNote}</span>
        </div>
        <p className="text-xs text-[#E8E4DC]/85 leading-relaxed">
          {activePlane.summary}
        </p>
      </div>
    </div>
  );
};
