import React from 'react';
import { BadgeVariant } from '../../types';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
}) => {
  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  };

  const variantStyles = {
    institutional: 'bg-[#4B2E2E] text-[#F5F5DC] border border-[#3A2222]',
    gold: 'bg-[#FAF3DC] text-[#7A5B0B] border border-[#E7CD7A]',
    neutral: 'bg-stone-100 text-stone-700 border border-stone-200',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border border-amber-200',
    planned: 'bg-stone-50 text-stone-600 border border-dashed border-stone-300',
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-md tracking-wide whitespace-nowrap shrink-0 transition-colors ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
