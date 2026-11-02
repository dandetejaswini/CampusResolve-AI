import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoadingState } from '../ui/LoadingState';

export const ProtectedRoute: React.FC = () => {
  const { status, profile } = useAuth();
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

  if (status === 'loading' && !savedProfile) {
    return (
      <div className="min-h-screen bg-[#F8F7F3] text-[#292A25] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <LoadingState label="Verifying Institutional Session..." />
        </div>
      </div>
    );
  }

  const isAuthed =
    (status === 'authenticated' && Boolean(profile)) || Boolean(savedProfile);

  if (!isAuthed) {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{
          from: `${location.pathname}${location.search}`,
          reason: 'protected_workspace',
        }}
      />
    );
  }

  return <Outlet />;
};
