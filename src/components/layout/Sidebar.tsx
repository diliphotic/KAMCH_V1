import React from 'react';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  GraduationCap,
  Briefcase,
  Building2,
  BookOpen,
  Award,
  FileText,
  X,
  LogIn,
} from 'lucide-react';
import { NavigationItemKey } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { getPermittedModules } from '../../config/permissions';
import { CollegeLogo } from '../ui/CollegeLogo';

export interface SidebarProps {
  currentTab: NavigationItemKey;
  onSelectTab: (tab: NavigationItemKey) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface NavModuleItem {
  id: NavigationItemKey;
  label: string;
  icon: React.ReactNode;
}

const MODULE_REGISTRY: NavModuleItem[] = [
  {
    id: 'welcome',
    label: 'Overview & Dashboard',
    icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'user_mgmt',
    label: 'User Management',
    icon: <Users className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'fees_mgmt',
    label: 'Fees Management',
    icon: <CreditCard className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'student_records',
    label: 'Student Management',
    icon: <GraduationCap className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'teacher_records',
    label: 'Teacher Records',
    icon: <Briefcase className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'marks_mgmt',
    label: 'Internal Assessment',
    icon: <Award className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'univ_exams',
    label: 'University Exams',
    icon: <FileText className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'dept_portal',
    label: 'Department Workspace',
    icon: <Building2 className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'library_mgmt',
    label: 'Library',
    icon: <BookOpen className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'leave_mgmt',
    label: 'Leave Management',
    icon: <FileText className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'attendance_mgmt',
    label: 'Attendance Reports',
    icon: <Award className="w-4 h-4 shrink-0" />,
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  onClose,
}) => {
  const { user, isLoading, openLoginModal } = useAuth();

  // Build navigation strictly from the authenticated user's permitted modules
  const permittedIds = user && !user.mustChangePassword
    ? getPermittedModules(user.role)
    : [];

  const visibleModules = MODULE_REGISTRY.filter((mod) =>
    permittedIds.includes(mod.id)
  );

  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const userInitial = (user?.fullName || user?.username || 'U').charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-stone-900/60 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar container */}
      <aside
        id="sidebar-navigation"
        aria-label="Application Navigation"
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 max-w-[85vw] bg-[#4B2E2E] text-[#F5F5DC] flex flex-col border-r border-[#3A2222] shadow-xl transition-transform duration-200 ease-out lg:translate-x-0 print:hidden ${
          isOpen ? 'translate-x-0 rounded-r-2xl' : '-translate-x-full'
        }`}
      >
        {/* Brand Area with College Logo */}
        <div className="px-4 py-3.5 border-b border-[#3D2323] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-white p-0.5 flex items-center justify-center shrink-0 shadow-xs border border-[#D4AF37]/40">
              <CollegeLogo size="sm" className="w-full h-full" />
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-sm font-bold text-[#F5F5DC] tracking-wide leading-tight truncate">
                KAMCH ERP
              </h2>
              <p className="text-[11px] text-[#D4AF37] font-medium truncate">
                Krishna Ayurvedic Med. Coll.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="lg:hidden min-w-[40px] min-h-[40px] -mr-1 flex items-center justify-center rounded-lg text-[#F5F5DC]/70 hover:text-white hover:bg-[#3D2323] transition-all duration-200 ease-out cursor-pointer"
            aria-label="Close navigation sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {!isLoading && user && !user.mustChangePassword && visibleModules.length > 0 && (
            <div>
              <div className="px-2.5 mb-2 text-[10px] font-semibold tracking-wider uppercase text-[#D4AF37]/80">
                Institutional Modules
              </div>
              <nav className="space-y-1" aria-label="Main Navigation">
                {visibleModules.map((item) => {
                  const isActive = currentTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out text-left group cursor-pointer ${
                        isActive
                          ? 'bg-[#372020] text-white border-l-3 border-[#D4AF37] shadow-xs'
                          : 'text-[#F5F5DC]/80 hover:bg-[#3E2424] hover:text-[#F5F5DC]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className={isActive ? 'text-[#D4AF37]' : 'text-stone-300'}>
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </div>

                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {!isLoading && !user && (
            <div className="pt-2 px-1">
              <button
                type="button"
                onClick={() => {
                  openLoginModal();
                  onClose();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium bg-[#372020] hover:bg-[#3E2424] text-[#D4AF37] border border-[#D4AF37]/30 transition-all duration-200 ease-out cursor-pointer active:scale-[0.98]"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Institutional Sign In</span>
              </button>
            </div>
          )}
        </div>

        {/* Compact User Status Footer */}
        {user && (
          <div className="p-3 border-t border-[#3D2323] bg-[#3B2222]/90 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#4B2E2E] border border-[#D4AF37]/50 text-[#F5F5DC] font-bold text-xs flex items-center justify-center shrink-0">
              {userInitial}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-[#F5F5DC] truncate">
                {user.fullName}
              </span>
              <span className="text-[10px] text-[#D4AF37] truncate font-mono">
                {user.departmentName ? `${user.roleName} · ${user.departmentName}` : user.roleName}
              </span>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
