import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoadingState } from '../ui/LoadingState';

export const ProtectedRoute: React.FC = () => {
  const { status, profile } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#F8F7F3] text-[#292A25] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <LoadingState label="Verifying Institutional Session..." />
        </div>
      </div>
    );
  }

  if (status !== 'authenticated' || !profile) {
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
