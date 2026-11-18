import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, ServerOff } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/cn';

export type EmptyStateVariant = 'empty' | 'loading' | 'unavailable' | 'error';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant = 'empty',
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
  compact = false,
}) => {
  const DefaultIcon =
    variant === 'loading'
      ? Loader2
      : variant === 'unavailable'
      ? ServerOff
      : variant === 'error'
      ? AlertTriangle
      : Inbox;

  const Icon = icon ?? DefaultIcon;

  const iconContainerClass =
    variant === 'error'
      ? 'bg-rose-50 text-rose-600 border-rose-200'
      : variant === 'unavailable'
      ? 'bg-slate-100 text-slate-600 border-slate-200'
      : variant === 'loading'
      ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
      : 'bg-muted text-muted-foreground border-border';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-7 px-4' : 'py-12 px-6',
        className
      )}
    >
      <div
        className={cn(
          'w-11 h-11 rounded-2xl border flex items-center justify-center mb-3',
          iconContainerClass
        )}
      >
        <Icon className={cn('w-5 h-5', variant === 'loading' && 'animate-spin')} />
      </div>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground max-w-md mt-1 leading-relaxed">
          {description}
        </p>
      )}
      {onAction && actionLabel && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAction}
          className="mt-4"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
