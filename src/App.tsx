/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { PublicLayout } from './components/layout/PublicLayout';
import { WorkspaceLayout } from './components/layout/WorkspaceLayout';
import { HomePage } from './pages/public/HomePage';
import { AboutPage } from './pages/public/AboutPage';
import { FeaturesPage } from './pages/public/FeaturesPage';
import { ContactPage } from './pages/public/ContactPage';
import { SignInPage } from './pages/public/SignInPage';
import { SignUpPage } from './pages/public/SignUpPage';
import { ResetPasswordPage } from './pages/public/ResetPasswordPage';
import { DashboardPage } from './pages/workspace/DashboardPage';
import { MyRequestsPage } from './pages/workspace/MyRequestsPage';
import { CreateRequestPage } from './pages/workspace/CreateRequestPage';
import { AIAssistantPage } from './pages/workspace/AIAssistantPage';
import { KnowledgeBasePage } from './pages/workspace/KnowledgeBasePage';
import { MessagesPage } from './pages/workspace/MessagesPage';
import { NotificationsPage } from './pages/workspace/NotificationsPage';
import { ProfilePage } from './pages/workspace/ProfilePage';
import { SettingsPage } from './pages/workspace/SettingsPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Website Routes */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/sign-up" element={<SignUpPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>

          {/* Private Protected Application Workspace Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/workspace" element={<WorkspaceLayout />}>
              <Route index element={<Navigate to="/workspace/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="requests" element={<MyRequestsPage />} />
              <Route path="create-request" element={<CreateRequestPage />} />
              <Route path="assistant" element={<AIAssistantPage />} />
              <Route path="knowledge-base" element={<KnowledgeBasePage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
