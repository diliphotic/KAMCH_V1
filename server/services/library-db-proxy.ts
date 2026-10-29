import { MemoryDatabase } from './memory-db.ts';
import { generateBarcodeId } from './library.service.ts';

export interface MemoryLibraryBook {
  id: number;
  accession_number: string;
  barcode_id: string;
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
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryLibrarySetting {
  id: number;
  borrower_type: 'STUDENT' | 'TEACHER';
  max_active_books: number;
  loan_period_days: number;
  fine_amount_per_day: number;
  grace_period_days: number;
  max_fine_amount: number | null;
  updated_by: number | null;
  updated_at: string;
}

export interface MemoryLibraryLoan {
  id: number;
  book_id: number;
  accession_number: string;
  borrower_type: 'STUDENT' | 'TEACHER';
  student_id: number | null;
  teacher_id: number | null;
  borrower_name: string;
  borrower_identifier: string;
  borrower_details: string | null;
  issue_date: string;
  due_date: string;
  return_date: string | null;
  status: 'ACTIVE' | 'RETURNED' | 'OVERDUE';
  issued_by: number;
  returned_by: number | null;
  is_initial_entry: boolean;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryLibraryFine {
  id: number;
  loan_id: number;
  overdue_days: number;
  assessed_fine: number;
  waived_amount: number;
  paid_amount: number;
  outstanding_balance: number;
  waiver_reason: string | null;
  waived_by: number | null;
  waived_at: string | null;
  status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED';
  calculation_details: any;
  created_at: string;
  updated_at: string;
}

export interface MemoryLibraryFinePayment {
  id: number;
  fine_id: number;
  payment_type: 'PAYMENT' | 'WAIVER';
  amount: number;
  payment_method: string;
  receipt_reference: string | null;
  reason: string | null;
  recorded_by: number;
  created_at: string;
}

/**
 * Ensures memory store has library collections initialized
 */
export function ensureLibraryMemoryStore(memDb: any) {
  if (!memDb.libraryBooks) memDb.libraryBooks = [];
  if (!memDb.librarySettings) {
    const now = new Date().toISOString();
    memDb.librarySettings = [
      {
        id: 1,
        borrower_type: 'STUDENT',
        max_active_books: 2,
        loan_period_days: 14,
        fine_amount_per_day: 2.0,
        grace_period_days: 1,
        max_fine_amount: 500.0,
        updated_by: null,
        updated_at: now,
      },
      {
        id: 2,
        borrower_type: 'TEACHER',
        max_active_books: 5,
        loan_period_days: 30,
        fine_amount_per_day: 2.0,
        grace_period_days: 1,
        max_fine_amount: 1000.0,
        updated_by: null,
        updated_at: now,
      },
    ];
  }
  if (!memDb.libraryLoans) memDb.libraryLoans = [];
  if (!memDb.libraryFines) memDb.libraryFines = [];
  if (!memDb.libraryFinePayments) memDb.libraryFinePayments = [];
}

/**
 * Handles Library SQL queries for in-memory database proxy
 */
export function handleLibraryQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const upper = sql.trim().toUpperCase();
  ensureLibraryMemoryStore(memDb);
  const m = memDb as any;

  // --------------------------------------------------------------------------
  // 1. LIBRARY SETTINGS
  // --------------------------------------------------------------------------
  if (upper.includes('FROM LIBRARY_SETTINGS')) {
    if (upper.includes('WHERE BORROWER_TYPE = ?')) {
      const bType = String(params[0]).toUpperCase();
      const setting = m.librarySettings.find((s: any) => s.borrower_type === bType);
      return [setting ? [setting] : [], []];
    }
    return [m.librarySettings, []];
  }

  if (upper.startsWith('UPDATE LIBRARY_SETTINGS')) {
    const bType = String(params[5] || params[params.length - 1]).toUpperCase();
    const setting = m.librarySettings.find((s: any) => s.borrower_type === bType);
    if (setting) {
      setting.max_active_books = Number(params[0]);
      setting.loan_period_days = Number(params[1]);
      setting.fine_amount_per_day = Number(params[2]);
      setting.grace_period_days = Number(params[3]);
      setting.max_fine_amount = params[4] !== null ? Number(params[4]) : null;
      setting.updated_by = params[params.length - 2] ? Number(params[params.length - 2]) : null;
      setting.updated_at = new Date().toISOString();
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  }

  // --------------------------------------------------------------------------
  // 2. LIBRARY BOOKS
  // --------------------------------------------------------------------------
  if (upper.includes('FROM LIBRARY_BOOKS') || upper.includes('FROM `LIBRARY_BOOKS`')) {
    if (upper.startsWith('SELECT COUNT(*)')) {
      let books = [...m.libraryBooks];
      if (upper.includes("STATUS = 'AVAILABLE'") || upper.includes('STATUS = "AVAILABLE"')) {
        books = books.filter((b: any) => b.status === 'AVAILABLE');
      } else if (upper.includes('WHERE STATUS = ?')) {
        const st = String(params[0]);
        books = books.filter((b: any) => b.status === st);
      }
      return [[{ total: books.length, cnt: books.length, total_books: books.length, count: books.length }], []];
    }

    if (
      upper.includes('ACCESSION_NUMBER = ?') ||
      upper.includes('BARCODE_ID = ?')
    ) {
      const term1 = String(params[0] || '').trim().toLowerCase();
      const term2 = String(params[1] || '').trim().toLowerCase();
      const book = m.libraryBooks.find(
        (b: any) =>
          (b.accession_number && b.accession_number.toLowerCase() === term1) ||
          (b.barcode_id && b.barcode_id.toLowerCase() === term1) ||
          (term2 && b.accession_number && b.accession_number.toLowerCase() === term2) ||
          (term2 && b.barcode_id && b.barcode_id.toLowerCase() === term2)
      );
      return [book ? [book] : [], []];
    }

    if (upper.includes('WHERE ID = ?')) {
      const id = Number(params[0]);
      const book = m.libraryBooks.find((b: any) => b.id === id);
      return [book ? [book] : [], []];
    }

    // List with search / status filter / pagination
    let books = [...m.libraryBooks];
    if (upper.includes("STATUS = 'AVAILABLE'") || upper.includes('STATUS = "AVAILABLE"')) {
      books = books.filter((b: any) => b.status === 'AVAILABLE');
    }
    if (upper.includes('LIKE ?')) {
      const q = String(params[0] || '').replace(/%/g, '').toLowerCase();
      books = books.filter(
        (b: any) =>
          (b.accession_number && b.accession_number.toLowerCase().includes(q)) ||
          (b.barcode_id && b.barcode_id.toLowerCase().includes(q)) ||
          (b.title && b.title.toLowerCase().includes(q)) ||
          (b.authors && b.authors.toLowerCase().includes(q)) ||
          (b.isbn && b.isbn.toLowerCase().includes(q)) ||
          (b.publisher_place && b.publisher_place.toLowerCase().includes(q))
      );
    }
    if (upper.includes('LIMIT ? OFFSET ?')) {
      const limitVal = Number(params[params.length - 2]);
      const offsetVal = Number(params[params.length - 1]);
      if (!isNaN(limitVal) && !isNaN(offsetVal)) {
        books = books.slice(offsetVal, offsetVal + limitVal);
      }
    } else if (upper.includes('LIMIT ?')) {
      const limitVal = Number(params[params.length - 1]);
      if (!isNaN(limitVal)) {
        books = books.slice(0, limitVal);
      }
    }
    return [books, []];
  }

  if (upper.startsWith('INSERT INTO LIBRARY_BOOKS') || upper.startsWith('INSERT INTO `LIBRARY_BOOKS`')) {
    const nextId = m.libraryBooks.length > 0 ? Math.max(...m.libraryBooks.map((b: any) => b.id)) + 1 : 1;
    const now = new Date().toISOString();
    const acc = String(params[0] || '').trim();
    const bCode = upper.includes('BARCODE_ID') && params[1] ? String(params[1]) : generateBarcodeId(acc);
    const isWithBarcode = upper.includes('BARCODE_ID');
    const offset = isWithBarcode ? 1 : 0;

    const newBook: MemoryLibraryBook = {
      id: nextId,
      accession_number: acc,
      barcode_id: bCode,
      accession_date: params[1 + offset] || null,
      title: String(params[2 + offset] || ''),
      authors: params[3 + offset] || null,
      edition_year: params[4 + offset] || null,
      publisher_place: params[5 + offset] || null,
      isbn: params[6 + offset] || null,
      pages: params[7 + offset] || null,
      binding: params[8 + offset] || null,
      source: params[9 + offset] || null,
      bill_number_date: params[10 + offset] || null,
      price: params[11 + offset] !== null && params[11 + offset] !== undefined ? Number(params[11 + offset]) : null,
      status: (params[12 + offset] as any) || 'AVAILABLE',
      remarks: params[13 + offset] || null,
      created_by: params[14 + offset] ? Number(params[14 + offset]) : null,
      created_at: now,
      updated_at: now,
    };
    m.libraryBooks.push(newBook);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  if (upper.startsWith('UPDATE LIBRARY_BOOKS') || upper.startsWith('UPDATE `LIBRARY_BOOKS`')) {
    if (upper.includes('SET STATUS = ? WHERE ID = ?')) {
      const st = params[0];
      const id = Number(params[1]);
      const book = m.libraryBooks.find((b: any) => b.id === id);
      if (book) {
        book.status = st;
        book.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
    }
    if (upper.includes('SET STATUS = ? WHERE ACCESSION_NUMBER = ?')) {
      const st = params[0];
      const acc = String(params[1]).trim().toLowerCase();
      const book = m.libraryBooks.find((b: any) => b.accession_number.toLowerCase() === acc);
      if (book) {
        book.status = st;
        book.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
    }
    // Full update
    const id = Number(params[params.length - 1]);
    const book = m.libraryBooks.find((b: any) => b.id === id);
    if (book) {
      book.title = params[0] || book.title;
      book.authors = params[1] !== undefined ? params[1] : book.authors;
      book.edition_year = params[2] !== undefined ? params[2] : book.edition_year;
      book.publisher_place = params[3] !== undefined ? params[3] : book.publisher_place;
      book.isbn = params[4] !== undefined ? params[4] : book.isbn;
      book.pages = params[5] !== undefined ? params[5] : book.pages;
      book.binding = params[6] !== undefined ? params[6] : book.binding;
      book.source = params[7] !== undefined ? params[7] : book.source;
      book.bill_number_date = params[8] !== undefined ? params[8] : book.bill_number_date;
      book.price = params[9] !== undefined ? (params[9] !== null ? Number(params[9]) : null) : book.price;
      book.status = params[10] || book.status;
      book.remarks = params[11] !== undefined ? params[11] : book.remarks;
      book.updated_at = new Date().toISOString();
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  }

  // --------------------------------------------------------------------------
  // 3. LIBRARY LOANS
  // --------------------------------------------------------------------------
  if (upper.includes('FROM LIBRARY_LOANS') || upper.includes('FROM `LIBRARY_LOANS`')) {
    if (upper.startsWith('SELECT COUNT(*)')) {
      let loans = [...m.libraryLoans];
      if (upper.includes('WHERE BOOK_ID = ? AND STATUS = ?')) {
        const bid = Number(params[0]);
        const st = String(params[1]);
        loans = loans.filter((l: any) => l.book_id === bid && l.status === st);
      } else if (upper.includes('WHERE BORROWER_TYPE = ? AND STUDENT_ID = ? AND STATUS = ?')) {
        const [bt, sid, st] = params;
        loans = loans.filter(
          (l: any) => l.borrower_type === bt && l.student_id === Number(sid) && l.status === st
        );
      } else if (upper.includes('WHERE BORROWER_TYPE = ? AND TEACHER_ID = ? AND STATUS = ?')) {
        const [bt, tid, st] = params;
        loans = loans.filter(
          (l: any) => l.borrower_type === bt && l.teacher_id === Number(tid) && l.status === st
        );
      } else if (upper.includes('WHERE STATUS = ?')) {
        const st = String(params[0]);
        loans = loans.filter((l: any) => l.status === st);
      }
      return [[{ total: loans.length, cnt: loans.length, active_count: loans.length, total_loans: loans.length }], []];
    }

    if (upper.includes('WHERE ACCESSION_NUMBER = ? AND STATUS = ?')) {
      const acc = String(params[0]).trim().toLowerCase();
      const st = String(params[1]);
      const loan = m.libraryLoans.find(
        (l: any) => l.accession_number.toLowerCase() === acc && l.status === st
      );
      return [loan ? [loan] : [], []];
    }

    if (upper.includes('WHERE BOOK_ID = ? AND STATUS = ?')) {
      const bid = Number(params[0]);
      const st = String(params[1]);
      const loan = m.libraryLoans.find((l: any) => l.book_id === bid && l.status === st);
      return [loan ? [loan] : [], []];
    }

    if (upper.includes('WHERE ID = ?')) {
      const id = Number(params[0]);
      const loan = m.libraryLoans.find((l: any) => l.id === id);
      return [loan ? [loan] : [], []];
    }

    if (upper.includes('WHERE LL.STATUS = ?') || upper.includes('WHERE STATUS = ?')) {
      const st = String(params[0]);
      const filtered = m.libraryLoans.filter((l: any) => l.status === st);
      return [filtered, []];
    }

    return [m.libraryLoans, []];
  }

  if (upper.startsWith('INSERT INTO LIBRARY_LOANS') || upper.startsWith('INSERT INTO `LIBRARY_LOANS`')) {
    const nextId = m.libraryLoans.length > 0 ? Math.max(...m.libraryLoans.map((l: any) => l.id)) + 1 : 1;
    const now = new Date().toISOString();
    const newLoan: MemoryLibraryLoan = {
      id: nextId,
      book_id: Number(params[0]),
      accession_number: String(params[1]),
      borrower_type: params[2],
      student_id: params[3] ? Number(params[3]) : null,
      teacher_id: params[4] ? Number(params[4]) : null,
      borrower_name: String(params[5]),
      borrower_identifier: String(params[6]),
      borrower_details: params[7] || null,
      issue_date: params[8] || now,
      due_date: params[9],
      return_date: params[10] || null,
      status: (params[11] as any) || 'ACTIVE',
      issued_by: Number(params[12]),
      returned_by: params[13] ? Number(params[13]) : null,
      is_initial_entry: Boolean(params[14]),
      remarks: params[15] || null,
      created_at: now,
      updated_at: now,
    };
    m.libraryLoans.push(newLoan);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  if (upper.startsWith('UPDATE LIBRARY_LOANS') || upper.startsWith('UPDATE `LIBRARY_LOANS`')) {
    const id = Number(params[params.length - 1]);
    const loan = m.libraryLoans.find((l: any) => l.id === id);
    if (loan) {
      if (upper.includes('SET STATUS = ?, RETURN_DATE = ?, RETURNED_BY = ?')) {
        loan.status = params[0];
        loan.return_date = params[1] || new Date().toISOString();
        loan.returned_by = params[2] ? Number(params[2]) : null;
        loan.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      if (upper.includes('SET STATUS = ?')) {
        loan.status = params[0];
        loan.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      loan.updated_at = new Date().toISOString();
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  }

  // --------------------------------------------------------------------------
  // 4. LIBRARY FINES
  // --------------------------------------------------------------------------
  if (upper.includes('FROM LIBRARY_FINES') || upper.includes('FROM `LIBRARY_FINES`')) {
    if (upper.startsWith('SELECT COUNT(*)')) {
      return [[{ total: m.libraryFines.length, cnt: m.libraryFines.length }], []];
    }
    if (upper.includes('WHERE LOAN_ID = ?')) {
      const lid = Number(params[0]);
      const fine = m.libraryFines.find((f: any) => f.loan_id === lid);
      return [fine ? [fine] : [], []];
    }
    if (upper.includes('WHERE ID =')) {
      let id = Number(params[0]);
      if (isNaN(id)) {
        const match = upper.match(/WHERE ID\s*=\s*(\d+)/);
        if (match) id = Number(match[1]);
      }
      const fine = m.libraryFines.find((f: any) => f.id === id);
      return [fine ? [fine] : [], []];
    }
    return [m.libraryFines, []];
  }

  if (upper.startsWith('INSERT INTO LIBRARY_FINES') || upper.startsWith('INSERT INTO `LIBRARY_FINES`')) {
    const nextId = m.libraryFines.length > 0 ? Math.max(...m.libraryFines.map((f: any) => f.id)) + 1 : 1;
    const now = new Date().toISOString();
    const isFiveParams = params.length === 5;
    const isEightParams = params.length === 8;
    const newFine: MemoryLibraryFine = {
      id: nextId,
      loan_id: Number(params[0]),
      overdue_days: Number(params[1]),
      assessed_fine: Number(params[2]),
      waived_amount: isFiveParams ? 0 : Number(params[3] || 0),
      paid_amount: isFiveParams ? 0 : Number(params[4] || 0),
      outstanding_balance: isFiveParams ? Number(params[3]) : Number(params[5] || params[2]),
      waiver_reason: isEightParams || isFiveParams ? null : (params[6] || null),
      waived_by: isEightParams || isFiveParams ? null : (params[7] ? Number(params[7]) : null),
      waived_at: isEightParams || isFiveParams ? null : (params[8] || null),
      status: isFiveParams ? 'PENDING' : ((isEightParams ? params[6] : params[9]) || 'PENDING'),
      calculation_details: isFiveParams
        ? (params[4] ? (typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4]) : null)
        : (isEightParams
          ? (params[7] ? (typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7]) : null)
          : (params[10] ? (typeof params[10] === 'string' ? JSON.parse(params[10]) : params[10]) : null)),
      created_at: now,
      updated_at: now,
    };
    m.libraryFines.push(newFine);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  if (upper.startsWith('UPDATE LIBRARY_FINES') || upper.startsWith('UPDATE `LIBRARY_FINES`')) {
    const id = Number(params[params.length - 1]);
    const fine = m.libraryFines.find((f: any) => f.id === id);
    if (fine) {
      if (upper.includes('SET PAID_AMOUNT = ?, OUTSTANDING_BALANCE = ?, STATUS = ?') || upper.includes('PAID_AMOUNT = PAID_AMOUNT + ?')) {
        fine.paid_amount = Number(params[0]);
        fine.outstanding_balance = Number(params[1]);
        fine.status = params[2];
        fine.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      if (upper.includes('UPDATE LIBRARY_FINES') && upper.includes('WAIVED_AMOUNT =')) {
        fine.waived_amount = Number(params[0]);
        fine.outstanding_balance = Number(params[1]);
        fine.waiver_reason = params[2] || fine.waiver_reason;
        fine.waived_by = params[3] ? Number(params[3]) : fine.waived_by;
        fine.waived_at = new Date().toISOString();
        fine.status = params[4] || (fine.outstanding_balance <= 0 ? 'WAIVED' : 'PARTIALLY_PAID');
        fine.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      fine.updated_at = new Date().toISOString();
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  }

  // --------------------------------------------------------------------------
  // 5. LIBRARY FINE PAYMENTS
  // --------------------------------------------------------------------------
  if (upper.includes('FROM LIBRARY_FINE_PAYMENTS') || upper.includes('FROM `LIBRARY_FINE_PAYMENTS`')) {
    if (upper.includes('WHERE FINE_ID = ?')) {
      const fid = Number(params[0]);
      const payments = m.libraryFinePayments.filter((p: any) => p.fine_id === fid);
      return [payments, []];
    }
    return [m.libraryFinePayments, []];
  }

  if (upper.startsWith('INSERT INTO LIBRARY_FINE_PAYMENTS') || upper.startsWith('INSERT INTO `LIBRARY_FINE_PAYMENTS`')) {
    const nextId =
      m.libraryFinePayments.length > 0
        ? Math.max(...m.libraryFinePayments.map((p: any) => p.id)) + 1
        : 1;
    const now = new Date().toISOString();
    const newPayment: MemoryLibraryFinePayment = {
      id: nextId,
      fine_id: Number(params[0]),
      payment_type: params[1],
      amount: Number(params[2]),
      payment_method: String(params[3] || 'CASH'),
      receipt_reference: params[4] || null,
      reason: params[5] || null,
      recorded_by: Number(params[6]),
      created_at: now,
    };
    m.libraryFinePayments.push(newPayment);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  return null;
}
