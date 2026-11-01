import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  FilePlus2,
  BookOpenCheck,
  Library,
  MessageSquare,
  Bell,
  UserCircle,
  Settings,
  ArrowLeft,
  LogOut,
  X,
} from 'lucide-react';
import { ActorRole, WorkspaceSection } from '../../types/domain';
import { getActorMetadata, getAuthorizedNavItems } from '../../utils/rbac';
import type { AppProfile } from '../../services/identityService';

const SECTION_ICONS: Record<WorkspaceSection, React.FC<{ className?: string }>> = {
  [WorkspaceSection.Dashboard]: LayoutDashboard,
  [WorkspaceSection.MyRequests]: FolderKanban,
  [WorkspaceSection.CreateRequest]: FilePlus2,
  [WorkspaceSection.AIAssistant]: BookOpenCheck,
  [WorkspaceSection.KnowledgeBase]: Library,
  [WorkspaceSection.Messages]: MessageSquare,
  [WorkspaceSection.Notifications]: Bell,
  [WorkspaceSection.Profile]: UserCircle,
  [WorkspaceSection.Settings]: Settings,
};

export interface WorkspaceSidebarProps {
  activeRole: ActorRole;
  profile: AppProfile | null;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onSignOut: () => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  activeRole,
  profile,
  isOpenMobile,
  onCloseMobile,
  onSignOut,
}) => {
  const actorMeta = getActorMetadata(activeRole);
  const navItems = getAuthorizedNavItems(activeRole);
  const dbRoleMeta = getActorMetadata(profile?.actor_role || ActorRole.Learner);

  const sidebarContent = (
    <div className="h-full flex flex-col justify-between bg-[#292A25] text-[#F8F7F3] w-68 shrink-0 select-none border-r border-[#292A25]">
      <div>
        {/* Brand Header */}
        <div className="px-6 py-5 border-b border-[#F8F7F3]/12 flex items-center justify-between">
          <Link
            to="/"
            className="font-serif-display text-lg tracking-tight text-[#F8F7F3] whitespace-nowrap"
          >
            CampusResolve AI
          </Link>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close workspace navigation"
            className="lg:hidden p-1 text-[#E8E4DC]/70 hover:text-[#F8F7F3] rounded"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Authenticated User Identity & Active Actor Role Summary */}
        <div className="px-6 py-4 border-b border-[#F8F7F3]/12 bg-[#777B63]/20 flex flex-col gap-2">
          {profile && (
            <div className="pb-2 border-b border-[#F8F7F3]/10">
              <div className="text-xs font-semibold text-[#F8F7F3] truncate">
                {profile.display_name}
              </div>
              <div className="text-[11px] text-[#E8E4DC]/75 truncate">
                {profile.verified_email}
              </div>
              <div className="text-[11px] text-[#B5A58D] mt-1">
                Assigned Role: {dbRoleMeta.label} ·{' '}
                {profile.auth_provider === 'firebase_google'
                  ? 'Google Sign-In'
                  : 'Institutional Email'}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] text-[#B5A58D] font-medium">
              Active Workspace View
            </div>
            <div className="text-sm font-semibold text-[#F8F7F3] mt-0.5">
              {actorMeta.label}
            </div>
            <div className="text-xs text-[#E8E4DC]/75 mt-1 leading-snug">
              {actorMeta.primaryResponsibility}
            </div>
          </div>
        </div>

        {/* Primary Workspace Navigation */}
        <nav aria-label="Workspace sections" className="px-3 py-4 flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = SECTION_ICONS[item.id];
            return (
              <NavLink
                key={item.id}
                to={item.path}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                    isActive
                      ? 'bg-[#777B63] text-[#F8F7F3] shadow-xs'
                      : 'text-[#E8E4DC]/75 hover:bg-[#F8F7F3]/10 hover:text-[#F8F7F3]'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0 text-[#B5A58D]" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Footer Sign Out & Return to Public Site */}
      <div className="p-4 border-t border-[#F8F7F3]/12 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-[#E8E4DC] hover:text-[#F8F7F3] hover:bg-[#F8F7F3]/10 transition-colors text-left"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0 text-[#B5A58D]" aria-hidden="true" />
          <span>Sign Out of Session</span>
        </button>

        <Link
          to="/"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-[#E8E4DC]/75 hover:text-[#F8F7F3] hover:bg-[#F8F7F3]/10 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Return to Public Website</span>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Static Sidebar */}
      <aside aria-label="Workspace sidebar" className="hidden lg:block shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex animate-page-enter">
          <div
            className="fixed inset-0 bg-[#292A25]/60 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside
            aria-label="Mobile workspace sidebar"
            className="relative z-10 h-full shadow-xl"
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};
