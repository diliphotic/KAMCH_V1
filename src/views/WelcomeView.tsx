import React, { useEffect, useState } from 'react';
import {
  Users,
  CreditCard,
  GraduationCap,
  Briefcase,
  Building2,
  BookOpen,
  ArrowRight,
  LogIn,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { NavigationItemKey } from '../types';
import { useAuth } from '../context/AuthContext';
import { canAccessModule } from '../config/permissions';
import { CollegeLogo } from '../components/ui/CollegeLogo';

export interface WelcomeViewProps {
  onNavigate: (tab: NavigationItemKey) => void;
}

interface FeeQuickStats {
  totalCollected: number;
  pendingTransfersCount: number;
  studentCount: number;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate }) => {
  const { user, openLoginModal } = useAuth();
  const [feeStats, setFeeStats] = useState<FeeQuickStats | null>(null);

  const showUsers = Boolean(user && canAccessModule(user.role, 'user_mgmt'));
  const showFees = Boolean(user && canAccessModule(user.role, 'fees_mgmt'));
  const showStudents = Boolean(user && canAccessModule(user.role, 'student_records'));
  const showTeachers = Boolean(user && canAccessModule(user.role, 'teacher_records'));
  const showDept = Boolean(user && canAccessModule(user.role, 'dept_portal'));
  const showLibrary = Boolean(user && canAccessModule(user.role, 'library_mgmt'));

  useEffect(() => {
    if (showFees && user && !user.mustChangePassword) {
      fetch('/api/fees/stats')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.totalCollected === 'number') {
            setFeeStats({
              totalCollected: data.totalCollected,
              pendingTransfersCount: data.pendingTransfersCount || 0,
              studentCount: data.studentCount || 0,
            });
          }
        })
        .catch(() => {
          // Ignore background stats failure
        });
    } else {
      setFeeStats(null);
    }
  }, [showFees, user]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="space-y-5">
      {/* Institutional Banner Header */}
      <div className="bg-white rounded-xl border border-stone-200/80 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 border border-[#D4AF37]/40 shadow-xs">
            <CollegeLogo size="md" className="w-full h-full" />
          </div>
          <div>
            <h1 className="font-serif text-lg sm:text-xl font-bold text-stone-900 leading-tight">
              Krishna Ayurvedic Medical College &amp; Hospital
            </h1>
            <p className="text-xs text-stone-500 mt-0.5">
              Institutional Enterprise Resource Planning
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto shrink-0">
          {user ? (
            <div className="flex items-center gap-2">
              <Badge variant="institutional" size="sm">
                {user.roleName}
              </Badge>
              {user.departmentName && (
                <Badge variant="gold" size="sm">
                  {user.departmentName}
                </Badge>
              )}
            </div>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={<LogIn className="w-3.5 h-3.5 text-[#D4AF37]" />}
              onClick={openLoginModal}
            >
              Sign In
            </Button>
          )}
        </div>
      </div>

      {/* Unauthenticated Landing Card (Never exposes restricted module cards or student/faculty login) */}
      {!user && (
        <Card accentTop>
          <CardContent className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <h2 className="font-serif text-base font-bold text-[#4B2E2E]">
                Authorized Institutional Access
              </h2>
              <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
                Sign in with your assigned institutional username or email address to access permitted administrative and academic modules.
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              icon={<LogIn className="w-4 h-4 text-[#D4AF37]" />}
              onClick={openLoginModal}
            >
              Sign In to KAMCH ERP
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Individual Teacher / Faculty Profile Card (Phase 1) */}
      {user && user.role === 'FACULTY' && !user.mustChangePassword && (
        <Card accentTop className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>Faculty Member Account</CardTitle>
                <p className="text-xs text-stone-500">
                  Linked Institutional Teacher Record (Phase 1)
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-[#FAF9F5] rounded-xl border border-stone-200/80 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-stone-900 font-serif">
                    {user.fullName}
                  </h3>
                  <p className="text-xs text-stone-600">
                    {user.teacherDesignation || 'Faculty Member'}
                    {user.departmentName ? ` · Department of ${user.departmentName}` : ''}
                  </p>
                </div>
                <Badge variant="success" size="sm">Active Account</Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 border-t border-stone-200/60 text-xs">
                <div>
                  <span className="text-[10px] text-stone-400 block font-medium">Username</span>
                  <span className="font-mono text-stone-800 font-semibold">{user.username}</span>
                </div>
                {user.teacherEmployeeCode && (
                  <div>
                    <span className="text-[10px] text-stone-400 block font-medium">Employee Code</span>
                    <span className="font-mono text-stone-800 font-semibold">{user.teacherEmployeeCode}</span>
                  </div>
                )}
                {user.teacherCode && (
                  <div>
                    <span className="text-[10px] text-stone-400 block font-medium">Teacher Code (NCISM)</span>
                    <span className="font-mono text-stone-800 font-semibold">{user.teacherCode}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-lg text-xs text-amber-900 leading-relaxed">
              <p className="font-medium text-amber-950 mb-0.5">Teacher Leave Management System — Phase 1 Active</p>
              Your individual institutional login account is verified and linked to your official faculty profile. Leave applications, balance management, and workflow approvals will become available in subsequent release phases.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Authenticated Operational Module Cards — Strictly Permitted Modules Only */}
      {user && user.role !== 'FACULTY' && !user.mustChangePassword && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {showFees && (
            <Card accentTop className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                      <CreditCard className="w-4.5 h-4.5" />
                    </div>
                    <CardTitle>Fees Management</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Student fee assessments, cash and bank-transfer collections, passbook verification, receipts, and financial reports.
                  </p>
                  {feeStats && (
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/70">
                        <span className="text-[10px] text-stone-500 font-medium block">Verified Collected</span>
                        <span className="text-xs font-bold text-emerald-800">
                          {formatCurrency(feeStats.totalCollected)}
                        </span>
                      </div>
                      <div className="bg-stone-50 p-2.5 rounded-lg border border-stone-200/70">
                        <span className="text-[10px] text-stone-500 font-medium block">Pending Transfers</span>
                        <span className="text-xs font-bold text-amber-800">
                          {feeStats.pendingTransfersCount} Pending
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </div>
              <div className="p-5 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  iconPosition="right"
                  onClick={() => onNavigate('fees_mgmt')}
                >
                  Open Fees Management
                </Button>
              </div>
            </Card>
          )}

          {showUsers && (
            <Card accentTop className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                      <Users className="w-4.5 h-4.5" />
                    </div>
                    <CardTitle>User Management</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Account creation, role assignment, suspension and deactivation, password resets, department accounts, and audit logs.
                  </p>
                </CardContent>
              </div>
              <div className="p-5 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  iconPosition="right"
                  onClick={() => onNavigate('user_mgmt')}
                >
                  Open User Management
                </Button>
              </div>
            </Card>
          )}

          {showStudents && (
            <Card accentTop className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                      <GraduationCap className="w-4.5 h-4.5" />
                    </div>
                    <CardTitle>Student Management</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Central student registry across RS6 and RS7 cohorts, roll numbers, academic progression, internship tracking, and fee summaries.
                  </p>
                </CardContent>
              </div>
              <div className="p-5 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  iconPosition="right"
                  onClick={() => onNavigate('student_records')}
                >
                  Open Student Management
                </Button>
              </div>
            </Card>
          )}

          {showTeachers && (
            <Card accentTop className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                      <Briefcase className="w-4.5 h-4.5" />
                    </div>
                    <CardTitle>Teacher Records</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Institutional registry of faculty and teaching staff across college departments.
                  </p>
                </CardContent>
              </div>
              <div className="p-5 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  iconPosition="right"
                  onClick={() => onNavigate('teacher_records')}
                >
                  Open Teacher Records
                </Button>
              </div>
            </Card>
          )}

          {showDept && (
            <Card accentTop className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                      <Building2 className="w-4.5 h-4.5" />
                    </div>
                    <CardTitle>Department Workspace</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Departmental overview and assigned department faculty records.
                  </p>
                </CardContent>
              </div>
              <div className="p-5 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  iconPosition="right"
                  onClick={() => onNavigate('dept_portal')}
                >
                  Open Department Workspace
                </Button>
              </div>
            </Card>
          )}

          {showLibrary && (
            <Card accentTop className="flex flex-col justify-between">
              <div>
                <CardHeader className="pb-3 border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                      <BookOpen className="w-4.5 h-4.5" />
                    </div>
                    <CardTitle>Library</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Institutional library administration workspace.
                  </p>
                </CardContent>
              </div>
              <div className="p-5 pt-0">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  iconPosition="right"
                  onClick={() => onNavigate('library_mgmt')}
                >
                  Open Library
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
