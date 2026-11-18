import React from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error = false, disabled, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        disabled={disabled}
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'w-full bg-white text-slate-900 border rounded-lg p-2.5 text-xs transition-all duration-150 font-normal',
          'placeholder:text-slate-400',
          'focus:outline-none focus:ring-2',
          error
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20 text-rose-950'
            : 'border-slate-300 focus:border-indigo-600 focus:ring-indigo-600/20',
          'disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed',
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
