import React from 'react';
import { cn } from '../../lib/cn';

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rows = 5,
  columns = 4,
  className,
}) => {
  return (
    <div className={cn('w-full space-y-2 animate-pulse p-4', className)}>
      <div className="h-8 bg-slate-100 rounded-lg w-full mb-3" />
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="flex items-center gap-4 h-9">
          {Array.from({ length: columns }).map((_, cIdx) => (
            <div
              key={cIdx}
              className={cn(
                'h-4 bg-slate-100 rounded',
                cIdx === 0 ? 'w-1/4' : cIdx === columns - 1 ? 'w-16' : 'flex-1'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
