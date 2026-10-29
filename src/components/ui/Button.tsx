import React from 'react';
import { ButtonVariant, ButtonSize } from '../../types';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 ease-out select-none rounded-lg cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-offset-2';

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 min-h-[34px]',
    md: 'text-sm px-4 py-2 gap-2 min-h-[38px]',
    lg: 'text-base px-5 py-2.5 gap-2.5 min-h-[44px]',
  };

  const variantStyles = {
    primary: 'bg-[#4B2E2E] text-[#F5F5DC] hover:bg-[#3B2424] active:bg-[#2F1D1D] focus-visible:outline-[#D4AF37] border border-[#3B2424] shadow-xs hover:shadow-sm',
    secondary: 'bg-[#F5F5DC] text-[#4B2E2E] hover:bg-[#EBEBC8] active:bg-[#DFDFB8] focus-visible:outline-[#4B2E2E] border border-[#E0DDB8]',
    outline: 'bg-white text-[#4B2E2E] hover:bg-[#FAF9F0] active:bg-[#F5F5DC] border border-stone-300 hover:border-[#4B2E2E]/60 focus-visible:outline-[#4B2E2E] shadow-xs',
    ghost: 'bg-transparent text-stone-700 hover:text-[#4B2E2E] hover:bg-stone-100 active:bg-stone-200 border border-transparent focus-visible:outline-[#4B2E2E]',
    gold: 'bg-[#D4AF37] text-[#372020] font-semibold hover:bg-[#C49F27] active:bg-[#B48F17] focus-visible:outline-[#4B2E2E] border border-[#C49F27] shadow-xs hover:shadow-sm',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : icon && iconPosition === 'left' ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      <span>{children}</span>
      {!isLoading && icon && iconPosition === 'right' ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
    </button>
  );
};
