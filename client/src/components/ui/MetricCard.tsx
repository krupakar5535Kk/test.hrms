import React from 'react';
import { cn } from '../../lib/cn';

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'primary';
  className?: string;
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  unit,
  subtitle,
  icon,
  badge,
  tone = 'default',
  className,
  onClick,
}) => {
  const iconTones = {
    default: 'bg-slate-100 text-slate-600 border-slate-200',
    primary: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    destructive: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
  }[tone];

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === 'function') {
      const IconComponent = icon as React.ComponentType<{ className?: string }>;
      return <IconComponent className="w-4 h-4" />;
    }
    return null;
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white border border-slate-200/90 rounded-2xl p-4.5 shadow-xs transition-all duration-150',
        onClick && 'cursor-pointer hover:border-slate-300 hover:shadow-md active:scale-[0.99]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center border shrink-0',
              iconTones
            )}
          >
            {renderIcon()}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium text-slate-400">
            {unit}
          </span>
        )}
        {badge && <div className="ml-auto">{badge}</div>}
      </div>

      {subtitle && (
        <div className="mt-1.5 text-xs text-slate-500 truncate">
          {subtitle}
        </div>
      )}
    </div>
  );
};
