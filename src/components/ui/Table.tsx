import React from 'react';
import { EmptyState, EmptyStateProps } from './EmptyState';
import { LoadingState } from './LoadingState';
import { ErrorMessage } from './ErrorMessage';
import { ViewDataState } from '../../types/domain';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  mono?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface TableProps<T> {
  caption: string;
  columns: TableColumn<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  dataState?: ViewDataState;
  emptyStateProps: EmptyStateProps;
  loadingLabel?: string;
  errorTitle?: string;
  errorMessage?: string;
  onRetryState?: () => void;
}

export function Table<T>({
  caption,
  columns,
  data,
  getRowKey,
  dataState = ViewDataState.Empty,
  emptyStateProps,
  loadingLabel,
  errorTitle = 'Unable to Retrieve Workspace Records',
  errorMessage = 'Unable to load the requested records at this time. Please retry or check your network connection.',
  onRetryState,
}: TableProps<T>) {
  if (dataState === ViewDataState.Loading) {
    return <LoadingState label={loadingLabel} />;
  }

  if (dataState === ViewDataState.Error) {
    return (
      <ErrorMessage
        title={errorTitle}
        message={errorMessage}
        code="DATA_FETCH_ERROR"
        onRetry={onRetryState}
      />
    );
  }

  return (
    <div className="w-full rounded-md surface-elevated overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-[#292A25]/12 bg-[#E8E4DC]/65">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 text-xs font-semibold text-[#292A25]/85 tracking-tight whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          {data.length > 0 ? (
            <tbody className="divide-y divide-[#292A25]/10 text-sm">
              {data.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className="hover:bg-[#E8E4DC]/40 transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-[#292A25]/85 ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      } ${col.mono ? 'font-mono-tabular text-xs' : ''}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="p-4 md:p-6">
                  <EmptyState {...emptyStateProps} />
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
