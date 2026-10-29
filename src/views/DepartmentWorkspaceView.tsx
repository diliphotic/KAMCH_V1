import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Briefcase, ArrowRight, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isDepartmentAccountRole } from '../config/permissions';
import { NavigationItemKey } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

interface DepartmentWorkspaceProps {
  onNavigate: (tab: NavigationItemKey) => void;
}

interface DeptInfo {
  id: number;
  code: string;
  name: string;
  description: string | null;
}

interface DeptTeacher {
  id: number;
  employeeCode: string;
  teacherCode?: string;
  teacherCodeStatus?: string;
  registrationNumber?: string;
  fullName: string;
  designation: string;
  qualification: string;
  status: string;
  dataVerificationRequired?: boolean;
}

export const DepartmentWorkspaceView: React.FC<DepartmentWorkspaceProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const isDeptScoped = isDepartmentAccountRole(user?.role);

  const [departmentsList, setDepartmentsList] = useState<DeptInfo[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(user?.departmentId || null);
  const [department, setDepartment] = useState<DeptInfo | null>(null);
  const [teachers, setTeachers] = useState<DeptTeacher[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isDeptScoped) {
        const res = await fetch('/api/departments/my-workspace');
        if (res.ok) {
          const data = await res.json();
          setDepartment(data.department || null);
          setTeachers(data.teachers || []);
        }
      } else {
        const listRes = await fetch('/api/departments/my-workspace');
        if (listRes.ok) {
          const listData = await listRes.json();
          const depts: DeptInfo[] = listData.departments || [];
          setDepartmentsList(depts);
          const targetId = selectedDeptId || depts[0]?.id || null;
          if (targetId) {
            setSelectedDeptId(targetId);
            const wsRes = await fetch(`/api/departments/${targetId}/workspace`);
            if (wsRes.ok) {
              const wsData = await wsRes.json();
              setDepartment(wsData.department || null);
              setTeachers(wsData.teachers || []);
            }
          } else {
            setDepartment(null);
            setTeachers([]);
          }
        }
      }
    } catch {
      // Ignore network hiccup
    } finally {
      setIsLoading(false);
    }
  }, [isDeptScoped, selectedDeptId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={department ? department.name : 'Department Workspace'}
        description={
          isDeptScoped
            ? 'Department-isolated academic workspace for your assigned department.'
            : 'Inspect departmental records and assigned teaching staff.'
        }
        actions={
          <div className="flex items-center gap-2">
            {!isDeptScoped && departmentsList.length > 0 && (
              <select
                value={selectedDeptId || ''}
                onChange={(e) => setSelectedDeptId(Number(e.target.value))}
                className="py-1.5 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-800 min-h-[36px]"
              >
                {departmentsList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<Briefcase className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('teacher_records')}
            >
              Manage Teacher Records
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-xs text-stone-500">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D4AF37]" />
            Loading department workspace...
          </CardContent>
        </Card>
      ) : !department ? (
        <Card>
          <CardContent className="p-8 text-center text-xs text-stone-500">
            <Building2 className="w-6 h-6 mx-auto mb-2 text-stone-400" />
            No department records configured yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card accentTop>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#4B2E2E]/10 flex items-center justify-center text-[#4B2E2E]">
                  <Building2 className="w-4.5 h-4.5" />
                </div>
                <div>
                  <CardTitle>{department.name}</CardTitle>
                  <CardDescription>{department.description || 'Institutional Department'}</CardDescription>
                </div>
              </div>
              <Badge variant="gold" size="sm">
                {department.code}
              </Badge>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Department Teacher Records ({teachers.length})</CardTitle>
                <CardDescription>
                  Teaching faculty associated with {department.name}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                icon={<ArrowRight className="w-3.5 h-3.5" />}
                iconPosition="right"
                onClick={() => onNavigate('teacher_records')}
              >
                Open Registry
              </Button>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Teacher Code</th>
                    <th className="py-2.5 px-4">Prof. Reg. No.</th>
                    <th className="py-2.5 px-4">Teacher Name</th>
                    <th className="py-2.5 px-4">Designation</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {teachers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-stone-500">
                        No teacher records added for this department yet.
                      </td>
                    </tr>
                  ) : (
                    teachers.map((t) => (
                      <tr key={t.id} className="hover:bg-stone-50/70">
                        <td className="py-2.5 px-4 font-mono text-stone-700">
                          {t.teacherCode ||
                            (t.teacherCodeStatus === 'APPLIED'
                              ? 'Applied'
                              : t.employeeCode || '—')}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-stone-600">
                          {t.registrationNumber || '—'}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-stone-900">{t.fullName}</td>
                        <td className="py-2.5 px-4 text-stone-700">{t.designation}</td>
                        <td className="py-2.5 px-4">
                          <Badge variant={t.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">
                            {t.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
