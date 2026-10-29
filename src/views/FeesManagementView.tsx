import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CreditCard,
  Search,
  UserPlus,
  Receipt,
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  FileText,
  BadgePercent,
  Check,
  Eye,
  Info,
  Calendar,
  Building,
  ArrowRight,
  Filter,
  DollarSign,
  Utensils,
  Home,
  RefreshCw,
  Sliders,
  RotateCcw,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Notification } from '../components/ui/Notification';
import { CollegeLogo } from '../components/ui/CollegeLogo';

export const formatINR = (val: number | string | null | undefined): string => {
  const num = typeof val === 'number' ? val : parseFloat(String(val ?? 0));
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export interface FeeStructure {
  id: number;
  academic_year: string;
  admission_category: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  year_of_study: number;
  college_fee: number;
  development_fee: number;
  mess_fee: number;
  hostel_fee: number;
  total_annual_fee: number;
  description: string;
  is_active: boolean;
}

export interface StudentFeeItem {
  id: number;
  studentIdNumber: string;
  temporaryRollNumber?: string | null;
  permanentUniversityNumber?: string | null;
  universityRegStatus?: string;
  fullName: string;
  admissionCategory: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  admissionYear: number;
  currentYearOfStudy: number;
  isKeaEligible: boolean;
  keaAcknowledgementNo: string | null;
  messEnrolled: boolean;
  hostelEnrolled: boolean;
  status: string;
  currentAssessment: {
    id: number;
    academicYear: string;
    isKeaExceptionApplied: boolean;
    keaExceptionReason: string | null;
    assessedCollegeFee: number;
    assessedDevelopmentFee: number;
    assessedMessFee: number;
    assessedHostelFee: number;
    totalAssessedFee: number;
    concessionTotal: number;
    revisedPayable: number;
  } | null;
  totalPaid: number;
  totalPending: number;
  outstandingBalance: number;
}

export interface StudentLedgerData {
  student: {
    id: number;
    studentIdNumber: string;
    fullName: string;
    admissionCategory: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
    admissionYear: number;
    currentYearOfStudy: number;
    isKeaEligible: boolean;
    keaAcknowledgementNo: string | null;
    messEnrolled: boolean;
    hostelEnrolled: boolean;
    contactPhone: string | null;
    contactEmail: string | null;
    status: string;
  };
  assessments: Array<{
    id: number;
    academicYear: string;
    yearOfStudy: number;
    admissionCategory: string;
    assessedCollegeFee: number;
    assessedDevelopmentFee: number;
    assessedMessFee: number;
    assessedHostelFee: number;
    totalAssessedFee: number;
    concessionTotal: number;
    revisedPayable: number;
    notes: string | null;
    assessorName: string;
    createdAt: string;
  }>;
  serviceEnrollments: Array<{
    id: number;
    serviceType: 'MESS' | 'HOSTEL';
    startDate: string;
    endDate: string | null;
    annualFee: number;
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    notes: string | null;
    creatorName: string;
    createdAt: string;
  }>;
  concessions: Array<{
    id: number;
    feeComponent: string;
    concessionType: 'FIXED' | 'PERCENTAGE';
    value: number;
    calculatedReduction: number;
    reason: string;
    authorizerName: string;
    createdAt: string;
  }>;
  payments: Array<{
    id: number;
    assessmentId: number;
    paymentReference: string;
    amount: number;
    destination: 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT';
    paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'ONLINE_DEV';
    studentTxRef: string | null;
    passbookTxRef: string | null;
    bankName: string | null;
    paymentDate: string;
    recorderName: string;
    verifierName: string | null;
    reverserName: string | null;
    notes: string | null;
    status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'REVERSED';
    rejectionReason: string | null;
    reversalReason: string | null;
    receipt: {
      id: number;
      receiptNumber: string;
      receiptType: string;
      status: string;
    } | null;
  }>;
  summary: {
    totalAssessed: number;
    concessionTotal: number;
    revisedPayable: number;
    verifiedPaid: number;
    pendingTransfers: number;
    outstandingBalance: number;
  };
}

export interface PrintableReceiptData {
  receiptNumber: string;
  receiptType: 'PROVISIONAL_ACKNOWLEDGEMENT' | 'FINAL_COLLEGE_RECEIPT' | 'SECRETARY_DEV_RECEIPT';
  paymentReference: string;
  destination: string;
  issueDate: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string;
  approvedByRole: string;
  student: {
    idNumber: string;
    name: string;
    category: string;
    academicYear: string;
    yearOfStudy: number;
  };
  assessment: {
    collegeFee: number;
    developmentFee: number;
    messFee: number;
    hostelFee: number;
    totalAssessed: number;
    concessions: number;
    revisedPayable: number;
  };
  payment: {
    amount: number;
    amountInWords: string;
    method: string;
    studentTxRef: string | null;
    passbookTxRef: string | null;
    bankName: string | null;
    paymentDate: string;
  };
  totalPaidSoFar: number;
  remainingBalance: number;
}

export interface FeesManagementViewProps {
  initialSelectedStudentId?: number | null;
  onClearInitialSelectedStudent?: () => void;
  onRegisterInStudentManagement?: () => void;
  onOpenStudentProfile?: (studentId: number) => void;
}

export const FeesManagementView: React.FC<FeesManagementViewProps> = ({
  initialSelectedStudentId,
  onClearInitialSelectedStudent,
  onRegisterInStudentManagement,
  onOpenStudentProfile,
}) => {
  const { user, csrfToken } = useAuth();

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isPrincipal = user?.role === 'PRINCIPAL';
  const isSecretary = user?.role === 'SECRETARY';
  const isOfficeOrStaff = user?.role === 'OFFICE' || user?.role === 'STAFF';

  // Strict role boundaries
  const canConfigureFees = isSuperAdmin || isPrincipal || isSecretary;
  const canGrantConcessions = isSuperAdmin || isPrincipal; // Office staff strictly blocked
  const canReversePayments = isSuperAdmin || isPrincipal || isSecretary; // Office staff strictly blocked
  const canVerifyBankTransfers = isSuperAdmin || isPrincipal || isSecretary || isOfficeOrStaff;
  const canRecordPayments = isSuperAdmin || isPrincipal || isSecretary || isOfficeOrStaff;

  const [activeTab, setActiveTab] = useState<'students' | 'verification' | 'structures' | 'reports'>('students');

  // Key Institutional Stats
  const [stats, setStats] = useState({
    totalAssessed: 0,
    totalCollected: 0,
    totalPending: 0,
    totalOutstanding: 0,
    pendingTransfersCount: 0,
    studentCount: 0,
  });

  // Students List (Starts strictly empty by specification)
  const [students, setStudents] = useState<StudentFeeItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  // Fee Structures
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [isLoadingStructures, setIsLoadingStructures] = useState(false);

  // Notifications
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'info'; title: string; message: string } | null>(null);

  const showNotification = (type: 'success' | 'warning' | 'info', title: string, message: string) => {
    setNotification({ type, title, message });
  };

  // Read-only potential duplicate student diagnostics (never auto-deletes or merges)
  const [potentialDuplicates, setPotentialDuplicates] = useState<
    Array<{
      studentAId: number;
      studentAIdNumber: string;
      studentAName: string;
      studentBId: number;
      studentBIdNumber: string;
      studentBName: string;
      reasons: string[];
    }>
  >([]);
  const [initializingStudentId, setInitializingStudentId] = useState<number | null>(null);

  // Student Full Ledger Modal
  const [selectedStudentLedger, setSelectedStudentLedger] = useState<StudentLedgerData | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  // Record Payment Modal
  const [paymentModal, setPaymentModal] = useState<{
    student: StudentFeeItem;
    amount: string;
    destination: 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT';
    paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'ONLINE_DEV';
    studentTxRef: string;
    bankName: string;
    paymentDate: string;
    notes: string;
  } | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Bank Transfer Verification Modal
  const [verificationModal, setVerificationModal] = useState<{
    paymentId: number;
    paymentRef: string;
    studentName: string;
    studentIdNumber: string;
    amount: number;
    studentTxRef: string | null;
    action: 'VERIFY' | 'REJECT';
    passbookTxRef: string;
    rejectionReason: string;
  } | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Concession Modal
  const [concessionModal, setConcessionModal] = useState<{
    studentId: number;
    assessmentId: number;
    studentName: string;
    totalAssessed: number;
    existingConcessions: number;
    revisedPayable: number;
    concessionType: 'FIXED' | 'PERCENTAGE';
    value: string;
    feeComponent: string;
    reason: string;
  } | null>(null);
  const [concessionLoading, setConcessionLoading] = useState(false);
  const [concessionError, setConcessionError] = useState<string | null>(null);

  // Manage Services Modal (Mess / Hostel join & leave)
  const [serviceModal, setServiceModal] = useState<{
    studentId: number;
    studentName: string;
    serviceType: 'MESS' | 'HOSTEL';
    action: 'JOIN' | 'LEAVE';
    effectiveDate: string;
    annualFee: string;
    notes: string;
  } | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  // Payment Reversal Modal (Super Admin & Principal)
  const [reversalModal, setReversalModal] = useState<{
    paymentId: number;
    paymentRef: string;
    studentName: string;
    amount: number;
    reason: string;
  } | null>(null);
  const [reversalLoading, setReversalLoading] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Fee Structure Edit Modal (Super Admin, Principal, Secretary)
  const [structureEditModal, setStructureEditModal] = useState<{
    id?: number;
    academicYear: string;
    admissionCategory: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
    yearOfStudy: number;
    collegeFee: string;
    developmentFee: string;
    messFee: string;
    hostelFee: string;
    description: string;
    isActive: boolean;
    scope: 'FUTURE_ONLY' | 'SELECTED_BATCH' | 'SELECTED_STUDENTS';
    reason: string;
    targetStudentIds: number[];
  } | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);

  // Printable Receipt Modal
  const [printableReceipt, setPrintableReceipt] = useState<PrintableReceiptData | null>(null);
  const [isLoadingPrint, setIsLoadingPrint] = useState(false);

  // Reports State
  const [reportFilters, setReportFilters] = useState({
    dateFrom: '',
    dateTo: '',
    destination: 'ALL',
    method: 'ALL',
    status: 'ALL',
    category: 'ALL',
  });
  const [reportData, setReportData] = useState<{
    records: any[];
    totalVerified: number;
    totalPending: number;
    count: number;
  }>({ records: [], totalVerified: 0, totalPending: 0, count: 0 });
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/fees/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.warn('Failed to fetch fee stats:', err);
    }
  }, []);

  // Fetch Fee Structures
  const fetchFeeStructures = useCallback(async () => {
    setIsLoadingStructures(true);
    try {
      const res = await fetch('/api/fees/structures?academicYear=2026-2027');
      if (res.ok) {
        const data = await res.json();
        setFeeStructures(data.feeStructures || []);
      }
    } catch (err) {
      console.warn('Failed to fetch structures:', err);
    } finally {
      setIsLoadingStructures(false);
    }
  }, []);

  // Fetch Students List
  const fetchStudents = useCallback(async () => {
    setIsLoadingStudents(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (categoryFilter) params.append('category', categoryFilter);

      const res = await fetch(`/api/fees/students?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } catch (err) {
      console.warn('Failed to fetch students:', err);
    } finally {
      setIsLoadingStudents(false);
    }
  }, [searchQuery, categoryFilter]);

  // Fetch Reports
  const fetchReports = useCallback(async () => {
    setIsLoadingReports(true);
    try {
      const params = new URLSearchParams();
      if (reportFilters.dateFrom) params.append('dateFrom', reportFilters.dateFrom);
      if (reportFilters.dateTo) params.append('dateTo', reportFilters.dateTo);
      if (reportFilters.destination !== 'ALL') params.append('destination', reportFilters.destination);
      if (reportFilters.method !== 'ALL') params.append('method', reportFilters.method);
      if (reportFilters.status !== 'ALL') params.append('status', reportFilters.status);
      if (reportFilters.category !== 'ALL') params.append('category', reportFilters.category);

      const res = await fetch(`/api/fees/reports?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      }
    } catch (err) {
      console.warn('Failed to fetch reports:', err);
    } finally {
      setIsLoadingReports(false);
    }
  }, [reportFilters]);

  const fetchRegistryDiagnostics = useCallback(async () => {
    try {
      const res = await fetch('/api/students/registry-diagnostics');
      if (res.ok) {
        const data = await res.json();
        setPotentialDuplicates(data.potentialDuplicates || []);
      }
    } catch {
      // Ignore diagnostics fetch failure if role lacks student_records access
    }
  }, []);

  // Initial Load
  useEffect(() => {
    fetchStats();
    fetchFeeStructures();
    fetchStudents();
    fetchRegistryDiagnostics();
  }, [fetchStats, fetchFeeStructures, fetchStudents, fetchRegistryDiagnostics]);

  useEffect(() => {
    if (activeTab === 'reports') {
      fetchReports();
    }
  }, [activeTab, fetchReports]);

  // Matching students for fee structure revision scope
  const matchingStudentsForStructure = useMemo(() => {
    if (!structureEditModal) return [];
    return students.filter(
      (s) => s.admissionCategory === structureEditModal.admissionCategory
    );
  }, [students, structureEditModal?.admissionCategory]);

  const calculateRevisedStudentFee = useCallback(
    (student: StudentFeeItem) => {
      if (!structureEditModal) return 0;
      const col = parseFloat(structureEditModal.collegeFee || '0');
      const dev = parseFloat(structureEditModal.developmentFee || '0');
      const mess = student.messEnrolled ? parseFloat(structureEditModal.messFee || '30000') : 0;
      const hostel = student.hostelEnrolled ? parseFloat(structureEditModal.hostelFee || '30000') : 0;
      return (isNaN(col) ? 0 : col) + (isNaN(dev) ? 0 : dev) + (isNaN(mess) ? 0 : mess) + (isNaN(hostel) ? 0 : hostel);
    },
    [structureEditModal]
  );

  // Initialize 2026-2027 Fee Assessment for an existing Student Management record that has none yet
  const handleInitializeAssessment = async (studentId: number) => {
    if (!csrfToken) {
      showNotification('warning', 'Session Notice', 'Session expired. Please refresh the page.');
      return;
    }

    setInitializingStudentId(studentId);
    try {
      const res = await fetch(`/api/fees/students/${studentId}/initialize-assessment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Fee Assessment Initialized', data.message);
        await fetchStudents();
        await fetchStats();
        await handleOpenLedger(studentId);
      } else {
        showNotification('warning', 'Assessment Notice', data.error || 'Failed to initialize fee assessment.');
      }
    } catch {
      showNotification('warning', 'Network Notice', 'Network error while initializing fee assessment.');
    } finally {
      setInitializingStudentId(null);
    }
  };

  // Open Student Full Ledger
  const handleOpenLedger = useCallback(async (studentId: number) => {
    setIsLoadingLedger(true);
    try {
      const res = await fetch(`/api/fees/students/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedStudentLedger(data);
      } else {
        showNotification('warning', 'Ledger Notice', 'Failed to retrieve student ledger.');
      }
    } catch {
      showNotification('warning', 'Network Notice', 'Network error retrieving student ledger.');
    } finally {
      setIsLoadingLedger(false);
    }
  }, []);

  // Automatically open student ledger when navigated from Student Management registration or profile
  useEffect(() => {
    if (initialSelectedStudentId) {
      setActiveTab('students');
      handleOpenLedger(initialSelectedStudentId);
      onClearInitialSelectedStudent?.();
    }
  }, [initialSelectedStudentId, handleOpenLedger, onClearInitialSelectedStudent]);

  // Handle Payment Submit
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModal || !csrfToken) return;

    const amountNum = parseFloat(paymentModal.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setPaymentError('Please enter a valid positive payment amount.');
      return;
    }

    if (amountNum > paymentModal.student.outstandingBalance) {
      setPaymentError(`Amount cannot exceed the current outstanding balance of ₹${paymentModal.student.outstandingBalance.toLocaleString('en-IN')}.`);
      return;
    }

    if (paymentModal.paymentMethod === 'BANK_TRANSFER' && !paymentModal.studentTxRef.trim()) {
      setPaymentError('Student transaction reference (UTR / Bank Ref) is mandatory for bank transfers.');
      return;
    }

    setPaymentLoading(true);
    setPaymentError(null);

    try {
      const res = await fetch('/api/fees/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          studentId: paymentModal.student.id,
          assessmentId: paymentModal.student.currentAssessment?.id,
          amount: amountNum,
          destination: paymentModal.destination,
          paymentMethod: paymentModal.paymentMethod,
          studentTxRef: paymentModal.studentTxRef.trim() || null,
          bankName: paymentModal.bankName.trim() || null,
          paymentDate: paymentModal.paymentDate,
          notes: paymentModal.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Payment Recorded', data.message);
        setPaymentModal(null);
        fetchStudents();
        fetchStats();

        // If printable receipt ID returned, fetch printable receipt
        if (data.receiptId) {
          handleViewReceipt(data.receiptId);
        }
      } else {
        setPaymentError(data.error || 'Failed to record payment.');
      }
    } catch {
      setPaymentError('Network error while recording payment.');
    } finally {
      setPaymentLoading(false);
    }
  };

  // Handle Bank Verification or Rejection
  const handleVerificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationModal || !csrfToken) return;

    if (verificationModal.action === 'VERIFY' && !verificationModal.passbookTxRef.trim()) {
      setVerificationError('Passbook transaction number is mandatory to verify bank transfer.');
      return;
    }

    if (verificationModal.action === 'REJECT' && !verificationModal.rejectionReason.trim()) {
      setVerificationError('Mandatory rejection reason must be provided.');
      return;
    }

    setVerificationLoading(true);
    setVerificationError(null);

    try {
      const res = await fetch(`/api/fees/payments/${verificationModal.paymentId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          action: verificationModal.action,
          passbookTxRef: verificationModal.passbookTxRef.trim(),
          rejectionReason: verificationModal.rejectionReason.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Bank Transfer Updated', data.message);
        setVerificationModal(null);
        fetchStudents();
        fetchStats();
        if (selectedStudentLedger) {
          handleOpenLedger(selectedStudentLedger.student.id);
        }
      } else {
        setVerificationError(data.error || 'Failed to process verification.');
      }
    } catch {
      setVerificationError('Network error while processing verification.');
    } finally {
      setVerificationLoading(false);
    }
  };

  // Handle Concession Submit (Super Admin & Principal)
  const handleConcessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concessionModal || !csrfToken) return;

    const valNum = parseFloat(concessionModal.value);
    if (isNaN(valNum) || valNum <= 0) {
      setConcessionError('Please enter a valid positive concession value.');
      return;
    }

    if (!concessionModal.reason.trim()) {
      setConcessionError('Mandatory institutional reason is required.');
      return;
    }

    setConcessionLoading(true);
    setConcessionError(null);

    try {
      const res = await fetch('/api/fees/concessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          studentId: concessionModal.studentId,
          assessmentId: concessionModal.assessmentId,
          concessionType: concessionModal.concessionType,
          value: valNum,
          reason: concessionModal.reason.trim(),
          feeComponent: concessionModal.feeComponent,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Concession Granted', data.message);
        setConcessionModal(null);
        fetchStudents();
        fetchStats();
        if (selectedStudentLedger) {
          handleOpenLedger(concessionModal.studentId);
        }
      } else {
        setConcessionError(data.error || 'Failed to grant concession.');
      }
    } catch {
      setConcessionError('Network error while recording concession.');
    } finally {
      setConcessionLoading(false);
    }
  };

  // Handle Service Join / Leave (Mess / Hostel)
  const handleServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceModal || !csrfToken) return;

    setServiceLoading(true);
    setServiceError(null);

    try {
      const res = await fetch(`/api/fees/students/${serviceModal.studentId}/services`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          serviceType: serviceModal.serviceType,
          action: serviceModal.action,
          effectiveDate: serviceModal.effectiveDate,
          annualFee: serviceModal.annualFee,
          notes: serviceModal.notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Service Updated', data.message);
        setServiceModal(null);
        fetchStudents();
        fetchStats();
        if (selectedStudentLedger) {
          handleOpenLedger(serviceModal.studentId);
        }
      } else {
        setServiceError(data.error || 'Failed to update service enrollment.');
      }
    } catch {
      setServiceError('Network error updating service enrollment.');
    } finally {
      setServiceLoading(false);
    }
  };

  // Handle Payment Reversal (Super Admin & Principal)
  const handleReversalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalModal || !csrfToken) return;

    if (!reversalModal.reason.trim()) {
      setReversalError('Mandatory reason required for audit trail.');
      return;
    }

    setReversalLoading(true);
    setReversalError(null);

    try {
      const res = await fetch(`/api/fees/payments/${reversalModal.paymentId}/reverse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          reversalReason: reversalModal.reason.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Payment Reversed', data.message);
        setReversalModal(null);
        fetchStudents();
        fetchStats();
        if (selectedStudentLedger) {
          handleOpenLedger(selectedStudentLedger.student.id);
        }
      } else {
        setReversalError(data.error || 'Failed to reverse payment.');
      }
    } catch {
      setReversalError('Network error reversing payment.');
    } finally {
      setReversalLoading(false);
    }
  };

  // Handle Structure Save
  const handleStructureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!structureEditModal || !csrfToken) return;

    const colFee = parseFloat(structureEditModal.collegeFee);
    const devFee = parseFloat(structureEditModal.developmentFee || '0');
    const mFee = parseFloat(structureEditModal.messFee || '30000');
    const hFee = parseFloat(structureEditModal.hostelFee || '30000');

    if (isNaN(colFee) || colFee < 0 || isNaN(devFee) || devFee < 0) {
      setStructureError('Please enter valid non-negative fee amounts.');
      return;
    }

    if ((structureEditModal.scope === 'SELECTED_BATCH' || structureEditModal.scope === 'SELECTED_STUDENTS') && !structureEditModal.reason.trim()) {
      setStructureError('Mandatory institutional reason is required when modifying student assessments.');
      return;
    }

    if (structureEditModal.scope === 'SELECTED_STUDENTS' && (!structureEditModal.targetStudentIds || structureEditModal.targetStudentIds.length === 0)) {
      setStructureError('Please select at least one student to update, or choose "Future Admissions Only".');
      return;
    }

    setStructureLoading(true);
    setStructureError(null);

    try {
      const res = await fetch('/api/fees/structures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          id: structureEditModal.id,
          academicYear: structureEditModal.academicYear,
          admissionCategory: structureEditModal.admissionCategory,
          yearOfStudy: structureEditModal.yearOfStudy,
          collegeFee: colFee,
          developmentFee: devFee,
          messFee: mFee,
          hostelFee: hFee,
          description: structureEditModal.description,
          isActive: structureEditModal.isActive,
          scope: structureEditModal.scope,
          reason: structureEditModal.reason ? structureEditModal.reason.trim() : undefined,
          targetStudentIds: structureEditModal.targetStudentIds,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('success', 'Structure Saved', data.message);
        setStructureEditModal(null);
        fetchFeeStructures();
        fetchStudents();
        fetchStats();
      } else {
        setStructureError(data.error || 'Failed to save fee structure.');
      }
    } catch {
      setStructureError('Network error saving fee structure.');
    } finally {
      setStructureLoading(false);
    }
  };

  // Fetch & View Printable Receipt
  const handleViewReceipt = async (receiptId: number) => {
    setIsLoadingPrint(true);
    try {
      const res = await fetch(`/api/fees/receipts/${receiptId}`);
      if (res.ok) {
        const data = await res.json();
        setPrintableReceipt(data);
      } else {
        showNotification('warning', 'Receipt Notice', 'Failed to retrieve receipt details.');
      }
    } catch {
      showNotification('warning', 'Network Notice', 'Network error loading receipt.');
    } finally {
      setIsLoadingPrint(false);
    }
  };

  const handlePrintReceipt = () => {
    const originalTitle = document.title;
    if (printableReceipt) {
      document.title = `Receipt_${printableReceipt.receiptNumber}_${printableReceipt.student.name.replace(/\s+/g, '_')}`;
    }
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 print:p-0 print:m-0 print:max-w-none">
      {/* Dashboard View & Operational Modals (strictly excluded during receipt printing) */}
      <div className="space-y-6 print:hidden">
        {/* Page Header */}
        <PageHeader
        title="Fees Management"
        description="Institutional fee assessment, independent mess & hostel billing, dual-account collections, passbook verification, and audit trail."
        breadcrumbs={[
          { label: 'ERP Home', href: '#' },
          { label: 'Institutional Accounts', href: '#' },
          { label: 'Fees Management', current: true },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchStats();
                fetchStudents();
                if (activeTab === 'structures') fetchFeeStructures();
                if (activeTab === 'reports') fetchReports();
              }}
              className="flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
            {canRecordPayments && onRegisterInStudentManagement && (
              <Button
                variant="primary"
                size="sm"
                onClick={onRegisterInStudentManagement}
                className="flex items-center gap-1.5 bg-[#4B2E2E] text-white hover:bg-[#3d2525]"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Register in Student Management
              </Button>
            )}
          </div>
        }
      />

      {/* Notifications */}
      {notification && (
        <Notification
          type={notification.type}
          title={notification.title}
          message={notification.message}
          onDismiss={() => setNotification(null)}
        />
      )}

      {/* Read-Only Potential Duplicate Student Records Notice */}
      {potentialDuplicates.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1.5">
          <div className="font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              {potentialDuplicates.length} Potential Duplicate Student Record Pair(s) Detected in Shared Registry (Read-Only Alert)
            </span>
          </div>
          <p className="text-[11px] text-amber-900">
            No records were modified or merged automatically. Verify the exact Student ID before recording fee collections:
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-900">
            {potentialDuplicates.slice(0, 5).map((d, idx) => (
              <li key={idx}>
                <span className="font-mono font-semibold">{d.studentAIdNumber}</span> ({d.studentAName}) &harr;{' '}
                <span className="font-mono font-semibold">{d.studentBIdNumber}</span> ({d.studentBName}) —{' '}
                {d.reasons.join('; ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Operational Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Assessed */}
        <Card className="rounded-xl border border-stone-200/70 shadow-sm bg-white hover:border-amber-200 transition-all duration-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total Assessed Fees</p>
              <h3 className="text-xl font-bold text-stone-900 mt-1">₹{stats.totalAssessed.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-stone-500 mt-0.5">{stats.studentCount} enrolled student{stats.studentCount === 1 ? '' : 's'}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-[#D4AF37]">
              <DollarSign className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Total Verified Collected */}
        <Card className="rounded-xl border border-stone-200/70 shadow-sm bg-white hover:border-emerald-200 transition-all duration-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Verified Collections</p>
              <h3 className="text-xl font-bold text-emerald-700 mt-1">₹{stats.totalCollected.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-emerald-600 mt-0.5">Cash & verified bank transfers</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Pending Bank Transfers */}
        <Card className="rounded-xl border border-stone-200/70 shadow-sm bg-white hover:border-amber-200 transition-all duration-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Pending Bank Transfers</p>
              <h3 className="text-xl font-bold text-amber-700 mt-1">₹{stats.totalPending.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-amber-600 mt-0.5">{stats.pendingTransfersCount} awaiting passbook check</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Total Net Outstanding */}
        <Card className="rounded-xl border border-stone-200/70 shadow-sm bg-white hover:border-rose-200 transition-all duration-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">Outstanding Balance</p>
              <h3 className="text-xl font-bold text-rose-700 mt-1">₹{stats.totalOutstanding.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-stone-500 mt-0.5">Excludes unverified transfers</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
              <AlertCircle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-stone-200">
        <nav className="flex space-x-6 overflow-x-auto pb-px" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('students')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-200 ${
              activeTab === 'students'
                ? 'border-[#4B2E2E] text-[#4B2E2E]'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Student Ledgers &amp; Search
          </button>

          <button
            onClick={() => setActiveTab('verification')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-200 ${
              activeTab === 'verification'
                ? 'border-[#4B2E2E] text-[#4B2E2E]'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
            }`}
          >
            <Clock className="w-4 h-4" />
            Bank Transfer Queue
            {stats.pendingTransfersCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                {stats.pendingTransfersCount}
              </span>
            )}
          </button>

          {canConfigureFees && (
            <button
              onClick={() => setActiveTab('structures')}
              className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-200 ${
                activeTab === 'structures'
                  ? 'border-[#4B2E2E] text-[#4B2E2E]'
                  : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
              }`}
            >
              <Sliders className="w-4 h-4" />
              Fee Structures
            </button>
          )}

          <button
            onClick={() => setActiveTab('reports')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 whitespace-nowrap transition-colors duration-200 ${
              activeTab === 'reports'
                ? 'border-[#4B2E2E] text-[#4B2E2E]'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
            }`}
          >
            <FileText className="w-4 h-4" />
            Financial Reports
          </button>
        </nav>
      </div>

      {/* TAB 1: Student Fee Search & Ledger List */}
      {activeTab === 'students' && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder="Search existing student by name, active ID, temp roll (KAMCH-...), or RGUHS no..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by seat category"
                className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] bg-white text-stone-700"
              >
                <option value="">All Seat Categories</option>
                <option value="GOVERNMENT">Government Quota</option>
                <option value="MANAGEMENT_PRIVATE">Management / Private</option>
                <option value="NRI">NRI Quota</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchStudents}
                disabled={isLoadingStudents}
                className="flex items-center gap-1.5"
              >
                <Filter className="w-3.5 h-3.5" />
                Filter
              </Button>
            </div>
          </div>

          {/* Students Table */}
          <Card className="rounded-xl border border-stone-200/80 shadow-xs overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200/80 text-xs font-semibold text-stone-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Student ID / Name</th>
                    <th className="py-3 px-4">Quota / Category</th>
                    <th className="py-3 px-4">Services</th>
                    <th className="py-3 px-4 text-right">Assessed (College + Dev)</th>
                    <th className="py-3 px-4 text-right">Verified Paid</th>
                    <th className="py-3 px-4 text-right">Pending Bank</th>
                    <th className="py-3 px-4 text-right">Outstanding</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
                  {isLoadingStudents ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-stone-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#4B2E2E]" />
                        Loading student accounts...
                      </td>
                    </tr>
                  ) : students.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center">
                        <div className="max-w-md mx-auto text-center space-y-3">
                          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto text-stone-400">
                            <CreditCard className="w-6 h-6" />
                          </div>
                          <h4 className="text-base font-semibold text-stone-800">
                            {searchQuery || categoryFilter
                              ? 'Student Not Found in Shared Registry'
                              : 'No Student Records Registered Yet'}
                          </h4>
                          <p className="text-sm text-stone-500">
                            {searchQuery || categoryFilter
                              ? 'No existing student matched your search or quota filter. If this student is a new admission, register them in Student Management first and you will return directly here.'
                              : 'Student Management is the single source of truth for student registration. Register a student in Student Management to initialize their fee account.'}
                          </p>
                          {canRecordPayments && onRegisterInStudentManagement && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={onRegisterInStudentManagement}
                              className="mt-2 bg-[#4B2E2E] text-white hover:bg-[#3d2525] rounded-lg"
                            >
                              <UserPlus className="w-4 h-4 mr-1.5" />
                              Register in Student Management
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    students.map((st) => (
                      <tr key={st.id} className="hover:bg-stone-50/70 transition-colors duration-150">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-stone-900">{st.fullName}</div>
                          <div className="text-xs font-mono text-stone-500 flex flex-wrap items-center gap-1.5">
                            <span>{st.studentIdNumber}</span>
                            {st.temporaryRollNumber && st.temporaryRollNumber !== st.studentIdNumber && (
                              <span className="text-[10px] text-stone-400">
                                (Temp: {st.temporaryRollNumber})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium ${
                            st.admissionCategory === 'GOVERNMENT'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : st.admissionCategory === 'MANAGEMENT_PRIVATE'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}>
                            {st.admissionCategory === 'GOVERNMENT'
                              ? 'Government'
                              : st.admissionCategory === 'MANAGEMENT_PRIVATE'
                              ? 'Private'
                              : 'NRI'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {st.messEnrolled ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Utensils className="w-3 h-3" /> Mess
                              </span>
                            ) : null}
                            {st.hostelEnrolled ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                                <Home className="w-3 h-3" /> Hostel
                              </span>
                            ) : null}
                            {!st.messEnrolled && !st.hostelEnrolled && (
                              <span className="text-xs text-stone-400">None</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {st.currentAssessment ? (
                            <div className="space-y-0.5">
                              <div className="font-bold text-stone-900">
                                ₹{st.currentAssessment.revisedPayable.toLocaleString('en-IN')}
                              </div>
                              <div className="text-[11px] text-stone-500 font-normal leading-tight">
                                <div>College: ₹{st.currentAssessment.assessedCollegeFee.toLocaleString('en-IN')}</div>
                                <div>Development: ₹{st.currentAssessment.assessedDevelopmentFee.toLocaleString('en-IN')}</div>
                              </div>
                              {st.currentAssessment.concessionTotal > 0 && (
                                <div className="text-[11px] text-emerald-600 font-normal">
                                  -₹{st.currentAssessment.concessionTotal.toLocaleString('en-IN')} conc.
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-amber-700">Not Initialized</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-emerald-700">
                          ₹{st.totalPaid.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {st.totalPending > 0 ? (
                            <span className="text-amber-700 font-medium">₹{st.totalPending.toLocaleString('en-IN')}</span>
                          ) : (
                            <span className="text-stone-400">₹0</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold">
                          {!st.currentAssessment ? (
                            <span className="text-xs font-medium text-stone-400">Assessment Pending</span>
                          ) : st.outstandingBalance === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> Cleared
                            </span>
                          ) : (
                            <span className="text-rose-700 font-semibold">
                              ₹{st.outstandingBalance.toLocaleString('en-IN')}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenLedger(st.id)}
                              className="text-xs px-2.5 py-1 rounded-lg"
                              title="View complete fee ledger"
                            >
                              <FileText className="w-3.5 h-3.5 mr-1" />
                              Ledger
                            </Button>

                            {canRecordPayments && !st.currentAssessment && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={initializingStudentId === st.id}
                                onClick={() => handleInitializeAssessment(st.id)}
                                className="text-xs px-2.5 py-1 rounded-lg"
                                title="Initialize 2026-2027 fee assessment from active quota structure"
                              >
                                {initializingStudentId === st.id ? 'Initializing...' : 'Init Assessment'}
                              </Button>
                            )}

                            {canRecordPayments && st.currentAssessment && st.outstandingBalance > 0 && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() =>
                                  setPaymentModal({
                                    student: st,
                                    amount: String(st.outstandingBalance),
                                    destination: 'COLLEGE_ACCOUNT',
                                    paymentMethod: 'CASH',
                                    studentTxRef: '',
                                    bankName: '',
                                    paymentDate: new Date().toISOString().split('T')[0],
                                    notes: '',
                                  })
                                }
                                className="text-xs px-2.5 py-1 rounded-lg bg-[#4B2E2E] text-white hover:bg-[#3d2525]"
                                title="Record payment collection"
                              >
                                <DollarSign className="w-3.5 h-3.5 mr-0.5" />
                                Pay
                              </Button>
                            )}
                          </div>
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

      {/* TAB 3: Bank Transfer Verification Queue */}
      {activeTab === 'verification' && (
        <Card className="rounded-xl border border-stone-200/80 shadow-xs bg-white">
          <CardHeader className="border-b border-stone-200/60 pb-4">
            <CardTitle className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              College Account Bank Transfer Verification Queue
            </CardTitle>
            <CardDescription className="text-sm text-stone-500">
              Payments deposited via NEFT/RTGS/IMPS/UPI remain provisional until verified against the college bank passbook next morning.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {students.flatMap((s) => s.currentAssessment ? [s] : []).filter((s) => s.totalPending > 0).length === 0 ? (
              <div className="py-12 text-center text-stone-500">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <h4 className="text-base font-semibold text-stone-800">Verification Queue Clear</h4>
                <p className="text-sm text-stone-500">No bank transfers are currently pending passbook verification.</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {students
                  .filter((s) => s.totalPending > 0)
                  .map((st) => (
                    <div key={st.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-stone-50/60 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-stone-900">{st.fullName}</span>
                          <span className="text-xs font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-600">{st.studentIdNumber}</span>
                          <Badge variant="warning" size="sm">Pending Verification</Badge>
                        </div>
                        <p className="text-xs text-stone-500">
                          Pending Bank Transfer Amount: <strong className="text-amber-700">₹{st.totalPending.toLocaleString('en-IN')}</strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenLedger(st.id)}
                          className="rounded-lg text-xs"
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          View Transfer Records
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 4: Fee Structure Configuration */}
      {activeTab === 'structures' && canConfigureFees && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-stone-900">Approved Fee Structures</h3>
              <p className="text-xs text-stone-500">Configurable rates stored in database by admission batch and seat category.</p>
            </div>
            {canConfigureFees && (
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  setStructureEditModal({
                    academicYear: '2026-2027',
                    admissionCategory: 'GOVERNMENT',
                    yearOfStudy: 1,
                    collegeFee: '75750',
                    developmentFee: '50000',
                    messFee: '30000',
                    hostelFee: '30000',
                    description: '',
                    isActive: true,
                    scope: 'FUTURE_ONLY',
                    reason: '',
                    targetStudentIds: [],
                  })
                }
                className="bg-[#4B2E2E] text-white hover:bg-[#3d2525] rounded-lg text-xs"
              >
                Configure New Structure
              </Button>
            )}
          </div>

          <Card className="rounded-xl border border-stone-200/80 shadow-xs overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200/80 text-xs font-semibold text-stone-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Academic Batch</th>
                    <th className="py-3 px-4">Seat Category</th>
                    <th className="py-3 px-4 text-right">College Fee</th>
                    <th className="py-3 px-4 text-right">Development Fee</th>
                    <th className="py-3 px-4 text-right">Base Total</th>
                    <th className="py-3 px-4 text-right">Mess Fee</th>
                    <th className="py-3 px-4 text-right">Hostel Fee</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {isLoadingStructures ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-stone-500">Loading fee structures...</td>
                    </tr>
                  ) : feeStructures.map((fs) => (
                    <tr key={fs.id} className="hover:bg-stone-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-stone-700">{fs.academic_year}</td>
                      <td className="py-3 px-4 font-medium text-stone-900">
                        {fs.admission_category === 'GOVERNMENT'
                          ? 'Government Quota'
                          : fs.admission_category === 'MANAGEMENT_PRIVATE'
                          ? 'Private Seat'
                          : 'NRI Quota'}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-stone-800">{formatINR(fs.college_fee)}</td>
                      <td className="py-3 px-4 text-right font-medium text-stone-800">{formatINR(fs.development_fee)}</td>
                      <td className="py-3 px-4 text-right font-bold text-[#4B2E2E]">{formatINR(fs.total_annual_fee)}</td>
                      <td className="py-3 px-4 text-right text-stone-600">{formatINR(fs.mess_fee || 30000)}</td>
                      <td className="py-3 px-4 text-right text-stone-600">{formatINR(fs.hostel_fee || 30000)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setStructureEditModal({
                              id: fs.id,
                              academicYear: fs.academic_year,
                              admissionCategory: fs.admission_category,
                              yearOfStudy: fs.year_of_study,
                              collegeFee: String(fs.college_fee),
                              developmentFee: String(fs.development_fee),
                              messFee: String(fs.mess_fee || 30000),
                              hostelFee: String(fs.hostel_fee || 30000),
                              description: fs.description || '',
                              isActive: Boolean(fs.is_active),
                              scope: 'FUTURE_ONLY',
                              reason: '',
                              targetStudentIds: [],
                            })
                          }
                          className="text-xs px-2.5 py-1 rounded-lg"
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 5: Financial Reports */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          {/* Filters Card */}
          <Card className="rounded-xl border border-stone-200/80 shadow-xs p-4 bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">From Date</label>
                <input
                  type="date"
                  value={reportFilters.dateFrom}
                  onChange={(e) => setReportFilters({ ...reportFilters, dateFrom: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">To Date</label>
                <input
                  type="date"
                  value={reportFilters.dateTo}
                  onChange={(e) => setReportFilters({ ...reportFilters, dateTo: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Collection Destination</label>
                <select
                  value={reportFilters.destination}
                  onChange={(e) => setReportFilters({ ...reportFilters, destination: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                >
                  <option value="ALL">All Destinations</option>
                  <option value="COLLEGE_ACCOUNT">College Account</option>
                  <option value="SECRETARY_DEV_ACCOUNT">Secretary Development Account</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Payment Method</label>
                <select
                  value={reportFilters.method}
                  onChange={(e) => setReportFilters({ ...reportFilters, method: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                >
                  <option value="ALL">All Methods</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="ONLINE_DEV">Online Development</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Status</label>
                <select
                  value={reportFilters.status}
                  onChange={(e) => setReportFilters({ ...reportFilters, status: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="VERIFIED">Verified Collected</option>
                  <option value="PENDING_VERIFICATION">Pending Verification</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="REVERSED">Reversed</option>
                </select>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3">
              <span className="text-xs text-stone-500">
                Found {reportData.count} transaction records.
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={fetchReports}
                className="bg-[#4B2E2E] text-white hover:bg-[#3d2525] text-xs px-4 rounded-lg"
              >
                Apply Filters
              </Button>
            </div>
          </Card>

          {/* Report Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-800 uppercase">Filtered Verified Collections</p>
                <h4 className="text-xl font-bold text-emerald-900 mt-0.5">₹{reportData.totalVerified.toLocaleString('en-IN')}</h4>
              </div>
              <CheckCircle2 className="w-8 h-8 text-emerald-600 opacity-80" />
            </div>

            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-800 uppercase">Filtered Pending Transfers</p>
                <h4 className="text-xl font-bold text-amber-900 mt-0.5">₹{reportData.totalPending.toLocaleString('en-IN')}</h4>
              </div>
              <Clock className="w-8 h-8 text-amber-600 opacity-80" />
            </div>
          </div>

          {/* Report Table */}
          <Card className="rounded-xl border border-stone-200/80 shadow-xs overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200/80 font-semibold text-stone-600 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Student</th>
                    <th className="py-2.5 px-3">Destination</th>
                    <th className="py-2.5 px-3">Method / Tx Ref</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Receipt #</th>
                    <th className="py-2.5 px-3">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {reportData.records.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-stone-400">No transactions found for the selected criteria.</td>
                    </tr>
                  ) : (
                    reportData.records.map((r: any) => (
                      <tr key={r.id} className="hover:bg-stone-50/70">
                        <td className="py-2.5 px-3 font-mono text-stone-600">{r.payment_date}</td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">{r.student_name} ({r.student_id_number})</td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            r.destination === 'SECRETARY_DEV_ACCOUNT'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-stone-100 text-stone-700'
                          }`}>
                            {r.destination === 'SECRETARY_DEV_ACCOUNT' ? 'Secretary Dev' : 'College Account'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-stone-800">{r.payment_method}</div>
                          {r.student_tx_ref && (
                            <div className="text-[10px] font-mono text-stone-500">UTR: {r.student_tx_ref}</div>
                          )}
                          {r.passbook_tx_ref && (
                            <div className="text-[10px] font-mono text-emerald-600">PB: {r.passbook_tx_ref}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-stone-900">₹{parseFloat(r.amount).toLocaleString('en-IN')}</td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            r.status === 'VERIFIED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.status === 'PENDING_VERIFICATION'
                              ? 'bg-amber-100 text-amber-800'
                              : r.status === 'REVERSED'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-600">{r.receipt_number || '—'}</td>
                        <td className="py-2.5 px-3 text-stone-500">{r.recorder_name}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 1: Individual Student Fee Ledger */}
      {selectedStudentLedger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-stone-200 p-6 space-y-6">
            <div className="flex items-start justify-between border-b border-stone-200 pb-4 gap-3">
              <div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-600 font-semibold">
                  {selectedStudentLedger.student.studentIdNumber} • Student ID #{selectedStudentLedger.student.id}
                </span>
                <h3 className="text-xl font-bold text-stone-900 mt-1">{selectedStudentLedger.student.fullName}</h3>
                <p className="text-xs text-stone-500">
                  {selectedStudentLedger.student.admissionCategory} Quota • Batch {selectedStudentLedger.student.admissionYear} • Year {selectedStudentLedger.student.currentYearOfStudy}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {onOpenStudentProfile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const targetId = selectedStudentLedger.student.id;
                      setSelectedStudentLedger(null);
                      onOpenStudentProfile(targetId);
                    }}
                    className="text-xs rounded-lg"
                  >
                    Open Student Profile
                  </Button>
                )}
                <button
                  onClick={() => setSelectedStudentLedger(null)}
                  className="text-stone-400 hover:text-stone-700 text-xl font-bold p-1"
                >
                  ✕
                </button>
              </div>
            </div>

            {selectedStudentLedger.assessments.length === 0 && canRecordPayments && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
                <span>
                  This Student Management record does not yet have an initialized 2026-2027 fee assessment.
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={initializingStudentId === selectedStudentLedger.student.id}
                  onClick={() => handleInitializeAssessment(selectedStudentLedger.student.id)}
                  className="bg-[#4B2E2E] text-white hover:bg-[#3d2525] rounded-lg shrink-0"
                >
                  {initializingStudentId === selectedStudentLedger.student.id
                    ? 'Initializing...'
                    : 'Initialize 2026-2027 Fee Assessment'}
                </Button>
              </div>
            )}

            {/* Assessment Breakdown Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                <span className="text-stone-500 block">Assessed College Fee</span>
                <span className="text-base font-bold text-stone-900">
                  ₹{(selectedStudentLedger.assessments[0]?.assessedCollegeFee ?? 0).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                <span className="text-stone-500 block">Development Fee</span>
                <span className="text-base font-bold text-stone-900">
                  ₹{(selectedStudentLedger.assessments[0]?.assessedDevelopmentFee ?? 0).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                <span className="text-stone-500 block">Mess & Hostel Fees</span>
                <span className="text-base font-bold text-stone-900">
                  ₹{((selectedStudentLedger.assessments[0]?.assessedMessFee ?? 0) + (selectedStudentLedger.assessments[0]?.assessedHostelFee ?? 0)).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                <span className="text-stone-500 block">Total Concessions</span>
                <span className="text-base font-bold text-emerald-700">
                  -₹{selectedStudentLedger.summary.concessionTotal.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Balance Summary Header */}
            <div className="p-4 rounded-xl border border-stone-200 bg-[#F5F5DC]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">Revised Payable Amount</span>
                <div className="text-xl font-bold text-stone-900">₹{selectedStudentLedger.summary.revisedPayable.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Verified Collections</span>
                <div className="text-xl font-bold text-emerald-800">₹{selectedStudentLedger.summary.verifiedPaid.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">Net Outstanding Balance</span>
                <div className="text-xl font-bold text-rose-800">₹{selectedStudentLedger.summary.outstandingBalance.toLocaleString('en-IN')}</div>
              </div>
            </div>

            {/* Service Enrollment Card (Mess & Hostel History) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Utensils className="w-4 h-4 text-[#D4AF37]" />
                  Independent Mess & Hostel Enrollment Lifecycle
                </h4>
                {canRecordPayments && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setServiceModal({
                          studentId: selectedStudentLedger.student.id,
                          studentName: selectedStudentLedger.student.fullName,
                          serviceType: 'MESS',
                          action: selectedStudentLedger.student.messEnrolled ? 'LEAVE' : 'JOIN',
                          effectiveDate: new Date().toISOString().split('T')[0],
                          annualFee: '30000',
                          notes: '',
                        })
                      }
                      className="text-xs px-2.5 py-1 rounded-lg"
                    >
                      {selectedStudentLedger.student.messEnrolled ? 'Leave Mess' : 'Join Mess'}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setServiceModal({
                          studentId: selectedStudentLedger.student.id,
                          studentName: selectedStudentLedger.student.fullName,
                          serviceType: 'HOSTEL',
                          action: selectedStudentLedger.student.hostelEnrolled ? 'LEAVE' : 'JOIN',
                          effectiveDate: new Date().toISOString().split('T')[0],
                          annualFee: '30000',
                          notes: '',
                        })
                      }
                      className="text-xs px-2.5 py-1 rounded-lg"
                    >
                      {selectedStudentLedger.student.hostelEnrolled ? 'Leave Hostel' : 'Join Hostel'}
                    </Button>
                  </div>
                )}
              </div>

              <div className="border border-stone-200 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-stone-50 border-b border-stone-200">
                    <tr className="font-semibold text-stone-600">
                      <th className="py-2 px-3">Service</th>
                      <th className="py-2 px-3">Start Date</th>
                      <th className="py-2 px-3">End Date</th>
                      <th className="py-2 px-3 text-right">Fee Rate</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {selectedStudentLedger.serviceEnrollments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-3 text-center text-stone-400">No mess or hostel enrollment history.</td>
                      </tr>
                    ) : (
                      selectedStudentLedger.serviceEnrollments.map((se) => (
                        <tr key={se.id}>
                          <td className="py-2 px-3 font-semibold text-stone-800">{se.serviceType}</td>
                          <td className="py-2 px-3 text-stone-600">{se.startDate}</td>
                          <td className="py-2 px-3 text-stone-600">{se.endDate || 'Active'}</td>
                          <td className="py-2 px-3 text-right font-medium">₹{se.annualFee.toLocaleString('en-IN')}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              se.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'
                            }`}>
                              {se.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-stone-500">{se.creatorName}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Concessions Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <BadgePercent className="w-4 h-4 text-[#D4AF37]" />
                  Authorized Concessions (Super Admin & Principal)
                </h4>
                {canGrantConcessions && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setConcessionModal({
                        studentId: selectedStudentLedger.student.id,
                        assessmentId: selectedStudentLedger.assessments[0]?.id || 1,
                        studentName: selectedStudentLedger.student.fullName,
                        totalAssessed: selectedStudentLedger.summary.totalAssessed,
                        existingConcessions: selectedStudentLedger.summary.concessionTotal,
                        revisedPayable: selectedStudentLedger.summary.revisedPayable,
                        concessionType: 'FIXED',
                        value: '',
                        feeComponent: 'ALL',
                        reason: '',
                      })
                    }
                    className="text-xs px-2.5 py-1 rounded-lg"
                  >
                    Grant Concession
                  </Button>
                )}
              </div>

              <div className="border border-stone-200 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-stone-50 border-b border-stone-200">
                    <tr className="font-semibold text-stone-600">
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Value</th>
                      <th className="py-2 px-3 text-right">Reduction</th>
                      <th className="py-2 px-3">Mandatory Reason</th>
                      <th className="py-2 px-3">Authorized Officer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {selectedStudentLedger.concessions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-3 text-center text-stone-400">No concessions applied.</td>
                      </tr>
                    ) : (
                      selectedStudentLedger.concessions.map((c) => (
                        <tr key={c.id}>
                          <td className="py-2 px-3 font-semibold text-stone-800">{c.concessionType}</td>
                          <td className="py-2 px-3 text-right">{c.concessionType === 'PERCENTAGE' ? `${c.value}%` : `₹${c.value}`}</td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-700">₹{c.calculatedReduction.toLocaleString('en-IN')}</td>
                          <td className="py-2 px-3 text-stone-700">{c.reason}</td>
                          <td className="py-2 px-3 text-stone-500">{c.authorizerName}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment & Receipt Ledger History */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-[#4B2E2E]" />
                Transaction & Receipt Ledger
              </h4>

              <div className="border border-stone-200 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-stone-50 border-b border-stone-200">
                    <tr className="font-semibold text-stone-600">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Destination</th>
                      <th className="py-2.5 px-3">Method & Tx Ref</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Receipt Info</th>
                      <th className="py-2.5 px-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {selectedStudentLedger.payments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-stone-400">No payment transactions recorded yet.</td>
                      </tr>
                    ) : (
                      selectedStudentLedger.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 px-3 font-mono text-stone-600">{p.paymentDate}</td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              p.destination === 'SECRETARY_DEV_ACCOUNT' ? 'bg-purple-50 text-purple-700' : 'bg-stone-100 text-stone-700'
                            }`}>
                              {p.destination === 'SECRETARY_DEV_ACCOUNT' ? 'Secretary Dev' : 'College Account'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-stone-800">{p.paymentMethod}</span>
                            {p.studentTxRef && (
                              <div className="text-[10px] font-mono text-stone-500">UTR: {p.studentTxRef}</div>
                            )}
                            {p.passbookTxRef && (
                              <div className="text-[10px] font-mono text-emerald-600">Passbook: {p.passbookTxRef}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-stone-900">₹{p.amount.toLocaleString('en-IN')}</td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              p.status === 'VERIFIED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : p.status === 'PENDING_VERIFICATION'
                                ? 'bg-amber-100 text-amber-800'
                                : p.status === 'REVERSED'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {p.receipt ? (
                              <div>
                                <span className="font-mono text-stone-700">{p.receipt.receiptNumber}</span>
                                <div className="text-[10px] text-stone-500">{p.receipt.receiptType}</div>
                              </div>
                            ) : (
                              <span className="text-stone-400">None</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {p.receipt && (
                                <button
                                  onClick={() => handleViewReceipt(p.receipt!.id)}
                                  className="text-stone-600 hover:text-stone-900 p-1"
                                  title="Print Official Receipt"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {p.status === 'PENDING_VERIFICATION' && canVerifyBankTransfers && (
                                <button
                                  onClick={() =>
                                    setVerificationModal({
                                      paymentId: p.id,
                                      paymentRef: p.paymentReference,
                                      studentName: selectedStudentLedger.student.fullName,
                                      studentIdNumber: selectedStudentLedger.student.studentIdNumber,
                                      amount: p.amount,
                                      studentTxRef: p.studentTxRef,
                                      action: 'VERIFY',
                                      passbookTxRef: '',
                                      rejectionReason: '',
                                    })
                                  }
                                  className="text-amber-700 hover:text-amber-900 font-semibold text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200"
                                >
                                  Verify
                                </button>
                              )}

                              {p.status === 'VERIFIED' && canReversePayments && (
                                <button
                                  onClick={() =>
                                    setReversalModal({
                                      paymentId: p.id,
                                      paymentRef: p.paymentReference,
                                      studentName: selectedStudentLedger.student.fullName,
                                      amount: p.amount,
                                      reason: '',
                                    })
                                  }
                                  className="text-rose-600 hover:text-rose-800 p-1"
                                  title="Reverse Payment (Super Admin / Principal)"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-stone-200">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedStudentLedger(null)}
                className="rounded-lg"
              >
                Close Ledger
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Record Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-900">Record Fee Collection</h3>
                <p className="text-xs text-stone-500">
                  {paymentModal.student.fullName} ({paymentModal.student.studentIdNumber})
                </p>
              </div>
              <button
                onClick={() => setPaymentModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold"
              >
                ✕
              </button>
            </div>

            {paymentError && (
              <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                {paymentError}
              </div>
            )}

            <form onSubmit={handleRecordPayment} className="space-y-4">
              {/* Collection Destination */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Collection Destination <span className="text-rose-500">*</span>
                </label>
                <select
                  value={paymentModal.destination}
                  onChange={(e) => {
                    const dest = e.target.value as 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT';
                    setPaymentModal({
                      ...paymentModal,
                      destination: dest,
                      paymentMethod: dest === 'SECRETARY_DEV_ACCOUNT' ? 'CASH' : 'CASH',
                    });
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] bg-white"
                >
                  <option value="COLLEGE_ACCOUNT">College Account (Tuition, Mess, Hostel)</option>
                  <option value="SECRETARY_DEV_ACCOUNT">Secretary / Development Fee Account</option>
                </select>
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Payment Method <span className="text-rose-500">*</span>
                </label>
                <select
                  value={paymentModal.paymentMethod}
                  onChange={(e) => setPaymentModal({ ...paymentModal, paymentMethod: e.target.value as any })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] bg-white"
                >
                  {paymentModal.destination === 'COLLEGE_ACCOUNT' ? (
                    <>
                      <option value="CASH">Cash (Generates Final College Receipt immediately)</option>
                      <option value="BANK_TRANSFER">Bank Transfer (Provisional Acknowledgement; verified next morning)</option>
                    </>
                  ) : (
                    <>
                      <option value="CASH">Cash (Separate Secretary Development Fee Receipt)</option>
                      <option value="ONLINE_DEV">Online Development Payment (UTR reference)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Amount to Collect (₹) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentModal.amount}
                  onChange={(e) => setPaymentModal({ ...paymentModal, amount: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-bold text-stone-900 rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                />
                <p className="text-xs text-stone-500 mt-1">
                  Outstanding Balance: ₹{paymentModal.student.outstandingBalance.toLocaleString('en-IN')}
                </p>
              </div>

              {/* Transaction Ref (Mandatory for Bank Transfer) */}
              {(paymentModal.paymentMethod === 'BANK_TRANSFER' || paymentModal.paymentMethod === 'ONLINE_DEV') && (
                <div className="space-y-3 p-3 bg-amber-50/60 rounded-xl border border-amber-200">
                  <div>
                    <label className="block text-xs font-semibold text-amber-900 uppercase tracking-wider mb-1">
                      Student Transaction Ref / UTR Number <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. UTR1234567890"
                      value={paymentModal.studentTxRef}
                      onChange={(e) => setPaymentModal({ ...paymentModal, studentTxRef: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-amber-900 uppercase tracking-wider mb-1">
                      Bank Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. State Bank of India"
                      value={paymentModal.bankName}
                      onChange={(e) => setPaymentModal({ ...paymentModal, bankName: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                    />
                  </div>

                  <p className="text-[11px] text-amber-800">
                    <strong>Notice:</strong> Bank transfer will be recorded with status <em>Pending Verification</em>. A <em>Provisional Payment Acknowledgement</em> will be generated. The amount will not clear the outstanding balance until passbook verification next morning.
                  </p>
                </div>
              )}

              {/* Payment Date & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    required
                    value={paymentModal.paymentDate}
                    onChange={(e) => setPaymentModal({ ...paymentModal, paymentDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Supporting Notes
                  </label>
                  <input
                    type="text"
                    placeholder="Optional notes"
                    value={paymentModal.notes}
                    onChange={(e) => setPaymentModal({ ...paymentModal, notes: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPaymentModal(null)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={paymentLoading}
                  className="rounded-lg bg-[#4B2E2E] text-white hover:bg-[#3d2525] text-xs px-5"
                >
                  {paymentLoading ? 'Recording Payment...' : 'Confirm Collection'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Bank Transfer Verification Modal */}
      {verificationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-900">
                  {verificationModal.action === 'VERIFY' ? 'Verify Bank Transfer' : 'Reject Bank Transfer'}
                </h3>
                <p className="text-xs text-stone-500">
                  {verificationModal.studentName} ({verificationModal.studentIdNumber}) • ₹{verificationModal.amount.toLocaleString('en-IN')}
                </p>
              </div>
              <button
                onClick={() => setVerificationModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold"
              >
                ✕
              </button>
            </div>

            {verificationError && (
              <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                {verificationError}
              </div>
            )}

            <form onSubmit={handleVerificationSubmit} className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1">
                <div>
                  <span className="text-stone-500">Payment Ref: </span>
                  <span className="font-mono font-semibold text-stone-800">{verificationModal.paymentRef}</span>
                </div>
                <div>
                  <span className="text-stone-500">Student UTR: </span>
                  <span className="font-mono font-semibold text-stone-800">{verificationModal.studentTxRef || 'N/A'}</span>
                </div>
              </div>

              {verificationModal.action === 'VERIFY' ? (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Passbook Transaction Reference <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter reference from college bank passbook"
                    value={verificationModal.passbookTxRef}
                    onChange={(e) => setVerificationModal({ ...verificationModal, passbookTxRef: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                  />
                  <p className="text-xs text-stone-400 mt-1">
                    Confirms receipt of funds. Promotes Provisional Acknowledgement to Final College Receipt.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Mandatory Rejection Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="State reason (e.g. Transaction not found in passbook, mismatching amount, returned by bank)"
                    value={verificationModal.rejectionReason}
                    onChange={(e) => setVerificationModal({ ...verificationModal, rejectionReason: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVerificationModal(null)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={verificationLoading}
                  className={`rounded-lg text-xs px-5 text-white ${
                    verificationModal.action === 'VERIFY' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-rose-700 hover:bg-rose-800'
                  }`}
                >
                  {verificationLoading ? 'Processing...' : verificationModal.action === 'VERIFY' ? 'Confirm Verification' : 'Reject Transfer'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Concession Modal (Super Admin & Principal) */}
      {concessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-900">Grant Fee Concession</h3>
                <p className="text-xs text-stone-500">{concessionModal.studentName}</p>
              </div>
              <button
                onClick={() => setConcessionModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold"
              >
                ✕
              </button>
            </div>

            {concessionError && (
              <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                {concessionError}
              </div>
            )}

            <form onSubmit={handleConcessionSubmit} className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs flex justify-between">
                <div>
                  <span className="text-stone-500">Total Assessed: </span>
                  <span className="font-bold">₹{concessionModal.totalAssessed.toLocaleString('en-IN')}</span>
                </div>
                <div>
                  <span className="text-stone-500">Existing Concessions: </span>
                  <span className="font-bold text-emerald-700">₹{concessionModal.existingConcessions.toLocaleString('en-IN')}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Concession Type
                  </label>
                  <select
                    value={concessionModal.concessionType}
                    onChange={(e) => setConcessionModal({ ...concessionModal, concessionType: e.target.value as any })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 bg-white"
                  >
                    <option value="FIXED">Fixed Amount (₹)</option>
                    <option value="PERCENTAGE">Percentage (%)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Value <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder={concessionModal.concessionType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 25000'}
                    value={concessionModal.value}
                    onChange={(e) => setConcessionModal({ ...concessionModal, value: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Mandatory Institutional Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="e.g. Approved merit scholarship / management concession by Chairman"
                  value={concessionModal.reason}
                  onChange={(e) => setConcessionModal({ ...concessionModal, reason: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConcessionModal(null)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={concessionLoading}
                  className="rounded-lg bg-[#4B2E2E] text-white hover:bg-[#3d2525] text-xs px-5"
                >
                  {concessionLoading ? 'Applying...' : 'Authorize Concession'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Service Join/Leave Modal (Mess / Hostel) */}
      {serviceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-900">
                  {serviceModal.action === 'JOIN' ? `Enroll in ${serviceModal.serviceType}` : `Leave ${serviceModal.serviceType}`}
                </h3>
                <p className="text-xs text-stone-500">{serviceModal.studentName}</p>
              </div>
              <button
                onClick={() => setServiceModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold"
              >
                ✕
              </button>
            </div>

            {serviceError && (
              <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                {serviceError}
              </div>
            )}

            <form onSubmit={handleServiceSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Effective Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={serviceModal.effectiveDate}
                  onChange={(e) => setServiceModal({ ...serviceModal, effectiveDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                />
              </div>

              {serviceModal.action === 'JOIN' && (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Annual Fee Rate (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={serviceModal.annualFee}
                    onChange={(e) => setServiceModal({ ...serviceModal, annualFee: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Notes / Reason
                </label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={serviceModal.notes}
                  onChange={(e) => setServiceModal({ ...serviceModal, notes: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setServiceModal(null)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={serviceLoading}
                  className="rounded-lg bg-[#4B2E2E] text-white hover:bg-[#3d2525] text-xs px-5"
                >
                  {serviceLoading ? 'Saving...' : 'Confirm'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: Payment Reversal Modal (Super Admin & Principal) */}
      {reversalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-rose-700">Financial Correction / Reversal</h3>
                <p className="text-xs text-stone-500">
                  {reversalModal.studentName} • ₹{reversalModal.amount.toLocaleString('en-IN')}
                </p>
              </div>
              <button
                onClick={() => setReversalModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold"
              >
                ✕
              </button>
            </div>

            {reversalError && (
              <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                {reversalError}
              </div>
            )}

            <form onSubmit={handleReversalSubmit} className="space-y-4">
              <div className="p-3 bg-rose-50 text-rose-800 rounded-xl text-xs space-y-1">
                <p className="font-semibold">Audit Notice:</p>
                <p>This transaction will not be deleted. It will be marked as REVERSED and outstanding balance will be recalculated.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Mandatory Reversal Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="State the exact reason for reversal (e.g. Accidental duplicate cash entry by clerk)"
                  value={reversalModal.reason}
                  onChange={(e) => setReversalModal({ ...reversalModal, reason: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReversalModal(null)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={reversalLoading}
                  className="rounded-lg bg-rose-700 text-white hover:bg-rose-800 text-xs px-5"
                >
                  {reversalLoading ? 'Reversing...' : 'Authorize Reversal'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: Fee Structure Edit Modal (Super Admin, Principal, Secretary) */}
      {structureEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 space-y-4 my-8">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-900">
                  {structureEditModal.id ? 'Edit Fee Structure' : 'Configure New Fee Structure'}
                </h3>
                <p className="text-xs text-stone-500">
                  Configure institutional fee rates for admission quotas and academic batches.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStructureEditModal(null)}
                className="text-stone-400 hover:text-stone-700 font-bold p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {structureError && (
              <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                {structureError}
              </div>
            )}

            <form onSubmit={handleStructureSubmit} className="space-y-4">
              {/* Batch, Category, and Year of Study Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Academic Batch <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={structureEditModal.academicYear}
                    onChange={(e) => setStructureEditModal({ ...structureEditModal, academicYear: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                  >
                    <option value="2026-2027">2026-2027</option>
                    <option value="2027-2028">2027-2028</option>
                    <option value="2025-2026">2025-2026</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Seat Quota Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={structureEditModal.admissionCategory}
                    onChange={(e) =>
                      setStructureEditModal({
                        ...structureEditModal,
                        admissionCategory: e.target.value as 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI',
                        targetStudentIds: [],
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                  >
                    <option value="GOVERNMENT">Government Quota</option>
                    <option value="MANAGEMENT_PRIVATE">Management / Private</option>
                    <option value="NRI">NRI Quota</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Year of Study
                  </label>
                  <select
                    value={structureEditModal.yearOfStudy}
                    onChange={(e) => setStructureEditModal({ ...structureEditModal, yearOfStudy: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                  >
                    <option value={1}>1st Year (BAMS)</option>
                    <option value={2}>2nd Year</option>
                    <option value={3}>3rd Year</option>
                    <option value={4}>4th Year</option>
                  </select>
                </div>
              </div>

              {/* Fee Rates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    College Fee (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={structureEditModal.collegeFee}
                    onChange={(e) => setStructureEditModal({ ...structureEditModal, collegeFee: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Development Fee (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={structureEditModal.developmentFee}
                    onChange={(e) => setStructureEditModal({ ...structureEditModal, developmentFee: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Mess Fee (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={structureEditModal.messFee}
                    onChange={(e) => setStructureEditModal({ ...structureEditModal, messFee: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Hostel Fee (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={structureEditModal.hostelFee}
                    onChange={(e) => setStructureEditModal({ ...structureEditModal, hostelFee: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-300"
                  />
                </div>
              </div>

              {/* Live Base Total Banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/60 border border-amber-200 text-xs">
                <span className="font-semibold text-amber-900">Calculated Annual Base Fee (College + Development):</span>
                <span className="text-sm font-bold text-[#4B2E2E]">
                  {formatINR(parseFloat(structureEditModal.collegeFee || '0') + parseFloat(structureEditModal.developmentFee || '0'))}
                </span>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Structure Description / Circular Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. Approved fee structure per AYUSH Govt Notification 2026-27"
                  value={structureEditModal.description}
                  onChange={(e) => setStructureEditModal({ ...structureEditModal, description: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300"
                />
              </div>

              {/* Change Application Scope (Bug 4) */}
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
                  Scope of Changes
                </label>

                <div className="space-y-2 text-xs">
                  {/* Option 1: FUTURE_ONLY */}
                  <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-stone-100 transition-colors">
                    <input
                      type="radio"
                      name="scope"
                      value="FUTURE_ONLY"
                      checked={structureEditModal.scope === 'FUTURE_ONLY'}
                      onChange={() => setStructureEditModal({ ...structureEditModal, scope: 'FUTURE_ONLY' })}
                      className="mt-0.5 text-[#4B2E2E]"
                    />
                    <div>
                      <span className="font-semibold text-stone-900">Future Admissions Only</span>
                      <p className="text-stone-500 text-[11px]">Historical protection: leaves all existing student fee assessments untouched.</p>
                    </div>
                  </label>

                  {/* Option 2: SELECTED_BATCH */}
                  <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-stone-100 transition-colors">
                    <input
                      type="radio"
                      name="scope"
                      value="SELECTED_BATCH"
                      checked={structureEditModal.scope === 'SELECTED_BATCH'}
                      onChange={() => setStructureEditModal({ ...structureEditModal, scope: 'SELECTED_BATCH' })}
                      className="mt-0.5 text-[#4B2E2E]"
                    />
                    <div>
                      <span className="font-semibold text-stone-900">Apply to All Students in Selected Batch</span>
                      <p className="text-stone-500 text-[11px]">
                        Re-assesses all active students enrolled under {structureEditModal.admissionCategory} for batch {structureEditModal.academicYear}.
                      </p>
                    </div>
                  </label>

                  {/* Option 3: SELECTED_STUDENTS */}
                  <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-stone-100 transition-colors">
                    <input
                      type="radio"
                      name="scope"
                      value="SELECTED_STUDENTS"
                      checked={structureEditModal.scope === 'SELECTED_STUDENTS'}
                      onChange={() =>
                        setStructureEditModal({
                          ...structureEditModal,
                          scope: 'SELECTED_STUDENTS',
                          targetStudentIds:
                            structureEditModal.targetStudentIds.length === 0
                              ? matchingStudentsForStructure.map((s) => s.id)
                              : structureEditModal.targetStudentIds,
                        })
                      }
                      className="mt-0.5 text-[#4B2E2E]"
                    />
                    <div>
                      <span className="font-semibold text-stone-900">Selective Update (Choose Specific Students)</span>
                      <p className="text-stone-500 text-[11px]">Pick individual students from this batch and preview their revised payable amounts.</p>
                    </div>
                  </label>
                </div>

                {/* Batch Count Preview */}
                {structureEditModal.scope === 'SELECTED_BATCH' && (
                  <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 space-y-1">
                    {matchingStudentsForStructure.length > 0 ? (
                      <p className="font-medium">
                        Will re-assess <strong>{matchingStudentsForStructure.length}</strong> enrolled student(s) in this batch and quota.
                      </p>
                    ) : (
                      <p className="text-blue-800">
                        Notice: No students currently enrolled in {structureEditModal.admissionCategory} quota for batch {structureEditModal.academicYear}.
                      </p>
                    )}
                  </div>
                )}

                {/* Selective Student Checklist & Preview */}
                {structureEditModal.scope === 'SELECTED_STUDENTS' && (
                  <div className="space-y-2 pt-2 border-t border-stone-200">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-stone-800">
                        Select Students to Re-Assess ({structureEditModal.targetStudentIds.length} of {matchingStudentsForStructure.length} selected)
                      </span>
                      {matchingStudentsForStructure.length > 0 && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setStructureEditModal({
                                ...structureEditModal,
                                targetStudentIds: matchingStudentsForStructure.map((s) => s.id),
                              })
                            }
                            className="text-stone-600 hover:text-stone-900 underline text-[11px]"
                          >
                            Select All
                          </button>
                          <span className="text-stone-300">•</span>
                          <button
                            type="button"
                            onClick={() =>
                              setStructureEditModal({
                                ...structureEditModal,
                                targetStudentIds: [],
                              })
                            }
                            className="text-stone-600 hover:text-stone-900 underline text-[11px]"
                          >
                            Deselect All
                          </button>
                        </div>
                      )}
                    </div>

                    {matchingStudentsForStructure.length === 0 ? (
                      <div className="p-3 bg-stone-100 rounded-lg text-center text-xs text-stone-500">
                        No students currently enrolled in {structureEditModal.admissionCategory} quota for batch {structureEditModal.academicYear}.
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white">
                        {matchingStudentsForStructure.map((st) => {
                          const isChecked = structureEditModal.targetStudentIds.includes(st.id);
                          const currentTotal = st.currentAssessment?.totalAssessedFee || 0;
                          const revisedTotal = calculateRevisedStudentFee(st);
                          const diff = revisedTotal - currentTotal;

                          return (
                            <label
                              key={st.id}
                              className={`flex items-center justify-between p-2 text-xs cursor-pointer hover:bg-stone-50 transition-colors ${
                                isChecked ? 'bg-amber-50/40' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const nextIds = e.target.checked
                                      ? [...structureEditModal.targetStudentIds, st.id]
                                      : structureEditModal.targetStudentIds.filter((id) => id !== st.id);
                                    setStructureEditModal({ ...structureEditModal, targetStudentIds: nextIds });
                                  }}
                                  className="rounded border-stone-300 text-[#4B2E2E]"
                                />
                                <div>
                                  <span className="font-semibold text-stone-900">{st.fullName}</span>
                                  <span className="text-[10px] text-stone-500 font-mono ml-1.5">({st.studentIdNumber})</span>
                                </div>
                              </div>

                              <div className="text-right text-[11px] space-x-2">
                                <span className="text-stone-500">Current: {formatINR(currentTotal)}</span>
                                <span className="text-stone-400">→</span>
                                <span className="font-semibold text-stone-900">New: {formatINR(revisedTotal)}</span>
                                <span
                                  className={`font-semibold ml-1 ${
                                    diff > 0 ? 'text-amber-700' : diff < 0 ? 'text-emerald-700' : 'text-stone-400'
                                  }`}
                                >
                                  ({diff >= 0 ? `+${formatINR(diff)}` : `-${formatINR(Math.abs(diff))}`})
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Mandatory Reason for Batch or Selective revisions */}
                {(structureEditModal.scope === 'SELECTED_BATCH' || structureEditModal.scope === 'SELECTED_STUDENTS') && (
                  <div className="mt-2 pt-2 border-t border-stone-200">
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Mandatory Reason for Assessment Revision <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="State institutional circular, court order, or regulatory notification justification"
                      value={structureEditModal.reason}
                      onChange={(e) => setStructureEditModal({ ...structureEditModal, reason: e.target.value })}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStructureEditModal(null)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={structureLoading}
                  className="rounded-lg bg-[#4B2E2E] text-white hover:bg-[#3d2525] text-xs px-5"
                >
                  {structureLoading ? 'Saving...' : 'Save Structure'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>

      {/* MODAL 8: Printable Official Receipt Modal (Bug 2) */}
      {printableReceipt && (
        <div
          id="receipt-modal-container"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto print:static print:p-0 print:m-0 print:bg-white print:overflow-visible"
        >
          <div
            id="receipt-modal-card"
            className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-300 space-y-5 print:p-0 print:border-none print:shadow-none my-6 print:my-0 print:max-w-none print:w-full"
          >
            {/* Action Bar (Top) — Clearly Visible Print and Close Buttons (hidden when printing) */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 print:hidden">
              <div>
                <span className="text-xs font-bold text-stone-800 uppercase tracking-wider block">
                  Official Institutional Receipt Preview
                </span>
                <span className="text-[11px] text-stone-500">
                  {printableReceipt.receiptType.replace(/_/g, ' ')} • {printableReceipt.receiptNumber}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPrintableReceipt(null)}
                  className="rounded-lg text-xs flex items-center gap-1.5 px-3 py-1.5 border-stone-300 text-stone-700 hover:bg-stone-100"
                >
                  <X className="w-3.5 h-3.5" />
                  Close
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handlePrintReceipt}
                  className="bg-[#4B2E2E] text-white hover:bg-[#3d2525] rounded-lg text-xs flex items-center gap-1.5 px-4 py-1.5 font-semibold shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Receipt
                </Button>
              </div>
            </div>

            {/* Receipt Body — Standard A4 Print Layout */}
            <div
              id="kamch-printable-receipt"
              className="border border-stone-300 rounded-xl p-6 bg-white space-y-4 print:space-y-3.5 print:p-4 print:border print:border-stone-800 print:rounded-none"
            >
              {/* College Header */}
              <div className="text-center space-y-1 border-b border-stone-200 pb-4">
                <div className="flex justify-center mb-1">
                  <CollegeLogo className="w-12 h-12" />
                </div>
                <h2 className="text-lg font-bold text-[#4B2E2E] tracking-tight">
                  KRISHNA AYURVEDIC MEDICAL COLLEGE & HOSPITAL
                </h2>
                <p className="text-xs text-stone-600">
                  Affiliated to RGUHS, Recognized by NCISM & Ministry of AYUSH, Govt of India
                </p>
                <p className="text-xs text-stone-500">
                  Sankeshwar - 591313, Belagavi District, Karnataka
                </p>
              </div>

              {/* Receipt Status Banner */}
              <div className="text-center py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border">
                {printableReceipt.receiptType === 'PROVISIONAL_ACKNOWLEDGEMENT' ? (
                  <div className="bg-amber-100 text-amber-900 border-amber-300 py-1 rounded">
                    PROVISIONAL PAYMENT ACKNOWLEDGEMENT (PENDING PASSBOOK VERIFICATION)
                  </div>
                ) : printableReceipt.receiptType === 'SECRETARY_DEV_RECEIPT' ? (
                  <div className="bg-purple-100 text-purple-900 border-purple-300 py-1 rounded">
                    OFFICIAL SECRETARY DEVELOPMENT FEE RECEIPT
                  </div>
                ) : (
                  <div className="bg-emerald-100 text-emerald-900 border-emerald-300 py-1 rounded">
                    OFFICIAL COLLEGE FEE RECEIPT
                  </div>
                )}
              </div>

              {/* Receipt Metadata */}
              <div className="grid grid-cols-2 text-xs gap-3">
                <div>
                  <span className="text-stone-500">Receipt Number: </span>
                  <strong className="font-mono text-stone-900">{printableReceipt.receiptNumber}</strong>
                </div>
                <div className="text-right">
                  <span className="text-stone-500">Date of Issue: </span>
                  <strong className="text-stone-900">{new Date(printableReceipt.issueDate).toLocaleDateString('en-IN')}</strong>
                </div>
                <div>
                  <span className="text-stone-500">Student Name: </span>
                  <strong className="text-stone-900">{printableReceipt.student.name}</strong>
                </div>
                <div className="text-right">
                  <span className="text-stone-500">College ID: </span>
                  <strong className="font-mono text-stone-900">{printableReceipt.student.idNumber}</strong>
                </div>
                <div>
                  <span className="text-stone-500">Admission Category: </span>
                  <strong className="text-stone-900">{printableReceipt.student.category}</strong>
                </div>
                <div className="text-right">
                  <span className="text-stone-500">Academic Year: </span>
                  <strong className="text-stone-900">{printableReceipt.student.academicYear}</strong>
                </div>
              </div>

              {/* Fee Component Breakdown Table */}
              <table className="w-full text-xs border border-stone-200">
                <thead className="bg-stone-100">
                  <tr className="border-b border-stone-200 text-left">
                    <th className="py-2 px-3">Component Description</th>
                    <th className="py-2 px-3 text-right">Assessed Rate (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  <tr>
                    <td className="py-1.5 px-3">Annual College Tuition & Academic Fees</td>
                    <td className="py-1.5 px-3 text-right">{formatINR(printableReceipt.assessment.collegeFee)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-3">Institutional Development & Infrastructure Fees</td>
                    <td className="py-1.5 px-3 text-right">{formatINR(printableReceipt.assessment.developmentFee)}</td>
                  </tr>
                  {printableReceipt.assessment.messFee > 0 && (
                    <tr>
                      <td className="py-1.5 px-3">Mess Facility Charges (Annual)</td>
                      <td className="py-1.5 px-3 text-right">{formatINR(printableReceipt.assessment.messFee)}</td>
                    </tr>
                  )}
                  {printableReceipt.assessment.hostelFee > 0 && (
                    <tr>
                      <td className="py-1.5 px-3">Hostel Accommodation Charges (Annual)</td>
                      <td className="py-1.5 px-3 text-right">{formatINR(printableReceipt.assessment.hostelFee)}</td>
                    </tr>
                  )}
                  {printableReceipt.assessment.concessions > 0 && (
                    <tr className="text-emerald-700">
                      <td className="py-1.5 px-3">Authorized Concession Reduction</td>
                      <td className="py-1.5 px-3 text-right">-{formatINR(printableReceipt.assessment.concessions)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Paid Amount Highlight */}
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-stone-800">Amount Received:</span>
                  <span className="text-base font-bold text-[#4B2E2E]">{formatINR(printableReceipt.payment.amount)}</span>
                </div>
                <div className="text-xs text-stone-600 italic">
                  Amount in words: <strong>{printableReceipt.payment.amountInWords}</strong>
                </div>
                <div className="text-xs text-stone-600 pt-1">
                  Payment Mode: <strong>{printableReceipt.payment.method}</strong>
                  {printableReceipt.payment.studentTxRef && (
                    <span> • Student Ref: <strong className="font-mono">{printableReceipt.payment.studentTxRef}</strong></span>
                  )}
                  {printableReceipt.payment.passbookTxRef && (
                    <span> • Passbook Ref: <strong className="font-mono text-emerald-700">{printableReceipt.payment.passbookTxRef}</strong></span>
                  )}
                </div>
              </div>

              {/* Outstanding Balance Note */}
              <div className="flex justify-between text-xs text-stone-600 border-t border-stone-200 pt-2">
                <span>Total Verified Paid So Far: {formatINR(printableReceipt.totalPaidSoFar)}</span>
                <span>Remaining Balance: <strong>{formatINR(printableReceipt.remainingBalance)}</strong></span>
              </div>

              {/* Signatures */}
              <div className="pt-6 flex justify-between items-end text-xs text-stone-600">
                <div className="text-center">
                  <div className="border-t border-stone-400 w-36 pt-1">Student / Depositor</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-stone-800">{printableReceipt.approvedBy}</div>
                  <div className="text-[10px] text-stone-500">{printableReceipt.approvedByRole}</div>
                  <div className="border-t border-stone-400 w-44 pt-1 mt-1">Authorized Signatory / Seal</div>
                </div>
              </div>
            </div>

            {/* Action Bar (Bottom) — Clearly Visible Print and Close Buttons (hidden when printing) */}
            <div className="flex items-center justify-between pt-3 border-t border-stone-200 print:hidden">
              <span className="text-xs text-stone-500">
                Official document generated by KAMCH ERP Fees Module
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPrintableReceipt(null)}
                  className="rounded-lg text-xs px-4 py-2 border-stone-300 text-stone-700 hover:bg-stone-100"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handlePrintReceipt}
                  className="rounded-lg bg-[#4B2E2E] text-white hover:bg-[#3d2525] text-xs px-5 py-2 flex items-center gap-1.5 font-semibold shadow-xs"
                >
                  <Printer className="w-4 h-4" />
                  Print Receipt
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
