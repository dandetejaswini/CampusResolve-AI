import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  ArrowUpRight,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { ViewDataState } from '../../types/domain';
import { getActorMetadata } from '../../utils/rbac';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Button } from '../../components/ui/Button';
import { markAllNotificationsRead } from '../../services/workspaceClient';

export const NotificationsPage: React.FC = () => {
  const {
    activeRole,
    dataState,
    setDataState,
    workspaceData,
    refreshWorkspaceData: refreshWorkspace,
  } = useWorkspaceContext();
  const navigate = useNavigate();
  const actorMeta = getActorMetadata(activeRole);
  const [filterCategory, setFilterCategory] = useState<
    'all' | 'escalations' | 'policy'
  >('all');
  const [markingRead, setMarkingRead] = useState(false);

  const notifications = workspaceData?.notifications ?? [];

  const filteredNotifications = useMemo(() => {
    if (filterCategory === 'all') return notifications;
    return notifications.filter((n) => n.category === filterCategory);
  }, [notifications, filterCategory]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      await markAllNotificationsRead();
      await refreshWorkspace();
    } finally {
      setMarkingRead(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
            <span>Lifecycle Updates</span>
            <span aria-hidden="true">·</span>
            <span>
              {unreadCount} Unread · {notifications.length} Total Event
              {notifications.length === 1 ? '' : 's'}
            </span>
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
            Notifications
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={markingRead}
              leftIcon={<CheckCheck className="w-3.5 h-3.5" />}
              onClick={handleMarkAllRead}
            >
              {markingRead ? 'Marking Read...' : 'Mark All as Read'}
            </Button>
          )}

          <div
            role="group"
            aria-label="Filter notification stream"
            className="flex items-center gap-1 p-1 rounded-md bg-[#E8E4DC]/75 border border-[#292A25]/12"
          >
            {(
              [
                { id: 'all', label: 'All Updates' },
                { id: 'escalations', label: 'Escalation Updates' },
                { id: 'policy', label: 'Policy Context' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterCategory(tab.id)}
                aria-pressed={filterCategory === tab.id}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  filterCategory === tab.id
                    ? 'bg-[#292A25] text-[#F8F7F3] shadow-2xs'
                    : 'text-[#292A25]/75 hover:text-[#292A25]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {dataState === ViewDataState.Loading && (
        <LoadingState label="Loading notification stream..." rows={3} />
      )}

      {dataState === ViewDataState.Error && (
        <ErrorMessage
          title="Notification Stream Error"
          message="Unable to load workspace notifications."
          code="NOTIFICATION_STREAM_ERROR"
          onRetry={() => {
            setDataState(ViewDataState.Empty);
            refreshWorkspace();
          }}
        />
      )}

      {dataState !== ViewDataState.Loading &&
        dataState !== ViewDataState.Error &&
        filteredNotifications.length === 0 && (
          <EmptyState
            icon={<Bell className="w-4 h-4" />}
            title="Zero unread notifications or escalation updates"
            scopeContext={`${actorMeta.label} · Filter: ${filterCategory.toUpperCase()}`}
            description="Status transitions, routing assignments, and escalation notices appear here automatically as requests move through their lifecycle."
            primaryActionLabel="Open Notification Settings"
            onPrimaryAction={() => navigate('/workspace/settings')}
            secondaryActionLabel="Return to Dashboard"
            onSecondaryAction={() => navigate('/workspace/dashboard')}
          />
        )}

      {dataState !== ViewDataState.Loading &&
        dataState !== ViewDataState.Error &&
        filteredNotifications.length > 0 && (
          <div className="flex flex-col gap-3">
            {filteredNotifications.map((n) => (
              <div
                key={n.notification_id}
                className={`rounded-md border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                  n.is_read
                    ? 'border-[#292A25]/12 bg-[#F8F7F3]'
                    : 'border-[#777B63]/45 bg-[#E8E4DC]/55'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-2 rounded bg-[#292A25]/8 text-[#292A25]">
                    {n.category === 'escalations' ? (
                      <AlertTriangle className="w-4 h-4 text-[#8F3F34]" />
                    ) : n.category === 'policy' ? (
                      <FileText className="w-4 h-4 text-[#777B63]" />
                    ) : (
                      <Bell className="w-4 h-4 text-[#292A25]" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#292A25]">
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-[#292A25] text-[#F8F7F3]">
                          Unread
                        </span>
                      )}
                      {n.ticket_id && (
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                          {n.ticket_id}
                        </span>
                      )}
                      {n.policy_reference && (
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#777B63]/15 text-[#292A25]">
                          {n.policy_reference}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#292A25]/80 leading-relaxed">
                      {n.summary}
                    </p>
                    <span className="font-mono text-[11px] text-[#777B63]">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                {n.ticket_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    rightIcon={<ArrowUpRight className="w-3.5 h-3.5" />}
                    onClick={() => navigate('/workspace/requests')}
                  >
                    Inspect Ticket
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
};
