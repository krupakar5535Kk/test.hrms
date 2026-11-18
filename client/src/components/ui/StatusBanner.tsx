import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  ServerOff,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { cn } from '../../lib/cn';

export type BannerTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'offline'
  | 'pending'
  | 'unavailable';

interface StatusBannerProps {
  tone: BannerTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

const toneStyles: Record<
  BannerTone,
  { container: string; icon: React.ComponentType<{ className?: string }> }
> = {
  info: {
    container: 'bg-sky-50/80 border-sky-200 text-sky-900',
    icon: Info,
  },
  success: {
    container: 'bg-emerald-50/80 border-emerald-200 text-emerald-900',
    icon: CheckCircle2,
  },
  warning: {
    container: 'bg-amber-50/85 border-amber-200 text-amber-900',
    icon: AlertCircle,
  },
  error: {
    container: 'bg-rose-50/85 border-rose-200 text-rose-900',
    icon: XCircle,
  },
  offline: {
    container: 'bg-slate-100 border-slate-300 text-slate-800',
    icon: WifiOff,
  },
  pending: {
    container: 'bg-amber-50/85 border-amber-200 text-amber-900',
    icon: Clock,
  },
  unavailable: {
    container: 'bg-slate-50 border-slate-200 text-slate-700',
    icon: ServerOff,
  },
};

export const StatusBanner: React.FC<StatusBannerProps> = ({
  tone,
  title,
  description,
  action,
  className,
}) => {
  const { container, icon: Icon } = toneStyles[tone];
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs',
        container,
        className
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{title}</p>
          {description && <p className="opacity-85 mt-0.5 leading-relaxed">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};
