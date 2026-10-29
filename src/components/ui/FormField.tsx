import React from 'react';

export interface FormFieldProps {
  id?: string;
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  helperText,
  error,
  required = false,
  className = '',
  children,
}) => {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={id}
        className="text-xs font-semibold text-stone-700 select-none flex items-center justify-between"
      >
        <span>
          {label}
          {required && <span className="text-amber-700 ml-1" aria-hidden="true">*</span>}
        </span>
      </label>
      {children}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </span>
      ) : helperText ? (
        <span id={`${id}-helper`} className="text-xs text-stone-500">
          {helperText}
        </span>
      ) : null}
    </div>
  );
};

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full text-sm px-3 py-2 bg-white rounded-md border text-stone-800 placeholder:text-stone-400 transition-colors focus:bg-white disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed ${
          error
            ? 'border-red-400 focus:border-red-600 focus:ring-1 focus:ring-red-400 focus:outline-none'
            : 'border-stone-300 hover:border-stone-400 focus:border-[#4B2E2E] focus:ring-1 focus:ring-[#4B2E2E] focus:outline-none'
        } ${className}`}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, error, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`w-full text-sm px-3 py-2 bg-white rounded-md border text-stone-800 transition-colors focus:bg-white disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed ${
          error
            ? 'border-red-400 focus:border-red-600 focus:ring-1 focus:ring-red-400 focus:outline-none'
            : 'border-stone-300 hover:border-stone-400 focus:border-[#4B2E2E] focus:ring-1 focus:ring-[#4B2E2E] focus:outline-none'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`w-full text-sm px-3 py-2 bg-white rounded-md border text-stone-800 placeholder:text-stone-400 transition-colors focus:bg-white disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed ${
          error
            ? 'border-red-400 focus:border-red-600 focus:ring-1 focus:ring-red-400 focus:outline-none'
            : 'border-stone-300 hover:border-stone-400 focus:border-[#4B2E2E] focus:ring-1 focus:ring-[#4B2E2E] focus:outline-none'
        } ${className}`}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
