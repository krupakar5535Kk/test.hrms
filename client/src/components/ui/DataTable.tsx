import React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Input } from './Input';
import { TableSkeleton } from './TableSkeleton';
import { EmptyState } from './EmptyState';

export interface DataTableProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  filters?: React.ReactNode;
  filterSlot?: React.ReactNode;
  totalCount?: number;
  filteredCount?: number;
  loading?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onClearFilters?: () => void;
  children: React.ReactNode;
  className?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  title,
  description,
  actions,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filters,
  filterSlot,
  totalCount,
  filteredCount,
  loading = false,
  isLoading = false,
  error = null,
  onRetry,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no items matching the selected filters.',
  emptyAction,
  onClearFilters,
  children,
  className,
}) => {
  const isTableLoading = loading || isLoading;
  const activeFilters = filters || filterSlot;
  const showToolbar = Boolean(
    title || actions || onSearchChange || activeFilters || totalCount !== undefined
  );

  return (
    <div
      className={cn(
        'bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden',
        className
      )}
    >
      {showToolbar && (
        <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              {title && (
                <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  {title}
                  {totalCount !== undefined && (
                    <span className="text-[11px] font-mono font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      {totalCount}
                    </span>
                  )}
                </h3>
              )}
              {description && (
                <p className="text-xs text-slate-500 mt-0.5">{description}</p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-2 shrink-0">{actions}</div>
            )}
          </div>

          {(onSearchChange || activeFilters) && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
              {onSearchChange && (
                <div className="w-full sm:max-w-xs">
                  <Input
                    inputSize="sm"
                    placeholder={searchPlaceholder ?? 'Search records...'}
                    value={searchValue ?? ''}
                    onChange={(e) => onSearchChange(e.target.value)}
                    leftIcon={<Search className="w-3.5 h-3.5" />}
                  />
                </div>
              )}
              {activeFilters && (
                <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
                  {activeFilters}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isTableLoading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : error ? (
        <div className="py-12">
          <EmptyState
            variant="error"
            title="Failed to load records"
            description={error}
            actionLabel={onRetry ? 'Retry' : undefined}
            onAction={onRetry}
          />
        </div>
      ) : filteredCount === 0 ? (
        <div className="py-12">
          {emptyAction ? (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <h4 className="font-semibold text-slate-900">{emptyTitle}</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">{emptyDescription}</p>
              <div className="mt-4">{emptyAction}</div>
            </div>
          ) : (
            <EmptyState
              variant="empty"
              title={emptyTitle}
              description={emptyDescription}
              actionLabel={onClearFilters ? 'Clear Filters' : undefined}
              onAction={onClearFilters}
            />
          )}
        </div>
      ) : (
        <div className="overflow-x-auto w-full">
          {children}
        </div>
      )}

      {totalCount !== undefined && !isTableLoading && !error && filteredCount !== 0 && (
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[11px] text-slate-500 font-medium">
          <span>
            Showing <strong className="text-slate-700 font-mono tabular-nums">{filteredCount ?? totalCount}</strong> of{' '}
            <strong className="text-slate-700 font-mono tabular-nums">{totalCount}</strong> records
          </span>
          {filteredCount !== undefined && filteredCount < totalCount && (
            <span className="text-amber-600 font-medium">Filtered</span>
          )}
        </div>
      )}
    </div>
  );
};
