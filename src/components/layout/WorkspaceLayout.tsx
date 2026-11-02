import React, {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { ActorRole, ViewDataState } from '../../types/domain';
import { WORKSPACE_NAV_ITEMS } from '../../utils/rbac';
import { useAuth } from '../../context/AuthContext';
import {
  WorkspaceBootstrapPayload,
  fetchWorkspaceBootstrap,
} from '../../services/workspaceClient';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceHeader } from './WorkspaceHeader';

export interface WorkspaceContextValue {
  activeRole: ActorRole;
  setActiveRole: (role: ActorRole) => void;
  dataState: ViewDataState;
  setDataState: (state: ViewDataState) => void;
  workspaceData: WorkspaceBootstrapPayload | null;
  setWorkspaceData: React.Dispatch<
    React.SetStateAction<WorkspaceBootstrapPayload | null>
  >;
  isLoadingWorkspace: boolean;
  workspaceError: string | null;
  refreshWorkspaceData: (params?: {
    kbPage?: number;
    kbPageSize?: number;
    kbSearch?: string;
    kbDomain?: string;
  }) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
);

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspaceContext must be used inside WorkspaceLayout');
  }
  return ctx;
}

export const WorkspaceLayout: React.FC = () => {
  const {
    profile,
    welcomeEmailNotice,
    authWarning,
    dismissNotices,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const savedProfile = React.useMemo(() => {
    if (profile) return profile;
    try {
      const raw = localStorage.getItem('campusresolve_demo_profile');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.actor_role) return parsed;
      }
    } catch {}
    return null;
  }, [profile]);

  const effectiveProfile = profile || savedProfile;

  const [activeRole, setActiveRole] = useState<ActorRole>(
    effectiveProfile?.actor_role || ActorRole.Learner
  );
  const [dataState, setDataState] = useState<ViewDataState>(ViewDataState.Empty);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [workspaceData, setWorkspaceData] =
    useState<WorkspaceBootstrapPayload | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState<boolean>(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Sync initial activeRole when profile loads or switches
  useEffect(() => {
    if (effectiveProfile?.actor_role) {
      setActiveRole(effectiveProfile.actor_role);
    }
  }, [effectiveProfile?.actor_role]);

  const refreshWorkspaceData = useCallback(
    async (params?: {
      kbPage?: number;
      kbPageSize?: number;
      kbSearch?: string;
      kbDomain?: string;
    }) => {
      const targetProfile = profile || savedProfile;
      if (!targetProfile) return;
      setIsLoadingWorkspace(true);
      setWorkspaceError(null);
      try {
        const res = await fetchWorkspaceBootstrap(params, targetProfile);
        setWorkspaceData(res);
      } catch (err) {
        setWorkspaceError(
          err instanceof Error
            ? err.message
            : 'Failed to load workspace operational records.'
        );
      } finally {
        setIsLoadingWorkspace(false);
      }
    },
    [profile, savedProfile]
  );

  useEffect(() => {
    const targetProfile = profile || savedProfile;
    if (targetProfile) {
      refreshWorkspaceData();
    }
  }, [profile, savedProfile, refreshWorkspaceData]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  const matchedNav =
    WORKSPACE_NAV_ITEMS.find((item) => location.pathname.startsWith(item.path)) ||
    WORKSPACE_NAV_ITEMS[0];

  return (
    <WorkspaceContext.Provider
      value={{
        activeRole,
        setActiveRole,
        dataState,
        setDataState,
        workspaceData,
        setWorkspaceData,
        isLoadingWorkspace,
        workspaceError,
        refreshWorkspaceData,
      }}
    >
      <div className="min-h-screen flex bg-[#F8F7F3] text-[#292A25]">
        <WorkspaceSidebar
          activeRole={activeRole}
          profile={effectiveProfile}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onSignOut={handleSignOut}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <WorkspaceHeader
            currentSectionLabel={matchedNav.label}
            activeRole={activeRole}
            profile={effectiveProfile}
            onRoleChange={setActiveRole}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onSignOut={handleSignOut}
          />

          {(welcomeEmailNotice || authWarning) && (
            <div className="max-w-6xl w-full mx-auto px-6 md:px-8 pt-5">
              <div
                role="status"
                className="rounded-md border border-[#777B63]/45 bg-[#E8E4DC]/80 px-4 py-3 flex items-start justify-between gap-4 text-xs text-[#292A25]"
              >
                <div className="flex items-start gap-2.5">
                  {authWarning ? (
                    <AlertTriangle
                      className="w-4 h-4 text-[#8C3A32] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2
                      className="w-4 h-4 text-[#777B63] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex flex-col gap-1">
                    {welcomeEmailNotice && <span>{welcomeEmailNotice}</span>}
                    {authWarning && <span>{authWarning}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={dismissNotices}
                  aria-label="Dismiss notification"
                  className="p-1 text-[#292A25]/60 hover:text-[#292A25]"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {workspaceError && (
            <div className="max-w-6xl w-full mx-auto px-6 md:px-8 pt-5">
              <div
                role="alert"
                className="rounded-md border border-[#8C3A32]/50 bg-[#8C3A32]/10 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-[#292A25]"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className="w-4 h-4 text-[#8C3A32] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1">
                    <strong className="text-[#8C3A32] font-semibold">
                      Workspace Data Synchronization Notice
                    </strong>
                    <span>{workspaceError}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isLoadingWorkspace}
                  onClick={() => refreshWorkspaceData()}
                  className="shrink-0 rounded border border-[#8C3A32]/40 bg-[#F8F7F3] px-3 py-1.5 text-xs font-medium text-[#292A25] hover:bg-[#E8E4DC] disabled:opacity-50 transition-colors"
                >
                  {isLoadingWorkspace ? 'Synchronizing...' : 'Retry Synchronization'}
                </button>
              </div>
            </div>
          )}

          <main
            key={`${location.pathname}-${activeRole}`}
            className="flex-1 p-6 md:p-8 max-w-6xl w-full mx-auto animate-page-enter"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
};
