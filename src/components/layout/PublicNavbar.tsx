import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About', end: false },
  { to: '/features', label: 'Features', end: false },
  { to: '/contact', label: 'Contact', end: false },
  { to: '/sign-in', label: 'Sign In', end: false },
];

export const PublicNavbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { status, profile } = useAuth();
  const isAuthenticated = status === 'authenticated' && Boolean(profile);

  return (
    <header className="sticky top-0 z-40 w-full bg-[#F8F7F3]/95 backdrop-blur-xs border-b border-[#292A25]/12">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single text element wordmark */}
        <Link
          to="/"
          className="font-serif-display text-xl tracking-tight text-[#292A25] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#777B63]"
        >
          CampusResolve AI
        </Link>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#292A25]/75"
        >
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `py-1 transition-colors duration-150 whitespace-nowrap shrink-0 border-b-2 ${
                  isActive
                    ? 'text-[#292A25] border-[#777B63]'
                    : 'border-transparent hover:text-[#292A25] hover:border-[#B5A58D]'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="hidden md:flex items-center shrink-0">
          {isAuthenticated ? (
            <Link
              to="/workspace/dashboard"
              className="px-4 py-2 text-xs font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#777B63]"
            >
              Open Workspace
            </Link>
          ) : (
            <Link
              to="/sign-up"
              className="px-4 py-2 text-xs font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#777B63]"
            >
              Create Account
            </Link>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-expanded={mobileMenuOpen}
          aria-label={
            mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'
          }
          className="md:hidden p-2 rounded-md text-[#292A25] hover:bg-[#E8E4DC]/70 focus-visible:outline-2 focus-visible:outline-[#777B63]"
        >
          {mobileMenuOpen ? (
            <X className="w-5 h-5" aria-hidden="true" />
          ) : (
            <Menu className="w-5 h-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden border-t border-[#292A25]/12 bg-[#F8F7F3] px-6 py-5 flex flex-col gap-3 animate-page-enter"
        >
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `py-2 text-sm font-medium transition-colors ${
                  isActive ? 'text-[#777B63] font-semibold' : 'text-[#292A25]/80'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <div className="pt-2 border-t border-[#292A25]/10">
            <Link
              to={isAuthenticated ? '/workspace/dashboard' : '/sign-up'}
              onClick={() => setMobileMenuOpen(false)}
              className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-[#F8F7F3] bg-[#292A25] rounded-md hover:bg-[#777B63] transition-colors"
            >
              {isAuthenticated ? 'Open Workspace' : 'Create Account'}
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
};
