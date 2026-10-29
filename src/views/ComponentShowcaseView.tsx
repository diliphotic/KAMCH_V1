import React, { useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Send,
  Eye,
  AlertCircle,
  FileCheck,
  Building,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { FormField, Input, Select, Textarea } from '../components/ui/FormField';
import { Table, Column } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Notification } from '../components/ui/Notification';
import { ButtonVariant, ButtonSize, BadgeVariant, NotificationType } from '../types';

interface DepartmentRow {
  code: string;
  name: string;
  sanskritName: string;
  hodTitle: string;
  facultyQuota: number;
  status: 'active' | 'in_review';
}

const SAMPLE_DEPARTMENTS: DepartmentRow[] = [
  {
    code: 'AYUR-KAYA-01',
    name: 'General Medicine',
    sanskritName: 'Kayachikitsa',
    hodTitle: 'Professor & Senior Physician',
    facultyQuota: 8,
    status: 'active',
  },
  {
    code: 'AYUR-SHAL-02',
    name: 'Surgery & Kshar Sutra',
    sanskritName: 'Shalya Tantra',
    hodTitle: 'Chief Surgical Consultant',
    facultyQuota: 6,
    status: 'active',
  },
  {
    code: 'AYUR-SHAL-03',
    name: 'ENT, Eye & Dentistry',
    sanskritName: 'Shalakya Tantra',
    hodTitle: 'Associate Professor',
    facultyQuota: 5,
    status: 'active',
  },
  {
    code: 'AYUR-PRAS-04',
    name: 'Obstetrics & Gynecology',
    sanskritName: 'Prasuti & Stri Roga',
    hodTitle: 'Senior Clinical Specialist',
    facultyQuota: 6,
    status: 'active',
  },
  {
    code: 'AYUR-DRAV-05',
    name: 'Ayurvedic Pharmacology',
    sanskritName: 'Dravyaguna Vijnana',
    hodTitle: 'Professor of Pharmacognosy',
    facultyQuota: 7,
    status: 'active',
  },
];

export const ComponentShowcaseView: React.FC = () => {
  // Button interactive test state
  const [selectedVariant, setSelectedVariant] = useState<ButtonVariant>('primary');
  const [selectedSize, setSelectedSize] = useState<ButtonSize>('md');
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [isDisabledState, setIsDisabledState] = useState(false);
  const [buttonClickCount, setButtonClickCount] = useState(0);

  // Form interactive test state
  const [formInputText, setFormInputText] = useState('BAMS-2026-Batch');
  const [formSelectedDept, setFormSelectedDept] = useState('AYUR-KAYA-01');
  const [formNotes, setFormNotes] = useState('Initial institutional registry verification.');
  const [showFieldError, setShowFieldError] = useState(false);

  // Table interactive test state
  const [isDenseTable, setIsDenseTable] = useState(false);
  const [showEmptyTable, setShowEmptyTable] = useState(false);

  // Notification interactive test state
  const [activeNotifications, setActiveNotifications] = useState<Record<string, boolean>>({
    institutional: true,
    info: true,
    warning: true,
    success: true,
  });

  const dismissNotification = (id: string) => {
    setActiveNotifications((prev) => ({ ...prev, [id]: false }));
  };

  const resetNotifications = () => {
    setActiveNotifications({
      institutional: true,
      info: true,
      warning: true,
      success: true,
    });
  };

  // Table column configuration
  const columns: Column<DepartmentRow>[] = [
    {
      key: 'code',
      header: 'Department Code',
      isNumeric: true,
      render: (row) => <span className="font-mono text-stone-700 font-medium">{row.code}</span>,
    },
    {
      key: 'sanskritName',
      header: 'Ayurvedic Discipline',
      render: (row) => (
        <div>
          <span className="font-semibold text-stone-900">{row.sanskritName}</span>
          <span className="text-xs text-stone-500 block">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'hodTitle',
      header: 'HOD Academic Rank',
      render: (row) => <span className="text-stone-700">{row.hodTitle}</span>,
    },
    {
      key: 'facultyQuota',
      header: 'Approved Faculty',
      align: 'right',
      isNumeric: true,
      render: (row) => (
        <span className="tabular-nums font-mono text-stone-800 font-medium">
          {row.facultyQuota}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'NCISM Status',
      align: 'center',
      render: (row) => (
        <Badge variant={row.status === 'active' ? 'success' : 'warning'} size="sm">
          {row.status === 'active' ? 'Approved Unit' : 'Under Review'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Institutional Component Kit"
        kicker="Design System Implementation"
        description="A complete suite of reusable, accessible UI building blocks built strictly with the institutional colour palette (#4B2E2E Deep brown, #F5F5DC Cream, #D4AF37 Antique gold, #FFFFFF White)."
        breadcrumbs={[
          { label: 'KAMCH ERP', href: '#' },
          { label: 'Foundation', href: '#' },
          { label: 'Component Kit', current: true },
        ]}
      />

      {/* 1. Button Suite */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Reusable Button Component</CardTitle>
            <CardDescription>
              Supports primary, secondary, outline, ghost, and gold variants across three scale sizes.
            </CardDescription>
          </div>
          <Badge variant="institutional" size="sm">Button.tsx</Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Variant Matrix */}
          <div>
            <label className="text-xs font-semibold text-stone-600 uppercase tracking-wider block mb-3">
              Standard Variant Gallery
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => setButtonClickCount((c) => c + 1)}>
                Primary (#4B2E2E)
              </Button>
              <Button variant="secondary" onClick={() => setButtonClickCount((c) => c + 1)}>
                Secondary (#F5F5DC)
              </Button>
              <Button variant="gold" onClick={() => setButtonClickCount((c) => c + 1)}>
                Antique Gold (#D4AF37)
              </Button>
              <Button variant="outline" onClick={() => setButtonClickCount((c) => c + 1)}>
                Outline
              </Button>
              <Button variant="ghost" onClick={() => setButtonClickCount((c) => c + 1)}>
                Ghost
              </Button>
              <Button variant="primary" disabled>
                Disabled State
              </Button>
            </div>
          </div>

          {/* Size Scale */}
          <div>
            <label className="text-xs font-semibold text-stone-600 uppercase tracking-wider block mb-3">
              Size Hierarchy
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" icon={<Building className="w-3 h-3" />}>
                Small (sm)
              </Button>
              <Button variant="primary" size="md" icon={<Building className="w-4 h-4" />}>
                Medium (md - Default)
              </Button>
              <Button variant="primary" size="lg" icon={<Building className="w-5 h-5" />}>
                Large (lg)
              </Button>
            </div>
          </div>

          {/* Interactive Button Workbench */}
          <div className="p-4 rounded-md bg-stone-50 border border-stone-200">
            <h4 className="text-xs font-bold text-stone-800 mb-2 flex items-center justify-between">
              <span>Interactive Button Tester</span>
              <span className="font-mono text-stone-500 font-normal">
                Clicks Registered: {buttonClickCount}
              </span>
            </h4>
            <div className="flex flex-wrap items-center gap-4 text-xs text-stone-700 mb-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isLoadingState}
                  onChange={(e) => setIsLoadingState(e.target.checked)}
                  className="rounded text-[#4B2E2E] focus:ring-[#4B2E2E]"
                />
                <span>Toggle Loading State</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDisabledState}
                  onChange={(e) => setIsDisabledState(e.target.checked)}
                  className="rounded text-[#4B2E2E] focus:ring-[#4B2E2E]"
                />
                <span>Toggle Disabled State</span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant={selectedVariant}
                size={selectedSize}
                isLoading={isLoadingState}
                disabled={isDisabledState}
                icon={<Send className="w-4 h-4" />}
                onClick={() => setButtonClickCount((c) => c + 1)}
              >
                Test Interactive Action
              </Button>
              <span className="text-xs text-stone-500">
                Current Variant: <code className="text-[#4B2E2E] font-semibold">{selectedVariant}</code>
              </span>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex items-center justify-between w-full text-xs text-stone-500">
            <span>WCAG compliant focus rings via focus-visible:outline-2</span>
            <span>Single-line label enforcement (whitespace-nowrap)</span>
          </div>
        </CardFooter>
      </Card>

      {/* 2. Card Hierarchy */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>2. Reusable Card Component</CardTitle>
            <CardDescription>
              Structural container with single-elevation depth, subtle hairline borders, and optional institutional gold top accent.
            </CardDescription>
          </div>
          <Badge variant="institutional" size="sm">Card.tsx</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Standard Card */}
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Standard Institutional Container</CardTitle>
                  <CardDescription>Clean hairline border with stone-200 border</CardDescription>
                </div>
                <Badge variant="neutral" size="sm">Standard</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Default card styling with zero-pill metadata discipline, crisp title typography, and restrained shadows.
                </p>
              </CardContent>
              <CardFooter>
                <span>Footer Slot · Action Area</span>
              </CardFooter>
            </Card>

            {/* Accent Top Card */}
            <Card accentTop>
              <CardHeader>
                <div>
                  <CardTitle>Top-Accent Institutional Card</CardTitle>
                  <CardDescription>2px Antique Gold (#D4AF37) top hairline</CardDescription>
                </div>
                <Badge variant="gold" size="sm">Featured</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Used for primary dashboards, key governance files, and statutory compliance indicators without excessive decoration.
                </p>
              </CardContent>
              <CardFooter>
                <span>Footer Slot · Status Verified</span>
              </CardFooter>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* 3. Form Fields Suite */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>3. Reusable Form Field Components</CardTitle>
            <CardDescription>
              Accessible inputs, selects, and textareas with label binding, error messages, and helper hints.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showFieldError ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setShowFieldError(!showFieldError)}
            >
              {showFieldError ? 'Hide Error State' : 'Simulate Validation Error'}
            </Button>
            <Badge variant="institutional" size="sm">FormField.tsx</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              id="academic-batch-code"
              label="Academic Batch Identifier"
              required
              helperText="Official university intake batch designation."
              error={showFieldError ? 'This identifier must follow format BAMS-YYYY-Batch' : undefined}
            >
              <Input
                id="academic-batch-code"
                value={formInputText}
                onChange={(e) => setFormInputText(e.target.value)}
                error={showFieldError}
                placeholder="e.g. BAMS-2026-Batch"
              />
            </FormField>

            <FormField
              id="department-select"
              label="Assigned Department"
              required
              helperText="Select parent Ayurvedic teaching or clinical department."
              error={showFieldError ? 'Department assignment is required' : undefined}
            >
              <Select
                id="department-select"
                value={formSelectedDept}
                onChange={(e) => setFormSelectedDept(e.target.value)}
                error={showFieldError}
              >
                <option value="AYUR-KAYA-01">Kayachikitsa (General Medicine)</option>
                <option value="AYUR-SHAL-02">Shalya Tantra (Surgery)</option>
                <option value="AYUR-SHAL-03">Shalakya Tantra (ENT & Ophthalmology)</option>
                <option value="AYUR-PRAS-04">Prasuti & Stri Roga (Obstetrics)</option>
                <option value="AYUR-DRAV-05">Dravyaguna Vijnana (Pharmacology)</option>
              </Select>
            </FormField>
          </div>

          <FormField
            id="administrative-remarks"
            label="Administrative Registry Remarks"
            helperText="Optional notes regarding the department establishment records."
          >
            <Textarea
              id="administrative-remarks"
              rows={3}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Enter archival documentation notes..."
            />
          </FormField>
        </CardContent>
        <CardFooter>
          <div className="flex items-center justify-between w-full text-xs text-stone-600">
            <span>Label bindings link via htmlFor and aria-describedby</span>
            <span>Error messages feature role=&quot;alert&quot; for screen readers</span>
          </div>
        </CardFooter>
      </Card>

      {/* 4. Table Component */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>4. Reusable Institutional Table</CardTitle>
            <CardDescription>
              Clean table with tabular figures for numeric codes and responsive horizontal overflow wrapping.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDenseTable(!isDenseTable)}
            >
              {isDenseTable ? 'Normal Padding' : 'Compact Rows'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEmptyTable(!showEmptyTable)}
            >
              {showEmptyTable ? 'Show Data Rows' : 'Test Empty State'}
            </Button>
            <Badge variant="institutional" size="sm">Table.tsx</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table<DepartmentRow>
            columns={columns}
            data={showEmptyTable ? [] : SAMPLE_DEPARTMENTS}
            keyExtractor={(row) => row.code}
            dense={isDenseTable}
            emptyMessage="No departments registered in this query. Use the future department management module to add records."
            caption="KAMCH Ayurvedic Departments Reference Table"
          />
        </CardContent>
        <CardFooter>
          <div className="flex items-center justify-between w-full text-xs text-stone-500">
            <span>Enforces tabular-nums font-mono on numeric columns</span>
            <span>Handles empty state gracefully without layout shift</span>
          </div>
        </CardFooter>
      </Card>

      {/* 5. Badge Component Suite */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>5. Reusable Badge Component</CardTitle>
            <CardDescription>
              Restrained, accessible status indicators adhering to anti-slop guidelines (no glowing candy pills).
            </CardDescription>
          </div>
          <Badge variant="institutional" size="sm">Badge.tsx</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="institutional">Institutional (#4B2E2E)</Badge>
            <Badge variant="gold">Antique Gold (#D4AF37)</Badge>
            <Badge variant="neutral">Neutral System</Badge>
            <Badge variant="success">Active / Approved</Badge>
            <Badge variant="warning">Under Review</Badge>
            <Badge variant="planned">Planned (Dashed)</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <span className="text-xs text-stone-500">Small scale (sm):</span>
            <Badge variant="institutional" size="sm">Institutional</Badge>
            <Badge variant="gold" size="sm">Gold Accent</Badge>
            <Badge variant="success" size="sm">Approved</Badge>
            <Badge variant="planned" size="sm">Future Phase</Badge>
          </div>
        </CardContent>
      </Card>

      {/* 6. Notification Banners */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>6. Reusable Notification Component</CardTitle>
            <CardDescription>
              Accessible institutional alert banners with clear severity indication and dismiss actions.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={resetNotifications}
            >
              Reset Banners
            </Button>
            <Badge variant="institutional" size="sm">Notification.tsx</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3.5">
          {activeNotifications.institutional && (
            <Notification
              type="institutional"
              title="Official Institutional Notice"
              message="Krishna Ayurvedic Medical College & Hospital administrative records foundation is verified."
              onDismiss={() => dismissNotification('institutional')}
            />
          )}

          {activeNotifications.info && (
            <Notification
              type="info"
              title="Foundation Scope Boundary"
              message="This version provides layout and UI foundations only. No fake student figures or analytics are generated."
              onDismiss={() => dismissNotification('info')}
            />
          )}

          {activeNotifications.warning && (
            <Notification
              type="warning"
              title="Database Connectivity Notice"
              message="MySQL database integration will be established in Phase 2 alongside the Authentication module."
              onDismiss={() => dismissNotification('warning')}
            />
          )}

          {activeNotifications.success && (
            <Notification
              type="success"
              title="Design System Verified"
              message="All 6 foundation components meet WCAG AA contrast standards and institutional palette guidelines."
              onDismiss={() => dismissNotification('success')}
            />
          )}

          {!activeNotifications.institutional &&
            !activeNotifications.info &&
            !activeNotifications.warning &&
            !activeNotifications.success && (
              <div className="text-center py-6 text-xs text-stone-500 italic bg-stone-50 rounded-md border border-stone-200">
                All notifications dismissed. Click &quot;Reset Banners&quot; above to re-display them.
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
};
