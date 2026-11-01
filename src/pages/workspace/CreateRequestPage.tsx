import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { getActorCategories, getActorMetadata } from '../../utils/rbac';
import {
  CreateRequestFormInput,
  validateCreateRequestForm,
} from '../../utils/validation';
import {
  OFFICIAL_CATEGORIES,
  DOCUMENTED_ROUTING_RULES,
} from '../../services/workflowEngine';
import {
  createOperationalTicket,
  linkPolicyAssistantEscalationTicket,
} from '../../services/workspaceClient';
import { AssignmentRecord, SLARecord, TicketRecord } from '../../types/phase3';
import { Form } from '../../components/ui/Form';
import {
  InputField,
  SelectField,
  TextAreaField,
  CheckboxField,
} from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';

const DEPARTMENT_OPTIONS = [
  {
    value: 'Office of Financial Aid & Scholarships',
    label: 'Office of Financial Aid & Scholarships',
  },
  {
    value: 'Office of the University Registrar',
    label: 'Office of the University Registrar',
  },
  {
    value: 'Campus IT Operations & Identity Desk',
    label: 'Campus IT Operations & Identity Desk',
  },
  {
    value: 'Disability & Accessibility Services Office',
    label: 'Disability & Accessibility Services Office',
  },
  {
    value: 'Academic Administration Review Office',
    label: 'Academic Administration Review Office',
  },
];

const URGENCY_OPTIONS = [
  {
    value: 'Standard Priority',
    label: 'Standard Priority',
  },
  {
    value: 'Time-Sensitive Academic Priority',
    label: 'Time-Sensitive Academic Priority',
  },
  {
    value: 'Administrative Escalation Priority',
    label: 'Administrative Escalation Priority (Triggers Escalation Review)',
  },
];

export const CreateRequestPage: React.FC = () => {
  const { activeRole, refreshWorkspaceData } = useWorkspaceContext();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (
    location.state as {
      prefill?: Partial<CreateRequestFormInput> & { fromQueryId?: string };
    } | null
  )?.prefill;
  const actorMeta = getActorMetadata(activeRole);
  const roleCategories = getActorCategories(activeRole);

  // Surface the 4 core categories first, followed by role-scoped intake options
  const categoryOptions = [
    ...OFFICIAL_CATEGORIES.map((c) => ({
      value: c,
      label: `${c} (${DOCUMENTED_ROUTING_RULES[c].primary_assigned_team})`,
    })),
    ...roleCategories
      .filter((rc) => !(OFFICIAL_CATEGORIES as readonly string[]).includes(rc))
      .map((rc) => ({ value: rc, label: rc })),
  ];

  const [formState, setFormState] = useState<CreateRequestFormInput>({
    subject: prefill?.subject || '',
    category: prefill?.category || '',
    departmentTarget: prefill?.departmentTarget || '',
    urgencyLevel: prefill?.urgencyLevel || '',
    courseOrPolicyCode: prefill?.courseOrPolicyCode || '',
    description: prefill?.description || '',
    policyAcknowledged: Boolean(prefill?.policyAcknowledged),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    ticket: TicketRecord;
    assignment: AssignmentRecord;
    sla: SLARecord;
  } | null>(null);

  const handleValidateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateCreateRequestForm(formState);
    setErrors(result.errors);
    setSubmitError(null);
    if (result.isValid) {
      setConfirmDialogOpen(true);
    }
  };

  const handleConfirmSubmission = async () => {
    setConfirmDialogOpen(false);
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await createOperationalTicket({
        subject: formState.subject,
        category: formState.category,
        departmentTarget: formState.departmentTarget,
        urgencyLevel: formState.urgencyLevel,
        courseOrPolicyCode: formState.courseOrPolicyCode,
        description: formState.description,
      });

      if (prefill?.fromQueryId && res.ticket?.ticket_id) {
        try {
          await linkPolicyAssistantEscalationTicket({
            queryId: prefill.fromQueryId,
            ticketId: res.ticket.ticket_id,
          });
        } catch {
          // Non-blocking audit link update
        }
      }

      setCreatedResult({
        ticket: res.ticket,
        assignment: res.assignment,
        sla: res.sla,
      });
      await refreshWorkspaceData();
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Failed to create operational ticket.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormState({
      subject: '',
      category: '',
      departmentTarget: '',
      urgencyLevel: '',
      courseOrPolicyCode: '',
      description: '',
      policyAcknowledged: false,
    });
    setErrors({});
    setSubmitError(null);
    setCreatedResult(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
          <span>{actorMeta.label} Intake Workflow</span>
          <span aria-hidden="true">·</span>
          <span>Rule-Based Classification, Routing & SLA Tracking</span>
        </div>
        <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
          {actorMeta.createRequestTitle}
        </h1>
        <p className="text-sm text-[#292A25]/70">
          Submit a request across Financial Aid, Registration, IT, or
          Accessibility to route your case to the appropriate university support
          team with applicable policy citations and SLA tracking.
        </p>
      </div>

      {submitError && (
        <div
          role="alert"
          className="rounded-md border border-[#8C3A32]/45 bg-[#8C3A32]/10 p-4 flex items-start gap-2.5 text-xs text-[#292A25]"
        >
          <AlertCircle className="w-4 h-4 text-[#8C3A32] shrink-0 mt-0.5" />
          <div>
            <strong className="block mb-0.5">Request Submission Error</strong>
            {submitError}
          </div>
        </div>
      )}

      {createdResult && (
        <div
          role="status"
          className="rounded-md border border-[#777B63]/45 bg-[#E8E4DC]/80 p-5 flex flex-col gap-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#292A25]/10 pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#292A25]">
              <ShieldCheck
                className="w-4 h-4 text-[#777B63]"
                aria-hidden="true"
              />
              <span>
                Request Submitted & Routed · Ticket ID:{' '}
                <span className="font-mono text-sm underline">
                  {createdResult.ticket.ticket_id}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="primary"
                onClick={() => navigate('/workspace/requests')}
              >
                Inspect in My Requests
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/workspace/messages')}
              >
                Open Correspondence Thread
              </Button>
              <Button size="sm" variant="ghost" onClick={handleReset}>
                Create Another
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded bg-[#F8F7F3] p-3 border border-[#292A25]/10">
              <dt className="text-[#292A25]/60">Official Category & Rule</dt>
              <dd className="font-semibold text-[#292A25] mt-0.5">
                {createdResult.ticket.category_name} (
                <span className="font-mono">
                  {createdResult.assignment.routing_rule_id}
                </span>
                )
              </dd>
            </div>
            <div className="rounded bg-[#F8F7F3] p-3 border border-[#292A25]/10">
              <dt className="text-[#292A25]/60">Assigned Responsible Team</dt>
              <dd className="font-semibold text-[#292A25] mt-0.5">
                {createdResult.assignment.assigned_team}
              </dd>
            </div>
            <div className="rounded bg-[#F8F7F3] p-3 border border-[#292A25]/10">
              <dt className="text-[#292A25]/60">Referenced Policy & Article</dt>
              <dd className="font-mono text-[11px] font-semibold text-[#777B63] mt-0.5">
                {createdResult.ticket.referenced_policy_id} v
                {createdResult.ticket.referenced_policy_version} ·{' '}
                {createdResult.ticket.referenced_article_id} v
                {createdResult.ticket.referenced_article_version}
              </dd>
            </div>
            <div className="rounded bg-[#F8F7F3] p-3 border border-[#292A25]/10">
              <dt className="text-[#292A25]/60">
                SLA Record ({createdResult.sla.sla_id})
              </dt>
              <dd className="font-mono text-[11px] text-[#292A25] mt-0.5">
                Target: {createdResult.sla.target_business_minutes}m · Due:{' '}
                {new Date(createdResult.sla.due_timestamp).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <div className="rounded-md surface-elevated p-6 md:p-8">
        <Form
          title="Request Classification & Details"
          description="Select an official category (Financial Aid, Registration, IT, Accessibility) or role-scoped inquiry type."
          onSubmit={handleValidateSubmit}
          footer={
            <>
              <Button variant="outline" onClick={handleReset}>
                Clear Form
              </Button>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting
                  ? 'Submitting Request...'
                  : 'Validate & Submit Request'}
              </Button>
            </>
          }
        >
          <InputField
            label="Request Subject"
            required
            placeholder="Enter a concise summary of your request"
            value={formState.subject}
            onChange={(e) =>
              setFormState({ ...formState, subject: e.target.value })
            }
            error={errors.subject}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SelectField
              label="Request Category"
              required
              placeholder="Select category..."
              options={categoryOptions}
              value={formState.category}
              onChange={(e) =>
                setFormState({ ...formState, category: e.target.value })
              }
              error={errors.category}
            />

            <SelectField
              label="Target Academic or Support Unit"
              required
              placeholder="Select receiving unit..."
              options={DEPARTMENT_OPTIONS}
              value={formState.departmentTarget}
              onChange={(e) =>
                setFormState({ ...formState, departmentTarget: e.target.value })
              }
              error={errors.departmentTarget}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SelectField
              label="Priority Classification"
              required
              placeholder="Select priority level..."
              options={URGENCY_OPTIONS}
              value={formState.urgencyLevel}
              onChange={(e) =>
                setFormState({ ...formState, urgencyLevel: e.target.value })
              }
              error={errors.urgencyLevel}
            />

            <InputField
              label="Course or Policy Reference (Optional)"
              placeholder="e.g., POL-FINAID-2026-002, POL-REG-2026-002, or CS-101"
              value={formState.courseOrPolicyCode}
              onChange={(e) =>
                setFormState({
                  ...formState,
                  courseOrPolicyCode: e.target.value,
                })
              }
              helperText="Include a policy ID (e.g., POL-REG-2026-002) or course code if applicable."
            />
          </div>

          <TextAreaField
            label="Request Summary & Context"
            required
            rows={5}
            placeholder="Provide a clear summary of your request and relevant context (minimum 25 characters)..."
            value={formState.description}
            onChange={(e) =>
              setFormState({ ...formState, description: e.target.value })
            }
            error={errors.description}
          />

          <CheckboxField
            label="I confirm that the information provided is accurate and ready for routing."
            checked={formState.policyAcknowledged}
            onChange={(e) =>
              setFormState({
                ...formState,
                policyAcknowledged: e.target.checked,
              })
            }
            error={errors.policyAcknowledged}
          />
        </Form>
      </div>

      <ConfirmationDialog
        isOpen={confirmDialogOpen}
        title="Confirm Request Submission"
        description={`You are submitting a ${actorMeta.label} request under "${formState.category}" targeted to "${formState.departmentTarget}". Confirm to submit your request, route it to the responsible department, attach applicable policy references, and start SLA tracking.`}
        confirmLabel="Confirm & Submit Request"
        cancelLabel="Return to Edit"
        onConfirm={handleConfirmSubmission}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </div>
  );
};
