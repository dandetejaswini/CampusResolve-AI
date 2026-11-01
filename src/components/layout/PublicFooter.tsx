import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export const PublicFooter: React.FC = () => {
  const { status, profile } = useAuth();
  const isAuthenticated = status === 'authenticated' && Boolean(profile);

  return (
    <footer className="w-full bg-[#292A25] text-[#F8F7F3] border-t border-[#292A25]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-[#F8F7F3]/12">
          <div className="md:col-span-5 flex flex-col gap-4">
            <Link
              to="/"
              className="font-serif-display text-2xl text-[#F8F7F3] tracking-tight w-fit"
            >
              CampusResolve AI
            </Link>
            <p className="text-sm text-[#E8E4DC]/80 leading-relaxed max-w-md">
              An intelligent platform for routing learner and instructor requests,
              retrieving policy-grounded answers, and tracking resolution and
              escalation across university workflows.
            </p>
            <div className="flex items-center gap-2 text-xs text-[#B5A58D] pt-1">
              <span>Academic Request Routing</span>
              <span aria-hidden="true">·</span>
              <span>Policy-Grounded Governance</span>
            </div>
          </div>

          <div className="md:col-span-2 flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-wider text-[#B5A58D] font-sans">
              Public Pages
            </h2>
            <ul className="flex flex-col gap-2.5 text-sm text-[#E8E4DC]/80">
              <li>
                <Link to="/" className="hover:text-[#F8F7F3] transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-[#F8F7F3] transition-colors">
                  About
                </Link>
              </li>
              <li>
                <Link to="/features" className="hover:text-[#F8F7F3] transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-[#F8F7F3] transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-2 flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-wider text-[#B5A58D] font-sans">
              Workspace & Access
            </h2>
            <ul className="flex flex-col gap-2.5 text-sm text-[#E8E4DC]/80">
              {!isAuthenticated && status !== 'loading' && (
                <>
                  <li>
                    <Link to="/sign-in" className="hover:text-[#F8F7F3] transition-colors">
                      Sign In
                    </Link>
                  </li>
                  <li>
                    <Link to="/sign-up" className="hover:text-[#F8F7F3] transition-colors">
                      Sign Up
                    </Link>
                  </li>
                </>
              )}
              <li>
                <Link
                  to="/workspace/dashboard"
                  className="hover:text-[#F8F7F3] transition-colors"
                >
                  Open Workspace
                </Link>
              </li>
              <li>
                <Link
                  to="/workspace/assistant"
                  className="hover:text-[#F8F7F3] transition-colors"
                >
                  AI Policy Assistant
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3 flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-wider text-[#B5A58D] font-sans">
              Institutional Inquiry Channel
            </h2>
            <div className="flex flex-col gap-2 text-sm text-[#E8E4DC]/75 leading-relaxed">
              <p>Academic Workflow & Policy Governance</p>
              <p className="text-xs text-[#E8E4DC]/65">
                Submit questions regarding academic request routing, policy
                references, or institutional support via the{' '}
                <Link
                  to="/contact"
                  className="text-[#B5A58D] underline underline-offset-4 hover:text-[#F8F7F3]"
                >
                  Contact Inquiry Form
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#E8E4DC]/65">
          <p>© {new Date().getFullYear()} CampusResolve AI. Academic Request Routing & Policy Governance.</p>
          <div className="flex items-center gap-4">
            <Link to="/about" className="hover:text-[#F8F7F3] transition-colors">
              Platform Architecture
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/features" className="hover:text-[#F8F7F3] transition-colors">
              Role Capabilities
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/contact" className="hover:text-[#F8F7F3] transition-colors">
              Inquiry Form
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
