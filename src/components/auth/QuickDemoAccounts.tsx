import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  BookOpen,
  Headphones,
  ShieldCheck,
  Cpu,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { ActorRole } from '../../types/domain';
import { useAuth, INSTITUTIONAL_DEMO_ACCOUNTS, DemoAccountConfig } from '../../context/AuthContext';

const ROLE_ICONS: Record<ActorRole, React.FC<{ className?: string }>> = {
  [ActorRole.Learner]: GraduationCap,
  [ActorRole.Instructor]: BookOpen,
  [ActorRole.SupportStaff]: Headphones,
  [ActorRole.AcademicAdministrator]: ShieldCheck,
  [ActorRole.PlatformAdministrator]: Cpu,
};

export const QuickDemoAccounts: React.FC<{
  onBeforeSignIn?: () => void;
}> = ({ onBeforeSignIn }) => {
  const { signInDemoAccount } = useAuth();
  const navigate = useNavigate();
  const [loadingRole, setLoadingRole] = useState<ActorRole | null>(null);

  const handleSelectRole = async (demo: DemoAccountConfig) => {
    if (loadingRole) return;
    setLoadingRole(demo.role);
    if (onBeforeSignIn) onBeforeSignIn();

    try {
      await signInDemoAccount(demo.role);
      navigate('/workspace/dashboard', { replace: true });
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <div className="rounded-md border border-[#292A25]/15 bg-[#E8E4DC]/40 p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 border-b border-[#292A25]/10 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-[#777B63]/20 text-[#292A25]">
            <Zap className="w-4 h-4 text-[#777B63]" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#292A25]">
              Quick Demo Accounts
            </h2>
            <p className="text-xs text-[#292A25]/70">
              One-click instant login to preview role-based views and features:
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono-tabular bg-[#292A25]/10 text-[#292A25] px-2 py-0.5 rounded font-medium">
          5 Roles
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {INSTITUTIONAL_DEMO_ACCOUNTS.map((demo) => {
          const Icon = ROLE_ICONS[demo.role] || GraduationCap;
          const isLoading = loadingRole === demo.role;

          return (
            <button
              key={demo.role}
              type="button"
              disabled={Boolean(loadingRole)}
              onClick={() => handleSelectRole(demo)}
              className="text-left p-3 rounded-md bg-[#F8F7F3] border border-[#292A25]/12 hover:border-[#777B63] hover:shadow-2xs transition-all flex flex-col justify-between gap-2 group cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#777B63]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded bg-[#E8E4DC] text-[#292A25] group-hover:bg-[#292A25] group-hover:text-[#F8F7F3] transition-colors">
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-semibold text-[#292A25]">
                    {demo.label}
                  </span>
                </div>
                <span className="text-[10px] text-[#777B63] font-mono-tabular">
                  {demo.badge}
                </span>
              </div>

              <div className="text-[11px] text-[#292A25]/75 line-clamp-2 leading-relaxed">
                {demo.description}
              </div>

              <div className="pt-1.5 border-t border-[#292A25]/8 flex items-center justify-between text-[11px] font-medium text-[#777B63] group-hover:text-[#292A25]">
                <span className="truncate">{demo.displayName}</span>
                <span className="flex items-center gap-1 shrink-0 ml-1">
                  {isLoading ? 'Entering...' : 'Log In'}
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
