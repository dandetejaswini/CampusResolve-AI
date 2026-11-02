import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Library,
  FilePlus2,
  FileText,
  BookOpen,
  ShieldAlert,
  CheckCircle2,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useWorkspaceContext } from '../../components/layout/WorkspaceLayout';
import { AuthorizedAction, ViewDataState } from '../../types/domain';
import { canActorPerformAction, getActorMetadata } from '../../utils/rbac';
import { Table, TableColumn } from '../../components/ui/Table';
import { InputField, SelectField, TextAreaField } from '../../components/ui/InputField';
import { Button } from '../../components/ui/Button';
import { publishPolicyDocument } from '../../services/workspaceClient';
import {
  KnowledgeArticleRecord,
  PolicyDocumentRecord,
  PolicyDomainCode,
} from '../../types/phase3';

export const KnowledgeBasePage: React.FC = () => {
  const {
    activeRole,
    dataState,
    setDataState,
    workspaceData,
    setWorkspaceData,
    refreshWorkspaceData: refreshWorkspace,
  } = useWorkspaceContext();
  const navigate = useNavigate();
  const actorMeta = getActorMetadata(activeRole);

  const [activeTab, setActiveTab] = useState<'policies' | 'articles'>('policies');
  const [searchTerm, setSearchTerm] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [kbPage, setKbPage] = useState<number>(1);

  const [selectedPolicy, setSelectedPolicy] =
    useState<PolicyDocumentRecord | null>(null);
  const [selectedArticle, setSelectedArticle] =
    useState<KnowledgeArticleRecord | null>(null);

  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [newDomainCode, setNewDomainCode] = useState<PolicyDomainCode>('REG');
  const [newTitle, setNewTitle] = useState('');
  const [newVersion, setNewVersion] = useState('2.1');
  const [newEffectiveDate, setNewEffectiveDate] = useState('2026-09-01');
  const [newSummary, setNewSummary] = useState('');
  const [newContent, setNewContent] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const canPublishPolicy = canActorPerformAction(
    activeRole,
    AuthorizedAction.PublishKnowledgeArticle
  );
  const canProposeRevision = canActorPerformAction(
    activeRole,
    AuthorizedAction.ProposePolicyRevision
  );

  const policies = workspaceData?.knowledgeBase.policies ?? [];
  const articles = workspaceData?.knowledgeBase.articles ?? [];
  const totalArticles = workspaceData?.knowledgeBase.totalArticlesCount ?? 0;
  const pageSize = workspaceData?.knowledgeBase.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(totalArticles / pageSize));

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (domainFilter !== 'all' && p.domain !== domainFilter) return false;
      if (statusFilter !== 'all' && p.lifecycle_state !== statusFilter)
        return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          p.policy_id.toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.category_id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [policies, domainFilter, statusFilter, searchTerm]);

  const filteredArticles = useMemo(() => {
    return articles.filter((a) => {
      if (statusFilter === 'active' && a.lifecycle_state !== 'published')
        return false;
      if (statusFilter === 'expired' && a.lifecycle_state !== 'expired')
        return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          a.article_id.toLowerCase().includes(q) ||
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.content.toLowerCase().includes(q) ||
          a.category_id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [articles, statusFilter, searchTerm]);

  const handleDomainFilterChange = async (nextDomain: string) => {
    setDomainFilter(nextDomain);
    setKbPage(1);
    await refreshWorkspace({
      kbPage: 1,
      kbDomain: nextDomain,
      kbSearch: searchTerm,
    });
  };

  const handlePageChange = async (nextPage: number) => {
    setKbPage(nextPage);
    await refreshWorkspace({
      kbPage: nextPage,
      kbDomain: domainFilter,
      kbSearch: searchTerm,
    });
  };

  const handlePublishPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (publishing) return;
    if (!newTitle.trim() || !newSummary.trim()) {
      setPublishError('Both policy title and authoritative summary are required.');
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await publishPolicyDocument({
        domain: newDomainCode,
        title: newTitle.trim(),
        version: newVersion.trim() || '1.0',
        effectiveDate: newEffectiveDate,
        summary: newSummary.trim(),
        content: newContent.trim() || newSummary.trim(),
      });
      if (res && res.policy && res.article) {
        setWorkspaceData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            knowledgeBase: {
              ...prev.knowledgeBase,
              policies: [res.policy, ...prev.knowledgeBase.policies],
              articles: [res.article, ...prev.knowledgeBase.articles],
              totalArticlesCount: prev.knowledgeBase.totalArticlesCount + 1,
            },
          };
        });
      }
      refreshWorkspace({
        kbPage,
        kbDomain: domainFilter,
        kbSearch: searchTerm,
      }).catch(() => {});
      setNewTitle('');
      setNewSummary('');
      setNewContent('');
      setPublishDialogOpen(false);
    } catch (err) {
      setPublishError(
        err instanceof Error ? err.message : 'Failed to publish policy.'
      );
    } finally {
      setPublishing(false);
    }
  };

  const policyColumns: TableColumn<PolicyDocumentRecord>[] = [
    {
      key: 'policy_id',
      header: 'Policy ID',
      mono: true,
      render: (r) => (
        <button
          type="button"
          onClick={() => setSelectedPolicy(r)}
          className="font-mono text-xs font-semibold text-[#292A25] underline decoration-[#777B63] underline-offset-2 hover:text-[#777B63]"
        >
          {r.policy_id}
        </button>
      ),
    },
    {
      key: 'title',
      header: 'Policy Title & Category',
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setSelectedPolicy(r)}
            className="text-left font-medium text-[#292A25] hover:text-[#777B63]"
          >
            {r.title}
          </button>
          <span className="text-[11px] text-[#777B63]">
            Domain: {r.domain} ({r.category_id}) · Source: {r.source_name}
          </span>
        </div>
      ),
    },
    {
      key: 'lifecycle_state',
      header: 'Applicability Status',
      render: (r) => (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
            r.lifecycle_state === 'active'
              ? 'bg-[#777B63]/12 text-[#292A25] border-[#777B63]/35'
              : 'bg-[#8F3F34]/12 text-[#8F3F34] border-[#8F3F34]/35'
          }`}
        >
          {r.lifecycle_state === 'active' ? (
            <CheckCircle2 className="w-3 h-3 text-[#777B63]" />
          ) : (
            <ShieldAlert className="w-3 h-3 text-[#8F3F34]" />
          )}
          {r.lifecycle_state.toUpperCase()}
        </span>
      ),
    },
    {
      key: 'effective_window',
      header: 'Effective Window',
      mono: true,
      render: (r) => (
        <span className="text-xs text-[#292A25]/80">
          {r.effective_date} → {r.expiration_date ?? 'Present'}
        </span>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      align: 'right',
      mono: true,
      render: (r) => `v${r.version}`,
    },
  ];

  const articleColumns: TableColumn<KnowledgeArticleRecord>[] = [
    {
      key: 'article_id',
      header: 'Article ID',
      mono: true,
      render: (r) => (
        <button
          type="button"
          onClick={() => setSelectedArticle(r)}
          className="font-mono text-xs font-semibold text-[#292A25] underline decoration-[#777B63] underline-offset-2 hover:text-[#777B63]"
        >
          {r.article_id}
        </button>
      ),
    },
    {
      key: 'title',
      header: 'Knowledge Article Title',
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setSelectedArticle(r)}
            className="text-left font-medium text-[#292A25] hover:text-[#777B63]"
          >
            {r.title}
          </button>
          <span className="text-[11px] text-[#777B63]">
            Category: {r.category_id} · Linked Policy: {r.primary_policy_id} (v{r.primary_policy_version})
          </span>
        </div>
      ),
    },
    {
      key: 'lifecycle_state',
      header: 'Status',
      render: (r) => (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
            r.lifecycle_state === 'published'
              ? 'bg-[#777B63]/12 text-[#292A25] border-[#777B63]/35'
              : 'bg-[#8F3F34]/12 text-[#8F3F34] border-[#8F3F34]/35'
          }`}
        >
          {r.lifecycle_state.toUpperCase()}
        </span>
      ),
    },
    {
      key: 'effective_window',
      header: 'Effective Window',
      mono: true,
      render: (r) => (
        <span className="text-xs text-[#292A25]/80">
          {r.effective_date} → {r.expiration_date ?? 'Present'}
        </span>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      align: 'right',
      mono: true,
      render: (r) => `v${r.version}`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[#292A25]/10 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-[#777B63] font-medium">
            <span>Policy Reference Repository</span>
            <span aria-hidden="true">·</span>
            <span>
              {policies.length} Policy Documents · {totalArticles} Knowledge Articles Indexed
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-[#292A25]">
              {actorMeta.label} View
            </span>
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl text-[#292A25] tracking-tight">
            Knowledge Base
          </h1>
          <p className="text-sm text-[#292A25]/70">
            Versioned institutional policy documents and operational knowledge articles with effective-date applicability tracking and citation references across all institutional profiles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canPublishPolicy || canProposeRevision ? (
            <Button
              variant={canPublishPolicy ? 'primary' : 'outline'}
              leftIcon={<FilePlus2 className="w-4 h-4" />}
              onClick={() => setPublishDialogOpen(true)}
            >
              {canPublishPolicy ? 'Register Policy Document' : 'Propose Policy Note'}
            </Button>
          ) : (
            <Button
              variant="outline"
              leftIcon={<BookOpen className="w-4 h-4" />}
              onClick={() => navigate('/workspace/assistant')}
            >
              Ask Policy Assistant
            </Button>
          )}
        </div>
      </div>

      {/* Corpus Switcher & Filter Bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Knowledge Base Corpus View"
            className="inline-flex rounded-md border border-[#292A25]/15 bg-[#E8E4DC]/65 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'policies'}
              onClick={() => setActiveTab('policies')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium transition-colors ${
                activeTab === 'policies'
                  ? 'bg-[#292A25] text-[#F8F7F3]'
                  : 'text-[#292A25]/75 hover:text-[#292A25]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Policy Documents ({filteredPolicies.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'articles'}
              onClick={() => setActiveTab('articles')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium transition-colors ${
                activeTab === 'articles'
                  ? 'bg-[#292A25] text-[#F8F7F3]'
                  : 'text-[#292A25]/75 hover:text-[#292A25]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Knowledge Articles ({totalArticles})
            </button>
          </div>

          <div className="text-xs text-[#777B63]">
            Click any document ID or title to inspect version history, effective dates, and source provenance.
          </div>
        </div>

        <div className="rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/45 p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <InputField
              label="Search Policy Reference Repository"
              placeholder="Search by ID (POL-FINAID-2026-001, KB-000001), title, or summary..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="md:col-span-4">
            <SelectField
              label="Official Domain / Category Filter"
              value={domainFilter}
              onChange={(e) => handleDomainFilterChange(e.target.value)}
              options={[
                { value: 'all', label: 'All Official Categories (4 Domains)' },
                { value: 'FINAID', label: 'Financial Aid (FINAID)' },
                { value: 'REG', label: 'Registration & Records (REG)' },
                { value: 'IT', label: 'Campus IT & Identity (IT)' },
                { value: 'ACCESS', label: 'Accessibility & Accommodations (ACCESS)' },
              ]}
            />
          </div>
          <div className="md:col-span-3">
            <SelectField
              label="Effective Applicability"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Statuses (Active & Expired)' },
                { value: 'active', label: 'Active / Published Only' },
                { value: 'expired', label: 'Expired / Superseded Only' },
              ]}
            />
          </div>
        </div>
      </div>

      {activeTab === 'policies' ? (
        <Table<PolicyDocumentRecord>
          caption="Institutional Policy Documents"
          columns={policyColumns}
          data={filteredPolicies}
          getRowKey={(r) => r.policy_id}
          dataState={dataState}
          loadingLabel="Loading policy repository..."
          onRetryState={() => setDataState(ViewDataState.Empty)}
          emptyStateProps={{
            icon: <Library className="w-4 h-4" />,
            title:
              policies.length === 0
                ? 'No institutional policy documents published yet'
                : 'No policy documents match the current filter criteria',
            scopeContext: `${actorMeta.label} Policy View`,
            description:
              policies.length === 0
                ? canPublishPolicy
                  ? 'The policy repository is currently empty. Use the "Register Policy Document" button above to publish verified institutional policies.'
                  : 'The policy repository is currently empty. Verified institutional policies will appear here once published by authorized academic administrators.'
                : 'Adjust the domain or status filter to inspect active and expired institutional policies.',
            primaryActionLabel: policies.length === 0 && canPublishPolicy ? 'Register Policy Document' : 'Reset Filters',
            onPrimaryAction: () => {
              if (policies.length === 0 && canPublishPolicy) {
                setPublishDialogOpen(true);
              } else {
                setSearchTerm('');
                setDomainFilter('all');
                setStatusFilter('all');
              }
            },
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Table<KnowledgeArticleRecord>
            caption="Operational Knowledge Base Articles"
            columns={articleColumns}
            data={filteredArticles}
            getRowKey={(r) => r.article_id}
            dataState={dataState}
            loadingLabel="Loading knowledge articles..."
            onRetryState={() => setDataState(ViewDataState.Empty)}
            emptyStateProps={{
              icon: <BookOpen className="w-4 h-4" />,
              title:
                articles.length === 0
                  ? 'No knowledge articles published yet'
                  : 'No knowledge articles match the current filter criteria',
              scopeContext: `${actorMeta.label} Knowledge Base View`,
              description:
                articles.length === 0
                  ? 'Operational knowledge articles will be indexed here as verified institutional policies and operational guidance are published.'
                  : 'Reset search or domain filters to browse operational knowledge articles.',
              primaryActionLabel: 'Reset Filters',
              onPrimaryAction: () => {
                setSearchTerm('');
                handleDomainFilterChange('all');
                setStatusFilter('all');
              },
            }}
          />

          {/* Pagination bar for 200 KB articles */}
          <div className="flex items-center justify-between rounded-md border border-[#292A25]/12 bg-[#E8E4DC]/45 px-4 py-2.5 text-xs text-[#292A25]/80">
            <span>
              Showing page <strong>{kbPage}</strong> of <strong>{totalPages}</strong> ({totalArticles} total articles)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={kbPage <= 1}
                leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                onClick={() => handlePageChange(kbPage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={kbPage >= totalPages}
                rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                onClick={() => handlePageChange(kbPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Policy Document Inspection Modal */}
      {selectedPolicy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect policy ${selectedPolicy.policy_id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#292A25]/45 p-4"
        >
          <div className="w-full max-w-2xl rounded-md border border-[#292A25]/20 bg-[#F8F7F3] p-6 shadow-xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-[#292A25]/12 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[#777B63]">
                    {selectedPolicy.policy_id}
                  </span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                    Version {selectedPolicy.version}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      selectedPolicy.lifecycle_state === 'active'
                        ? 'bg-[#777B63]/15 text-[#292A25]'
                        : 'bg-[#8F3F34]/15 text-[#8F3F34]'
                    }`}
                  >
                    {selectedPolicy.lifecycle_state.toUpperCase()}
                  </span>
                </div>
                <h2 className="font-serif-display text-xl text-[#292A25] mt-1">
                  {selectedPolicy.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPolicy(null)}
                className="p-1 rounded text-[#292A25]/60 hover:text-[#292A25]"
                aria-label="Close inspection dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedPolicy.lifecycle_state !== 'active' && (
              <div className="rounded border border-[#8F3F34]/40 bg-[#8F3F34]/10 p-3 text-xs text-[#8F3F34]">
                <strong>Expired Policy Notice:</strong> This policy version expired on{' '}
                <code className="font-mono">{selectedPolicy.expiration_date}</code>. The AI Policy Assistant automatically excludes expired policies as authoritative sources for current-term requests.
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-[#E8E4DC]/50 p-3 rounded border border-[#292A25]/10">
              <div>
                <span className="text-[#777B63] block">Domain / Category</span>
                <strong className="text-[#292A25]">
                  {selectedPolicy.domain} ({selectedPolicy.category_id})
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Source Name</span>
                <strong className="text-[#292A25]">{selectedPolicy.source_name}</strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Section Reference</span>
                <strong className="font-mono text-[11px] text-[#292A25]">
                  {selectedPolicy.authoritative_section_ref}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Effective Date</span>
                <strong className="font-mono text-[#292A25]">
                  {selectedPolicy.effective_date}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Expiration Date</span>
                <strong className="font-mono text-[#292A25]">
                  {selectedPolicy.expiration_date ?? 'Active / Open'}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Superseded By</span>
                <strong className="font-mono text-[#292A25]">
                  {selectedPolicy.superseded_by_policy_id ?? 'None (Current)'}
                </strong>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#777B63] uppercase tracking-wider">
                Policy Summary
              </span>
              <p className="text-xs text-[#292A25]/85 leading-relaxed bg-[#E8E4DC]/35 border border-[#292A25]/10 rounded p-3">
                {selectedPolicy.summary}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#777B63] uppercase tracking-wider">
                Authoritative Policy Text & Rule Content
              </span>
              <p className="text-sm text-[#292A25] leading-relaxed bg-[#F8F7F3] border border-[#292A25]/12 rounded p-4 whitespace-pre-wrap">
                {selectedPolicy.content}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#292A25]/10">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const policyId = selectedPolicy.policy_id;
                  const title = selectedPolicy.title;
                  setSelectedPolicy(null);
                  navigate(
                    `/workspace/assistant?q=${encodeURIComponent(
                      `Explain ${policyId}: ${title}`
                    )}`
                  );
                }}
              >
                Query in AI Policy Assistant
              </Button>
              <Button variant="primary" size="sm" onClick={() => setSelectedPolicy(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Article Inspection Modal */}
      {selectedArticle && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect knowledge article ${selectedArticle.article_id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#292A25]/45 p-4"
        >
          <div className="w-full max-w-2xl rounded-md border border-[#292A25]/20 bg-[#F8F7F3] p-6 shadow-xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-[#292A25]/12 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[#777B63]">
                    {selectedArticle.article_id}
                  </span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#E8E4DC] text-[#292A25]">
                    Version {selectedArticle.version}
                  </span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#777B63]/15 text-[#292A25]">
                    Linked Policy: {selectedArticle.primary_policy_id} (v{selectedArticle.primary_policy_version})
                  </span>
                </div>
                <h2 className="font-serif-display text-xl text-[#292A25] mt-1">
                  {selectedArticle.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedArticle(null)}
                className="p-1 rounded text-[#292A25]/60 hover:text-[#292A25]"
                aria-label="Close article dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-[#E8E4DC]/50 p-3 rounded border border-[#292A25]/10">
              <div>
                <span className="text-[#777B63] block">Category</span>
                <strong className="text-[#292A25]">{selectedArticle.category_id}</strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Lifecycle State</span>
                <strong className="text-[#292A25]">
                  {selectedArticle.lifecycle_state.toUpperCase()}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Parent Policy</span>
                <strong className="font-mono text-[11px] text-[#292A25]">
                  {selectedArticle.primary_policy_id}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Effective Date</span>
                <strong className="font-mono text-[#292A25]">
                  {selectedArticle.effective_date}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Expiration Date</span>
                <strong className="font-mono text-[#292A25]">
                  {selectedArticle.expiration_date ?? 'Active / Open'}
                </strong>
              </div>
              <div>
                <span className="text-[#777B63] block">Tags</span>
                <strong className="font-mono text-[#292A25]">
                  {selectedArticle.tags.join(', ')}
                </strong>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#777B63] uppercase tracking-wider">
                Operational Knowledge Article Content
              </span>
              <p className="text-sm text-[#292A25] leading-relaxed bg-[#F8F7F3] border border-[#292A25]/12 rounded p-4 whitespace-pre-wrap">
                {selectedArticle.content}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#292A25]/10">
              <Button variant="primary" size="sm" onClick={() => setSelectedArticle(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Register Policy Document / Propose Policy Note Modal */}
      {publishDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Register Policy Document"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#292A25]/45 p-4"
        >
          <form
            onSubmit={handlePublishPolicy}
            className="w-full max-w-lg rounded-md border border-[#292A25]/20 bg-[#F8F7F3] p-6 shadow-xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#292A25]/12 pb-3">
              <div>
                <h2 className="font-serif-display text-xl text-[#292A25]">
                  {canPublishPolicy ? 'Register New Policy Document' : 'Propose Policy Note'}
                </h2>
                <p className="text-xs text-[#777B63] mt-0.5">
                  Assigns the next sequential <code className="font-mono">POL-&lt;domain&gt;-2026-XXX</code> identifier and indexes it for AI Policy Assistant retrieval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPublishDialogOpen(false)}
                className="p-1 rounded text-[#292A25]/60 hover:text-[#292A25]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {publishError && (
              <div className="rounded border border-[#8F3F34]/40 bg-[#8F3F34]/10 p-3 text-xs text-[#8F3F34]">
                {publishError}
              </div>
            )}

            <SelectField
              label="Policy Domain (Determines Official Category & ID Prefix)"
              value={newDomainCode}
              onChange={(e) => setNewDomainCode(e.target.value as PolicyDomainCode)}
              options={[
                { value: 'FINAID', label: 'FINAID — Financial Aid (POL-FINAID-2026-XXX)' },
                { value: 'REG', label: 'REG — Registration & Academic Records (POL-REG-2026-XXX)' },
                { value: 'IT', label: 'IT — Campus IT & Identity Services (POL-IT-2026-XXX)' },
                { value: 'ACCESS', label: 'ACCESS — Accessibility & Accommodations (POL-ACCESS-2026-XXX)' },
              ]}
            />

            <InputField
              label="Policy Title"
              placeholder="e.g., Late Course Withdrawal & Medical Documentation Standards"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <InputField
                label="Policy Version"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                required
              />
              <InputField
                label="Effective Date"
                type="date"
                value={newEffectiveDate}
                onChange={(e) => setNewEffectiveDate(e.target.value)}
                required
              />
            </div>

            <TextAreaField
              label="Authoritative Policy Summary"
              placeholder="Enter concise summary of policy scope and applicability..."
              rows={2}
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
              required
            />

            <TextAreaField
              label="Full Policy Rule Content"
              placeholder="Enter the detailed policy rules, deadlines, required documentation, and escalation criteria..."
              rows={4}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#292A25]/12">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPublishDialogOpen(false)}
                disabled={publishing}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={publishing}>
                {publishing ? 'Indexing Policy...' : 'Publish & Index Policy'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
