import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Send, FileText, ShieldCheck, Lock } from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { ActorRole, ViewDataState } from '../../types/domain';
import { getActorMetadata } from '../../utils/rbac';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Button } from '../../components/ui/Button';
import { CheckboxField, TextAreaField } from '../../components/ui/InputField';
import { postTicketMessage } from '../../services/workspaceClient';

export const MessagesPage: React.FC = () => {
  const {
    activeRole,
    dataState,
    setDataState,
    workspaceData,
    refreshWorkspaceData: refreshWorkspace,
  } = useWorkspaceContext();
  const navigate = useNavigate();
  const actorMeta = getActorMetadata(activeRole);

  const tickets = workspaceData?.tickets ?? [];
  const allMessages = workspaceData?.messages ?? [];

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const isStaffOrAdmin =
    activeRole === ActorRole.SupportStaff ||
    activeRole === ActorRole.AcademicAdministrator ||
    activeRole === ActorRole.PlatformAdministrator;

  const activeTicketId = useMemo(() => {
    if (
      selectedTicketId &&
      tickets.some((t) => t.ticket_id === selectedTicketId)
    ) {
      return selectedTicketId;
    }
    return tickets[0]?.ticket_id ?? null;
  }, [selectedTicketId, tickets]);

  const activeTicket = useMemo(
    () => tickets.find((t) => t.ticket_id === activeTicketId) ?? null,
    [tickets, activeTicketId]
  );

  const threadMessages = useMemo(
    () =>
      allMessages
        .filter((m) => m.ticket_id === activeTicketId)
        .sort((a, b) => a.sequence_number - b.sequence_number),
    [allMessages, activeTicketId]
  );

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!activeTicketId || replyBody.trim().length < 5) {
      setSendError('Message body must be at least 5 characters.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await postTicketMessage({
        ticketId: activeTicketId,
        body: replyBody.trim(),
        isInternal: isStaffOrAdmin && isInternalNote,
      });
      setReplyBody('');
      setIsInternalNote(false);
      refreshWorkspace().catch(() => {});
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'Failed to post message.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
          <span>Request-Linked Correspondence</span>
          <span aria-hidden="true">·</span>
          <span>
            {tickets.length} Active Thread{tickets.length === 1 ? '' : 's'} (
            {allMessages.length} Messages)
          </span>
        </div>
        <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
          Messages
        </h1>
        <p className="text-sm text-[#292A25]/70">
          Every message is linked to an audited request thread with policy and knowledge article version citations.
        </p>
      </div>

      {dataState === ViewDataState.Loading && (
        <LoadingState
          label="Loading request correspondence threads..."
          rows={4}
        />
      )}

      {dataState === ViewDataState.Error && (
        <ErrorMessage
          title="Correspondence Service Error"
          message="Unable to load request correspondence threads."
          code="MESSAGES_LOAD_ERROR"
          onRetry={() => {
            setDataState(ViewDataState.Empty);
            refreshWorkspace();
          }}
        />
      )}

      {dataState !== ViewDataState.Loading &&
        dataState !== ViewDataState.Error &&
        tickets.length === 0 && (
          <EmptyState
            icon={<MessageSquare className="w-4 h-4" />}
            title="No active correspondence threads for this account"
            scopeContext={`${actorMeta.label} Inbox`}
            description="Submit a request to open an audited correspondence thread with your assigned university support team."
            primaryActionLabel={actorMeta.createRequestTitle}
            onPrimaryAction={() => navigate('/workspace/create-request')}
            secondaryActionLabel="View Request Ledger"
            onSecondaryAction={() => navigate('/workspace/requests')}
          />
        )}

      {dataState !== ViewDataState.Loading &&
        dataState !== ViewDataState.Error &&
        tickets.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Ticket Thread List */}
            <div className="lg:col-span-4 flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#777B63] px-1">
                Request Threads ({tickets.length})
              </div>
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
                {tickets.map((t) => {
                  const count = allMessages.filter(
                    (m) => m.ticket_id === t.ticket_id
                  ).length;
                  const isSelected = t.ticket_id === activeTicketId;
                  return (
                    <button
                      key={t.ticket_id}
                      type="button"
                      onClick={() => setSelectedTicketId(t.ticket_id)}
                      className={`text-left rounded-md border p-3.5 transition-colors flex flex-col gap-1.5 ${
                        isSelected
                          ? 'border-[#292A25] bg-[#E8E4DC]/85 shadow-2xs'
                          : 'border-[#292A25]/12 bg-[#F8F7F3] hover:bg-[#E8E4DC]/45'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-[#292A25]">
                          {t.ticket_id}
                        </span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#292A25]/10 text-[#292A25]">
                          {count} msg{count === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-[#292A25] line-clamp-1">
                        {t.subject}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-[#777B63]">
                        <span>{t.category_name}</span>
                        <span className="uppercase font-mono">
                          {t.lifecycle_status.replace('_', ' ')}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Active Thread Messages & Reply Composer */}
            <div className="lg:col-span-8 rounded-md border border-[#292A25]/15 bg-[#F8F7F3] p-5 flex flex-col gap-4">
              {activeTicket && (
                <>
                  <div className="border-b border-[#292A25]/10 pb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#777B63]">
                          {activeTicket.ticket_id}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25] font-medium">
                          {activeTicket.category_name}
                        </span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#777B63]/15 text-[#292A25]">
                          {activeTicket.current_assigned_team}
                        </span>
                      </div>
                      <h2 className="font-serif-display text-xl text-[#292A25] mt-1">
                        {activeTicket.subject}
                      </h2>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/workspace/requests')}
                    >
                      Inspect Full Traceability
                    </Button>
                  </div>

                  {/* Message list */}
                  <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
                    {threadMessages.map((m) => (
                      <div
                        key={m.message_id}
                        className={`rounded-md border p-4 flex flex-col gap-2 ${
                          m.is_internal
                            ? 'border-[#8C6A2E]/45 bg-[#8C6A2E]/10'
                            : m.message_type === 'requester_inquiry'
                            ? 'border-[#292A25]/15 bg-[#E8E4DC]/40'
                            : 'border-[#777B63]/35 bg-[#F8F7F3]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#292A25]">
                              {m.sender_name}
                            </span>
                            <span className="text-[11px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#292A25]/8 text-[#777B63]">
                              {m.message_type.replace(/_/g, ' ')}
                            </span>
                            {m.is_internal && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-[#8C6A2E]/20 text-[#292A25]">
                                <Lock className="w-3 h-3" />
                                Internal Staff Note
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-[#777B63]">
                              {m.message_id}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-[#777B63]">
                            {new Date(m.created_at).toLocaleString()}
                          </span>
                        </div>

                        <p className="text-sm text-[#292A25] leading-relaxed whitespace-pre-wrap">
                          {m.body}
                        </p>

                        {(m.cited_policy_id || m.cited_article_id) && (
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-[#777B63]">
                            <ShieldCheck className="w-3.5 h-3.5 text-[#777B63]" />
                            <span>Grounded Sources:</span>
                            {m.cited_policy_id && (
                              <span className="font-mono px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                                {m.cited_policy_id} (v
                                {m.cited_policy_version ?? '2.0'})
                              </span>
                            )}
                            {m.cited_article_id && (
                              <span className="font-mono px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                                <FileText className="w-3 h-3 inline mr-1" />
                                {m.cited_article_id}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Reply Composer */}
                  <form
                    onSubmit={handleSendReply}
                    className="border-t border-[#292A25]/12 pt-4 flex flex-col gap-3"
                  >
                    {sendError && (
                      <div className="rounded border border-[#8F3F34]/40 bg-[#8F3F34]/10 p-2.5 text-xs text-[#8F3F34]">
                        {sendError}
                      </div>
                    )}
                    <TextAreaField
                      label={`Post Reply to ${activeTicket.ticket_id}`}
                      placeholder="Add documentation, policy clarification, or follow-up details to this ticket thread (min 5 chars)..."
                      rows={3}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      required
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {isStaffOrAdmin ? (
                        <CheckboxField
                          label="Internal Staff Note (Visible only to Support Staff & Administrators)"
                          checked={isInternalNote}
                          onChange={(e) => setIsInternalNote(e.target.checked)}
                        />
                      ) : (
                        <span className="text-[11px] text-[#777B63]">
                          Replies are recorded in the audited ticket thread.
                        </span>
                      )}
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={sending || replyBody.trim().length < 5}
                        leftIcon={<Send className="w-3.5 h-3.5" />}
                      >
                        {sending
                          ? 'Posting Message...'
                          : isStaffOrAdmin && isInternalNote
                          ? 'Record Internal Note'
                          : 'Send Audited Message'}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
};
