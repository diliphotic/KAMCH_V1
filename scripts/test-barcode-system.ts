import { generateBarcodeId, generateCode128Svg } from '../server/services/library.service.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';
import { handleLibraryQuery } from '../server/services/library-db-proxy.ts';

async function runBarcodeSystemTests() {
  console.log('=== KAMCH ERP LIBRARY - BARCODE SYSTEM TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, details?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  // TEST 1: Barcode ID Format Mapping
  console.log('--- 1. BARCODE ID FORMAT MAPPING TESTS ---');
  assert(generateBarcodeId('1') === 'KAMCH-L-00001', 'Accession 1 -> KAMCH-L-00001', `Got: ${generateBarcodeId('1')}`);
  assert(generateBarcodeId('34') === 'KAMCH-L-00034', 'Accession 34 -> KAMCH-L-00034', `Got: ${generateBarcodeId('34')}`);
  assert(generateBarcodeId('395') === 'KAMCH-L-00395', 'Accession 395 -> KAMCH-L-00395', `Got: ${generateBarcodeId('395')}`);
  assert(generateBarcodeId('1234') === 'KAMCH-L-01234', 'Accession 1234 -> KAMCH-L-01234', `Got: ${generateBarcodeId('1234')}`);
  assert(generateBarcodeId('11256') === 'KAMCH-L-11256', 'Accession 11256 -> KAMCH-L-11256', `Got: ${generateBarcodeId('11256')}`);
  assert(generateBarcodeId('KAMCH-L-00395') === 'KAMCH-L-00395', 'Idempotent barcode ID KAMCH-L-00395', `Got: ${generateBarcodeId('KAMCH-L-00395')}`);

  // TEST 2: Code 128 SVG Barcode Generation
  console.log('\n--- 2. CODE 128 BARCODE SVG GENERATION TESTS ---');
  const svg = generateCode128Svg('KAMCH-L-00395', {
    height: 48,
    moduleWidth: 2,
    showText: true,
    title: 'KAMCH CENTRAL LIBRARY',
    accessionNumber: '395',
  });
  assert(svg.includes('<svg'), 'Generated valid SVG element');
  assert(svg.includes('KAMCH CENTRAL LIBRARY'), 'SVG contains header title');
  assert(svg.includes('KAMCH-L-00395'), 'SVG encodes full barcode ID');
  assert(svg.includes('[Acc: 395]'), 'SVG contains accession number subtext');

  // TEST 3: Database Proxy Barcode Lookup
  console.log('\n--- 3. DATABASE PROXY BARCODE LOOKUP TESTS ---');
  const memDb = new MemoryDatabase();

  // Insert book with barcode_id
  const bcode395 = generateBarcodeId('395');
  const insertBookRes = handleLibraryQuery(
    memDb,
    `INSERT INTO library_books (
      accession_number, barcode_id, title, authors, edition_year, publisher_place, price, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?)`,
    ['395', bcode395, 'Ashtanga Hridaya Sutrasthana', 'Vagbhata', '2023', 'Varanasi', 850.00, 1]
  );
  assert(Boolean(insertBookRes && insertBookRes[0]?.insertId), 'Book inserted with accession 395 and barcode KAMCH-L-00395');

  // Query book by accession_number
  const queryAccRes = handleLibraryQuery(
    memDb,
    `SELECT * FROM library_books WHERE accession_number = ? OR barcode_id = ? OR barcode_id = ? LIMIT 1`,
    ['395', '395', bcode395]
  );
  assert(Boolean(queryAccRes && queryAccRes[0]?.length === 1), 'Found book by accession number query');
  assert(queryAccRes?.[0]?.[0]?.barcode_id === 'KAMCH-L-00395', 'Book record contains barcode_id KAMCH-L-00395');

  // Query book by scanned barcode_id
  const queryBcodeRes = handleLibraryQuery(
    memDb,
    `SELECT * FROM library_books WHERE accession_number = ? OR barcode_id = ? OR barcode_id = ? LIMIT 1`,
    ['KAMCH-L-00395', 'KAMCH-L-00395', bcode395]
  );
  assert(Boolean(queryBcodeRes && queryBcodeRes[0]?.length === 1), 'Found book by scanned barcode ID input');

  // TEST 4: Circulation Scan Issue and Return
  console.log('\n--- 4. CIRCULATION SCAN ISSUE & RETURN TESTS ---');

  // Insert loan
  const insertLoanRes = handleLibraryQuery(
    memDb,
    `INSERT INTO library_loans (
       book_id, accession_number, borrower_type, student_id, teacher_id,
       borrower_name, borrower_identifier, borrower_details,
       issue_date, due_date, status, issued_by, is_initial_entry, remarks
     ) VALUES (?, ?, 'STUDENT', 1, NULL, 'Rohan Sharma', '21AY045', 'Daksha Batch', '2026-10-27 10:00:00', '2026-11-10', 'ACTIVE', 1, FALSE, 'Scan issue test')`,
    [1, '395']
  );
  assert(Boolean(insertLoanRes && insertLoanRes[0]?.insertId), 'Loan created successfully for book 395');

  // Query active loan by scanned barcode_id KAMCH-L-00395
  const queryLoanRes = handleLibraryQuery(
    memDb,
    `SELECT l.*, b.title AS book_title
     FROM library_loans l
     JOIN library_books b ON l.book_id = b.id
     WHERE (l.accession_number = ? OR b.barcode_id = ? OR b.barcode_id = ?) AND l.status = 'ACTIVE'`,
    ['KAMCH-L-00395', 'KAMCH-L-00395', bcode395]
  );
  assert(Boolean(queryLoanRes && queryLoanRes[0]?.length === 1), 'Found active loan using scanned barcode ID KAMCH-L-00395');

  // TEST 5: Large Dataset Bulk Barcode Pagination (> 500 Books, e.g. 1,250 Books)
  console.log('\n--- 5. LARGE DATASET BULK BARCODE PAGINATION TESTS (> 500 BOOKS) ---');
  const largeDb = new MemoryDatabase();

  const TOTAL_LARGE_BOOKS = 1250;
  for (let i = 1; i <= TOTAL_LARGE_BOOKS; i++) {
    const accStr = String(i);
    const bCode = generateBarcodeId(accStr);
    handleLibraryQuery(
      largeDb,
      `INSERT INTO library_books (
        accession_number, barcode_id, title, authors, status, created_by
      ) VALUES (?, ?, ?, ?, 'AVAILABLE', 1)`,
      [accStr, bCode, `Ayurvedic Volume ${i}`, 'Dr. Author', 'AVAILABLE', 1]
    );
  }

  // Count check
  const countRes = handleLibraryQuery(
    largeDb,
    `SELECT COUNT(*) AS total FROM library_books WHERE status = 'AVAILABLE'`,
    []
  );
  const totalInDb = countRes?.[0]?.[0]?.total;
  assert(totalInDb === TOTAL_LARGE_BOOKS, `Large dataset created: ${totalInDb} books in catalogue (Target: ${TOTAL_LARGE_BOOKS})`);

  // Simulate chunked fetching (Chunk size: 500)
  let fetchedLabelsCount = 0;
  let offset = 0;
  const CHUNK_SIZE = 500;
  let chunkCount = 0;

  while (offset < totalInDb) {
    const chunkRes = handleLibraryQuery(
      largeDb,
      `SELECT accession_number, barcode_id, title, authors FROM library_books WHERE status = 'AVAILABLE' ORDER BY accession_number ASC LIMIT ? OFFSET ?`,
      [CHUNK_SIZE, offset]
    );
    const rows = chunkRes?.[0] || [];
    fetchedLabelsCount += rows.length;
    offset += CHUNK_SIZE;
    chunkCount++;
  }

  assert(fetchedLabelsCount === TOTAL_LARGE_BOOKS, `Successfully retrieved ALL ${fetchedLabelsCount} barcode labels across ${chunkCount} chunks without 500 truncation limit`);

  console.log('\n==================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBarcodeSystemTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
