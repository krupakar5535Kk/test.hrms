import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: 'sm' | 'md' | 'lg';
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, selectSize = 'md', error = false, disabled, children, ...props }, ref) => {
    const sizeClasses = {
      sm: 'h-8 text-xs pl-2.5 pr-7 rounded-lg',
      md: 'h-9 text-xs pl-3 pr-8 rounded-lg',
      lg: 'h-11 text-sm pl-3.5 pr-9 rounded-xl',
    }[selectSize];

    return (
      <div className="relative flex items-center w-full">
        <select
          ref={ref}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            'w-full bg-white text-slate-900 border appearance-none transition-all duration-150',
            'focus:outline-none focus:ring-2 font-normal',
            error
              ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20 text-rose-950'
              : 'border-slate-300 focus:border-indigo-600 focus:ring-indigo-600/20',
            'disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed',
            sizeClasses,
            className
          )}
          {...props}
        >
          {children}
        </select>
        <div className="absolute right-2.5 pointer-events-none flex items-center text-slate-400">
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      </div>
    );
  }
);

Select.displayName = 'Select';
