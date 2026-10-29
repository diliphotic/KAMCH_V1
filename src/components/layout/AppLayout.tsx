import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopNavbar } from './TopNavbar';
import { NavigationItemKey } from '../../types';

export interface AppLayoutProps {
  currentTab: NavigationItemKey;
  onSelectTab: (tab: NavigationItemKey) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onSelectTab,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-stone-800 flex flex-col antialiased overflow-x-hidden print:bg-white print:overflow-visible">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={onSelectTab}
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Area (Offset by sidebar width on large viewports; zeroed for print) */}
      <div className="lg:pl-64 flex flex-col flex-1 min-w-0 w-full print:pl-0">
        {/* Compact Top Navigation Bar */}
        <TopNavbar
          currentTab={currentTab}
          onSelectTab={onSelectTab}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        {/* Viewport Content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 p-3 sm:p-5 lg:p-6 max-w-7xl w-full mx-auto outline-none min-w-0 print:p-0 print:m-0 print:max-w-none"
        >
          {children}
        </main>

        {/* Institutional Minimal Footer */}
        <footer className="py-3 px-6 border-t border-stone-200/60 bg-white/50 text-xs text-stone-500 flex flex-col sm:flex-row items-center justify-between gap-1 print:hidden">
          <span className="font-medium text-stone-600">
            Krishna Ayurvedic Medical College &amp; Hospital
          </span>
          <span className="text-[11px] text-stone-400">KAMCH ERP</span>
        </footer>
      </div>
    </div>
  );
};
