import React from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      inputSize = 'md',
      leftIcon,
      rightIcon,
      error = false,
      disabled,
      ...props
    },
    ref
  ) => {
    const sizeClasses = {
      sm: 'h-8 text-xs px-2.5 rounded-lg',
      md: 'h-9 text-xs px-3 rounded-lg',
      lg: 'h-11 text-sm px-3.5 rounded-xl',
    }[inputSize];

    return (
      <div className="relative flex items-center w-full">
        {leftIcon && (
          <div className="absolute left-2.5 flex items-center justify-center pointer-events-none text-slate-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            'w-full bg-white text-slate-900 border transition-all duration-150',
            'placeholder:text-slate-400 font-normal',
            'focus:outline-none focus:ring-2',
            error
              ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20 text-rose-950'
              : 'border-slate-300 focus:border-indigo-600 focus:ring-indigo-600/20',
            'disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed',
            leftIcon && (inputSize === 'sm' ? 'pl-8' : 'pl-9'),
            rightIcon && (inputSize === 'sm' ? 'pr-8' : 'pr-9'),
            sizeClasses,
            className
          )}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-2.5 flex items-center justify-center pointer-events-none text-slate-400">
            {rightIcon}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
