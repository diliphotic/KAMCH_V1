import React, { useState } from 'react';
import {
  GitBranch,
  Layers,
  Database,
  Calendar,
  AlertCircle,
  FileCode,
  Shield,
  ArrowRight,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { FUTURE_ERP_MODULES } from '../config/modules';
import { NavigationItemKey } from '../types';

export interface ModuleRoadmapViewProps {
  selectedModuleId?: NavigationItemKey;
  onNavigate: (tab: NavigationItemKey) => void;
}

export const ModuleRoadmapView: React.FC<ModuleRoadmapViewProps> = ({
  selectedModuleId,
  onNavigate,
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const categories = ['all', 'Core System', 'Academic', 'Financial', 'Governance'];

  const filteredModules = FUTURE_ERP_MODULES.filter((m) => {
    if (filterCategory === 'all') return true;
    return m.category === filterCategory;
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Future Modules Architecture & Roadmap"
        kicker="Krishna Ayurvedic Medical College & Hospital"
        description="Official architectural blueprint of the 9 upcoming academic and hospital modules. All items are clearly demarcated as planned specifications with zero fabricated functionality."
        breadcrumbs={[
          { label: 'KAMCH ERP', href: '#' },
          { label: 'Architecture', href: '#' },
          { label: 'Roadmap & Modules', current: true },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('architecture')}
          >
            Server & Database Setup
          </Button>
        }
      />

      {/* Scope Disclaimer Banner */}
      <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#D4AF37]/50 text-stone-800 text-xs leading-relaxed flex items-start gap-3">
        <Shield className="w-5 h-5 text-[#4B2E2E] shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-[#4B2E2E] block text-sm mb-0.5">
            Phase 1 Scope Boundary Policy
          </span>
          As mandated in the foundation brief, business logic, authentication, database schemas, and student transactions are planned for subsequent phases. The table structures and architectural scopes documented below serve as formal specifications for the upcoming MySQL backend development.
        </div>
      </div>

      {/* Interactive Category Filter Bar */}
      <div className="flex items-center gap-2 p-1.5 bg-stone-100 rounded-lg max-w-fit overflow-x-auto">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              filterCategory === cat
                ? 'bg-white text-[#4B2E2E] shadow-xs font-semibold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {cat === 'all' ? 'All Modules (9)' : cat}
          </button>
        ))}
      </div>

      {/* Modules Catalog */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredModules.map((module) => {
          const isHighlighted = selectedModuleId === (module.id as NavigationItemKey);

          return (
            <Card
              key={module.id}
              accentTop={isHighlighted}
              className={isHighlighted ? 'ring-2 ring-[#D4AF37]' : ''}
            >
              <CardHeader className="bg-[#FAF9F5]/70">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] text-stone-500 font-semibold">
                      {module.code}
                    </span>
                    <span className="text-stone-300">·</span>
                    <span className="text-[11px] text-stone-600 font-medium">
                      {module.category}
                    </span>
                  </div>
                  <CardTitle className="text-stone-900 truncate">
                    {module.title}
                  </CardTitle>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="planned" size="sm">
                    {module.plannedPhase}
                  </Badge>
                  <span className="text-[10px] text-amber-800 font-medium">
                    Not Implemented
                  </span>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <p className="text-xs text-stone-600 leading-relaxed">
                  {module.description}
                </p>

                {/* Scope points */}
                <div>
                  <h4 className="text-[11px] font-semibold text-stone-700 uppercase tracking-wider mb-2">
                    Planned Functional Scope
                  </h4>
                  <ul className="space-y-1.5 text-xs text-stone-600">
                    {module.scopeSummary.map((scope, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-[#D4AF37] font-bold mt-0.5" aria-hidden="true">
                          •
                        </span>
                        <span>{scope}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Intended MySQL tables */}
                <div className="pt-2 border-t border-stone-100">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-700 uppercase tracking-wider mb-2">
                    <Database className="w-3.5 h-3.5 text-[#4B2E2E]" />
                    <span>Intended MySQL Schemas</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {module.intendedTables.map((tbl) => (
                      <span
                        key={tbl}
                        className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-mono text-[11px] border border-stone-200"
                      >
                        {tbl}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>

              <CardFooter>
                <div className="flex items-center justify-between w-full text-xs text-stone-500">
                  <span>Status: Specification Defined</span>
                  <span className="font-mono text-[11px] text-stone-400">
                    Backend: Node.js API
                  </span>
                </div>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
