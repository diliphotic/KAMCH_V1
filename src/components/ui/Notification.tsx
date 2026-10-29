import React from 'react';
import { Info, AlertTriangle, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { NotificationType } from '../../types';

export interface NotificationProps {
  type?: NotificationType;
  title: string;
  message?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  action?: React.ReactNode;
}

export const Notification: React.FC<NotificationProps> = ({
  type = 'info',
  title,
  message,
  onDismiss,
  className = '',
  action,
}) => {
  const configs = {
    institutional: {
      container: 'bg-[#FAF8F5] border-[#D4AF37]/60 text-stone-900',
      icon: <ShieldCheck className="w-5 h-5 text-[#4B2E2E] shrink-0" aria-hidden="true" />,
      titleColor: 'text-[#4B2E2E]',
    },
    info: {
      container: 'bg-stone-50 border-stone-300 text-stone-800',
      icon: <Info className="w-5 h-5 text-stone-600 shrink-0" aria-hidden="true" />,
      titleColor: 'text-stone-900',
    },
    warning: {
      container: 'bg-amber-50/80 border-amber-300 text-amber-900',
      icon: <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" aria-hidden="true" />,
      titleColor: 'text-amber-950',
    },
    success: {
      container: 'bg-emerald-50/80 border-emerald-300 text-emerald-900',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />,
      titleColor: 'text-emerald-950',
    },
  };

  const current = configs[type];

  return (
    <div
      role="region"
      aria-label={title}
      className={`rounded-lg border p-4 shadow-xs flex items-start gap-3.5 transition-all ${current.container} ${className}`}
    >
      <div className="mt-0.5">{current.icon}</div>
      <div className="flex-1 min-w-0">
        <h4 className={`text-sm font-semibold tracking-tight ${current.titleColor}`}>
          {title}
        </h4>
        {message && (
          <div className="text-xs text-stone-600 mt-1 leading-relaxed">
            {message}
          </div>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-stone-400 hover:text-stone-700 p-1 rounded transition-colors focus-visible:outline-2 focus-visible:outline-[#4B2E2E]"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
