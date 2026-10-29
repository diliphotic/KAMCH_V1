import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen,
  Barcode,
  Search,
  Upload,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Clock,
  Printer,
  DollarSign,
  Settings,
  User,
  GraduationCap,
  Briefcase,
  FileText,
  Plus,
  RefreshCw,
  X,
  Calendar,
  Layers,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { FormField } from '../components/ui/FormField';

type LibraryTab =
  | 'circulation'
  | 'initial_loans'
  | 'catalogue'
  | 'barcodes'
  | 'fines'
  | 'reports'
  | 'settings';

interface BookRecord {
  id: number;
  accession_number: string;
  accession_date: string | null;
  title: string;
  authors: string | null;
  edition_year: string | null;
  publisher_place: string | null;
  isbn: string | null;
  pages: string | null;
  binding: string | null;
  source: string | null;
  bill_number_date: string | null;
  price: number | null;
  status: 'AVAILABLE' | 'ISSUED' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';
  remarks: string | null;
}

interface BorrowerResult {
  borrowerType: 'STUDENT' | 'TEACHER';
  id: number;
  fullName: string;
  identifier: string;
  registerNumber?: string | null;
  studentIdNumber?: string;
  temporaryRollNumber?: string | null;
  designation?: string;
  details: string;
  activeLoansCount: number;
  maxAllowedBooks: number;
  loanPeriodDays: number;
  canBorrow: boolean;
}

interface ActiveLoanRecord {
  id: number;
  book_id: number;
  accession_number: string;
  book_title: string;
  book_authors: string | null;
  borrower_type: 'STUDENT' | 'TEACHER';
  borrower_name: string;
  borrower_identifier: string;
  borrower_details: string | null;
  issue_date: string;
  due_date: string;
  days_overdue: number;
  is_initial_entry: boolean;
}

interface FineRecord {
  id: number;
  loan_id: number;
  accession_number: string;
  book_title: string;
  borrower_name: string;
  borrower_identifier: string;
  borrower_type: 'STUDENT' | 'TEACHER';
  due_date: string;
  return_date: string;
  overdue_days: number;
  assessed_fine: number;
  waived_amount: number;
  paid_amount: number;
  outstanding_balance: number;
  waiver_reason: string | null;
  waived_by_name: string | null;
  status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED';
}

interface LibrarySettingRecord {
  id: number;
  borrower_type: 'STUDENT' | 'TEACHER';
  max_active_books: number;
  loan_period_days: number;
  fine_amount_per_day: number;
  grace_period_days: number;
  max_fine_amount: number | null;
}

function formatCurrency(val: any): string {
  if (val === null || val === undefined || val === '') return '—';
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return '—';
  return `₹${num.toFixed(2)}`;
}

export const LibraryWorkspaceView: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const [activeTab, setActiveTab] = useState<LibraryTab>('circulation');

  const getCsrfHeader = useCallback((): Record<string, string> => {
    let token = csrfToken;
    if (!token) {
      const match = document.cookie.match(/kamch_csrf=([^;]+)/);
      if (match) token = match[1];
    }
    return token ? { 'X-CSRF-Token': token } : {};
  }, [csrfToken]);

  // Stats
  const [stats, setStats] = useState<any>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Notifications
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Circulation Tab State
  const [circMode, setCircMode] = useState<'ISSUE' | 'RETURN'>('ISSUE');
  const [scannerAccNumber, setScannerAccNumber] = useState('');
  const [activeLoanForReturn, setActiveLoanForReturn] = useState<ActiveLoanRecord | null>(null);
  const [returnSummary, setReturnSummary] = useState<any>(null);

  // Borrower search
  const [borrowerSearchQuery, setBorrowerSearchQuery] = useState('');
  const [borrowerResults, setBorrowerResults] = useState<BorrowerResult[]>([]);
  const [selectedBorrower, setSelectedBorrower] = useState<BorrowerResult | null>(null);
  const [isSearchingBorrower, setIsSearchingBorrower] = useState(false);

  // Book search in Issue
  const [bookLookupAcc, setBookLookupAcc] = useState('');
  const [selectedBookForIssue, setSelectedBookForIssue] = useState<BookRecord | null>(null);
  const [isLookingUpBook, setIsLookingUpBook] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);

  // Catalogue Tab State
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueStatus, setCatalogueStatus] = useState('');
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [totalBooks, setTotalBooks] = useState(0);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);
  const [cataloguePage, setCataloguePage] = useState(0);

  // Add/Edit Book Modal
  const [showBookModal, setShowBookModal] = useState(false);
  const [editingBook, setEditingBook] = useState<BookRecord | null>(null);
  const [bookFormData, setBookFormData] = useState<Partial<BookRecord>>({});
  const [isSavingBook, setIsSavingBook] = useState(false);

  // Excel Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);

  // Initial Handwritten Register Entry
  const [initialAcc, setInitialAcc] = useState('');
  const [initialType, setInitialType] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [initialName, setInitialName] = useState('');
  const [initialIdentifier, setInitialIdentifier] = useState('');
  const [initialDetails, setInitialDetails] = useState('');
  const [initialIssueDate, setInitialIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [initialDueDate, setInitialDueDate] = useState('');
  const [initialRemarks, setInitialRemarks] = useState('');
  const [isSubmittingInitial, setIsSubmittingInitial] = useState(false);

  // Barcode Printing State
  const [selectedAccsForPrint, setSelectedAccsForPrint] = useState<string[]>([]);
  const [barcodeLabels, setBarcodeLabels] = useState<any[]>([]);
  const [isLoadingBarcodes, setIsLoadingBarcodes] = useState(false);
  const [barcodeLoadProgress, setBarcodeLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [labelCols, setLabelCols] = useState<number>(3);

  // Fines Tab State
  const [finesList, setFinesList] = useState<FineRecord[]>([]);
  const [fineStatusFilter, setFineStatusFilter] = useState('');
  const [isLoadingFines, setIsLoadingFines] = useState(false);
  const [selectedFineForPay, setSelectedFineForPay] = useState<FineRecord | null>(null);
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<string>('CASH');
  const [payReceiptRef, setPayReceiptRef] = useState<string>('');
  const [isPayingFine, setIsPayingFine] = useState(false);

  const [selectedFineForWaive, setSelectedFineForWaive] = useState<FineRecord | null>(null);
  const [waiveAmount, setWaiveAmount] = useState<string>('');
  const [waiveReason, setWaiveReason] = useState<string>('');
  const [isWaivingFine, setIsWaivingFine] = useState(false);

  // Settings Tab State
  const [settings, setSettings] = useState<LibrarySettingRecord[]>([]);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Active Loans & Reports
  const [activeLoans, setActiveLoans] = useState<ActiveLoanRecord[]>([]);
  const [loanSearchQuery, setLoanSearchQuery] = useState('');

  // Scanner Input Ref
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManageSettings = Boolean(
    user && ['SUPER_ADMIN', 'PRINCIPAL', 'LIBRARY'].includes(user.role)
  );

  // Auto-focus barcode scanner input when switching to circulation
  useEffect(() => {
    if (activeTab === 'circulation' && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  }, [activeTab, circMode]);

  const loadStats = useCallback(() => {
    setIsLoadingStats(true);
    fetch('/api/library/stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.stats) setStats(data.stats);
      })
      .catch(() => {})
      .finally(() => setIsLoadingStats(false));
  }, []);

  const loadBooks = useCallback(() => {
    setIsLoadingBooks(true);
    const params = new URLSearchParams({
      limit: '50',
      offset: String(cataloguePage * 50),
    });
    if (catalogueQuery) params.set('q', catalogueQuery);
    if (catalogueStatus) params.set('status', catalogueStatus);

    fetch(`/api/library/books?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.books)) {
          setBooks(data.books);
          setTotalBooks(Number(data.pagination?.total || 0));
        } else {
          setBooks([]);
          setTotalBooks(0);
        }
      })
      .catch((err) => {
        console.error('[Library Workspace] Failed to load books catalogue:', err);
        setBooks([]);
        setTotalBooks(0);
      })
      .finally(() => setIsLoadingBooks(false));
  }, [cataloguePage, catalogueQuery, catalogueStatus]);

  const loadActiveLoans = useCallback(() => {
    const url = loanSearchQuery
      ? `/api/library/loans/active?q=${encodeURIComponent(loanSearchQuery)}`
      : '/api/library/loans/active';
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.activeLoans) setActiveLoans(data.activeLoans);
      })
      .catch(() => {});
  }, [loanSearchQuery]);

  const loadFines = useCallback(() => {
    setIsLoadingFines(true);
    const url = fineStatusFilter
      ? `/api/library/fines?status=${fineStatusFilter}`
      : '/api/library/fines';
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.fines) setFinesList(data.fines);
      })
      .catch(() => {})
      .finally(() => setIsLoadingFines(false));
  }, [fineStatusFilter]);

  const loadSettings = useCallback(() => {
    fetch('/api/library/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.settings) setSettings(data.settings);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
    loadSettings();
  }, [loadStats, loadSettings]);

  useEffect(() => {
    if (activeTab === 'catalogue') loadBooks();
    if (activeTab === 'circulation' || activeTab === 'reports') loadActiveLoans();
    if (activeTab === 'fines') loadFines();
  }, [activeTab, loadBooks, loadActiveLoans, loadFines]);

  // Borrower search debounced
  useEffect(() => {
    if (!borrowerSearchQuery || borrowerSearchQuery.trim().length < 2) {
      setBorrowerResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearchingBorrower(true);
      fetch(`/api/library/borrowers/search?q=${encodeURIComponent(borrowerSearchQuery.trim())}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.borrowers) setBorrowerResults(data.borrowers);
        })
        .catch(() => {})
        .finally(() => setIsSearchingBorrower(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [borrowerSearchQuery]);

  // Handle Book Lookup for Issue
  const handleLookupBookForIssue = (accNum: string) => {
    const acc = accNum.trim();
    if (!acc) return;
    setIsLookingUpBook(true);
    fetch(`/api/library/books/by-accession/${encodeURIComponent(acc)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Book not found');
        return data;
      })
      .then((data) => {
        setSelectedBookForIssue(data.book);
        setNotice(null);
      })
      .catch((err) => {
        setSelectedBookForIssue(null);
        setNotice({ type: 'error', message: err.message });
      })
      .finally(() => setIsLookingUpBook(false));
  };

  // Handle Book Issue Submit
  const handleConfirmIssue = async () => {
    if (!selectedBorrower || !selectedBookForIssue) return;
    setIsIssuing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/library/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          borrowerType: selectedBorrower.borrowerType,
          borrowerId: selectedBorrower.id,
          borrowerIdentifier: selectedBorrower.identifier || selectedBorrower.registerNumber || selectedBorrower.studentIdNumber || `STU-${selectedBorrower.id}`,
          accessionNumber: selectedBookForIssue.accession_number,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to issue book');

      setNotice({
        type: 'success',
        message: `Book '${data.loan.accessionNumber}' successfully issued to ${data.loan.borrowerName}. Due Date: ${data.loan.dueDate}`,
      });
      setSelectedBookForIssue(null);
      setBookLookupAcc('');
      setScannerAccNumber('');
      loadStats();
      loadActiveLoans();

      // Refresh borrower active count
      if (selectedBorrower) {
        setSelectedBorrower({
          ...selectedBorrower,
          activeLoansCount: selectedBorrower.activeLoansCount + 1,
          canBorrow: selectedBorrower.activeLoansCount + 1 < selectedBorrower.maxAllowedBooks,
        });
      }
      setTimeout(() => scannerInputRef.current?.focus(), 100);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsIssuing(false);
    }
  };

  // Handle Return Scan / Lookup
  const handleReturnLookup = async (accNum: string) => {
    const acc = accNum.trim();
    if (!acc) return;
    setNotice(null);
    setReturnSummary(null);

    const normAcc = acc.toLowerCase();
    const rawAccNum = acc.replace(/^KAMCH-L-0*/i, '').toLowerCase();

    // Find active loan in activeLoans
    const match = activeLoans.find(
      (l) =>
        l.accession_number.toLowerCase() === normAcc ||
        l.accession_number.toLowerCase() === rawAccNum
    );
    if (match) {
      setActiveLoanForReturn(match);
    } else {
      // Fetch from API
      try {
        const res = await fetch(`/api/library/loans/active?q=${encodeURIComponent(acc)}`);
        const data = await res.json();
        const found = data.activeLoans?.find(
          (l: any) =>
            l.accession_number.toLowerCase() === normAcc ||
            l.accession_number.toLowerCase() === rawAccNum
        );
        if (found) {
          setActiveLoanForReturn(found);
        } else if (data.activeLoans && data.activeLoans.length > 0) {
          setActiveLoanForReturn(data.activeLoans[0]);
        } else {
          setActiveLoanForReturn(null);
          setNotice({
            type: 'error',
            message: `No active loan found for accession number / barcode '${acc}'. It may already be returned or not yet catalogued.`,
          });
        }
      } catch {
        setActiveLoanForReturn(null);
      }
    }
  };

  // Confirm Return
  const handleConfirmReturn = async () => {
    if (!activeLoanForReturn) return;
    setNotice(null);
    try {
      const res = await fetch('/api/library/return', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({ accessionNumber: activeLoanForReturn.accession_number }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to return book');

      setReturnSummary(data.returnSummary);
      setNotice({
        type: 'success',
        message: `Book '${data.returnSummary.accessionNumber}' successfully returned. ${
          data.returnSummary.assessedFine > 0
            ? `Overdue Fine Assessed: ₹${Number(data.returnSummary.assessedFine).toFixed(2)} (${data.returnSummary.overdueDays} days overdue).`
            : 'Returned on schedule. No overdue fine.'
        }`,
      });
      setActiveLoanForReturn(null);
      setScannerAccNumber('');
      loadStats();
      loadActiveLoans();
      setTimeout(() => scannerInputRef.current?.focus(), 100);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    }
  };

  // Handle Excel File Upload & Parse
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingExcel(true);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/library/books/import-preview', {
        method: 'POST',
        headers: {
          ...getCsrfHeader(),
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to preview workbook');

      setImportPreview(data.preview);
      setShowImportModal(true);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsParsingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Confirm Import
  const handleConfirmImport = async () => {
    if (!importPreview?.validBooks || importPreview.validBooks.length === 0) return;
    setIsConfirmingImport(true);
    setNotice(null);

    const validBooks = importPreview.validBooks;
    const CHUNK_SIZE = 2500;
    let totalImported = 0;
    let totalSkipped = 0;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getCsrfHeader(),
      };

      for (let i = 0; i < validBooks.length; i += CHUNK_SIZE) {
        const chunk = validBooks.slice(i, i + CHUNK_SIZE);
        const res = await fetch('/api/library/books/import-confirm', {
          method: 'POST',
          headers,
          body: JSON.stringify({ books: chunk }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to import books batch');

        totalImported += data.importedCount || 0;
        totalSkipped += data.skippedCount || 0;
      }

      setNotice({
        type: 'success',
        message: `Successfully imported ${totalImported} book(s) into the catalogue (${totalSkipped} skipped as duplicates or missing fields).`,
      });
      setShowImportModal(false);
      setImportPreview(null);
      loadBooks();
      loadStats();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsConfirmingImport(false);
    }
  };

  // Handle Save Book (Add or Edit)
  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookFormData.title || !bookFormData.accession_number) {
      setNotice({ type: 'error', message: 'Accession number and title are required.' });
      return;
    }
    setIsSavingBook(true);
    setNotice(null);
    try {
      const url = editingBook ? `/api/library/books/${editingBook.id}` : '/api/library/books';
      const method = editingBook ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          accessionNumber: bookFormData.accession_number,
          accessionDate: bookFormData.accession_date,
          title: bookFormData.title,
          authors: bookFormData.authors,
          editionYear: bookFormData.edition_year,
          publisherPlace: bookFormData.publisher_place,
          isbn: bookFormData.isbn,
          pages: bookFormData.pages,
          binding: bookFormData.binding,
          source: bookFormData.source,
          billNumberDate: bookFormData.bill_number_date,
          price: bookFormData.price,
          status: bookFormData.status,
          remarks: bookFormData.remarks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save book');

      setNotice({
        type: 'success',
        message: editingBook ? 'Book updated successfully.' : 'New book added to catalogue.',
      });
      setShowBookModal(false);
      setEditingBook(null);
      setBookFormData({});
      loadBooks();
      loadStats();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsSavingBook(false);
    }
  };

  // Handle Initial Register Loan Entry
  const handleInitialLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialAcc || !initialName || !initialIdentifier || !initialDueDate) {
      setNotice({ type: 'error', message: 'All required fields must be completed.' });
      return;
    }
    setIsSubmittingInitial(true);
    setNotice(null);
    try {
      const res = await fetch('/api/library/initial-loan-entry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          accessionNumber: initialAcc,
          borrowerType: initialType,
          borrowerName: initialName,
          borrowerIdentifier: initialIdentifier,
          borrowerDetails: initialDetails,
          issueDate: initialIssueDate,
          dueDate: initialDueDate,
          remarks: initialRemarks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record initial loan');

      setNotice({ type: 'success', message: data.message });
      setInitialAcc('');
      setInitialName('');
      setInitialIdentifier('');
      setInitialDetails('');
      setInitialDueDate('');
      setInitialRemarks('');
      loadStats();
      loadActiveLoans();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsSubmittingInitial(false);
    }
  };

  // Handle Barcode Generation for Selected Books, All Available Books, or Entire Catalogue (All Books)
  const handleGenerateBarcodes = async (options: {
    testPrint?: boolean;
    allAvailable?: boolean;
    allBooks?: boolean;
    accessionNumbers?: string[];
  } = {}) => {
    setIsLoadingBarcodes(true);
    setNotice(null);
    setBarcodeLoadProgress(null);

    const targetAccs = options.accessionNumbers || (options.testPrint || options.allAvailable || options.allBooks ? [] : selectedAccsForPrint);

    let accumulatedLabels: any[] = [];
    let currentOffset = 0;
    const CHUNK_SIZE = 1000;
    let hasMore = true;

    try {
      while (hasMore) {
        const res = await fetch('/api/library/barcodes/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getCsrfHeader(),
          },
          body: JSON.stringify({
            accessionNumbers: targetAccs,
            allAvailable: Boolean(options.allAvailable),
            allBooks: Boolean(options.allBooks),
            testPrint: Boolean(options.testPrint),
            offset: currentOffset,
            limit: CHUNK_SIZE,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate barcode labels chunk');

        const newLabels = data.labels || [];
        accumulatedLabels = [...accumulatedLabels, ...newLabels];

        const total = data.totalCount || accumulatedLabels.length;
        setBarcodeLoadProgress({ loaded: accumulatedLabels.length, total });
        setBarcodeLabels(accumulatedLabels);

        if (data.hasMore && newLabels.length > 0) {
          currentOffset += newLabels.length;
        } else {
          hasMore = false;
        }
      }

      setNotice({
        type: 'success',
        message: `Successfully loaded ${accumulatedLabels.length.toLocaleString()} barcode label(s) ready for printing.`,
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Error loading barcode labels at offset ${currentOffset}: ${err.message}`,
      });
    } finally {
      setIsLoadingBarcodes(false);
    }
  };

  // Handle Fine Payment
  const handlePayFineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFineForPay) return;
    const num = parseFloat(payAmount);
    if (isNaN(num) || num <= 0) {
      setNotice({ type: 'error', message: 'Enter a valid payment amount.' });
      return;
    }
    setIsPayingFine(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/library/fines/${selectedFineForPay.id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          amount: num,
          paymentMethod: payMethod,
          receiptReference: payReceiptRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');

      setNotice({ type: 'success', message: data.message });
      setSelectedFineForPay(null);
      setPayAmount('');
      setPayReceiptRef('');
      loadFines();
      loadStats();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsPayingFine(false);
    }
  };

  // Handle Fine Waiver
  const handleWaiveFineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFineForWaive) return;
    if (!waiveReason.trim()) {
      setNotice({ type: 'error', message: 'An administrative reason is mandatory to authorize a fine waiver.' });
      return;
    }
    setIsWaivingFine(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/library/fines/${selectedFineForWaive.id}/waive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          amount: waiveAmount ? parseFloat(waiveAmount) : undefined,
          reason: waiveReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to waive fine');

      setNotice({ type: 'success', message: data.message });
      setSelectedFineForWaive(null);
      setWaiveAmount('');
      setWaiveReason('');
      loadFines();
      loadStats();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsWaivingFine(false);
    }
  };

  // Handle Settings Update
  const handleSaveSetting = async (borrowerType: 'STUDENT' | 'TEACHER', setting: LibrarySettingRecord) => {
    setIsSavingSettings(true);
    setNotice(null);
    try {
      const res = await fetch('/api/library/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getCsrfHeader(),
        },
        body: JSON.stringify({
          borrowerType,
          maxActiveBooks: setting.max_active_books,
          loanPeriodDays: setting.loan_period_days,
          fineAmountPerDay: setting.fine_amount_per_day,
          gracePeriodDays: setting.grace_period_days,
          maxFineAmount: setting.max_fine_amount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update settings');

      setNotice({ type: 'success', message: data.message });
      loadSettings();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <PageHeader
        title="Central Library"
        description="Comprehensive Accession Register, Circulation Desk, Barcode Automation & Overdue Fine Management"
      />

      {/* Institutional Notice Alert */}
      {notice && (
        <div
          className={`p-3.5 rounded-lg text-xs font-medium flex items-center justify-between transition-all ${
            notice.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : notice.type === 'error'
              ? 'bg-red-50 text-red-900 border border-red-200'
              : 'bg-stone-50 text-stone-800 border border-stone-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : notice.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            ) : (
              <BookOpen className="w-4 h-4 text-stone-600 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-stone-400 hover:text-stone-700 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Real-time Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-xs">
          <p className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Registered Books</p>
          <p className="text-xl font-bold text-stone-900 mt-1">
            {isLoadingStats ? '...' : (stats?.totalBooks || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Physical copies</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-xs">
          <p className="text-[11px] font-medium text-emerald-700 uppercase tracking-wider">Available on Shelf</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">
            {isLoadingStats ? '...' : (stats?.availableBooks || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Ready for circulation</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-xs">
          <p className="text-[11px] font-medium text-amber-700 uppercase tracking-wider">Active Loans</p>
          <p className="text-xl font-bold text-amber-800 mt-1">
            {isLoadingStats ? '...' : (stats?.activeLoans || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Currently with borrowers</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-xs">
          <p className="text-[11px] font-medium text-red-700 uppercase tracking-wider">Overdue Loans</p>
          <p className="text-xl font-bold text-red-700 mt-1">
            {isLoadingStats ? '...' : (stats?.overdueLoans || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Past due return date</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-xs">
          <p className="text-[11px] font-medium text-stone-600 uppercase tracking-wider">Fines Collected</p>
          <p className="text-xl font-bold text-stone-900 mt-1">
            ₹{isLoadingStats ? '...' : (stats?.totalFinesCollected || 0).toFixed(2)}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Offline receipts</p>
        </div>
        <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-xs">
          <p className="text-[11px] font-medium text-purple-700 uppercase tracking-wider">Outstanding Fines</p>
          <p className="text-xl font-bold text-purple-800 mt-1">
            ₹{isLoadingStats ? '...' : (stats?.totalFinesOutstanding || 0).toFixed(2)}
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Unpaid overdue balance</p>
        </div>
      </div>

      {/* Navigation Segmented Control */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-stone-100 rounded-lg border border-stone-200">
        <button
          onClick={() => setActiveTab('circulation')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            activeTab === 'circulation'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Circulation Desk (Issue / Return)</span>
        </button>

        <button
          onClick={() => setActiveTab('catalogue')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            activeTab === 'catalogue'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Accession Catalogue</span>
        </button>

        <button
          onClick={() => setActiveTab('barcodes')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            activeTab === 'barcodes'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
          }`}
        >
          <Barcode className="w-3.5 h-3.5" />
          <span>Barcode Labels</span>
        </button>

        <button
          onClick={() => setActiveTab('fines')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            activeTab === 'fines'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Fines & Settlements</span>
        </button>

        <button
          onClick={() => setActiveTab('initial_loans')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            activeTab === 'initial_loans'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Handwritten Register Entry</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            activeTab === 'reports'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Active Loans & Reports</span>
        </button>

        {canManageSettings && (
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'settings'
                ? 'bg-[#4B2E2E] text-white shadow-xs'
                : 'text-stone-700 hover:text-stone-900 hover:bg-stone-200/60'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Borrowing Settings</span>
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: CIRCULATION DESK (ISSUE / RETURN)                                   */}
      {/* ========================================================================= */}
      {activeTab === 'circulation' && (
        <div className="space-y-4">
          {/* Issue vs Return Toggle */}
          <div className="flex items-center justify-between bg-white border border-stone-200 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setCircMode('ISSUE');
                  setScannerAccNumber('');
                  setActiveLoanForReturn(null);
                  setReturnSummary(null);
                  if (scannerInputRef.current) scannerInputRef.current.focus();
                }}
                className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
                  circMode === 'ISSUE'
                    ? 'bg-[#4B2E2E] text-white shadow-xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                1. Book Issue (Check Out)
              </button>
              <button
                onClick={() => {
                  setCircMode('RETURN');
                  setScannerAccNumber('');
                  setSelectedBookForIssue(null);
                  if (scannerInputRef.current) scannerInputRef.current.focus();
                }}
                className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
                  circMode === 'RETURN'
                    ? 'bg-[#4B2E2E] text-white shadow-xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                2. Book Return (Check In & Fines)
              </button>
            </div>

            <div className="text-right text-[11px] text-stone-500 hidden sm:block">
              USB Barcode scanner input active · Enter or scan accession number
            </div>
          </div>

          {/* CIRCULATION: ISSUE MODE */}
          {circMode === 'ISSUE' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Step 1: Select Borrower */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Step 1: Select Borrower</CardTitle>
                      <CardDescription>
                        Search student by register number or name; teacher by staff code or name
                      </CardDescription>
                    </div>
                    {selectedBorrower && (
                      <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Selected
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search student by name or University Reg No (e.g. 23A...); teacher by staff code..."
                      value={borrowerSearchQuery}
                      onChange={(e) => setBorrowerSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 text-xs rounded-md border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E] focus:ring-1 focus:ring-[#4B2E2E]"
                    />
                    {isSearchingBorrower && (
                      <RefreshCw className="w-3.5 h-3.5 text-stone-400 animate-spin absolute right-3 top-2.5" />
                    )}
                  </div>

                  {/* Borrower Search Results Dropdown */}
                  {borrowerResults.length > 0 && !selectedBorrower && (
                    <div className="border border-stone-200 rounded-md divide-y divide-stone-100 max-h-52 overflow-y-auto bg-stone-50/50">
                      {borrowerResults.map((b) => (
                        <div
                          key={`${b.borrowerType}-${b.id}`}
                          onClick={() => {
                            setSelectedBorrower(b);
                            setBorrowerSearchQuery('');
                            setBorrowerResults([]);
                          }}
                          className="p-2.5 hover:bg-stone-100 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-stone-900">{b.fullName}</span>
                              <Badge variant="neutral" className="text-[10px] font-mono py-0 text-stone-700 bg-stone-100">
                                {b.borrowerType === 'STUDENT'
                                  ? `Reg: ${b.registerNumber || b.identifier || 'Pending'}`
                                  : `Staff ID: ${b.identifier}`}
                              </Badge>
                              {b.studentIdNumber && b.studentIdNumber !== b.registerNumber && (
                                <span className="text-[10px] text-stone-500 font-mono">
                                  ({b.studentIdNumber})
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-stone-500 mt-0.5">{b.details}</p>
                          </div>
                          <div className="text-right">
                            <span
                              className={`text-[11px] font-semibold ${
                                b.canBorrow ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {b.activeLoansCount} / {b.maxAllowedBooks} Active
                            </span>
                            <p className="text-[10px] text-stone-400">
                              {b.canBorrow ? 'Eligible' : 'Limit Reached'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* No Results Found State */}
                  {borrowerSearchQuery.trim().length >= 2 && !isSearchingBorrower && borrowerResults.length === 0 && !selectedBorrower && (
                    <div className="border border-stone-200 rounded-md p-3 text-center text-xs text-stone-500 bg-stone-50">
                      No borrower found matching "{borrowerSearchQuery}". Search student by name or university reg no (e.g. 23A...); teacher by staff code.
                    </div>
                  )}

                  {/* Selected Borrower Details Card */}
                  {selectedBorrower ? (
                    <div className="bg-[#F5F5DC]/40 border border-[#D4AF37]/40 rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {selectedBorrower.borrowerType === 'STUDENT' ? (
                            <div className="w-8 h-8 rounded-full bg-[#4B2E2E]/10 text-[#4B2E2E] flex items-center justify-center font-bold text-xs">
                              <GraduationCap className="w-4 h-4" />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#D4AF37]/20 text-[#4B2E2E] flex items-center justify-center font-bold text-xs">
                              <Briefcase className="w-4 h-4" />
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-bold text-stone-900">{selectedBorrower.fullName}</p>
                            <p className="text-[11px] text-stone-600 font-mono">
                              ID: {selectedBorrower.identifier}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedBorrower(null)}
                          className="text-[11px] text-stone-500 hover:text-red-700 underline"
                        >
                          Change
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-700 pt-1 border-t border-stone-200">
                        <div>
                          <span className="text-stone-500">Department / Batch:</span>
                          <p className="font-medium text-stone-900">{selectedBorrower.details}</p>
                        </div>
                        <div>
                          <span className="text-stone-500">Current Borrowing Status:</span>
                          <p
                            className={`font-semibold ${
                              selectedBorrower.canBorrow ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {selectedBorrower.activeLoansCount} of {selectedBorrower.maxAllowedBooks} books active (
                            {selectedBorrower.loanPeriodDays} days loan)
                          </p>
                        </div>
                      </div>

                      {!selectedBorrower.canBorrow && (
                        <div className="text-[11px] text-red-700 bg-red-50 p-2 rounded border border-red-200 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Borrowing limit reached. Student/teacher must return outstanding books before issuing new titles.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border border-dashed border-stone-300 rounded-lg p-4 text-center text-xs text-stone-400">
                      No borrower selected. Search by student university register number or teacher staff code above.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Step 2: Scan / Enter Accession Number & Issue */}
              <Card>
                <CardHeader>
                  <CardTitle>Step 2: Scan Book Accession Number</CardTitle>
                  <CardDescription>
                    USB scanner keyboard input automatically searches when scanned
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Barcode className="w-4 h-4 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
                      <input
                        ref={scannerInputRef}
                        type="text"
                        placeholder="Scan barcode or enter accession number..."
                        value={bookLookupAcc}
                        onChange={(e) => setBookLookupAcc(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleLookupBookForIssue(bookLookupAcc);
                          }
                        }}
                        className="w-full pl-9 pr-4 py-2 text-xs font-mono rounded-md border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E] focus:ring-1 focus:ring-[#4B2E2E]"
                      />
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleLookupBookForIssue(bookLookupAcc)}
                      disabled={!bookLookupAcc.trim() || isLookingUpBook}
                    >
                      {isLookingUpBook ? 'Searching...' : 'Lookup'}
                    </Button>
                  </div>

                  {/* Book Details Found */}
                  {selectedBookForIssue && (
                    <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs font-bold text-stone-900">{selectedBookForIssue.title}</p>
                          <p className="text-[11px] text-stone-600 mt-0.5">
                            Author(s): {selectedBookForIssue.authors || 'Not specified'}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            selectedBookForIssue.status === 'AVAILABLE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {selectedBookForIssue.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-stone-600 pt-1 border-t border-stone-200">
                        <div>
                          <span className="text-stone-400 block">Accession No</span>
                          <span className="font-mono font-bold text-stone-800">
                            {selectedBookForIssue.accession_number}
                          </span>
                        </div>
                        <div>
                          <span className="text-stone-400 block">Publisher</span>
                          <span className="text-stone-800">
                            {selectedBookForIssue.publisher_place || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-stone-400 block">ISBN</span>
                          <span className="font-mono text-stone-800">
                            {selectedBookForIssue.isbn || '—'}
                          </span>
                        </div>
                      </div>

                      {/* Due Date Preview */}
                      {selectedBorrower && (
                        <div className="mt-2 p-2 bg-[#F5F5DC]/60 border border-[#D4AF37]/40 rounded text-[11px] text-stone-800 flex items-center justify-between">
                          <span className="font-medium">Calculated Due Date:</span>
                          <span className="font-bold text-[#4B2E2E]">
                            {new Date(
                              Date.now() + selectedBorrower.loanPeriodDays * 24 * 60 * 60 * 1000
                            ).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}{' '}
                            ({selectedBorrower.loanPeriodDays} days)
                          </span>
                        </div>
                      )}

                      {/* Issue Action Button */}
                      <div className="pt-2">
                        <Button
                          variant="gold"
                          size="md"
                          onClick={handleConfirmIssue}
                          disabled={
                            isIssuing ||
                            !selectedBorrower ||
                            !selectedBorrower.canBorrow ||
                            selectedBookForIssue.status !== 'AVAILABLE'
                          }
                          className="w-full font-bold"
                        >
                          {isIssuing ? 'Recording Issue...' : 'Confirm Book Issue'}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* CIRCULATION: RETURN MODE */}
          {circMode === 'RETURN' && (
            <Card>
              <CardHeader>
                <CardTitle>Book Return & Overdue Fine Assessment</CardTitle>
                <CardDescription>
                  Scan or enter book accession number to check in physical copy and calculate any overdue fine
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-xl flex gap-2">
                  <div className="relative flex-1">
                    <Barcode className="w-4 h-4 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      ref={scannerInputRef}
                      type="text"
                      placeholder="Scan returned book barcode or type accession number..."
                      value={scannerAccNumber}
                      onChange={(e) => setScannerAccNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleReturnLookup(scannerAccNumber);
                        }
                      }}
                      className="w-full pl-9 pr-4 py-2 text-xs font-mono rounded-md border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E] focus:ring-1 focus:ring-[#4B2E2E]"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleReturnLookup(scannerAccNumber)}
                    disabled={!scannerAccNumber.trim()}
                  >
                    Find Active Loan
                  </Button>
                </div>

                {/* Found Active Loan for Return */}
                {activeLoanForReturn && (
                  <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 space-y-3 max-w-2xl">
                    <div className="flex items-start justify-between border-b border-stone-200 pb-2">
                      <div>
                        <h4 className="text-sm font-bold text-stone-900">{activeLoanForReturn.book_title}</h4>
                        <p className="text-xs text-stone-500 font-mono mt-0.5">
                          Accession No: <strong>{activeLoanForReturn.accession_number}</strong>
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
                        Active Loan
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-stone-400 text-[11px] block">Borrower</span>
                        <span className="font-semibold text-stone-900">{activeLoanForReturn.borrower_name}</span>
                        <span className="text-[10px] text-stone-500 font-mono block">
                          {activeLoanForReturn.borrower_identifier}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-400 text-[11px] block">Issue Date</span>
                        <span className="text-stone-800">
                          {new Date(activeLoanForReturn.issue_date).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                      <div>
                        <span className="text-stone-400 text-[11px] block">Scheduled Due Date</span>
                        <span className="font-semibold text-stone-900">
                          {new Date(activeLoanForReturn.due_date).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                    </div>

                    {/* Overdue Assessment Alert */}
                    {new Date(activeLoanForReturn.due_date) < new Date() ? (
                      <div className="bg-red-50 border border-red-200 rounded p-2.5 text-xs text-red-900 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>Book is Overdue</span>
                        </div>
                        <p className="text-[11px] text-red-700">
                          Due date was{' '}
                          {new Date(activeLoanForReturn.due_date).toLocaleDateString('en-IN')}. Overdue fine will
                          be automatically assessed and recorded on return.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs text-emerald-900 flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Returning on schedule. No overdue fine will be assessed.</span>
                      </div>
                    )}

                    <div className="pt-2">
                      <Button
                        variant="gold"
                        size="md"
                        onClick={handleConfirmReturn}
                        className="w-full font-bold"
                      >
                        Confirm Return & Update Book Status
                      </Button>
                    </div>
                  </div>
                )}

                {/* Return Summary Display */}
                {returnSummary && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2 max-w-2xl">
                    <h4 className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      Book Return Receipt
                    </h4>
                    <div className="text-xs text-stone-700 space-y-1">
                      <p>
                        Book: <strong>{returnSummary.bookTitle}</strong> (Accession: {returnSummary.accessionNumber})
                      </p>
                      <p>
                        Borrower: <strong>{returnSummary.borrowerName}</strong> ({returnSummary.borrowerIdentifier})
                      </p>
                      <p>
                        Returned on:{' '}
                        <strong>
                          {new Date(returnSummary.returnDate).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </strong>
                      </p>
                      {returnSummary.assessedFine > 0 ? (
                        <p className="text-red-700 font-bold text-sm pt-1">
                          Assessed Overdue Fine: ₹{returnSummary.assessedFine.toFixed(2)} ({returnSummary.overdueDays} days overdue)
                        </p>
                      ) : (
                        <p className="text-emerald-700 font-bold text-xs pt-1">
                          No overdue fine assessed.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ACCESSION REGISTER CATALOGUE & EXCEL IMPORT                         */}
      {/* ========================================================================= */}
      {activeTab === 'catalogue' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Physical Accession Catalogue</CardTitle>
                <CardDescription>
                  Source of truth for all individual physical copies ({totalBooks} books registered)
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                {/* Excel Import Button */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isParsingExcel}
                  className="text-xs"
                >
                  <Upload className="w-3.5 h-3.5 mr-1 text-[#4B2E2E]" />
                  {isParsingExcel ? 'Parsing File...' : 'Import Accession Register (Excel)'}
                </Button>

                {/* Add Single Book */}
                <Button
                  variant="gold"
                  size="sm"
                  onClick={() => {
                    setEditingBook(null);
                    setBookFormData({
                      status: 'AVAILABLE',
                      accession_date: new Date().toISOString().split('T')[0],
                    });
                    setShowBookModal(true);
                  }}
                  className="text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Book
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Search & Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by Accession No, Title, Author, ISBN, Publisher..."
                  value={catalogueQuery}
                  onChange={(e) => {
                    setCatalogueQuery(e.target.value);
                    setCataloguePage(0);
                  }}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-md border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E]"
                />
              </div>

              <select
                value={catalogueStatus}
                onChange={(e) => {
                  setCatalogueStatus(e.target.value);
                  setCataloguePage(0);
                }}
                className="px-3 py-2 text-xs rounded-md border border-stone-300 bg-white"
              >
                <option value="">All Statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="ISSUED">Issued</option>
                <option value="LOST">Lost</option>
                <option value="DAMAGED">Damaged</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>
            </div>

            {/* Books Table */}
            <div className="border border-stone-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Acc No</th>
                    <th className="py-2.5 px-3">Title & Authors</th>
                    <th className="py-2.5 px-3">Publisher & Place</th>
                    <th className="py-2.5 px-3">ISBN</th>
                    <th className="py-2.5 px-3">Price</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {isLoadingBooks ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-stone-400">
                        Loading catalogue records...
                      </td>
                    </tr>
                  ) : books.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-stone-400">
                        No books match the search criteria. Click "Import Accession Register" to upload books from Excel.
                      </td>
                    </tr>
                  ) : (
                    books.map((b) => (
                      <tr key={b.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-stone-900">
                          {b.accession_number}
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-stone-900">{b.title}</p>
                          <p className="text-[11px] text-stone-500">{b.authors || '—'}</p>
                        </td>
                        <td className="py-2.5 px-3 text-stone-600">
                          {b.publisher_place || '—'}
                          {b.edition_year && <span className="text-stone-400 block text-[10px]">{b.edition_year}</span>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-600">{b.isbn || '—'}</td>
                        <td className="py-2.5 px-3 text-stone-700">
                          {formatCurrency(b.price)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              b.status === 'AVAILABLE'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : b.status === 'ISSUED'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-stone-100 text-stone-600'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1">
                          <button
                            onClick={() => {
                              setSelectedAccsForPrint([b.accession_number]);
                              setActiveTab('barcodes');
                              handleGenerateBarcodes({ testPrint: false });
                            }}
                            className="text-[#4B2E2E] hover:underline text-[11px] font-medium"
                          >
                            Barcode
                          </button>
                          <span className="text-stone-300">·</span>
                          <button
                            onClick={() => {
                              setEditingBook(b);
                              setBookFormData({ ...b });
                              setShowBookModal(true);
                            }}
                            className="text-stone-600 hover:text-stone-900 text-[11px] font-medium"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalBooks > 50 && (
              <div className="flex items-center justify-between text-xs text-stone-500 pt-2">
                <span>
                  Showing {cataloguePage * 50 + 1}–{Math.min((cataloguePage + 1) * 50, totalBooks)} of {totalBooks} books
                </span>
                <div className="space-x-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCataloguePage((p) => Math.max(0, p - 1))}
                    disabled={cataloguePage === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCataloguePage((p) => p + 1)}
                    disabled={(cataloguePage + 1) * 50 >= totalBooks}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: BARCODE LABELS GENERATION & PRINTING                                */}
      {/* ========================================================================= */}
      {activeTab === 'barcodes' && (
        <>
          <style>{`
            @media print {
              @page {
                size: A4 portrait;
                margin: 6mm;
              }
              body * {
                visibility: hidden;
              }
              .library-print-sheet, .library-print-sheet * {
                visibility: visible;
              }
              .library-print-sheet {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                margin: 0;
                padding: 0;
                background: white !important;
                border: none !important;
                box-shadow: none !important;
              }
              .no-print {
                display: none !important;
              }
              .print-label-card {
                break-inside: avoid;
                page-break-inside: avoid;
              }
            }
          `}</style>
          <Card className="no-print">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle>Code 128 Barcode Label Sheet Printing</CardTitle>
                  <CardDescription>
                    Vector SVG Code 128 barcode labels with headers and accession numbers. Standard A4 sheet grid layout.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="gold"
                    size="sm"
                    onClick={() => handleGenerateBarcodes({ allBooks: true })}
                    disabled={isLoadingBarcodes}
                    className="text-xs font-bold"
                  >
                    <Barcode className="w-3.5 h-3.5 mr-1" />
                    Load Entire Catalogue (All Books)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateBarcodes({ allAvailable: true })}
                    disabled={isLoadingBarcodes}
                    className="text-xs"
                  >
                    Load All Available Books
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateBarcodes({ testPrint: true })}
                    disabled={isLoadingBarcodes}
                    className="text-xs"
                  >
                    Test Print (4 Sample Labels)
                  </Button>
                  <Button
                    variant="gold"
                    size="sm"
                    onClick={() => window.print()}
                    disabled={barcodeLabels.length === 0}
                    className="font-bold text-xs"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1" />
                    Print Labels ({barcodeLabels.length.toLocaleString()})
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Progress Indicator when loading large barcode batches */}
              {isLoadingBarcodes && barcodeLoadProgress && (
                <div className="bg-[#F5F5DC] border border-[#D4AF37] text-[#4B2E2E] rounded-lg p-3 text-xs font-semibold flex items-center justify-between no-print">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-[#4B2E2E]" />
                    <span>
                      Loading Barcode Labels... {barcodeLoadProgress.loaded.toLocaleString()} / {barcodeLoadProgress.total.toLocaleString()} books loaded (
                      {Math.round((barcodeLoadProgress.loaded / (barcodeLoadProgress.total || 1)) * 100)}%)
                    </span>
                  </div>
                  <span className="text-[11px] text-stone-600 font-mono">
                    Chunked background retrieval active
                  </span>
                </div>
              )}

              {/* Quick selector & layout controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-stone-50 rounded-lg border border-stone-200">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-stone-700">Grid Layout:</span>
                  <select
                    value={labelCols}
                    onChange={(e) => setLabelCols(Number(e.target.value))}
                    className="px-2.5 py-1 text-xs rounded border border-stone-300 bg-white"
                  >
                    <option value={3}>3 Columns × 8 Rows (24 Labels/A4 Page - Default)</option>
                    <option value={30}>3 Columns × 10 Rows (30 Labels/A4 Page - Alternate)</option>
                    <option value={2}>2 Columns × 5 Rows (10 Labels/A4 Page)</option>
                    <option value={1}>1 Column (Thermal Roll / Single Label)</option>
                  </select>
                </div>

                <div className="text-xs text-stone-500">
                  {barcodeLabels.length > 0 ? (
                    <span>
                      Ready to print <strong>{barcodeLabels.length.toLocaleString()}</strong> unique barcode label(s).
                    </span>
                  ) : (
                    <span>No labels loaded yet. Click 'Load Entire Catalogue (All Books)' above.</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rendered Barcode Labels Grid Container for Screen and Window.Print */}
          <div className="library-print-sheet">
            {isLoadingBarcodes ? (
              <div className="text-center py-12 text-xs text-stone-400 no-print">
                Generating crisp Code 128 barcodes...
              </div>
            ) : barcodeLabels.length === 0 ? (
              <div className="text-center py-12 text-xs text-stone-400 border border-dashed border-stone-200 rounded-lg no-print">
                <Barcode className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                Select books from the Accession Catalogue or click 'Load All Available Books' above to preview barcode labels.
              </div>
            ) : (
              <div
                className={`grid gap-2 p-3 bg-white border border-stone-200 rounded-lg print:border-none print:p-0 ${
                  labelCols === 1
                    ? 'grid-cols-1 max-w-sm mx-auto'
                    : labelCols === 2
                    ? 'grid-cols-2'
                    : labelCols === 30
                    ? 'grid-cols-3'
                    : labelCols === 3
                    ? 'grid-cols-3'
                    : 'grid-cols-3'
                }`}
              >
                {barcodeLabels.map((lbl, idx) => (
                  <div
                    key={`${lbl.barcodeId || lbl.accessionNumber}-${idx}`}
                    className="print-label-card border border-stone-300 rounded p-2 flex flex-col items-center justify-between bg-white text-center shadow-2xs print:border-stone-400 print:shadow-none min-h-[110px]"
                  >
                    <p className="text-[9px] font-bold text-[#4B2E2E] uppercase tracking-wider truncate max-w-full">
                      KAMCH CENTRAL LIBRARY
                    </p>
                    <div
                      className="my-1 w-full flex justify-center"
                      dangerouslySetInnerHTML={{ __html: lbl.svg }}
                    />
                    <p className="text-[10px] text-stone-900 font-semibold truncate max-w-full px-1">
                      {lbl.title}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: FINES & SETTLEMENTS                                                */}
      {/* ========================================================================= */}
      {activeTab === 'fines' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Overdue Fines & Waivers</CardTitle>
                <CardDescription>
                  Track assessed fines, offline cash payments, and administrative waivers with full audit trail
                </CardDescription>
              </div>

              <select
                value={fineStatusFilter}
                onChange={(e) => setFineStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-md border border-stone-300 bg-white"
              >
                <option value="">All Fines</option>
                <option value="PENDING">Pending (Unpaid)</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="PAID">Paid in Full</option>
                <option value="WAIVED">Waived</option>
              </select>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="border border-stone-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Borrower</th>
                    <th className="py-2.5 px-3">Book & Accession</th>
                    <th className="py-2.5 px-3">Overdue Days</th>
                    <th className="py-2.5 px-3">Assessed</th>
                    <th className="py-2.5 px-3">Paid</th>
                    <th className="py-2.5 px-3">Waived</th>
                    <th className="py-2.5 px-3">Balance</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {isLoadingFines ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-stone-400">
                        Loading fine records...
                      </td>
                    </tr>
                  ) : finesList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-stone-400">
                        No fines found for the selected status.
                      </td>
                    </tr>
                  ) : (
                    finesList.map((f) => (
                      <tr key={f.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-stone-900">{f.borrower_name}</p>
                          <p className="text-[10px] text-stone-500 font-mono">
                            {f.borrower_identifier} ({f.borrower_type})
                          </p>
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="font-medium text-stone-900 truncate max-w-xs">{f.book_title}</p>
                          <p className="text-[10px] text-stone-500 font-mono">Acc: {f.accession_number}</p>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-red-700">
                          {f.overdue_days} days
                        </td>
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          ₹{Number(f.assessed_fine).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-emerald-700">
                          ₹{Number(f.paid_amount).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-stone-500">
                          ₹{Number(f.waived_amount).toFixed(2)}
                          {f.waived_by_name && (
                            <span className="block text-[9px] text-stone-400">
                              by {f.waived_by_name}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-stone-900">
                          ₹{Number(f.outstanding_balance).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              f.status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-800'
                                : f.status === 'WAIVED'
                                ? 'bg-stone-100 text-stone-700'
                                : 'bg-red-50 text-red-800'
                            }`}
                          >
                            {f.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5">
                          {Number(f.outstanding_balance) > 0 && (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedFineForPay(f);
                                  setPayAmount(String(f.outstanding_balance));
                                }}
                                className="text-emerald-700 hover:underline font-semibold text-[11px]"
                              >
                                Pay
                              </button>
                              <span className="text-stone-300">·</span>
                              <button
                                onClick={() => {
                                  setSelectedFineForWaive(f);
                                  setWaiveAmount(String(f.outstanding_balance));
                                }}
                                className="text-stone-600 hover:underline font-medium text-[11px]"
                              >
                                Waive
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: INITIAL HANDWRITTEN REGISTER ENTRY                                 */}
      {/* ========================================================================= */}
      {activeTab === 'initial_loans' && (
        <Card>
          <CardHeader>
            <CardTitle>Initial Entry of Outstanding Handwritten Register Loans</CardTitle>
            <CardDescription>
              Record books currently issued out on the physical paper register so the ERP accurately marks them as unavailable
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInitialLoanSubmit} className="space-y-4 max-w-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Book Accession Number *" required>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 1042"
                    value={initialAcc}
                    onChange={(e) => setInitialAcc(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E]"
                  />
                </FormField>

                <FormField label="Borrower Type *" required>
                  <select
                    value={initialType}
                    onChange={(e) => setInitialType(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded border border-stone-300 bg-white"
                  >
                    <option value="STUDENT">Student</option>
                    <option value="TEACHER">Teacher</option>
                  </select>
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Borrower Full Name *" required>
                  <input
                    type="text"
                    required
                    placeholder="Borrower name as written in register"
                    value={initialName}
                    onChange={(e) => setInitialName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E]"
                  />
                </FormField>

                <FormField label="Identifier (Roll No / Reg No / Staff ID) *" required>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 21AY045 or FAC-08"
                    value={initialIdentifier}
                    onChange={(e) => setInitialIdentifier(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-stone-300 focus:outline-hidden focus:border-[#4B2E2E]"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Original Issue Date">
                  <input
                    type="date"
                    value={initialIssueDate}
                    onChange={(e) => setInitialIssueDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-stone-300"
                  />
                </FormField>

                <FormField label="Agreed Due Date *" required>
                  <input
                    type="date"
                    required
                    value={initialDueDate}
                    onChange={(e) => setInitialDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded border border-stone-300"
                  />
                </FormField>
              </div>

              <FormField label="Batch / Department / Remarks">
                <input
                  type="text"
                  placeholder="e.g. Daksha Batch, Second Prof, or handwritten register page 42"
                  value={initialRemarks}
                  onChange={(e) => setInitialRemarks(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded border border-stone-300"
                />
              </FormField>

              <div className="pt-2">
                <Button variant="gold" size="md" type="submit" disabled={isSubmittingInitial} className="font-bold">
                  {isSubmittingInitial ? 'Recording...' : 'Record Outstanding Paper Loan'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: ACTIVE LOANS & REPORTS                                              */}
      {/* ========================================================================= */}
      {activeTab === 'reports' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Currently Issued Books & Overdue Report</CardTitle>
                <CardDescription>
                  Real-time list of all physical copies currently with students or teachers
                </CardDescription>
              </div>

              <div className="relative w-72">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by accession, borrower, title..."
                  value={loanSearchQuery}
                  onChange={(e) => setLoanSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-stone-300"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border border-stone-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Acc No</th>
                    <th className="py-2.5 px-3">Book Title</th>
                    <th className="py-2.5 px-3">Borrower Details</th>
                    <th className="py-2.5 px-3">Issue Date</th>
                    <th className="py-2.5 px-3">Due Date</th>
                    <th className="py-2.5 px-3">Overdue Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {activeLoans.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-stone-400">
                        No active loans recorded. All registered books are available on the shelves.
                      </td>
                    </tr>
                  ) : (
                    activeLoans.map((l) => (
                      <tr key={l.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-stone-900">
                          {l.accession_number}
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-stone-900">{l.book_title}</p>
                          <p className="text-[10px] text-stone-500">{l.book_authors || '—'}</p>
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-stone-900">{l.borrower_name}</p>
                          <p className="text-[10px] text-stone-500 font-mono">
                            {l.borrower_identifier} · {l.borrower_details || l.borrower_type}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 text-stone-600">
                          {new Date(l.issue_date).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-stone-900">
                          {new Date(l.due_date).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-2.5 px-3">
                          {l.days_overdue > 0 ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800">
                              {l.days_overdue} days overdue
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-800">
                              Active (On Time)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 7: BORROWING & FINE SETTINGS                                          */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && canManageSettings && (
        <Card>
          <CardHeader>
            <CardTitle>Configurable Borrowing & Overdue Fine Policies</CardTitle>
            <CardDescription>
              Rules stored in database and enforced automatically during circulation. Authorized roles: Principal, Super Admin, Librarian.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {settings.map((s) => (
                <div
                  key={s.borrower_type}
                  className="bg-stone-50 border border-stone-200 rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                    <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-2">
                      {s.borrower_type === 'STUDENT' ? (
                        <GraduationCap className="w-4 h-4 text-[#4B2E2E]" />
                      ) : (
                        <Briefcase className="w-4 h-4 text-[#D4AF37]" />
                      )}
                      {s.borrower_type} Borrowing Rules
                    </h4>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-stone-500 block text-[11px] font-medium mb-1">
                        Max Active Books
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={s.max_active_books}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSettings(
                            settings.map((x) =>
                              x.borrower_type === s.borrower_type ? { ...x, max_active_books: val } : x
                            )
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white"
                      />
                    </div>

                    <div>
                      <label className="text-stone-500 block text-[11px] font-medium mb-1">
                        Loan Period (Days)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={s.loan_period_days}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSettings(
                            settings.map((x) =>
                              x.borrower_type === s.borrower_type ? { ...x, loan_period_days: val } : x
                            )
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white"
                      />
                    </div>

                    <div>
                      <label className="text-stone-500 block text-[11px] font-medium mb-1">
                        Fine Rate / Day (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={s.fine_amount_per_day}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSettings(
                            settings.map((x) =>
                              x.borrower_type === s.borrower_type ? { ...x, fine_amount_per_day: val } : x
                            )
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white"
                      />
                    </div>

                    <div>
                      <label className="text-stone-500 block text-[11px] font-medium mb-1">
                        Grace Period (Days)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={s.grace_period_days}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSettings(
                            settings.map((x) =>
                              x.borrower_type === s.borrower_type ? { ...x, grace_period_days: val } : x
                            )
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="text-stone-500 block text-[11px] font-medium mb-1">
                        Maximum Fine Cap (₹) (Optional)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={s.max_fine_amount || ''}
                        placeholder="e.g. 500"
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          setSettings(
                            settings.map((x) =>
                              x.borrower_type === s.borrower_type ? { ...x, max_fine_amount: val } : x
                            )
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSaveSetting(s.borrower_type, s)}
                      disabled={isSavingSettings}
                      className="w-full"
                    >
                      Update {s.borrower_type} Settings
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT BOOK                                                    */}
      {/* ========================================================================= */}
      {showBookModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <h3 className="text-sm font-bold text-stone-900">
                {editingBook ? `Edit Book (${editingBook.accession_number})` : 'Add New Book to Catalogue'}
              </h3>
              <button
                onClick={() => setShowBookModal(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBook} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Accession Number *" required>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingBook)}
                    value={bookFormData.accession_number || ''}
                    onChange={(e) => setBookFormData({ ...bookFormData, accession_number: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300 font-mono"
                  />
                </FormField>

                <FormField label="Accession Date">
                  <input
                    type="date"
                    value={bookFormData.accession_date || ''}
                    onChange={(e) => setBookFormData({ ...bookFormData, accession_date: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                  />
                </FormField>
              </div>

              <FormField label="Book Title *" required>
                <input
                  type="text"
                  required
                  value={bookFormData.title || ''}
                  onChange={(e) => setBookFormData({ ...bookFormData, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                />
              </FormField>

              <FormField label="Authors">
                <input
                  type="text"
                  value={bookFormData.authors || ''}
                  onChange={(e) => setBookFormData({ ...bookFormData, authors: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Edition & Year">
                  <input
                    type="text"
                    value={bookFormData.edition_year || ''}
                    onChange={(e) => setBookFormData({ ...bookFormData, edition_year: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                  />
                </FormField>

                <FormField label="Publisher & Place">
                  <input
                    type="text"
                    value={bookFormData.publisher_place || ''}
                    onChange={(e) => setBookFormData({ ...bookFormData, publisher_place: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FormField label="ISBN">
                  <input
                    type="text"
                    value={bookFormData.isbn || ''}
                    onChange={(e) => setBookFormData({ ...bookFormData, isbn: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300 font-mono"
                  />
                </FormField>

                <FormField label="Price (₹)">
                  <input
                    type="number"
                    step="0.01"
                    value={bookFormData.price ?? ''}
                    onChange={(e) => setBookFormData({ ...bookFormData, price: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                  />
                </FormField>

                <FormField label="Status">
                  <select
                    value={bookFormData.status || 'AVAILABLE'}
                    onChange={(e) => setBookFormData({ ...bookFormData, status: e.target.value as any })}
                    className="w-full px-3 py-1.5 text-xs rounded border border-stone-300 bg-white"
                  >
                    <option value="AVAILABLE">Available</option>
                    <option value="ISSUED">Issued</option>
                    <option value="LOST">Lost</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="WITHDRAWN">Withdrawn</option>
                  </select>
                </FormField>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button variant="outline" size="sm" type="button" onClick={() => setShowBookModal(false)}>
                  Cancel
                </Button>
                <Button variant="gold" size="sm" type="submit" disabled={isSavingBook} className="font-bold">
                  {isSavingBook ? 'Saving...' : 'Save Book'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EXCEL ACCESSION REGISTER IMPORT PREVIEW                            */}
      {/* ========================================================================= */}
      {showImportModal && importPreview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <div>
                <h3 className="text-sm font-bold text-stone-900">
                  Accession Register Import Preview & Validation
                </h3>
                <p className="text-xs text-stone-500">
                  Pre-import validation results. Preserves accession numbers exactly as supplied.
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Validation Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-stone-50 p-2.5 rounded border border-stone-200">
                  <span className="text-stone-500 text-[10px] block uppercase">Total Rows Read</span>
                  <span className="text-base font-bold text-stone-900">{importPreview.totalRows}</span>
                </div>
                <div className="bg-emerald-50 p-2.5 rounded border border-emerald-200">
                  <span className="text-emerald-700 text-[10px] block uppercase">Valid New Books</span>
                  <span className="text-base font-bold text-emerald-800">{importPreview.validCount}</span>
                </div>
                <div className="bg-amber-50 p-2.5 rounded border border-amber-200">
                  <span className="text-amber-700 text-[10px] block uppercase">Already in Catalogue</span>
                  <span className="text-base font-bold text-amber-800">{importPreview.alreadyInCatalogueCount}</span>
                </div>
                <div className="bg-red-50 p-2.5 rounded border border-red-200">
                  <span className="text-red-700 text-[10px] block uppercase">Issues / Duplicates</span>
                  <span className="text-base font-bold text-red-800">
                    {importPreview.duplicateInFileCount + importPreview.missingAccessionCount + importPreview.missingTitleCount}
                  </span>
                </div>
              </div>

              {/* Issues / Warnings Table */}
              {importPreview.issues?.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-red-800 uppercase tracking-wide">
                    Validation Warnings ({importPreview.issues.length})
                  </h4>
                  <div className="border border-red-200 rounded max-h-36 overflow-y-auto bg-red-50/40 divide-y divide-red-100 text-[11px]">
                    {importPreview.issues.map((iss: any, idx: number) => (
                      <div key={idx} className="p-2 flex items-center justify-between">
                        <span className="text-stone-700">
                          Row {iss.rowNumber}: {iss.reason}
                        </span>
                        <span className="font-mono text-red-700 font-bold">{iss.accessionNumber}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample Valid Records Preview */}
              {importPreview.sampleData?.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wide">
                    Sample Valid Records Ready for Import
                  </h4>
                  <div className="border border-stone-200 rounded max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase text-stone-500">
                        <tr>
                          <th className="p-2">Row</th>
                          <th className="p-2">Acc No</th>
                          <th className="p-2">Title</th>
                          <th className="p-2">Authors</th>
                          <th className="p-2">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {importPreview.sampleData.map((s: any, idx: number) => (
                          <tr key={idx} className="hover:bg-stone-50">
                            <td className="p-2 text-stone-400">{s.rowNumber}</td>
                            <td className="p-2 font-mono font-bold text-stone-800">{s.accession_number}</td>
                            <td className="p-2 font-medium text-stone-900">{s.title}</td>
                            <td className="p-2 text-stone-500">{s.authors || '—'}</td>
                            <td className="p-2 text-stone-700">{s.price ? `₹${s.price}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between p-4 border-t border-stone-200 bg-stone-50">
              <span className="text-xs text-stone-500">
                Invalid and duplicate rows will be skipped safely without data loss.
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowImportModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  onClick={handleConfirmImport}
                  disabled={isConfirmingImport || importPreview.validCount === 0}
                  className="font-bold"
                >
                  {isConfirmingImport ? 'Importing...' : `Import ${importPreview.validCount} Valid Books`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PAY FINE                                                           */}
      {/* ========================================================================= */}
      {selectedFineForPay && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <h3 className="text-sm font-bold text-stone-900">Record Offline Fine Payment</h3>
              <button
                onClick={() => setSelectedFineForPay(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePayFineSubmit} className="p-4 space-y-3 text-xs">
              <div className="bg-stone-50 p-3 rounded border border-stone-200 space-y-1">
                <p>
                  Borrower: <strong>{selectedFineForPay.borrower_name}</strong> ({selectedFineForPay.borrower_identifier})
                </p>
                <p>Book: {selectedFineForPay.book_title}</p>
                <p className="text-red-700 font-bold">
                  Outstanding Balance: ₹{Number(selectedFineForPay.outstanding_balance).toFixed(2)}
                </p>
              </div>

              <FormField label="Payment Amount (₹) *" required>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={selectedFineForPay.outstanding_balance}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300 font-bold"
                />
              </FormField>

              <FormField label="Payment Method">
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300 bg-white"
                >
                  <option value="CASH">Cash (Offline Cashier)</option>
                  <option value="UPI">UPI / QR Code</option>
                  <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                </select>
              </FormField>

              <FormField label="Receipt Reference (Optional)">
                <input
                  type="text"
                  placeholder="e.g. REC-2026-081"
                  value={payReceiptRef}
                  onChange={(e) => setPayReceiptRef(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                />
              </FormField>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button variant="outline" size="sm" type="button" onClick={() => setSelectedFineForPay(null)}>
                  Cancel
                </Button>
                <Button variant="gold" size="sm" type="submit" disabled={isPayingFine} className="font-bold">
                  {isPayingFine ? 'Saving...' : 'Record Payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: WAIVE FINE                                                         */}
      {/* ========================================================================= */}
      {selectedFineForWaive && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <h3 className="text-sm font-bold text-stone-900">Authorize Fine Waiver</h3>
              <button
                onClick={() => setSelectedFineForWaive(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleWaiveFineSubmit} className="p-4 space-y-3 text-xs">
              <div className="bg-stone-50 p-3 rounded border border-stone-200 space-y-1">
                <p>
                  Borrower: <strong>{selectedFineForWaive.borrower_name}</strong> ({selectedFineForWaive.borrower_identifier})
                </p>
                <p>Book: {selectedFineForWaive.book_title}</p>
                <p className="text-red-700 font-bold">
                  Outstanding Balance: ₹{Number(selectedFineForWaive.outstanding_balance).toFixed(2)}
                </p>
              </div>

              <FormField label="Amount to Waive (₹) (Leave empty to waive full balance)">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={selectedFineForWaive.outstanding_balance}
                  placeholder={`Max ₹${selectedFineForWaive.outstanding_balance}`}
                  value={waiveAmount}
                  onChange={(e) => setWaiveAmount(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                />
              </FormField>

              <FormField label="Administrative Reason for Waiver *" required>
                <textarea
                  required
                  rows={2}
                  placeholder="e.g. Approved medical leave extension authorized by Principal / Medical Superintendent"
                  value={waiveReason}
                  onChange={(e) => setWaiveReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded border border-stone-300"
                />
              </FormField>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button variant="outline" size="sm" type="button" onClick={() => setSelectedFineForWaive(null)}>
                  Cancel
                </Button>
                <Button variant="gold" size="sm" type="submit" disabled={isWaivingFine} className="font-bold">
                  {isWaivingFine ? 'Waiving...' : 'Authorize Waiver'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
