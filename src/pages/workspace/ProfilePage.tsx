import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { useAuth } from '../../context/AuthContext';
import { ActorRole } from '../../types/domain';
import { getActorMetadata } from '../../utils/rbac';
import {
  ProfileFormInput,
  validateProfileForm,
} from '../../utils/validation';
import { Form } from '../../components/ui/Form';
import { InputField } from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';

export const ProfilePage: React.FC = () => {
  const { activeRole } = useWorkspaceContext();
  const { profile, updateProfile } = useAuth();
  const actorMeta = getActorMetadata(activeRole);
  const authoritativeRoleMeta = getActorMetadata(
    profile?.actor_role || ActorRole.Learner
  );

  const [formState, setFormState] = useState<ProfileFormInput>({
    displayName: profile?.display_name || '',
    institutionalEmail: profile?.verified_email || '',
    departmentUnit: profile?.department || '',
    officeOrCohort: profile?.office_or_cohort || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (profile) {
      setFormState({
        displayName: profile.display_name,
        institutionalEmail: profile.verified_email,
        departmentUnit: profile.department,
        officeOrCohort: profile.office_or_cohort || '',
      });
    }
  }, [profile]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = validateProfileForm(formState);
    setErrors(res.errors);
    if (!res.isValid) {
      setSaveFeedback(null);
      return;
    }

    setIsSaving(true);
    setSaveFeedback(null);
    const updateRes = await updateProfile({
      displayName: formState.displayName,
      department: formState.departmentUnit,
      officeOrCohort: formState.officeOrCohort || null,
    });
    setIsSaving(false);
    setSaveFeedback({
      ok: updateRes.ok,
      message: updateRes.message,
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
          <span>Unified Institutional Profile</span>
          <span aria-hidden="true">·</span>
          <span>Assigned Role: {authoritativeRoleMeta.label}</span>
        </div>
        <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
          Profile & Institutional Identity
        </h1>
        <p className="text-sm text-[#292A25]/70">
          Review your verified authentication identity, assigned institutional
          role, and update your academic department or office profile details.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Authoritative Identity & RBAC Scope Card */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {profile && (
            <div className="rounded-md surface-elevated p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-[#292A25]/10 pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#292A25]">
                  <Lock className="w-3.5 h-3.5 text-[#777B63]" aria-hidden="true" />
                  <span>Protected Identity Record (Read-Only)</span>
                </div>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                  {profile.account_status}
                </span>
              </div>

              <dl className="flex flex-col gap-3 text-xs">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[#292A25]/60">Verified Email</dt>
                  <dd className="font-semibold text-[#292A25]">
                    {profile.verified_email}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5">
                  <dt className="text-[#292A25]/60">Authentication Method</dt>
                  <dd className="font-medium text-[#292A25]">
                    {profile.auth_provider === 'firebase_google'
                      ? 'Google Single Sign-On'
                      : 'Institutional Email & Password'}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5">
                  <dt className="text-[#292A25]/60">Account Identifier</dt>
                  <dd className="font-mono text-[11px] text-[#292A25]/85 break-all">
                    {profile.provider_subject}
                  </dd>
                </div>

                <div className="flex flex-col gap-0.5">
                  <dt className="text-[#292A25]/60">
                    Assigned Institutional Role
                  </dt>
                  <dd className="font-semibold text-[#777B63]">
                    {authoritativeRoleMeta.label} ({profile.actor_role})
                  </dd>
                </div>

                {profile.requested_role_note && (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[#292A25]/60">
                      Recorded Role Review Note
                    </dt>
                    <dd className="text-[#292A25]/80">
                      {profile.requested_role_note}
                    </dd>
                  </div>
                )}

                <div className="flex flex-col gap-0.5">
                  <dt className="text-[#292A25]/60">Account Activation Notice</dt>
                  <dd className="text-[#292A25]/80">
                    {profile.welcome_email_sent_at
                      ? `Recorded at ${new Date(profile.welcome_email_sent_at).toLocaleString()}`
                      : 'Active institutional account'}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/55 p-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5 border-b border-[#292A25]/10 pb-4">
              <div className="text-xs font-medium text-[#777B63]">
                Current Workspace Role View
              </div>
              <h2 className="font-serif-display text-2xl text-[#292A25]">
                {actorMeta.label}
              </h2>
              <p className="text-xs text-[#292A25]/70">
                {actorMeta.institutionalScope}
              </p>
            </div>

            <p className="text-xs text-[#292A25]/80 leading-relaxed">
              {actorMeta.description}
            </p>

            <div className="flex flex-col gap-2 pt-2 border-t border-[#292A25]/10">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#292A25]">
                <Shield
                  className="w-3.5 h-3.5 text-[#777B63]"
                  aria-hidden="true"
                />
                <span>Role Governance & Restrictions</span>
              </div>
              <ul className="flex flex-col gap-1.5 text-xs text-[#292A25]/75 list-disc pl-4">
                {actorMeta.restrictedCapabilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Right: Editable Profile Metadata Form */}
        <div className="lg:col-span-7 rounded-md surface-elevated p-6 md:p-8">
          {saveFeedback && (
            <div
              role="status"
              className={`mb-6 rounded-md border p-4 flex items-start gap-2.5 text-xs leading-relaxed ${
                saveFeedback.ok
                  ? 'border-[#777B63]/45 bg-[#E8E4DC]/75 text-[#292A25]'
                  : 'border-[#8C3A32]/45 bg-[#8C3A32]/10 text-[#292A25]'
              }`}
            >
              {saveFeedback.ok ? (
                <CheckCircle2
                  className="w-4 h-4 text-[#777B63] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              ) : (
                <AlertCircle
                  className="w-4 h-4 text-[#8C3A32] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
              )}
              <div>
                <strong className="text-[#292A25] block mb-0.5">
                  {saveFeedback.ok
                    ? 'Profile Updated'
                    : 'Profile Update Notice'}
                </strong>
                {saveFeedback.message}
              </div>
            </div>
          )}

          <Form
            title="Editable Institutional Profile Attributes"
            description="Update your display name, academic department, or office/program note. Verified email, authentication method, and assigned institutional role are managed by university identity governance."
            onSubmit={handleProfileSubmit}
            footer={
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFormState({
                      displayName: profile?.display_name || '',
                      institutionalEmail: profile?.verified_email || '',
                      departmentUnit: profile?.department || '',
                      officeOrCohort: profile?.office_or_cohort || '',
                    });
                    setErrors({});
                    setSaveFeedback(null);
                  }}
                >
                  Reset to Saved Values
                </Button>
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving ? 'Saving Profile...' : 'Save Profile Changes'}
                </Button>
              </>
            }
          >
            <InputField
              label="Full Name"
              required
              placeholder="Enter full name"
              value={formState.displayName}
              onChange={(e) =>
                setFormState({ ...formState, displayName: e.target.value })
              }
              error={errors.displayName}
            />

            <InputField
              label="Verified Institutional Email Address (Read-Only)"
              type="email"
              required
              disabled
              placeholder="name@university.edu"
              value={formState.institutionalEmail}
              onChange={() => {}}
              helperText="Managed by your institutional identity provider."
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <InputField
                label="Academic Department or Unit"
                required
                placeholder="Enter department or unit"
                value={formState.departmentUnit}
                onChange={(e) =>
                  setFormState({ ...formState, departmentUnit: e.target.value })
                }
                error={errors.departmentUnit}
              />

              <InputField
                label="Office or Program Note (Optional)"
                placeholder="Optional office or program note"
                value={formState.officeOrCohort}
                onChange={(e) =>
                  setFormState({ ...formState, officeOrCohort: e.target.value })
                }
              />
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
};
