import React from 'react';
import { Menu, LogIn, LogOut, AlertTriangle, KeyRound } from 'lucide-react';
import { NavigationItemKey } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../ui/Badge';
import { NotificationDropdown } from '../ui/NotificationDropdown';

export interface TopNavbarProps {
  onOpenMobileMenu: () => void;
  currentTab: NavigationItemKey;
  onSelectTab: (tab: NavigationItemKey) => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  onOpenMobileMenu,
  currentTab,
}) => {
  const { user, openLoginModal, openPasswordModal, logout } = useAuth();

  const getPageTitle = (tab: NavigationItemKey): string => {
    if (!user) return 'Institutional Portal';
    if (user.mustChangePassword) return 'Password Change Required';
    switch (tab) {
      case 'welcome':
        return 'Overview & Dashboard';
      case 'user_mgmt':
        return 'User Management';
      case 'fees_mgmt':
        return 'Fees Management';
      case 'student_records':
        return 'Student Records';
      case 'teacher_records':
        return 'Teacher Records';
      case 'marks_mgmt':
        return 'Internal Assessment';
      case 'dept_portal':
        return 'Department Workspace';
      case 'library_mgmt':
        return 'Library';
      default:
        return 'KAMCH ERP';
    }
  };

  const userInitial = (user?.fullName || user?.username || 'U').charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 h-13 sm:h-14 bg-white/95 backdrop-blur-xs border-b border-stone-200/90 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 print:hidden">
      {/* Zone 1: Mobile Menu Button + Clean Page Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden min-w-[38px] min-h-[38px] -ml-1 text-stone-700 hover:text-stone-900 rounded-lg hover:bg-stone-100 transition-all duration-200 ease-out flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#4B2E2E]"
          aria-label="Open navigation drawer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-stone-600 truncate min-w-0">
          <span className="font-semibold text-[#4B2E2E] hidden md:inline whitespace-nowrap">
            KAMCH
          </span>
          <span className="text-stone-300 hidden md:inline">/</span>
          <span className="truncate text-stone-900 font-semibold text-xs sm:text-sm">
            {getPageTitle(currentTab)}
          </span>
        </div>
      </div>

      {/* Zone 2: User Status, Password Change & Sign In/Out Action */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {user ? (
          <div className="flex items-center gap-2 sm:gap-3">
            <NotificationDropdown />
            <div className="flex items-center gap-1.5 sm:gap-2 mr-1">
              <div className="w-7 h-7 rounded-full bg-[#4B2E2E] text-[#F5F5DC] font-bold text-xs flex items-center justify-center shrink-0">
                {userInitial}
              </div>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-semibold text-stone-900 leading-tight truncate max-w-[140px]">
                  {user.fullName}
                </span>
                <span className="text-[10px] text-stone-500 font-mono truncate max-w-[160px]">
                  {user.departmentName ? `${user.roleName} · ${user.departmentName}` : user.roleName}
                </span>
              </div>
            </div>

            {user.mustChangePassword ? (
              <Badge variant="warning" size="sm" className="hidden lg:inline-flex">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Reset Required
              </Badge>
            ) : (
              <button
                type="button"
                onClick={openPasswordModal}
                title="Change your account password"
                className="inline-flex items-center justify-center gap-1 min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-lg text-stone-700 bg-white hover:bg-stone-100 border border-stone-200 transition-all duration-200 ease-out active:scale-[0.98] whitespace-nowrap cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#4B2E2E]" />
                <span className="hidden sm:inline">Change Password</span>
              </button>
            )}

            <button
              type="button"
              onClick={logout}
              title="Sign out of KAMCH ERP"
              className="inline-flex items-center justify-center gap-1 min-h-[36px] px-3 py-1 text-xs font-medium rounded-lg text-stone-700 bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-all duration-200 ease-out active:scale-[0.98] whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-stone-600" />
              <span className="hidden xs:inline">Sign Out</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openLoginModal}
            className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3.5 py-1.5 text-xs font-medium rounded-lg text-white bg-[#4B2E2E] hover:bg-[#3B2424] shadow-xs hover:shadow-sm transition-all duration-200 ease-out active:scale-[0.98] whitespace-nowrap cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
};
