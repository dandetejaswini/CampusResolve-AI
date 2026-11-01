import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, FilePlus2, LogOut, ShieldCheck } from 'lucide-react';
import { ActorRole } from '../../types/domain';
import { ACTOR_METADATA, getActorMetadata } from '../../utils/rbac';
import type { AppProfile } from '../../services/identityService';

export interface WorkspaceHeaderProps {
  currentSectionLabel: string;
  activeRole: ActorRole;
  profile: AppProfile | null;
  onRoleChange: (role: ActorRole) => void;
  onOpenMobileSidebar: () => void;
  onSignOut: () => void;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  currentSectionLabel,
  activeRole,
  profile,
  onRoleChange,
  onOpenMobileSidebar,
  onSignOut,
}) => {
  const actorMeta = getActorMetadata(activeRole);
  const authoritativeRoleMeta = getActorMetadata(
    profile?.actor_role || ActorRole.Learner
  );

  return (
    <header className="w-full bg-[#F8F7F3] border-b border-[#292A25]/12 px-6 py-3.5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: Mobile toggle + Breadcrumb trail */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            aria-label="Open workspace navigation sidebar"
            className="lg:hidden p-2 rounded-md text-[#292A25] hover:bg-[#E8E4DC]/70"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>

          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            <span className="text-[#292A25]/60 font-medium">Workspace</span>
            <span aria-hidden="true" className="text-[#292A25]/35">
              /
            </span>
            <span className="text-[#777B63] font-medium whitespace-nowrap">
              {actorMeta.shortLabel}
            </span>
            <span aria-hidden="true" className="text-[#292A25]/35">
              /
            </span>
            <span className="text-[#292A25] font-semibold whitespace-nowrap">
              {currentSectionLabel}
            </span>
          </nav>
        </div>

        {/* Right: Authenticated User Identity + Primary Contextual Action + Sign Out */}
        <div className="flex flex-wrap items-center gap-3">
          {profile && (
            <Link
              to="/workspace/profile"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/60 hover:bg-[#E8E4DC] transition-colors text-xs"
            >
              <ShieldCheck
                className="w-3.5 h-3.5 text-[#777B63] shrink-0"
                aria-hidden="true"
              />
              <span className="font-semibold text-[#292A25] truncate max-w-[160px]">
                {profile.display_name}
              </span>
              <span className="text-[#292A25]/60">·</span>
              <span className="text-[#777B63] font-medium">
                {authoritativeRoleMeta.shortLabel}
              </span>
            </Link>
          )}

          <Link
            to="/workspace/create-request"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{actorMeta.createRequestTitle}</span>
          </Link>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#292A25] border border-[#292A25]/20 rounded-md hover:bg-[#E8E4DC] transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 text-[#777B63]" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Role-Governed Workspace Indicator */}
      <div className="pt-2.5 border-t border-[#292A25]/10 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#292A25]/70 font-medium">
            Authenticated Role:
          </span>
          <span className="px-2.5 py-1 rounded-md bg-[#292A25] text-[#F8F7F3] font-semibold text-xs inline-flex items-center gap-1.5 shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E8E4DC]"></span>
            {authoritativeRoleMeta.label}
          </span>
          <span className="text-[#777B63] text-xs">
            ({authoritativeRoleMeta.primaryResponsibility})
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-[#292A25]/70">
          <span className="inline-flex items-center gap-1 text-[11px] bg-[#E8E4DC]/80 px-2 py-0.5 rounded border border-[#292A25]/10">
            🔒 Role-Governed Access Enforced
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="underline underline-offset-4 font-medium text-[#777B63] hover:text-[#292A25] transition-colors"
          >
            Switch Role Account
          </button>
        </div>
      </div>
    </header>
  );
};
