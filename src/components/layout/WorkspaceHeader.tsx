import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, FilePlus2, LogOut, ShieldCheck } from 'lucide-react';
import { ActorRole, ViewDataState } from '../../types/domain';
import { ACTOR_METADATA, getActorMetadata } from '../../utils/rbac';
import type { AppProfile } from '../../services/identityService';

export interface WorkspaceHeaderProps {
  currentSectionLabel: string;
  activeRole: ActorRole;
  profile: AppProfile | null;
  onRoleChange: (role: ActorRole) => void;
  dataState: ViewDataState;
  onDataStateChange: (state: ViewDataState) => void;
  onOpenMobileSidebar: () => void;
  onSignOut: () => void;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  currentSectionLabel,
  activeRole,
  profile,
  onRoleChange,
  dataState,
  onDataStateChange,
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

      {/* Role Perspective Controls Toolbar */}
      <div className="pt-2.5 border-t border-[#292A25]/10 flex flex-wrap items-center justify-between gap-4 text-xs">
        {/* Five Institutional Role Perspective Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#292A25]/70 font-medium mr-1">
            Role Perspective:
          </span>
          <div
            role="group"
            aria-label="Select institutional role workspace perspective"
            className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-[#E8E4DC]/75 border border-[#292A25]/12"
          >
            {Object.values(ActorRole).map((role) => {
              const meta = ACTOR_METADATA[role];
              const isSelected = activeRole === role;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => onRoleChange(role)}
                  aria-pressed={isSelected}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-[#292A25] text-[#F8F7F3] shadow-2xs'
                      : 'text-[#292A25]/75 hover:text-[#292A25] hover:bg-[#F8F7F3]/70'
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Account Role vs Preview Indicator */}
        {profile && activeRole !== profile.actor_role ? (
          <div className="flex items-center gap-2 text-xs text-[#777B63]">
            <span>
              Previewing <strong>{actorMeta.label}</strong> view (Your account role:{' '}
              <strong>{authoritativeRoleMeta.label}</strong>)
            </span>
            <button
              type="button"
              onClick={() => onRoleChange(profile.actor_role)}
              className="underline underline-offset-4 font-semibold text-[#292A25] hover:text-[#777B63] transition-colors"
            >
              Reset to My Role
            </button>
          </div>
        ) : (
          <div className="text-xs text-[#292A25]/60">
            Active Role: <strong className="text-[#292A25]">{authoritativeRoleMeta.label}</strong>
          </div>
        )}
      </div>
    </header>
  );
};
