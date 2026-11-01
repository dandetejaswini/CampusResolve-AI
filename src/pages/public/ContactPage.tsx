import React, { useState } from 'react';
import { Form } from '../../components/ui/Form';
import {
  InputField,
  SelectField,
  TextAreaField,
} from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import {
  ContactFormInput,
  validateContactForm,
} from '../../utils/validation';

const ACTOR_ROLE_OPTIONS = [
  { value: 'Learner', label: 'Learner' },
  { value: 'Instructor', label: 'Instructor' },
  { value: 'Academic Administrator', label: 'Academic Administrator' },
  { value: 'Support Staff', label: 'Support Staff' },
  { value: 'Platform Administrator', label: 'Platform Administrator' },
];

const TOPIC_OPTIONS = [
  { value: 'Request Routing & Tracking', label: 'Request Routing & Tracking' },
  { value: 'Policy-Grounded Answer Retrieval', label: 'Policy-Grounded Answer Retrieval' },
  { value: 'Resolution & Escalation Workflow', label: 'Resolution & Escalation Workflow' },
  { value: 'Role Permissions & Workspace Access', label: 'Role Permissions & Workspace Access' },
];

export const ContactPage: React.FC = () => {
  const [formState, setFormState] = useState<ContactFormInput>({
    fullName: '',
    email: '',
    institution: '',
    actorRole: '',
    topic: '',
    message: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validatedNotice, setValidatedNotice] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateContactForm(formState);
    setErrors(result.errors);
    if (result.isValid) {
      setValidatedNotice(true);
    } else {
      setValidatedNotice(false);
    }
  };

  const handleReset = () => {
    setFormState({
      fullName: '',
      email: '',
      institution: '',
      actorRole: '',
      topic: '',
      message: '',
    });
    setErrors({});
    setValidatedNotice(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 md:py-20">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left Column: Contact & Platform Information */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="flex items-center gap-2 text-xs font-medium text-[#777B63]">
            <span>Platform Correspondence</span>
            <span aria-hidden="true">·</span>
            <span>Institutional Support Channel</span>
          </div>

          <h1
            className="font-serif-display text-3xl md:text-4xl text-[#292A25] tracking-tight leading-tight"
            style={{ textWrap: 'balance' }}
          >
            Submit a platform or workflow inquiry.
          </h1>

          <p className="text-sm md:text-base text-[#292A25]/75 leading-relaxed">
            Use this form to submit general questions regarding request routing,
            policy-grounded answer retrieval, or institutional role access.
          </p>

          <div className="rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/55 p-6 flex flex-col gap-4 mt-2">
            <div>
              <h2 className="text-xs font-semibold text-[#777B63] font-sans">
                Inquiry Handling & Support Routing
              </h2>
              <p className="text-xs text-[#292A25]/80 mt-1 leading-relaxed">
                This channel handles general inquiries regarding platform
                capabilities and institutional onboarding. Registered learners,
                instructors, and staff should sign in to the workspace to submit
                and track formal academic or operational requests.
              </p>
            </div>
            <div className="border-t border-[#292A25]/10 pt-3">
              <div className="text-xs font-semibold text-[#292A25]">
                Direct Workspace Submissions
              </div>
              <p className="text-xs text-[#292A25]/70 mt-0.5 leading-relaxed">
                For active financial aid, registration, campus IT, or
                accessibility cases requiring departmental routing and service
                level tracking, sign in to use the Create Request workflow.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Validated Inquiry Form */}
        <div className="lg:col-span-7 rounded-md surface-elevated p-6 md:p-10">
          {validatedNotice && (
            <div
              role="status"
              className="mb-6 rounded-md border border-[#777B63]/45 bg-[#E8E4DC]/75 p-4 flex flex-col gap-2"
            >
              <div className="text-xs font-semibold text-[#292A25]">
                Inquiry Details Validated
              </div>
              <p className="text-xs text-[#292A25]/80 leading-relaxed">
                Thank you. Your inquiry details have been validated. To open a
                tracked request with a university department and receive formal
                status updates, please sign in to the CampusResolve AI
                workspace.
              </p>
            </div>
          )}

          <Form
            title="Platform Inquiry Form"
            description="Complete all required fields below to submit your inquiry."
            onSubmit={handleSubmit}
            footer={
              <>
                <Button variant="outline" onClick={handleReset}>
                  Clear Fields
                </Button>
                <Button type="submit" variant="primary">
                  Validate & Submit Inquiry
                </Button>
              </>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <InputField
                label="Full Name"
                required
                placeholder="Enter your full name"
                value={formState.fullName}
                onChange={(e) =>
                  setFormState({ ...formState, fullName: e.target.value })
                }
                error={errors.fullName}
              />

              <InputField
                label="Institutional Email"
                type="email"
                required
                placeholder="name@university.edu"
                value={formState.email}
                onChange={(e) =>
                  setFormState({ ...formState, email: e.target.value })
                }
                error={errors.email}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <InputField
                label="Academic Unit or Department"
                required
                placeholder="Enter department or unit"
                value={formState.institution}
                onChange={(e) =>
                  setFormState({ ...formState, institution: e.target.value })
                }
                error={errors.institution}
              />

              <SelectField
                label="Primary Actor Role"
                required
                placeholder="Select actor role..."
                options={ACTOR_ROLE_OPTIONS}
                value={formState.actorRole}
                onChange={(e) =>
                  setFormState({ ...formState, actorRole: e.target.value })
                }
                error={errors.actorRole}
              />
            </div>

            <SelectField
              label="Inquiry Topic"
              required
              placeholder="Select inquiry topic..."
              options={TOPIC_OPTIONS}
              value={formState.topic}
              onChange={(e) =>
                setFormState({ ...formState, topic: e.target.value })
              }
              error={errors.topic}
            />

            <TextAreaField
              label="Inquiry Details"
              required
              rows={5}
              placeholder="Describe your question regarding platform workflows or actor layouts (minimum 20 characters)..."
              value={formState.message}
              onChange={(e) =>
                setFormState({ ...formState, message: e.target.value })
              }
              error={errors.message}
              helperText="Minimum 20 characters required for validation."
            />
          </Form>
        </div>
      </div>
    </div>
  );
};
