import { ERPModuleDefinition, NavigationItem } from '../types';

export const FOUNDATION_NAV_ITEMS: NavigationItem[] = [
  {
    id: 'welcome',
    label: 'Overview & Dashboard',
    category: 'foundation',
    isImplemented: true,
    iconName: 'LayoutDashboard',
    description: 'Krishna Ayurvedic Medical College and Hospital ERP operational dashboard.',
  },
  {
    id: 'user_mgmt',
    label: 'User Management',
    category: 'foundation',
    isImplemented: true,
    iconName: 'Users',
    badgeText: 'MOD-AUTH',
    description: 'User directory, Super Admin account creation, unlocking, and delegated requests.',
  },
  {
    id: 'fees_mgmt',
    label: 'Fees Management',
    category: 'foundation',
    isImplemented: true,
    iconName: 'CreditCard',
    badgeText: 'MOD-FEE',
    description: 'Student fee accounts, KEA exceptions, cash/bank payments, and Principal receipt approvals.',
  },
];

export const FUTURE_ERP_MODULES: ERPModuleDefinition[] = [
  {
    id: 'user_mgmt',
    title: 'Authentication & User Management',
    code: 'MOD-AUTH-01',
    category: 'Core System',
    status: 'implemented',
    isImplemented: true,
    plannedPhase: 'Phase 1 - Module 1',
    description: 'Role-based access control for Principal, Secretary, HODs, Faculty, Hospital Staff, and Students with bcrypt-hashed credentials stored in MySQL.',
    scopeSummary: [
      'Role-based permissions (Super Admin, Principal, Secretary, Faculty, Staff)',
      'Secure password hashing with bcrypt on Node.js server',
      'Session management and institutional access logging',
      'Profile management for academic and hospital staff'
    ],
    intendedTables: ['users', 'roles', 'sessions', 'account_requests', 'audit_logs']
  },
  {
    id: 'dept_mgmt',
    title: 'Department Management',
    code: 'MOD-DEPT-02',
    category: 'Academic',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 2',
    description: 'Management of Ayurvedic specialties (Kayachikitsa, Shalya Tantra, Shalakya Tantra, Prasuti & Stri Roga, Kaumarbhritya, etc.) and their administrative hierarchies.',
    scopeSummary: [
      'Ayurvedic clinical and academic department registries',
      'Faculty departmental allocations and tenure tracking',
      'Laboratory and clinical unit attachments',
      'Curriculum course mapping by department'
    ],
    intendedTables: ['departments', 'department_units', 'faculty_assignments']
  },
  {
    id: 'fees_mgmt',
    title: 'Fees Management',
    code: 'MOD-FEE-03',
    category: 'Financial',
    status: 'implemented',
    isImplemented: true,
    plannedPhase: 'Phase 1 - Module 2',
    description: 'Government, Private, and NRI quota annual fee assessment, first-year KEA concessions, cash and bank transfer payment processing, and Principal receipt approval workflow.',
    scopeSummary: [
      'Approved annual fee structure (Govt ₹1.25L, Private ₹4L, NRI ₹6L)',
      'First-year KEA ₹750 college fee exception + ₹50k development fee',
      'Cash and Bank Transfer payment recording with exact balance tracking',
      'Principal receipt approval workflow with unique sequential numbering'
    ],
    intendedTables: ['students', 'fee_structures', 'student_fee_assessments', 'fee_payments', 'fee_receipts']
  },
  {
    id: 'marks_mgmt',
    title: 'Marks & Examination Management',
    code: 'MOD-EXAM-04',
    category: 'Academic',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 3',
    description: 'NCISM (National Commission for Indian System of Medicine) standard internal assessments, semester exams, practicals, viva-voce grading, and tabulation registers.',
    scopeSummary: [
      'Internal assessment entry with cutoff validations',
      'Clinical and practical examination grading sheets',
      'Marks tabulation registers (MTR) generation',
      'University hall ticket and clearance verification'
    ],
    intendedTables: ['academic_terms', 'course_examinations', 'student_marks', 'tabulation_registers']
  },
  {
    id: 'dept_portal',
    title: 'Department Portal',
    code: 'MOD-DPORT-05',
    category: 'Academic',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 4',
    description: 'Self-service portal for Heads of Departments to manage departmental notices, student clinical postings, faculty timetables, and resource requests.',
    scopeSummary: [
      'Departmental announcement and notice board',
      'Clinical ward rotation and student batch postings',
      'Daily lecture and practical schedule planner',
      'Departmental equipment and herbarium inventory tracking'
    ],
    intendedTables: ['dept_notices', 'clinical_postings', 'timetable_slots', 'dept_inventory']
  },
  {
    id: 'library_mgmt',
    title: 'Library Management',
    code: 'MOD-LIB-06',
    category: 'Academic',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 4',
    description: 'Cataloging of classical Ayurvedic samhitas, modern medical texts, clinical journals, book issuing, return cycles, and student reading room tracking.',
    scopeSummary: [
      'Ayurvedic manuscript and modern medical textbook accession registry',
      'Barcode-compatible book issuance and return workflow',
      'Late return overdue calculations and clearance checks',
      'E-journal and digital repository access integration'
    ],
    intendedTables: ['library_accessions', 'library_cards', 'book_issues', 'journal_subscriptions']
  },
  {
    id: 'principal_utils',
    title: 'Principal Utilities',
    code: 'MOD-PRIN-07',
    category: 'Governance',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 5',
    description: 'Executive supervision dashboard for the College Principal to review overall attendance, NCISM inspection compliances, faculty leave sanctions, and academic calendars.',
    scopeSummary: [
      'Executive institutional compliance checklists (NCISM/University)',
      'Faculty leave approvals and duty allocation oversight',
      'Academic calendar milestones and examination approvals',
      'College council minutes and statutory resolutions'
    ],
    intendedTables: ['statutory_compliances', 'faculty_leave_requests', 'council_resolutions']
  },
  {
    id: 'secretary_utils',
    title: 'Secretary Utilities',
    code: 'MOD-SEC-08',
    category: 'Governance',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 5',
    description: 'Administrative management utilities for the College Trust/Board Secretary for governance, infrastructure budgeting, staff recruitment approvals, and trust documentation.',
    scopeSummary: [
      'Trust board governance and institutional executive orders',
      'Capital expenditure and facility development tracking',
      'Staff appointment confirmations and service records',
      'Official correspondence and university liaison files'
    ],
    intendedTables: ['board_resolutions', 'capital_budgets', 'service_records', 'official_dispatches']
  },
  {
    id: 'reports',
    title: 'Reports & Institutional Records',
    code: 'MOD-REP-09',
    category: 'Governance',
    status: 'planned',
    isImplemented: false,
    plannedPhase: 'Phase 5',
    description: 'Comprehensive report generation engine for statutory inspections, annual university returns, student demographic analysis, and financial audits.',
    scopeSummary: [
      'Standard NCISM inspection proforma exports',
      'Annual academic performance and enrollment summaries',
      'Financial audit-ready fee reconciliation statements',
      'Hospital clinical census and bed occupancy reporting'
    ],
    intendedTables: ['report_templates', 'generated_reports', 'export_logs']
  }
];
