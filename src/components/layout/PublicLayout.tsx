import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PublicNavbar } from './PublicNavbar';
import { PublicFooter } from './PublicFooter';

export const PublicLayout: React.FC = () => {
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7F3] text-[#292A25]">
      <PublicNavbar />
      <main key={location.pathname} className="flex-1 animate-page-enter">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
};
