import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { ROLES, LIBRARY_WORKSPACE_ROLES } from '../permissions.ts';
import { recordAuditLog } from '../services/audit.ts';
import {
  generateCode128Svg,
  generateBarcodeId,
  parseAccessionRegister,
  calculateOverdueFine,
} from '../services/library.service.ts';

export const libraryRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// Apply auth to all library routes
libraryRouter.use(requireAuth);
libraryRouter.use(requirePasswordChangeClear);

// Roles authorized for circulation, catalogue management, and payments
const LIBRARY_OPERATOR_ROLES = [ROLES.SUPER_ADMIN, ROLES.PRINCIPAL, ROLES.LIBRARY];

// Roles authorized for policy settings changes and fine waivers
const LIBRARY_ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.PRINCIPAL, ROLES.LIBRARY];

// ============================================================================
// 1. WORKSPACE & METRICS
// ============================================================================

/**
 * GET /api/library/workspace
 * Workspace status & operator identity
 */
libraryRouter.get(
  '/workspace',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  (req: Request, res: Response) => {
    res.json({
      module: 'LIBRARY',
      status: 'active',
      operator: {
        id: req.user!.id,
        username: req.user!.username,
        fullName: req.user!.fullName,
        role: req.user!.role,
        roleName: req.user!.roleName,
      },
      canManageSettings: LIBRARY_ADMIN_ROLES.includes(req.user!.role as any),
      canWaiveFines: LIBRARY_ADMIN_ROLES.includes(req.user!.role as any),
    });
  }
);

/**
 * GET /api/library/stats
 * Real-time database metrics for dashboard & reports
 */
libraryRouter.get(
  '/stats',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (_req: Request, res: Response) => {
    const pool = getPool();
    try {
      const [bookCounts] = await pool.query<any[]>(
        `SELECT 
           COUNT(*) AS total_books,
           SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available_books,
           SUM(CASE WHEN status = 'ISSUED' THEN 1 ELSE 0 END) AS issued_books,
           SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) AS lost_books,
           SUM(CASE WHEN status = 'DAMAGED' THEN 1 ELSE 0 END) AS damaged_books
         FROM library_books`
      );

      const [loanCounts] = await pool.query<any[]>(
        `SELECT 
           COUNT(*) AS active_loans,
           SUM(CASE WHEN due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_loans
         FROM library_loans
         WHERE status = 'ACTIVE'`
      );

      const [fineCounts] = await pool.query<any[]>(
        `SELECT 
           COUNT(*) AS total_fines_count,
           COALESCE(SUM(assessed_fine), 0) AS total_assessed,
           COALESCE(SUM(paid_amount), 0) AS total_collected,
           COALESCE(SUM(waived_amount), 0) AS total_waived,
           COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
         FROM library_fines`
      );

      const stats = {
        totalBooks: Number(bookCounts[0]?.total_books || 0),
        availableBooks: Number(bookCounts[0]?.available_books || 0),
        issuedBooks: Number(bookCounts[0]?.issued_books || 0),
        lostBooks: Number(bookCounts[0]?.lost_books || 0),
        damagedBooks: Number(bookCounts[0]?.damaged_books || 0),
        activeLoans: Number(loanCounts[0]?.active_loans || 0),
        overdueLoans: Number(loanCounts[0]?.overdue_loans || 0),
        totalFinesAssessed: Number(fineCounts[0]?.total_assessed || 0),
        totalFinesCollected: Number(fineCounts[0]?.total_collected || 0),
        totalFinesWaived: Number(fineCounts[0]?.total_waived || 0),
        totalFinesOutstanding: Number(fineCounts[0]?.total_outstanding || 0),
      };

      res.json({ success: true, stats });
    } catch (err) {
      console.error('[Library] Stats error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve library statistics', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 2. BOOK CATALOGUE & EXCEL IMPORT
// ============================================================================

/**
 * GET /api/library/books
 * Search and paginated catalogue list
 */
libraryRouter.get(
  '/books',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const pool = getPool();
    const query = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10), 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10), 0);

    try {
      let sql = 'SELECT * FROM library_books';
      const params: any[] = [];
      const whereClauses: string[] = [];

      if (status && ['AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN'].includes(status)) {
        whereClauses.push('status = ?');
        params.push(status);
      }

      if (query) {
        whereClauses.push(
          '(accession_number LIKE ? OR barcode_id LIKE ? OR title LIKE ? OR authors LIKE ? OR isbn LIKE ? OR publisher_place LIKE ?)'
        );
        const searchPattern = `%${query}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
      }

      if (whereClauses.length > 0) {
        sql += ' WHERE ' + whereClauses.join(' AND ');
      }

      sql += ' ORDER BY accession_number ASC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const [rows] = await pool.query<any[]>(sql, params);

      // Total count query
      let countSql = 'SELECT COUNT(*) AS total FROM library_books';
      const countParams = params.slice(0, params.length - 2);
      if (whereClauses.length > 0) {
        countSql += ' WHERE ' + whereClauses.join(' AND ');
      }
      const [countRows] = await pool.query<any[]>(countSql, countParams);
      const total = Number(countRows[0]?.total || 0);

      res.json({
        success: true,
        books: rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + rows.length < total,
        },
      });
    } catch (err) {
      console.error('[Library] Books fetch error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve books catalogue', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/library/books/by-accession/:acc
 * Look up book by accession number or barcode ID
 */
libraryRouter.get(
  '/books/by-accession/:acc',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const acc = String(req.params.acc || '').trim();
    if (!acc) {
      res.status(400).json({ error: 'Accession number is required', code: 'MISSING_PARAM' });
      return;
    }

    const pool = getPool();
    try {
      const generatedBcode = generateBarcodeId(acc);
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM library_books WHERE accession_number = ? OR barcode_id = ? OR barcode_id = ? LIMIT 1',
        [acc, acc, generatedBcode]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: `Book with accession number '${acc}' not found`, code: 'NOT_FOUND' });
        return;
      }
      res.json({ success: true, book: rows[0] });
    } catch (err) {
      console.error('[Library] Book lookup error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to find book', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/library/books
 * Add a single book to the catalogue
 */
libraryRouter.post(
  '/books',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const {
      accessionNumber,
      accessionDate,
      title,
      authors,
      editionYear,
      publisherPlace,
      isbn,
      pages,
      binding,
      source,
      billNumberDate,
      price,
      remarks,
    } = req.body || {};

    const cleanAcc = String(accessionNumber || '').trim();
    const cleanTitle = String(title || '').trim();

    if (!cleanAcc || !cleanTitle) {
      res.status(400).json({
        error: 'Accession number and title are required.',
        code: 'MISSING_REQUIRED_FIELDS',
      });
      return;
    }

    const pool = getPool();
    try {
      // Check existing
      const [existing] = await pool.query<any[]>(
        'SELECT id FROM library_books WHERE accession_number = ? LIMIT 1',
        [cleanAcc]
      );
      if (existing && existing.length > 0) {
        res.status(409).json({
          error: `Book with accession number '${cleanAcc}' already exists in catalogue.`,
          code: 'DUPLICATE_ACCESSION_NUMBER',
        });
        return;
      }

      const numPrice = price !== undefined && price !== null && price !== '' ? parseFloat(String(price)) : null;
      const barcodeId = generateBarcodeId(cleanAcc);

      const [insertResult] = await pool.query<any>(
        `INSERT INTO library_books (
          accession_number, barcode_id, accession_date, title, authors, edition_year,
          publisher_place, isbn, pages, binding, source,
          bill_number_date, price, status, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)`,
        [
          cleanAcc,
          barcodeId,
          accessionDate || null,
          cleanTitle,
          authors ? String(authors).trim() : null,
          editionYear ? String(editionYear).trim() : null,
          publisherPlace ? String(publisherPlace).trim() : null,
          isbn ? String(isbn).trim() : null,
          pages ? String(pages).trim() : null,
          binding ? String(binding).trim() : null,
          source ? String(source).trim() : null,
          billNumberDate ? String(billNumberDate).trim() : null,
          numPrice,
          remarks ? String(remarks).trim() : null,
          req.user!.id,
        ]
      );

      const bookId = insertResult.insertId;

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_BOOK_CREATED',
        targetType: 'LIBRARY_BOOK',
        targetId: String(bookId),
        ipAddress: req.ip || null,
        details: {
          accessionNumber: cleanAcc,
          title: cleanTitle,
          authors,
          isbn,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Book created successfully.',
        bookId,
        accessionNumber: cleanAcc,
      });
    } catch (err) {
      console.error('[Library] Book creation error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create book', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/library/books/:id
 * Update catalogue record
 */
libraryRouter.put(
  '/books/:id',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Valid book ID required', code: 'INVALID_ID' });
      return;
    }

    const {
      title,
      authors,
      editionYear,
      publisherPlace,
      isbn,
      pages,
      binding,
      source,
      billNumberDate,
      price,
      status,
      remarks,
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Title cannot be empty', code: 'INVALID_TITLE' });
      return;
    }

    const pool = getPool();
    try {
      const [existing] = await pool.query<any[]>(
        'SELECT * FROM library_books WHERE id = ? LIMIT 1',
        [id]
      );
      if (!existing || existing.length === 0) {
        res.status(404).json({ error: 'Book record not found', code: 'NOT_FOUND' });
        return;
      }
      const book = existing[0];

      const numPrice = price !== undefined && price !== null && price !== '' ? parseFloat(String(price)) : null;
      const cleanStatus = status ? String(status).toUpperCase() : book.status;

      await pool.query(
        `UPDATE library_books SET
           title = ?, authors = ?, edition_year = ?, publisher_place = ?,
           isbn = ?, pages = ?, binding = ?, source = ?,
           bill_number_date = ?, price = ?, status = ?, remarks = ?
         WHERE id = ?`,
        [
          cleanTitle,
          authors !== undefined ? (authors ? String(authors).trim() : null) : book.authors,
          editionYear !== undefined ? (editionYear ? String(editionYear).trim() : null) : book.edition_year,
          publisherPlace !== undefined ? (publisherPlace ? String(publisherPlace).trim() : null) : book.publisher_place,
          isbn !== undefined ? (isbn ? String(isbn).trim() : null) : book.isbn,
          pages !== undefined ? (pages ? String(pages).trim() : null) : book.pages,
          binding !== undefined ? (binding ? String(binding).trim() : null) : book.binding,
          source !== undefined ? (source ? String(source).trim() : null) : book.source,
          billNumberDate !== undefined ? (billNumberDate ? String(billNumberDate).trim() : null) : book.bill_number_date,
          numPrice !== null ? numPrice : book.price,
          cleanStatus,
          remarks !== undefined ? (remarks ? String(remarks).trim() : null) : book.remarks,
          id,
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_BOOK_UPDATED',
        targetType: 'LIBRARY_BOOK',
        targetId: String(id),
        ipAddress: req.ip || null,
        details: {
          bookId: id,
          accessionNumber: book.accession_number,
          before: {
            title: book.title,
            authors: book.authors,
            status: book.status,
          },
          after: {
            title: cleanTitle,
            authors,
            status: cleanStatus,
          },
        },
      });

      res.json({ success: true, message: 'Book record updated successfully.' });
    } catch (err) {
      console.error('[Library] Book update error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update book', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/library/books/import-preview
 * Parse uploaded Excel/CSV file, validate fields, check for duplicates, return preview
 */
libraryRouter.post(
  '/books/import-preview',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  upload.single('file'),
  async (req: Request, res: Response) => {
    let fileBuffer: Buffer | null = null;
    if (req.file && req.file.buffer) {
      fileBuffer = req.file.buffer;
    } else if (req.body?.base64Data && typeof req.body.base64Data === 'string') {
      const cleanBase64 = req.body.base64Data.replace(/^data:.*?;base64,/, '');
      fileBuffer = Buffer.from(cleanBase64, 'base64');
    }

    if (!fileBuffer) {
      res.status(400).json({
        error: 'Missing file payload. Please upload an Excel or CSV file.',
        code: 'MISSING_PAYLOAD',
      });
      return;
    }

    try {
      const pool = getPool();
      const [existingRows] = await pool.query<any[]>('SELECT accession_number FROM library_books');
      const existingAccSet = new Set<string>();
      for (const r of existingRows || []) {
        if (r.accession_number) {
          existingAccSet.add(String(r.accession_number).trim().toLowerCase());
        }
      }

      const preview = await parseAccessionRegister(fileBuffer, existingAccSet);

      res.json({
        success: true,
        preview: {
          totalRows: preview.totalRows,
          validCount: preview.validCount,
          duplicateInFileCount: preview.duplicateInFileCount,
          alreadyInCatalogueCount: preview.alreadyInCatalogueCount,
          missingAccessionCount: preview.missingAccessionCount,
          missingTitleCount: preview.missingTitleCount,
          issues: preview.issues,
          sampleData: preview.sampleData,
          validBooks: preview.validBooks,
        },
      });
    } catch (err) {
      console.error('[Library] Import preview error:', (err as Error).message);
      res.status(400).json({
        error: `Failed to parse workbook: ${(err as Error).message}`,
        code: 'PARSE_ERROR',
      });
    }
  }
);

/**
 * POST /api/library/books/import-confirm
 * Batch insert validated books transactionally in chunks
 */
libraryRouter.post(
  '/books/import-confirm',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const { books } = req.body || {};
    if (!Array.isArray(books) || books.length === 0) {
      res.status(400).json({
        error: 'No validated books provided for import.',
        code: 'EMPTY_IMPORT_LIST',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      let importedCount = 0;
      let skippedCount = 0;

      // Fetch all existing accession numbers in bulk to make duplicate checks O(1)
      const [allExisting] = await connection.query<any[]>(
        'SELECT accession_number FROM library_books'
      );
      const existingAccSet = new Set<string>();
      for (const r of allExisting || []) {
        if (r.accession_number) {
          existingAccSet.add(String(r.accession_number).trim().toLowerCase());
        }
      }

      // Process insertion in efficient chunks of 500 records
      const CHUNK_SIZE = 500;
      for (let i = 0; i < books.length; i += CHUNK_SIZE) {
        const chunk = books.slice(i, i + CHUNK_SIZE);

        for (const b of chunk) {
          const acc = String(b.accession_number || '').trim();
          const title = String(b.title || '').trim();
          if (!acc || !title) {
            skippedCount++;
            continue;
          }

          const accLower = acc.toLowerCase();
          if (existingAccSet.has(accLower)) {
            skippedCount++;
            continue;
          }

          const priceNum =
            b.price !== null && b.price !== undefined && b.price !== ''
              ? parseFloat(String(b.price))
              : null;
          const barcodeId = b.barcode_id || generateBarcodeId(acc);

          await connection.query(
            `INSERT INTO library_books (
               accession_number, barcode_id, accession_date, title, authors, edition_year,
               publisher_place, isbn, pages, binding, source,
               bill_number_date, price, status, remarks, created_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)`,
            [
              acc,
              barcodeId,
              b.accession_date || null,
              title,
              b.authors || null,
              b.edition_year || null,
              b.publisher_place || null,
              b.isbn || null,
              b.pages || null,
              b.binding || null,
              b.source || null,
              b.bill_number_date || null,
              priceNum,
              b.remarks || null,
              req.user!.id,
            ]
          );

          existingAccSet.add(accLower);
          importedCount++;
        }
      }

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_CATALOGUE_IMPORTED',
        targetType: 'LIBRARY_CATALOGUE',
        targetId: `BATCH_${Date.now()}`,
        ipAddress: req.ip || null,
        details: {
          importedCount,
          skippedCount,
          totalProvided: books.length,
        },
      });

      res.json({
        success: true,
        message: `Successfully imported ${importedCount} book(s) into the catalogue (${skippedCount} skipped).`,
        importedCount,
        skippedCount,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[Library] Import confirm error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to import catalogue batch', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

// ============================================================================
// 3. BARCODE LABELS & PRINTING
// ============================================================================

/**
 * GET /api/library/barcode/:acc
 * Returns single Code 128 SVG barcode
 */
libraryRouter.get(
  '/barcode/:acc',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  (req: Request, res: Response) => {
    const acc = String(req.params.acc || '').trim();
    if (!acc) {
      res.status(400).json({ error: 'Accession number is required', code: 'MISSING_PARAM' });
      return;
    }

    const barcodeId = generateBarcodeId(acc);
    const rawAcc = acc.replace(/^KAMCH-L-0*/i, '') || acc;

    const svg = generateCode128Svg(barcodeId, {
      height: 48,
      moduleWidth: 2,
      showText: true,
      title: 'KAMCH CENTRAL LIBRARY',
      accessionNumber: rawAcc,
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  }
);

/**
 * POST /api/library/barcodes/batch
 * Bulk label generation for selected or all books
 */
libraryRouter.post(
  '/barcodes/batch',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const { accessionNumbers, allAvailable, allBooks, offset, limit, testPrint } = req.body || {};

    const pool = getPool();
    let booksToPrint: { accessionNumber: string; barcodeId: string; title: string; authors: string | null }[] = [];
    let totalCount = 0;

    const chunkOffset = Math.max(parseInt(String(offset || '0'), 10), 0);
    const chunkLimit = Math.min(Math.max(parseInt(String(limit || '1000'), 10), 1), 2000);

    if (testPrint) {
      booksToPrint = [
        { accessionNumber: '1', barcodeId: 'KAMCH-L-00001', title: 'Ayurvedic Samhita Volume 1', authors: 'Charaka' },
        { accessionNumber: '34', barcodeId: 'KAMCH-L-00034', title: 'Sushruta Samhita Vol II', authors: 'Sushruta' },
        { accessionNumber: '395', barcodeId: 'KAMCH-L-00395', title: 'Ashtanga Hridaya Study Guide', authors: 'Vagbhata' },
        { accessionNumber: '11256', barcodeId: 'KAMCH-L-11256', title: 'Modern Anatomy & Ayurvedic Correlation', authors: 'Dr. K. Sharma' },
      ];
      totalCount = booksToPrint.length;
    } else if (allAvailable || allBooks) {
      const statusWhere = allBooks ? '' : "WHERE status = 'AVAILABLE'";

      const [countRows] = await pool.query<any[]>(
        `SELECT COUNT(*) AS total FROM library_books ${statusWhere}`
      );
      totalCount = Number(countRows[0]?.total || 0);

      const [rows] = await pool.query<any[]>(
        `SELECT accession_number, barcode_id, title, authors FROM library_books ${statusWhere} ORDER BY accession_number ASC LIMIT ? OFFSET ?`,
        [chunkLimit, chunkOffset]
      );
      booksToPrint = (rows || []).map((r) => ({
        accessionNumber: String(r.accession_number),
        barcodeId: r.barcode_id || generateBarcodeId(String(r.accession_number)),
        title: r.title,
        authors: r.authors || null,
      }));
    } else if (Array.isArray(accessionNumbers) && accessionNumbers.length > 0) {
      const inputList = accessionNumbers.map((s) => String(s).trim()).filter(Boolean);
      const uniqueInputs = Array.from(new Set(inputList));
      totalCount = uniqueInputs.length;

      const slicedInputs = limit !== undefined || offset !== undefined
        ? uniqueInputs.slice(chunkOffset, chunkOffset + chunkLimit)
        : uniqueInputs;

      if (slicedInputs.length > 0) {
        const [bookRows] = await pool.query<any[]>(
          'SELECT accession_number, barcode_id, title, authors FROM library_books'
        );
        const bookMap = new Map<string, { accessionNumber: string; barcodeId: string; title: string; authors: string | null }>();
        for (const b of bookRows || []) {
          const accStr = String(b.accession_number).trim();
          const bcodeStr = b.barcode_id || generateBarcodeId(accStr);
          const obj = {
            accessionNumber: accStr,
            barcodeId: bcodeStr,
            title: b.title,
            authors: b.authors || null,
          };
          bookMap.set(accStr.toLowerCase(), obj);
          bookMap.set(bcodeStr.toLowerCase(), obj);
        }

        for (const inp of slicedInputs) {
          const found = bookMap.get(inp.toLowerCase());
          if (found) {
            booksToPrint.push(found);
          } else {
            const rawAcc = inp.replace(/^KAMCH-L-0*/i, '') || inp;
            booksToPrint.push({
              accessionNumber: rawAcc,
              barcodeId: generateBarcodeId(rawAcc),
              title: 'Krishna Ayurvedic Medical College',
              authors: null,
            });
          }
        }
      }
    }

    if (totalCount === 0 && booksToPrint.length === 0) {
      res.status(400).json({ error: 'No valid books found for barcode label generation', code: 'EMPTY_LIST' });
      return;
    }

    const labels = booksToPrint.map((b) => {
      const svg = generateCode128Svg(b.barcodeId, {
        height: 44,
        moduleWidth: 2,
        showText: true,
        title: 'KAMCH CENTRAL LIBRARY',
        accessionNumber: b.accessionNumber,
      });
      return {
        accessionNumber: b.accessionNumber,
        barcodeId: b.barcodeId,
        title: b.title || 'Krishna Ayurvedic Medical College',
        authors: b.authors || null,
        svg,
      };
    });

    res.json({
      success: true,
      totalCount,
      offset: chunkOffset,
      limit: chunkLimit,
      count: labels.length,
      hasMore: chunkOffset + labels.length < totalCount,
      labels,
    });
  }
);

// ============================================================================
// 4. BORROWER LOOKUP & VERIFICATION
// ============================================================================

/**
 * GET /api/library/borrowers/search
 * Search students and teachers by register number, staff ID, or name
 */
libraryRouter.get(
  '/borrowers/search',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    if (!query || query.length < 2) {
      res.json({ success: true, borrowers: [] });
      return;
    }

    const pool = getPool();
    try {
      const searchPattern = `%${query}%`;

      // 1. Search Students
      const [studentRows] = await pool.query<any[]>(
        `SELECT s.id, s.full_name, s.student_id_number, s.temporary_roll_number,
                s.permanent_university_number, s.admission_year, s.current_year_of_study,
                b.name AS batch_name
         FROM students s
         LEFT JOIN academic_batches b ON s.current_placement_batch_id = b.id
         WHERE s.permanent_university_number LIKE ?
            OR s.student_id_number LIKE ?
            OR s.temporary_roll_number LIKE ?
            OR s.full_name LIKE ?
         LIMIT 15`,
        [searchPattern, searchPattern, searchPattern, searchPattern]
      );

      // 2. Search Teachers
      const [teacherRows] = await pool.query<any[]>(
        `SELECT t.id, t.full_name, t.employee_code, t.designation,
                d.name AS department_name
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         WHERE t.employee_code LIKE ?
            OR t.full_name LIKE ?
         LIMIT 15`,
        [searchPattern, searchPattern]
      );

      // 3. Fetch Settings for loan limits
      const [settingsRows] = await pool.query<any[]>('SELECT * FROM library_settings');
      const studentSettings = settingsRows.find((s: any) => s.borrower_type === 'STUDENT') || {
        max_active_books: 2,
        loan_period_days: 14,
      };
      const teacherSettings = settingsRows.find((s: any) => s.borrower_type === 'TEACHER') || {
        max_active_books: 5,
        loan_period_days: 30,
      };

      // 4. Check active loans for found borrowers
      const results: any[] = [];

      for (const s of studentRows || []) {
        const [loans] = await pool.query<any[]>(
          `SELECT COUNT(*) AS active_count FROM library_loans
           WHERE borrower_type = 'STUDENT' AND student_id = ? AND status = 'ACTIVE'`,
          [s.id]
        );
        const activeCount = Number(loans[0]?.active_count || 0);
        results.push({
          borrowerType: 'STUDENT',
          id: s.id,
          fullName: s.full_name,
          identifier: s.permanent_university_number || s.temporary_roll_number || s.student_id_number,
          registerNumber: s.permanent_university_number || null,
          studentIdNumber: s.student_id_number,
          temporaryRollNumber: s.temporary_roll_number || null,
          details: s.batch_name ? `${s.batch_name} (Prof Year ${s.current_year_of_study})` : `Year ${s.current_year_of_study}`,
          activeLoansCount: activeCount,
          maxAllowedBooks: studentSettings.max_active_books,
          loanPeriodDays: studentSettings.loan_period_days,
          canBorrow: activeCount < studentSettings.max_active_books,
        });
      }

      for (const t of teacherRows || []) {
        const [loans] = await pool.query<any[]>(
          `SELECT COUNT(*) AS active_count FROM library_loans
           WHERE borrower_type = 'TEACHER' AND teacher_id = ? AND status = 'ACTIVE'`,
          [t.id]
        );
        const activeCount = Number(loans[0]?.active_count || 0);
        results.push({
          borrowerType: 'TEACHER',
          id: t.id,
          fullName: t.full_name,
          identifier: t.employee_code,
          designation: t.designation,
          details: t.department_name ? `${t.designation} — ${t.department_name}` : t.designation,
          activeLoansCount: activeCount,
          maxAllowedBooks: teacherSettings.max_active_books,
          loanPeriodDays: teacherSettings.loan_period_days,
          canBorrow: activeCount < teacherSettings.max_active_books,
        });
      }

      res.json({ success: true, borrowers: results });
    } catch (err) {
      console.error('[Library] Borrower search error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to search borrowers', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 5. CIRCULATION: ISSUE & RETURN WORKFLOWS
// ============================================================================

/**
 * POST /api/library/issue
 * Issue book to student or teacher
 */
libraryRouter.post(
  '/issue',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const { borrowerType, borrowerId, borrowerIdentifier: reqBorrowerIdentifier, accessionNumber, customDueDate, remarks } = req.body || {};

    const cleanType = String(borrowerType || '').toUpperCase();
    const cleanAcc = String(accessionNumber || '').trim();
    const parsedBorrowerId = parseInt(String(borrowerId), 10);
    const cleanReqIdentifier = reqBorrowerIdentifier ? String(reqBorrowerIdentifier).trim() : '';

    if (!cleanAcc || !parsedBorrowerId || !['STUDENT', 'TEACHER'].includes(cleanType)) {
      res.status(400).json({
        error: 'Valid borrower type, borrower ID, and book accession number are required.',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Verify book availability with row-level lock (supports accession number or barcode ID)
      const generatedBcode = generateBarcodeId(cleanAcc);
      const [bookRows] = await connection.query<any[]>(
        'SELECT * FROM library_books WHERE accession_number = ? OR barcode_id = ? OR barcode_id = ? LIMIT 1 FOR UPDATE',
        [cleanAcc, cleanAcc, generatedBcode]
      );
      if (!bookRows || bookRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: `Book '${cleanAcc}' does not exist in catalogue.`, code: 'BOOK_NOT_FOUND' });
        return;
      }
      const book = bookRows[0];
      const actualAccNumber = book.accession_number;

      if (book.status !== 'AVAILABLE') {
        await connection.rollback();
        res.status(400).json({
          error: `Book '${cleanAcc}' is not available for issue (Current status: ${book.status}).`,
          code: 'BOOK_UNAVAILABLE',
        });
        return;
      }

      // 2. Prevent duplicate active loan on the book
      const [activeBookLoans] = await connection.query<any[]>(
        `SELECT id FROM library_loans WHERE book_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [book.id]
      );
      if (activeBookLoans && activeBookLoans.length > 0) {
        await connection.rollback();
        res.status(400).json({
          error: `Book '${cleanAcc}' already has an active issue record.`,
          code: 'ALREADY_ISSUED',
        });
        return;
      }

      // 3. Fetch borrower and settings
      let borrowerName = '';
      let borrowerIdentifier = '';
      let borrowerDetails = '';

      if (cleanType === 'STUDENT') {
        const [stRows] = await connection.query<any[]>(
          `SELECT s.id, s.full_name, s.student_id_number, s.permanent_university_number,
                  s.temporary_roll_number, b.name AS batch_name
           FROM students s
           LEFT JOIN academic_batches b ON s.current_placement_batch_id = b.id
           WHERE s.id = ? LIMIT 1`,
          [parsedBorrowerId]
        );
        if (!stRows || stRows.length === 0) {
          await connection.rollback();
          res.status(404).json({ error: 'Student record not found.', code: 'BORROWER_NOT_FOUND' });
          return;
        }
        const st = stRows[0];
        borrowerName = st.full_name;
        borrowerIdentifier =
          st.permanent_university_number ||
          st.temporary_roll_number ||
          st.student_id_number ||
          cleanReqIdentifier ||
          (st.id ? `STU-${st.id}` : '');
        borrowerDetails = st.batch_name || 'Student';
      } else {
        const [tchRows] = await connection.query<any[]>(
          `SELECT t.id, t.full_name, t.employee_code, t.teacher_code, t.registration_number, d.name AS department_name
           FROM teachers t
           LEFT JOIN departments d ON t.department_id = d.id
           WHERE t.id = ? LIMIT 1`,
          [parsedBorrowerId]
        );
        if (!tchRows || tchRows.length === 0) {
          await connection.rollback();
          res.status(404).json({ error: 'Teacher record not found.', code: 'BORROWER_NOT_FOUND' });
          return;
        }
        const tch = tchRows[0];
        borrowerName = tch.full_name;
        borrowerIdentifier =
          tch.employee_code ||
          tch.teacher_code ||
          tch.registration_number ||
          cleanReqIdentifier ||
          (tch.id ? `EMP-${tch.id}` : '');
        borrowerDetails = tch.department_name ? `${tch.designation} (${tch.department_name})` : tch.designation;
      }

      // Explicit Server-Side Validation: Ensure borrowerIdentifier is NOT NULL or empty before SQL insert
      if (!borrowerIdentifier || !borrowerIdentifier.trim()) {
        await connection.rollback();
        res.status(400).json({
          error: `Selected ${cleanType.toLowerCase()} '${borrowerName}' does not have a valid university register number or staff code in the database.`,
          code: 'MISSING_BORROWER_IDENTIFIER',
        });
        return;
      }

      // 4. Enforce borrowing limits using active loans (Section 6, 7)
      const [settingRows] = await connection.query<any[]>(
        'SELECT * FROM library_settings WHERE borrower_type = ? LIMIT 1',
        [cleanType]
      );
      const settings = settingRows[0] || {
        max_active_books: cleanType === 'STUDENT' ? 2 : 5,
        loan_period_days: cleanType === 'STUDENT' ? 14 : 30,
      };

      const borrowerCol = cleanType === 'STUDENT' ? 'student_id' : 'teacher_id';
      const [activeBorrowerLoans] = await connection.query<any[]>(
        `SELECT COUNT(*) AS active_count FROM library_loans
         WHERE borrower_type = ? AND ${borrowerCol} = ? AND status = 'ACTIVE'`,
        [cleanType, parsedBorrowerId]
      );
      const activeCount = Number(activeBorrowerLoans[0]?.active_count || 0);

      if (activeCount >= settings.max_active_books) {
        await connection.rollback();
        res.status(400).json({
          error: `Borrowing limit reached: ${cleanType === 'STUDENT' ? 'Student' : 'Teacher'} '${borrowerName}' already has ${activeCount} active book loan(s) (Maximum allowed: ${settings.max_active_books}).`,
          code: 'BORROWING_LIMIT_EXCEEDED',
        });
        return;
      }

      // 5. Calculate due date
      const issueDate = new Date();
      let dueDate: Date;
      if (customDueDate) {
        dueDate = new Date(customDueDate);
      } else {
        dueDate = new Date(issueDate.getTime() + settings.loan_period_days * 24 * 60 * 60 * 1000);
      }
      const dueDateStr = dueDate.toISOString().split('T')[0];
      const issueDateStr = issueDate.toISOString().replace('T', ' ').substring(0, 19);

      // 6. Update book status to ISSUED
      await connection.query(
        `UPDATE library_books SET status = 'ISSUED' WHERE id = ?`,
        [book.id]
      );

      // 7. Insert loan record
      const [loanInsert] = await connection.query<any>(
        `INSERT INTO library_loans (
           book_id, accession_number, borrower_type, student_id, teacher_id,
           borrower_name, borrower_identifier, borrower_details,
           issue_date, due_date, status, issued_by, is_initial_entry, remarks
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, FALSE, ?)`,
        [
          book.id,
          actualAccNumber,
          cleanType,
          cleanType === 'STUDENT' ? parsedBorrowerId : null,
          cleanType === 'TEACHER' ? parsedBorrowerId : null,
          borrowerName,
          borrowerIdentifier,
          borrowerDetails,
          issueDateStr,
          dueDateStr,
          req.user!.id,
          remarks ? String(remarks).trim() : null,
        ]
      );

      const loanId = loanInsert.insertId;

      await connection.commit();

      // Audit log
      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_BOOK_ISSUED',
        targetType: 'LIBRARY_LOAN',
        targetId: String(loanId),
        ipAddress: req.ip || null,
        details: {
          loanId,
          bookId: book.id,
          accessionNumber: cleanAcc,
          bookTitle: book.title,
          borrowerType: cleanType,
          borrowerName,
          borrowerIdentifier,
          dueDate: dueDateStr,
        },
      });

      res.status(201).json({
        success: true,
        message: `Book '${cleanAcc}' successfully issued to ${borrowerName}.`,
        loan: {
          id: loanId,
          accessionNumber: cleanAcc,
          bookTitle: book.title,
          borrowerName,
          borrowerIdentifier,
          dueDate: dueDateStr,
          remainingBorrowingCapacity: settings.max_active_books - (activeCount + 1),
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[Library] Issue error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to issue book', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/library/return
 * Return book by accession number, calculate fines if overdue
 */
libraryRouter.post(
  '/return',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const { accessionNumber, remarks } = req.body || {};
    const cleanAcc = String(accessionNumber || '').trim();

    if (!cleanAcc) {
      res.status(400).json({ error: 'Accession number is required', code: 'MISSING_PARAM' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Find active loan for accession number or barcode ID
      const generatedBcode = generateBarcodeId(cleanAcc);
      const [loanRows] = await connection.query<any[]>(
        `SELECT l.*, b.title AS book_title, b.accession_number AS book_accession
         FROM library_loans l
         JOIN library_books b ON l.book_id = b.id
         WHERE (l.accession_number = ? OR b.barcode_id = ? OR b.barcode_id = ?) AND l.status = 'ACTIVE'
         LIMIT 1 FOR UPDATE`,
        [cleanAcc, cleanAcc, generatedBcode]
      );

      if (!loanRows || loanRows.length === 0) {
        await connection.rollback();
        res.status(404).json({
          error: `No active loan found for accession number '${cleanAcc}'.`,
          code: 'NO_ACTIVE_LOAN',
        });
        return;
      }
      const loan = loanRows[0];

      // 2. Fetch applicable fine settings
      const [settingRows] = await connection.query<any[]>(
        'SELECT * FROM library_settings WHERE borrower_type = ? LIMIT 1',
        [loan.borrower_type]
      );
      const settings = settingRows[0] || {
        fine_amount_per_day: 2.0,
        grace_period_days: 1,
        max_fine_amount: 500.0,
      };

      // 3. Calculate overdue fine
      const returnDate = new Date();
      const returnDateStr = returnDate.toISOString().replace('T', ' ').substring(0, 19);
      const dueDateStr = loan.due_date instanceof Date ? loan.due_date.toISOString().split('T')[0] : String(loan.due_date).split('T')[0];

      const fineCalc = calculateOverdueFine(dueDateStr, returnDate.toISOString().split('T')[0], settings);

      // 4. Update loan status to RETURNED
      await connection.query(
        `UPDATE library_loans SET status = 'RETURNED', return_date = ?, returned_by = ?, remarks = ? WHERE id = ?`,
        [returnDateStr, req.user!.id, remarks ? String(remarks).trim() : loan.remarks, loan.id]
      );

      // 5. Update book status to AVAILABLE
      await connection.query(
        `UPDATE library_books SET status = 'AVAILABLE' WHERE id = ?`,
        [loan.book_id]
      );

      // 6. Record fine if assessed
      let fineId: number | null = null;
      if (fineCalc.assessedFine > 0) {
        const [fineInsert] = await connection.query<any>(
          `INSERT INTO library_fines (
             loan_id, overdue_days, assessed_fine, waived_amount, paid_amount,
             outstanding_balance, status, calculation_details
           ) VALUES (?, ?, ?, 0.00, 0.00, ?, 'PENDING', ?)`,
          [
            loan.id,
            fineCalc.overdueDays,
            fineCalc.assessedFine,
            fineCalc.assessedFine,
            JSON.stringify(fineCalc.details),
          ]
        );
        fineId = fineInsert.insertId;
      }

      await connection.commit();

      // Audit log
      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_BOOK_RETURNED',
        targetType: 'LIBRARY_LOAN',
        targetId: String(loan.id),
        ipAddress: req.ip || null,
        details: {
          loanId: loan.id,
          accessionNumber: cleanAcc,
          bookTitle: loan.book_title,
          borrowerName: loan.borrower_name,
          dueDate: dueDateStr,
          returnDate: returnDateStr,
          overdueDays: fineCalc.overdueDays,
          assessedFine: fineCalc.assessedFine,
          fineId,
        },
      });

      res.json({
        success: true,
        message: `Book '${cleanAcc}' successfully returned by ${loan.borrower_name}.`,
        returnSummary: {
          loanId: loan.id,
          accessionNumber: cleanAcc,
          bookTitle: loan.book_title,
          borrowerName: loan.borrower_name,
          borrowerIdentifier: loan.borrower_identifier,
          dueDate: dueDateStr,
          returnDate: returnDateStr,
          overdueDays: fineCalc.overdueDays,
          fineableDays: fineCalc.fineableDays,
          assessedFine: fineCalc.assessedFine,
          fineId,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[Library] Return error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to return book', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/library/initial-loan-entry
 * Controlled initial entry of outstanding loans from the physical handwritten register
 */
libraryRouter.post(
  '/initial-loan-entry',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const {
      accessionNumber,
      borrowerType,
      borrowerName,
      borrowerIdentifier,
      borrowerDetails,
      issueDate,
      dueDate,
      remarks,
    } = req.body || {};

    const cleanAcc = String(accessionNumber || '').trim();
    const cleanType = String(borrowerType || 'STUDENT').toUpperCase();
    const cleanName = String(borrowerName || '').trim();
    const cleanIdentifier = String(borrowerIdentifier || '').trim();

    if (!cleanAcc || !cleanName || !cleanIdentifier || !dueDate) {
      res.status(400).json({
        error: 'Accession number, borrower name, identifier, and due date are required.',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Find book
      const [bookRows] = await connection.query<any[]>(
        'SELECT id, title, status FROM library_books WHERE accession_number = ? LIMIT 1 FOR UPDATE',
        [cleanAcc]
      );
      if (!bookRows || bookRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: `Book '${cleanAcc}' not found in catalogue.`, code: 'BOOK_NOT_FOUND' });
        return;
      }
      const book = bookRows[0];

      // Update book status to ISSUED
      await connection.query('UPDATE library_books SET status = \'ISSUED\' WHERE id = ?', [book.id]);

      const issueDateStr = issueDate ? String(issueDate) : new Date().toISOString().split('T')[0];
      const dueDateStr = String(dueDate).split('T')[0];

      // Insert loan record marked as initial entry
      const [insertRes] = await connection.query<any>(
        `INSERT INTO library_loans (
           book_id, accession_number, borrower_type, student_id, teacher_id,
           borrower_name, borrower_identifier, borrower_details,
           issue_date, due_date, status, issued_by, is_initial_entry, remarks
         ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'ACTIVE', ?, TRUE, ?)`,
        [
          book.id,
          cleanAcc,
          cleanType,
          cleanName,
          cleanIdentifier,
          borrowerDetails ? String(borrowerDetails).trim() : null,
          issueDateStr,
          dueDateStr,
          req.user!.id,
          remarks ? `[Handwritten Register Entry] ${String(remarks).trim()}` : '[Handwritten Register Outstanding Loan]',
        ]
      );

      const loanId = insertRes.insertId;

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_INITIAL_LOAN_ENTERED',
        targetType: 'LIBRARY_LOAN',
        targetId: String(loanId),
        ipAddress: req.ip || null,
        details: {
          loanId,
          accessionNumber: cleanAcc,
          borrowerName: cleanName,
          borrowerIdentifier: cleanIdentifier,
          dueDate: dueDateStr,
        },
      });

      res.status(201).json({
        success: true,
        message: `Outstanding physical loan for book '${cleanAcc}' recorded successfully.`,
        loanId,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[Library] Initial loan error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to record initial loan', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * GET /api/library/loans/active
 * List all active loans with borrower details
 */
libraryRouter.get(
  '/loans/active',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const pool = getPool();
    const query = String(req.query.q || '').trim();

    try {
      let sql = `
        SELECT l.*, b.title AS book_title, b.authors AS book_authors,
               DATEDIFF(CURDATE(), l.due_date) AS days_overdue
        FROM library_loans l
        JOIN library_books b ON l.book_id = b.id
        WHERE l.status = 'ACTIVE'
      `;
      const params: any[] = [];

      if (query) {
        sql += ` AND (l.accession_number LIKE ? OR l.borrower_name LIKE ? OR l.borrower_identifier LIKE ? OR b.title LIKE ?)`;
        const pattern = `%${query}%`;
        params.push(pattern, pattern, pattern, pattern);
      }

      sql += ' ORDER BY l.due_date ASC';

      const [rows] = await pool.query<any[]>(sql, params);
      res.json({ success: true, activeLoans: rows });
    } catch (err) {
      console.error('[Library] Active loans error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve active loans', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/library/loans/history
 * List historical loans
 */
libraryRouter.get(
  '/loans/history',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const pool = getPool();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10), 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10), 0);

    try {
      const [rows] = await pool.query<any[]>(
        `SELECT l.*, b.title AS book_title, f.assessed_fine, f.paid_amount, f.waived_amount, f.status AS fine_status
         FROM library_loans l
         JOIN library_books b ON l.book_id = b.id
         LEFT JOIN library_fines f ON f.loan_id = l.id
         ORDER BY l.id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      res.json({ success: true, history: rows });
    } catch (err) {
      console.error('[Library] Loan history error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve loan history', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 6. FINE MANAGEMENT & PAYMENTS
// ============================================================================

/**
 * GET /api/library/fines
 * List fines with borrower and loan details
 */
libraryRouter.get(
  '/fines',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const pool = getPool();
    const status = String(req.query.status || '').trim().toUpperCase();

    try {
      let sql = `
        SELECT f.*, l.accession_number, l.borrower_name, l.borrower_identifier,
               l.borrower_type, l.due_date, l.return_date, b.title AS book_title,
               u.full_name AS waived_by_name
        FROM library_fines f
        JOIN library_loans l ON f.loan_id = l.id
        JOIN library_books b ON l.book_id = b.id
        LEFT JOIN users u ON f.waived_by = u.id
      `;
      const params: any[] = [];

      if (status && ['PENDING', 'PARTIALLY_PAID', 'PAID', 'WAIVED'].includes(status)) {
        sql += ' WHERE f.status = ?';
        params.push(status);
      }

      sql += ' ORDER BY f.id DESC LIMIT 100';

      const [rows] = await pool.query<any[]>(sql, params);
      res.json({ success: true, fines: rows });
    } catch (err) {
      console.error('[Library] Fines fetch error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve fines', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/library/fines/:id/payments
 * Get payment and waiver history for a fine record (Receipt details)
 */
libraryRouter.get(
  '/fines/:id/payments',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (req: Request, res: Response) => {
    const fineId = parseInt(req.params.id, 10);
    if (!fineId || isNaN(fineId)) {
      res.status(400).json({ error: 'Valid fine ID required', code: 'INVALID_ID' });
      return;
    }

    const pool = getPool();
    try {
      const [fineRows] = await pool.query<any[]>(
        `SELECT f.*, l.accession_number, l.borrower_name, l.borrower_identifier, l.borrower_type,
                b.title AS book_title
         FROM library_fines f
         JOIN library_loans l ON f.loan_id = l.id
         JOIN library_books b ON l.book_id = b.id
         WHERE f.id = ? LIMIT 1`,
        [fineId]
      );

      if (!fineRows || fineRows.length === 0) {
        res.status(404).json({ error: 'Fine record not found', code: 'NOT_FOUND' });
        return;
      }

      const [payments] = await pool.query<any[]>(
        `SELECT p.*, u.full_name AS recorded_by_name
         FROM library_fine_payments p
         LEFT JOIN users u ON p.recorded_by = u.id
         WHERE p.fine_id = ?
         ORDER BY p.id ASC`,
        [fineId]
      );

      res.json({
        success: true,
        fine: fineRows[0],
        payments,
      });
    } catch (err) {
      console.error('[Library] Fine payments fetch error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve fine payment history', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/library/fines/:id/pay
 * Record offline fine payment
 */
libraryRouter.post(
  '/fines/:id/pay',
  requireRoles(...LIBRARY_OPERATOR_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const fineId = parseInt(req.params.id, 10);
    const { amount, paymentMethod, receiptReference, remarks } = req.body || {};

    const payAmount = parseFloat(String(amount || '0'));
    if (!fineId || isNaN(fineId) || isNaN(payAmount) || payAmount <= 0) {
      res.status(400).json({
        error: 'Valid fine ID and positive payment amount are required.',
        code: 'INVALID_AMOUNT',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [fineRows] = await connection.query<any[]>(
        'SELECT * FROM library_fines WHERE id = ? LIMIT 1 FOR UPDATE',
        [fineId]
      );
      if (!fineRows || fineRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Fine record not found', code: 'NOT_FOUND' });
        return;
      }
      const fine = fineRows[0];

      const currentBalance = Number(fine.outstanding_balance);
      if (currentBalance <= 0) {
        await connection.rollback();
        res.status(400).json({ error: 'This fine has already been fully settled.', code: 'ALREADY_SETTLED' });
        return;
      }

      // Prevent overpayment beyond outstanding balance (Section 8)
      if (payAmount > currentBalance) {
        await connection.rollback();
        res.status(400).json({
          error: `Payment amount (₹${payAmount}) exceeds the outstanding balance (₹${currentBalance}). Overpayment is not permitted.`,
          code: 'OVERPAYMENT_NOT_PERMITTED',
        });
        return;
      }

      const nextPaid = Number(fine.paid_amount) + payAmount;
      const nextBalance = Math.max(0, currentBalance - payAmount);
      const nextStatus = nextBalance === 0 ? 'PAID' : 'PARTIALLY_PAID';

      await connection.query(
        `UPDATE library_fines SET paid_amount = ?, outstanding_balance = ?, status = ? WHERE id = ?`,
        [nextPaid, nextBalance, nextStatus, fineId]
      );

      const [paymentInsert] = await connection.query<any>(
        `INSERT INTO library_fine_payments (
           fine_id, payment_type, amount, payment_method, receipt_reference, reason, recorded_by
         ) VALUES (?, 'PAYMENT', ?, ?, ?, ?, ?)`,
        [
          fineId,
          payAmount,
          paymentMethod ? String(paymentMethod).trim() : 'CASH',
          receiptReference ? String(receiptReference).trim() : null,
          remarks ? String(remarks).trim() : 'Library fine payment',
          req.user!.id,
        ]
      );

      const paymentId = paymentInsert.insertId;

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_FINE_PAID',
        targetType: 'LIBRARY_FINE',
        targetId: String(fineId),
        ipAddress: req.ip || null,
        details: {
          fineId,
          paymentId,
          paidAmount: payAmount,
          previousBalance: currentBalance,
          newBalance: nextBalance,
          paymentMethod: paymentMethod || 'CASH',
          receiptReference,
        },
      });

      res.json({
        success: true,
        message: `Successfully recorded payment of ₹${payAmount.toFixed(2)}. Remaining balance: ₹${nextBalance.toFixed(2)}.`,
        fine: {
          id: fineId,
          paidAmount: nextPaid,
          outstandingBalance: nextBalance,
          status: nextStatus,
        },
        receipt: {
          paymentId,
          fineId,
          amount: payAmount,
          paymentMethod: paymentMethod ? String(paymentMethod).trim() : 'CASH',
          receiptReference: receiptReference ? String(receiptReference).trim() : null,
          paidAt: new Date().toISOString(),
          recordedBy: req.user!.id,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[Library] Fine payment error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to record fine payment', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/library/fines/:id/waive
 * Waive fine (Restricted to Super Admin, Principal, Librarian; requires reason)
 */
libraryRouter.post(
  '/fines/:id/waive',
  requireRoles(...LIBRARY_ADMIN_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const fineId = parseInt(req.params.id, 10);
    const { amount, reason } = req.body || {};

    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      res.status(400).json({
        error: 'A specific administrative reason is mandatory to authorize a fine waiver.',
        code: 'REASON_REQUIRED',
      });
      return;
    }

    const waiveAmount = amount !== undefined && amount !== null ? parseFloat(String(amount)) : null;

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [fineRows] = await connection.query<any[]>(
        'SELECT * FROM library_fines WHERE id = ? LIMIT 1 FOR UPDATE',
        [fineId]
      );
      if (!fineRows || fineRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Fine record not found', code: 'NOT_FOUND' });
        return;
      }
      const fine = fineRows[0];

      const currentBalance = Number(fine.outstanding_balance);
      if (currentBalance <= 0) {
        await connection.rollback();
        res.status(400).json({ error: 'This fine has already been fully settled or waived.', code: 'ALREADY_SETTLED' });
        return;
      }

      // If amount not specified, waive entire outstanding balance
      const effectiveWaiveAmount = waiveAmount !== null && !isNaN(waiveAmount) && waiveAmount > 0
        ? Math.min(waiveAmount, currentBalance)
        : currentBalance;

      const nextWaived = Number(fine.waived_amount) + effectiveWaiveAmount;
      const nextBalance = Math.max(0, currentBalance - effectiveWaiveAmount);
      const nextStatus = nextBalance === 0 ? 'WAIVED' : 'PARTIALLY_PAID';

      await connection.query(
        `UPDATE library_fines SET
           waived_amount = ?, outstanding_balance = ?, waiver_reason = ?,
           waived_by = ?, waived_at = NOW(), status = ?
         WHERE id = ?`,
        [nextWaived, nextBalance, cleanReason, req.user!.id, nextStatus, fineId]
      );

      await connection.query(
        `INSERT INTO library_fine_payments (
           fine_id, payment_type, amount, payment_method, receipt_reference, reason, recorded_by
         ) VALUES (?, 'WAIVER', ?, 'WAIVER', NULL, ?, ?)`,
        [fineId, effectiveWaiveAmount, cleanReason, req.user!.id]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_FINE_WAIVED',
        targetType: 'LIBRARY_FINE',
        targetId: String(fineId),
        ipAddress: req.ip || null,
        details: {
          fineId,
          originalFine: fine.assessed_fine,
          waivedAmount: effectiveWaiveAmount,
          remainingBalance: nextBalance,
          reason: cleanReason,
          authorizedByRole: req.user!.role,
        },
      });

      res.json({
        success: true,
        message: `Successfully waived ₹${effectiveWaiveAmount.toFixed(2)}. Remaining balance: ₹${nextBalance.toFixed(2)}.`,
        fine: {
          id: fineId,
          waivedAmount: nextWaived,
          outstandingBalance: nextBalance,
          status: nextStatus,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[Library] Fine waiver error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to waive fine', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

// ============================================================================
// 7. BORROWING & FINE SETTINGS
// ============================================================================

/**
 * GET /api/library/settings
 * Retrieve borrowing limits and fine policies
 */
libraryRouter.get(
  '/settings',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  async (_req: Request, res: Response) => {
    const pool = getPool();
    try {
      const [rows] = await pool.query<any[]>('SELECT * FROM library_settings ORDER BY borrower_type ASC');
      res.json({ success: true, settings: rows });
    } catch (err) {
      console.error('[Library] Settings fetch error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve library settings', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/library/settings
 * Update borrowing rules and fine rates (Super Admin, Principal, Librarian only)
 */
libraryRouter.put(
  '/settings',
  requireRoles(...LIBRARY_ADMIN_ROLES),
  validateCsrf,
  async (req: Request, res: Response) => {
    const { borrowerType, maxActiveBooks, loanPeriodDays, fineAmountPerDay, gracePeriodDays, maxFineAmount } = req.body || {};

    const cleanType = String(borrowerType || '').toUpperCase();
    if (!['STUDENT', 'TEACHER'].includes(cleanType)) {
      res.status(400).json({ error: 'Valid borrower type (STUDENT or TEACHER) required.', code: 'INVALID_TYPE' });
      return;
    }

    const maxBooks = parseInt(String(maxActiveBooks), 10);
    const loanDays = parseInt(String(loanPeriodDays), 10);
    const fineRate = parseFloat(String(fineAmountPerDay));
    const graceDays = parseInt(String(gracePeriodDays), 10);
    const maxFine = maxFineAmount !== null && maxFineAmount !== undefined && maxFineAmount !== ''
      ? parseFloat(String(maxFineAmount))
      : null;

    if (isNaN(maxBooks) || maxBooks < 1 || isNaN(loanDays) || loanDays < 1 || isNaN(fineRate) || fineRate < 0 || isNaN(graceDays) || graceDays < 0) {
      res.status(400).json({
        error: 'Invalid settings numbers. Limits and days must be positive integers; fine rate must be non-negative.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const pool = getPool();
    try {
      await pool.query(
        `UPDATE library_settings SET
           max_active_books = ?, loan_period_days = ?, fine_amount_per_day = ?,
           grace_period_days = ?, max_fine_amount = ?, updated_by = ?
         WHERE borrower_type = ?`,
        [maxBooks, loanDays, fineRate, graceDays, maxFine, req.user!.id, cleanType]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LIBRARY_SETTINGS_UPDATED',
        targetType: 'LIBRARY_SETTINGS',
        targetId: cleanType,
        ipAddress: req.ip || null,
        details: {
          borrowerType: cleanType,
          maxActiveBooks: maxBooks,
          loanPeriodDays: loanDays,
          fineAmountPerDay: fineRate,
          gracePeriodDays: graceDays,
          maxFineAmount: maxFine,
        },
      });

      res.json({
        success: true,
        message: `Library settings for ${cleanType} updated successfully.`,
      });
    } catch (err) {
      console.error('[Library] Settings update error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update library settings', code: 'DATABASE_ERROR' });
    }
  }
);
