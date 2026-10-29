import * as XLSX from 'xlsx';
import { PoolConnection } from 'mysql2/promise';
import { getPool } from '../db.ts';
import { recordAuditLog } from './audit.ts';

// ============================================================================
// 1. CODE 128 BARCODE SVG GENERATION (Subset B)
// ============================================================================

// Code 128 bar-space patterns for symbols 0 to 106.
// Each 6-digit string represents 3 bars and 3 spaces (module widths, sum = 11).
// Symbol 106 (Stop) has a 7th digit (terminal bar of width 2, sum = 13).
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', // 0-9
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', // 10-19
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', // 20-29
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 30-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', // 40-49
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', // 50-59
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', // 60-69
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 70-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', // 80-89
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', // 90-99
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'                                 // 100-106 (104=StartB, 106=Stop)
];

/**
 * Generates deterministic Barcode ID from accession number:
 * KAMCH-L- + accession number padded to at least 5 digits.
 * Examples:
 *   1 -> KAMCH-L-00001
 *   34 -> KAMCH-L-00034
 *   395 -> KAMCH-L-00395
 *   1234 -> KAMCH-L-01234
 *   11256 -> KAMCH-L-11256
 */
export function generateBarcodeId(accessionNumber: string): string {
  const clean = String(accessionNumber || '').trim();
  if (!clean) return 'KAMCH-L-00000';

  if (/^KAMCH-L-/i.test(clean)) {
    const rawNum = clean.substring(8).trim();
    if (/^\d+$/.test(rawNum)) {
      return `KAMCH-L-${rawNum.padStart(5, '0')}`;
    }
    return clean.toUpperCase();
  }

  if (/^\d+$/.test(clean)) {
    return `KAMCH-L-${clean.padStart(5, '0')}`;
  }

  return `KAMCH-L-${clean.toUpperCase()}`;
}

/**
 * Generates an SVG string containing a Code 128 B barcode for the given text.
 */
export function generateCode128Svg(
  text: string,
  options: {
    height?: number;
    moduleWidth?: number;
    showText?: boolean;
    quietZoneModules?: number;
    title?: string;
    accessionNumber?: string;
  } = {}
): string {
  const cleanText = String(text || '').trim();
  if (!cleanText) return '';

  const height = options.height || 50;
  const moduleWidth = options.moduleWidth || 2;
  const showText = options.showText !== false;
  const quietZone = options.quietZoneModules || 10;
  const title = options.title || 'KAMCH Central Library';

  // 1. Calculate values for Code 128 Subset B
  const START_B = 104;
  const STOP = 106;
  const values: number[] = [START_B];
  let checksum = START_B;

  for (let i = 0; i < cleanText.length; i++) {
    const code = cleanText.charCodeAt(i);
    // ASCII 32 to 127
    const val = (code >= 32 && code <= 126) ? code - 32 : 0;
    values.push(val);
    checksum += (i + 1) * val;
  }

  values.push(checksum % 103);
  values.push(STOP);

  // 2. Build module sequence (1 = bar, 0 = space)
  let modules = '0'.repeat(quietZone);
  for (const v of values) {
    const pattern = CODE128_PATTERNS[v];
    if (!pattern) continue;
    let isBar = true;
    for (const char of pattern) {
      const width = parseInt(char, 10);
      modules += (isBar ? '1' : '0').repeat(width);
      isBar = !isBar;
    }
  }
  modules += '0'.repeat(quietZone);

  // 3. Generate SVG rects
  const totalModules = modules.length;
  const svgWidth = totalModules * moduleWidth;
  const svgHeight = height + (showText ? 28 : 8);

  let rects = '';
  let inBar = false;
  let barStart = 0;

  for (let i = 0; i < totalModules; i++) {
    if (modules[i] === '1') {
      if (!inBar) {
        inBar = true;
        barStart = i;
      }
    } else {
      if (inBar) {
        inBar = false;
        const x = barStart * moduleWidth;
        const w = (i - barStart) * moduleWidth;
        rects += `<rect x="${x}" y="14" width="${w}" height="${height}" fill="#1c1917" />`;
      }
    }
  }
  if (inBar) {
    const x = barStart * moduleWidth;
    const w = (totalModules - barStart) * moduleWidth;
    rects += `<rect x="${x}" y="14" width="${w}" height="${height}" fill="#1c1917" />`;
  }

  const headerText = title
    ? `<text x="${svgWidth / 2}" y="10" text-anchor="middle" font-family="system-ui, sans-serif" font-size="9" font-weight="600" fill="#4B2E2E" letter-spacing="0.5">${escapeXml(title)}</text>`
    : '';

  let footerText = '';
  if (showText) {
    const accSubtext = options.accessionNumber
      ? `  [Acc: ${escapeXml(options.accessionNumber)}]`
      : '';
    footerText = `<text x="${svgWidth / 2}" y="${height + 24}" text-anchor="middle" font-family="monospace, monospace" font-size="11" font-weight="700" fill="#1c1917" letter-spacing="1.2">${escapeXml(cleanText)}${accSubtext}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
  <rect width="${svgWidth}" height="${svgHeight}" fill="#FFFFFF" />
  ${headerText}
  ${rects}
  ${footerText}
</svg>`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// ============================================================================
// 2. ACCESSION REGISTER EXCEL PARSER & VALIDATOR
// ============================================================================

export interface ParsedBookRow {
  rowNumber: number;
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
}

export interface ImportValidationIssue {
  rowNumber: number;
  accessionNumber: string;
  field: string;
  reason: string;
}

export interface ImportPreviewResult {
  totalRows: number;
  validCount: number;
  duplicateInFileCount: number;
  alreadyInCatalogueCount: number;
  missingAccessionCount: number;
  missingTitleCount: number;
  validBooks: ParsedBookRow[];
  issues: ImportValidationIssue[];
  sampleData: ParsedBookRow[];
}

/**
 * Normalizes header strings for flexible column matching against real accession registers.
 */
function normalizeHeader(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[._\-/\\]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Parses and validates an uploaded Excel/CSV Accession Register buffer.
 */
export async function parseAccessionRegister(
  fileBuffer: Buffer,
  existingAccessionNumbers: Set<string>
): Promise<ImportPreviewResult> {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Workbook contains no sheets.');
  }

  const worksheet = workbook.Sheets[sheetName];
  const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

  if (rawRows.length === 0) {
    return {
      totalRows: 0,
      validCount: 0,
      duplicateInFileCount: 0,
      alreadyInCatalogueCount: 0,
      missingAccessionCount: 0,
      missingTitleCount: 0,
      validBooks: [],
      issues: [],
      sampleData: [],
    };
  }

  // Identify column mapping dynamically
  const firstRow = rawRows[0];
  const colKeys = Object.keys(firstRow);

  let accCol = '';
  let titleCol = '';
  let authorCol = '';
  let dateCol = '';
  let editionCol = '';
  let pubCol = '';
  let isbnCol = '';
  let pagesCol = '';
  let bindingCol = '';
  let sourceCol = '';
  let billCol = '';
  let priceCol = '';

  for (const key of colKeys) {
    const norm = normalizeHeader(key);
    if (!accCol && (/accession/i.test(norm) || /^acc\b/i.test(norm) || norm === 'sl no' || norm === 'acc no')) {
      accCol = key;
    } else if (!titleCol && (/title/i.test(norm) || /name of book/i.test(norm))) {
      titleCol = key;
    } else if (!authorCol && (/author/i.test(norm) || /writer/i.test(norm))) {
      authorCol = key;
    } else if (!dateCol && (/date/i.test(norm) || /received/i.test(norm))) {
      dateCol = key;
    } else if (!editionCol && (/edition/i.test(norm) || /year/i.test(norm))) {
      editionCol = key;
    } else if (!pubCol && (/publisher/i.test(norm) || /place/i.test(norm))) {
      pubCol = key;
    } else if (!isbnCol && /isbn/i.test(norm)) {
      isbnCol = key;
    } else if (!pagesCol && (/page/i.test(norm) || /vol/i.test(norm))) {
      pagesCol = key;
    } else if (!bindingCol && /binding/i.test(norm)) {
      bindingCol = key;
    } else if (!sourceCol && (/source/i.test(norm) || /vendor/i.test(norm) || /supplier/i.test(norm))) {
      sourceCol = key;
    } else if (!billCol && (/bill/i.test(norm) || /invoice/i.test(norm) || /voucher/i.test(norm))) {
      billCol = key;
    } else if (!priceCol && (/price/i.test(norm) || /cost/i.test(norm) || /amount/i.test(norm) || /rs/i.test(norm))) {
      priceCol = key;
    }
  }

  // Fallbacks if header names are standard positional
  if (!accCol && colKeys.length > 0) accCol = colKeys[0];
  if (!titleCol && colKeys.length > 1) titleCol = colKeys[1];
  if (!authorCol && colKeys.length > 2) authorCol = colKeys[2];

  const seenInFile = new Set<string>();
  const validBooks: ParsedBookRow[] = [];
  const issues: ImportValidationIssue[] = [];

  let duplicateInFileCount = 0;
  let alreadyInCatalogueCount = 0;
  let missingAccessionCount = 0;
  let missingTitleCount = 0;

  for (let idx = 0; idx < rawRows.length; idx++) {
    const rowNum = idx + 2; // 1-based, accounting for header
    const r = rawRows[idx];

    const rawAcc = accCol ? String(r[accCol] || '').trim() : '';
    const rawTitle = titleCol ? String(r[titleCol] || '').trim() : '';
    const rawAuthor = authorCol ? String(r[authorCol] || '').trim() : '';
    const rawDate = dateCol ? String(r[dateCol] || '').trim() : '';
    const rawEdition = editionCol ? String(r[editionCol] || '').trim() : '';
    const rawPub = pubCol ? String(r[pubCol] || '').trim() : '';
    const rawIsbn = isbnCol ? String(r[isbnCol] || '').trim() : '';
    const rawPages = pagesCol ? String(r[pagesCol] || '').trim() : '';
    const rawBinding = bindingCol ? String(r[bindingCol] || '').trim() : '';
    const rawSource = sourceCol ? String(r[sourceCol] || '').trim() : '';
    const rawBill = billCol ? String(r[billCol] || '').trim() : '';
    const rawPrice = priceCol ? String(r[priceCol] || '').trim().replace(/[^0-9.]/g, '') : '';

    // Ignore completely blank separator rows
    if (!rawAcc && !rawTitle && !rawAuthor) {
      continue;
    }

    // Validation 1: Missing Accession Number
    if (!rawAcc) {
      missingAccessionCount++;
      issues.push({
        rowNumber: rowNum,
        accessionNumber: '(Empty)',
        field: 'accession_number',
        reason: 'Missing required Accession Number in accession register row.',
      });
      continue;
    }

    // Validation 2: Duplicate in Upload File
    const normalizedAcc = rawAcc.toLowerCase();
    if (seenInFile.has(normalizedAcc)) {
      duplicateInFileCount++;
      issues.push({
        rowNumber: rowNum,
        accessionNumber: rawAcc,
        field: 'accession_number',
        reason: `Duplicate accession number '${rawAcc}' found multiple times within the uploaded file.`,
      });
      continue;
    }
    seenInFile.add(normalizedAcc);

    // Validation 3: Duplicate against Existing Catalogue
    if (existingAccessionNumbers.has(normalizedAcc)) {
      alreadyInCatalogueCount++;
      issues.push({
        rowNumber: rowNum,
        accessionNumber: rawAcc,
        field: 'accession_number',
        reason: `Accession number '${rawAcc}' already exists in the institutional catalogue.`,
      });
      continue;
    }

    // Validation 4: Title missing
    if (!rawTitle) {
      missingTitleCount++;
      issues.push({
        rowNumber: rowNum,
        accessionNumber: rawAcc,
        field: 'title',
        reason: 'Missing book title. Each accession entry must have an identifiable title.',
      });
      continue;
    }

    // Parse date if possible
    let parsedDate: string | null = null;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        parsedDate = d.toISOString().split('T')[0];
      } else {
        parsedDate = rawDate; // Preserve original text representation
      }
    }

    const priceNum = rawPrice ? parseFloat(rawPrice) : null;

    validBooks.push({
      rowNumber: rowNum,
      accession_number: rawAcc,
      barcode_id: generateBarcodeId(rawAcc),
      accession_date: parsedDate,
      title: rawTitle,
      authors: rawAuthor || null,
      edition_year: rawEdition || null,
      publisher_place: rawPub || null,
      isbn: rawIsbn || null,
      pages: rawPages || null,
      binding: rawBinding || null,
      source: rawSource || null,
      bill_number_date: rawBill || null,
      price: priceNum !== null && !isNaN(priceNum) ? priceNum : null,
    });
  }

  return {
    totalRows: rawRows.length,
    validCount: validBooks.length,
    duplicateInFileCount,
    alreadyInCatalogueCount,
    missingAccessionCount,
    missingTitleCount,
    validBooks,
    issues,
    sampleData: validBooks.slice(0, 25),
  };
}

// ============================================================================
// 3. FINE & OVERDUE CALCULATION HELPER
// ============================================================================

export interface FineCalculationResult {
  isOverdue: boolean;
  overdueDays: number;
  fineableDays: number;
  finePerDay: number;
  gracePeriodDays: number;
  rawFine: number;
  maxFineCap: number | null;
  assessedFine: number;
  details: {
    dueDate: string;
    returnDate: string;
    overdueDays: number;
    gracePeriod: number;
    fineRate: number;
    appliedCap: number | null;
  };
}

/**
 * Calculates overdue days and fine according to configured library settings.
 */
export function calculateOverdueFine(
  dueDateStr: string,
  returnDateStr: string,
  settings: {
    fine_amount_per_day: number;
    grace_period_days: number;
    max_fine_amount: number | null;
  }
): FineCalculationResult {
  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const cleanStr = String(dateStr).split('T')[0];
    const parts = cleanStr.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    }
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const due = parseLocalDate(dueDateStr);
  const ret = parseLocalDate(returnDateStr);

  const diffTime = ret.getTime() - due.getTime();
  const overdueDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  const gracePeriod = settings.grace_period_days !== undefined && settings.grace_period_days !== null
    ? Number(settings.grace_period_days)
    : 0;
  const fineRate = settings.fine_amount_per_day !== undefined && settings.fine_amount_per_day !== null
    ? Number(settings.fine_amount_per_day)
    : 2.0;
  const maxFineCap = settings.max_fine_amount !== null && settings.max_fine_amount !== undefined
    ? Number(settings.max_fine_amount)
    : null;

  if (overdueDays <= gracePeriod) {
    return {
      isOverdue: overdueDays > 0,
      overdueDays,
      fineableDays: 0,
      finePerDay: fineRate,
      gracePeriodDays: gracePeriod,
      rawFine: 0,
      maxFineCap,
      assessedFine: 0,
      details: {
        dueDate: dueDateStr,
        returnDate: returnDateStr,
        overdueDays,
        gracePeriod,
        fineRate,
        appliedCap: maxFineCap,
      },
    };
  }

  // Grace period exceeded: fineable days is overdueDays
  const fineableDays = overdueDays;
  const rawFine = fineableDays * fineRate;
  const assessedFine = maxFineCap !== null ? Math.min(rawFine, maxFineCap) : rawFine;

  return {
    isOverdue: true,
    overdueDays,
    fineableDays,
    finePerDay: fineRate,
    gracePeriodDays: gracePeriod,
    rawFine: Math.round(rawFine * 100) / 100,
    maxFineCap,
    assessedFine: Math.round(assessedFine * 100) / 100,
    details: {
      dueDate: dueDateStr,
      returnDate: returnDateStr,
      overdueDays,
      gracePeriod,
      fineRate,
      appliedCap: maxFineCap,
    },
  };
}
