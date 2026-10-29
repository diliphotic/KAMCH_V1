import React from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  current?: boolean;
}

export interface PageHeaderProps {
  title: string;
  kicker?: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  kicker,
  description,
  breadcrumbs,
  actions,
  className = '',
}) => {
  return (
    <div className={`mb-5 pb-4 border-b border-stone-200/60 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumbs" className="mb-1.5">
          <ol className="flex items-center gap-1.5 text-xs text-stone-500">
            {breadcrumbs.map((crumb, idx) => (
              <li key={idx} className="flex items-center gap-1.5">
                {idx > 0 && <span className="text-stone-300">/</span>}
                {crumb.current || !crumb.href ? (
                  <span className={crumb.current ? 'text-[#4B2E2E] font-medium' : ''}>
                    {crumb.label}
                  </span>
                ) : (
                  <a
                    href={crumb.href}
                    className="hover:text-stone-800 transition-colors"
                  >
                    {crumb.label}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          {kicker && (
            <p className="text-[11px] font-semibold tracking-wider uppercase text-[#B59328] mb-0.5">
              {kicker}
            </p>
          )}
          <h1 className="text-xl sm:text-2xl font-bold text-[#4B2E2E] tracking-tight font-serif leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-xs sm:text-sm text-stone-500 mt-1 max-w-3xl leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};
