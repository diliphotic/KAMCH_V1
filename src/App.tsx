import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { AppLayout } from './components/layout/AppLayout';
import { WelcomeView } from './views/WelcomeView';
import { UserManagementView } from './views/UserManagementView';
import { FeesManagementView } from './views/FeesManagementView';
import { StudentRecordsView } from './views/StudentRecordsView';
import { TeacherRecordsView } from './views/TeacherRecordsView';
import { DepartmentWorkspaceView } from './views/DepartmentWorkspaceView';
import { MarksManagementView } from './views/MarksManagementView';
import { LibraryWorkspaceView } from './views/LibraryWorkspaceView';
import { LeaveManagementView } from './views/LeaveManagementView';
import { AttendanceManagementView } from './views/AttendanceManagementView';
import { UniversityExamsView } from './views/UniversityExamsView';
import { NavigationItemKey } from './types';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  canAccessModule,
  getDefaultModuleForRole,
  moduleFromPathname,
  pathnameForModule,
} from './config/permissions';
import { LoginModal } from './components/auth/LoginModal';
import { ChangePasswordModal } from './components/auth/ChangePasswordModal';
import { Card, CardContent } from './components/ui/Card';

function AppContent() {
  const { user, isLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavigationItemKey>(() => {
    return moduleFromPathname(window.location.pathname) || 'welcome';
  });
  const [pendingFeesRegistration, setPendingFeesRegistration] = useState(false);
  const [feesTargetStudentId, setFeesTargetStudentId] = useState<number | null>(null);
  const [profileTargetStudentId, setProfileTargetStudentId] = useState<number | null>(null);

  const navigateToTab = useCallback(
    (tab: NavigationItemKey, replace = false) => {
      const targetTab =
        user && !user.mustChangePassword && canAccessModule(user.role, tab)
          ? tab
          : getDefaultModuleForRole(user?.role);

      setCurrentTab(targetTab);
      const nextPath = pathnameForModule(targetTab);
      if (window.location.pathname !== nextPath) {
        if (replace) {
          window.history.replaceState(null, '', nextPath);
        } else {
          window.history.pushState(null, '', nextPath);
        }
      }
    },
    [user]
  );

  // Enforce URL & tab access rules whenever auth state or browser history changes
  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setCurrentTab('welcome');
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
      return;
    }

    if (user.mustChangePassword) {
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
      return;
    }

    const urlModule = moduleFromPathname(window.location.pathname);
    const desired = urlModule || currentTab;
    if (!canAccessModule(user.role, desired)) {
      const fallback = getDefaultModuleForRole(user.role);
      setCurrentTab(fallback);
      const nextPath = pathnameForModule(fallback);
      if (window.location.pathname !== nextPath) {
        window.history.replaceState(null, '', nextPath);
      }
    } else if (desired !== currentTab) {
      setCurrentTab(desired);
    }
  }, [user, isLoading, currentTab]);

  useEffect(() => {
    const handlePopState = () => {
      const urlModule = moduleFromPathname(window.location.pathname) || 'welcome';
      if (user && !user.mustChangePassword && canAccessModule(user.role, urlModule)) {
        setCurrentTab(urlModule);
      } else {
        const fallback = getDefaultModuleForRole(user?.role);
        setCurrentTab(fallback);
        window.history.replaceState(null, '', pathnameForModule(fallback));
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  return (
    <AppLayout currentTab={currentTab} onSelectTab={(tab) => navigateToTab(tab)}>
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center text-stone-500 text-xs gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-[#4B2E2E]" />
          <span>Verifying institutional session...</span>
        </div>
      ) : user?.mustChangePassword ? (
        <Card accentTop>
          <CardContent className="p-6 flex items-center gap-3 text-xs text-stone-700">
            <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0" />
            <span>
              Please complete your mandatory first-login password change to access KAMCH ERP modules.
            </span>
          </CardContent>
        </Card>
      ) : !user ? (
        <WelcomeView onNavigate={(tab) => navigateToTab(tab)} />
      ) : (
        <>
          {currentTab === 'welcome' && canAccessModule(user.role, 'welcome') && (
            <WelcomeView onNavigate={(tab) => navigateToTab(tab)} />
          )}

          {currentTab === 'user_mgmt' && canAccessModule(user.role, 'user_mgmt') && (
            <UserManagementView />
          )}

          {currentTab === 'fees_mgmt' && canAccessModule(user.role, 'fees_mgmt') && (
            <FeesManagementView
              initialSelectedStudentId={feesTargetStudentId}
              onClearInitialSelectedStudent={() => setFeesTargetStudentId(null)}
              onRegisterInStudentManagement={
                canAccessModule(user.role, 'student_records')
                  ? () => {
                      setPendingFeesRegistration(true);
                      navigateToTab('student_records');
                    }
                  : undefined
              }
              onOpenStudentProfile={
                canAccessModule(user.role, 'student_records')
                  ? (studentId) => {
                      setProfileTargetStudentId(studentId);
                      navigateToTab('student_records');
                    }
                  : undefined
              }
            />
          )}

          {currentTab === 'student_records' && canAccessModule(user.role, 'student_records') && (
            <StudentRecordsView
              onNavigate={(tab) => navigateToTab(tab)}
              autoOpenRegisterForFees={pendingFeesRegistration}
              onRegisteredForFees={(studentId) => {
                setPendingFeesRegistration(false);
                setFeesTargetStudentId(studentId);
                navigateToTab('fees_mgmt');
              }}
              onCancelForFees={() => {
                setPendingFeesRegistration(false);
                navigateToTab('fees_mgmt');
              }}
              initialSelectedStudentId={profileTargetStudentId}
              onClearInitialSelectedStudent={() => setProfileTargetStudentId(null)}
              onOpenStudentInFees={
                canAccessModule(user.role, 'fees_mgmt')
                  ? (studentId) => {
                      setFeesTargetStudentId(studentId);
                      navigateToTab('fees_mgmt');
                    }
                  : undefined
              }
            />
          )}

          {currentTab === 'teacher_records' && canAccessModule(user.role, 'teacher_records') && (
            <TeacherRecordsView />
          )}

          {currentTab === 'marks_mgmt' && canAccessModule(user.role, 'marks_mgmt') && (
            <MarksManagementView />
          )}

          {currentTab === 'dept_portal' && canAccessModule(user.role, 'dept_portal') && (
            <DepartmentWorkspaceView onNavigate={(tab) => navigateToTab(tab)} />
          )}

          {currentTab === 'library_mgmt' && canAccessModule(user.role, 'library_mgmt') && (
            <LibraryWorkspaceView />
          )}

          {currentTab === 'leave_mgmt' && canAccessModule(user.role, 'leave_mgmt') && (
            <LeaveManagementView />
          )}

          {currentTab === 'attendance_mgmt' && canAccessModule(user.role, 'attendance_mgmt') && (
            <AttendanceManagementView />
          )}

          {currentTab === 'univ_exams' && canAccessModule(user.role, 'univ_exams') && (
            <UniversityExamsView />
          )}
        </>
      )}

      {/* Authentication Modals */}
      <LoginModal />
      <ChangePasswordModal />
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
