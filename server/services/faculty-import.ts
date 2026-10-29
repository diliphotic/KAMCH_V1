import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toIsoDateOnly } from './student-progression.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_FACULTY_SOURCE_PATH = path.resolve(
  __dirname,
  '../db/seed-data/kamch_faculty_source.txt'
);

export type TeacherCodeStatus =
  | 'VERIFIED'
  | 'APPLIED'
  | 'NOT_PROVIDED'
  | 'REQUIRES_VERIFICATION';

export interface CanonicalDepartmentSpec {
  sourceName: string;
  proposedCode: string;
  description: string;
  distinctiveTokens: string[];
}

export const CANONICAL_FACULTY_DEPARTMENTS: readonly CanonicalDepartmentSpec[] = [
  {
    sourceName: 'Rasashastra and Bhaishajya Kalpana',
    proposedCode: 'RSBK',
    description: 'Department of Rasashastra and Bhaishajya Kalpana',
    distinctiveTokens: ['rasashastra', 'bhaishajya', 'rsbk'],
  },
  {
    sourceName: 'Rachana Shareera',
    proposedCode: 'RACHANA_SHAREERA',
    description: 'Department of Rachana Shareera',
    distinctiveTokens: ['rachana'],
  },
  {
    sourceName: 'Kriya Shareera',
    proposedCode: 'KRIYA_SHAREERA',
    description: 'Department of Kriya Shareera',
    distinctiveTokens: ['kriya'],
  },
  {
    sourceName: 'Ayurveda Samhita Siddhant',
    proposedCode: 'SAMHITA_SIDDHANT',
    description: 'Department of Ayurveda Samhita Siddhant',
    distinctiveTokens: ['samhita', 'siddhant', 'siddhanta'],
  },
  {
    sourceName: 'Roga Nidana And Vikriti Vijnana',
    proposedCode: 'ROGA_NIDANA',
    description: 'Department of Roga Nidana and Vikriti Vijnana',
    distinctiveTokens: ['roga', 'nidana', 'vikriti'],
  },
  {
    sourceName: 'Dravyaguna Vigyana',
    proposedCode: 'DRAVYAGUNA',
    description: 'Department of Dravyaguna Vigyana',
    distinctiveTokens: ['dravyaguna'],
  },
  {
    sourceName: 'Swastha Vritta & Yoga',
    proposedCode: 'SWASTHAVRITTA',
    description: 'Department of Swastha Vritta & Yoga',
    distinctiveTokens: ['swasthavritta', 'swastha'],
  },
  {
    sourceName: 'Agada Tantra',
    proposedCode: 'AGADA_TANTRA',
    description: 'Department of Agada Tantra',
    distinctiveTokens: ['agada'],
  },
  {
    sourceName: 'Prasooti Tantra & Striroga',
    proposedCode: 'PRASOOTI_STRIROGA',
    description: 'Department of Prasooti Tantra & Striroga',
    distinctiveTokens: ['prasooti', 'prasuti', 'striroga', 'streeroga'],
  },
  {
    sourceName: 'Koumarabhritya',
    proposedCode: 'KOUMARABHRITYA',
    description: 'Department of Koumarabhritya',
    distinctiveTokens: ['koumarabhritya', 'kaumarabhritya', 'balaroga'],
  },
  {
    sourceName: 'Kaya Chikitsa',
    proposedCode: 'KAYA_CHIKITSA',
    description: 'Department of Kaya Chikitsa',
    distinctiveTokens: ['kayachikitsa', 'kaya'],
  },
  {
    sourceName: 'Panchakarma',
    proposedCode: 'PANCHAKARMA',
    description: 'Department of Panchakarma',
    distinctiveTokens: ['panchakarma'],
  },
  {
    sourceName: 'Shalya Tantra',
    proposedCode: 'SHALYA_TANTRA',
    description: 'Department of Shalya Tantra',
    distinctiveTokens: ['shalya', 'shalyatantra'],
  },
  {
    sourceName: 'Shalakya Tantra',
    proposedCode: 'SHALAKYA_TANTRA',
    description: 'Department of Shalakya Tantra',
    distinctiveTokens: ['shalakya', 'shalakyatantra'],
  },
];

export const REQUIRED_TEACHER_MIGRATION_COLUMNS: readonly string[] = [
  'teacher_code',
  'teacher_code_status',
  'registration_number',
  'date_of_birth',
  'joining_date_service',
  'joining_date_institute',
  'reported_experience',
  'previous_institute',
  'profile_photo_url',
  'data_verification_required',
  'verification_notes',
  'raw_source_snapshot',
];

export interface VerificationFlag {
  code:
    | 'MISSING_REGISTRATION_NUMBER'
    | 'PLACEHOLDER_REGISTRATION_NUMBER'
    | 'TEACHER_CODE_APPLIED_PENDING'
    | 'MISSING_TEACHER_CODE'
    | 'UNUSUAL_TEACHER_CODE_FORMAT'
    | 'MISSING_EMAIL'
    | 'MISSING_PHONE'
    | 'NON_STANDARD_PHONE_FORMAT'
    | 'INVALID_OR_MISSING_DATE'
    | 'FUTURE_DATE'
    | 'INSTITUTE_BEFORE_SERVICE_DATE'
    | 'SUSPICIOUS_INSTITUTE_JOINING_DATE'
    | 'EXPERIENCE_SERVICE_DATE_DISCREPANCY'
    | 'MISSING_PREVIOUS_INSTITUTE';
  message: string;
}

export interface ParsedFacultyRecord {
  sourceIndex: number;
  departmentSourceName: string;
  proposedDepartmentCode: string;
  headingName: string;
  fullName: string;
  designation: string;
  qualification: string | null;
  dateOfBirth: string | null;
  registrationNumber: string | null;
  teacherCode: string | null;
  teacherCodeStatus: TeacherCodeStatus;
  joiningDateService: string | null;
  joiningDateInstitute: string | null;
  reportedExperience: string | null;
  previousInstitute: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  profilePhotoUrl: string | null;
  dataVerificationRequired: boolean;
  verificationFlags: VerificationFlag[];
  verificationNotes: string | null;
  rawSourceSnapshot: {
    departmentHeader: string;
    headingName: string;
    fields: Record<string, string>;
  };
}

export interface FacultyParseResult {
  records: ParsedFacultyRecord[];
  departmentsInOrder: string[];
  ignoredTrailingNoiseLines: number;
  sourceInternalDuplicates: Array<{
    indexA: number;
    nameA: string;
    indexB: number;
    nameB: string;
    reasons: string[];
  }>;
}

const MONTH_NAME_MAP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function isValidCalendarYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1930 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Parses source document dates (`DD/MM/YYYY`, `D/M/YYYY`, `DD-MM-YYYY`, `1 April 2014`, `10 April, 2014`)
 * into strict `YYYY-MM-DD` without timezone drift. Never fabricates dates on failure.
 */
export function parseSourceDateToIso(raw: string | undefined | null): {
  isoDate: string | null;
  valid: boolean;
} {
  if (!raw) return { isoDate: null, valid: false };
  const s = raw.trim();
  if (!s || /^[-–—\s]+$/.test(s)) return { isoDate: null, valid: false };

  // 1. ISO YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarYmd(y, m, d)) {
      return { isoDate: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, valid: true };
    }
    return { isoDate: null, valid: false };
  }

  // 2. Indian DD/MM/YYYY or DD-MM-YYYY (including single-digit D/M/YYYY)
  const dmyNumeric = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyNumeric) {
    const d = Number(dmyNumeric[1]);
    const m = Number(dmyNumeric[2]);
    const y = Number(dmyNumeric[3]);
    if (isValidCalendarYmd(y, m, d)) {
      return {
        isoDate: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        valid: true,
      };
    }
    return { isoDate: null, valid: false };
  }

  // 3. Written month format: `1 April 2014`, `10 April, 2014`
  const dmyWritten = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (dmyWritten) {
    const d = Number(dmyWritten[1]);
    const monthKey = dmyWritten[2].toLowerCase();
    const m = MONTH_NAME_MAP[monthKey];
    const y = Number(dmyWritten[3]);
    if (m && isValidCalendarYmd(y, m, d)) {
      return {
        isoDate: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        valid: true,
      };
    }
    return { isoDate: null, valid: false };
  }

  return { isoDate: null, valid: false };
}

/**
 * Parses source-reported experience strings (e.g. `18 Years 11 Months`, `12 yrs 1 month`,
 * `2 Year 4Months`, `06 Months`, `21 Yrs`) into approximate total months SOLELY for
 * non-destructive discrepancy detection. Never overwrites the verbatim `reportedExperience`.
 */
export function parseExperienceMonthsForComparison(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  let years = 0;
  let months = 0;
  let matchedAny = false;

  const yrMatch = s.match(/(\d+)\s*(?:years?|yrs?\.?)/i);
  if (yrMatch) {
    years = Number(yrMatch[1]);
    matchedAny = true;
  }

  const moMatch = s.match(/(\d+)\s*(?:months?|mos?\.?)/i);
  if (moMatch) {
    months = Number(moMatch[1]);
    matchedAny = true;
  }

  if (!matchedAny) return null;
  return years * 12 + months;
}

function diffMonthsBetweenIsoDates(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + (ed - sd) / 30.4375;
}

function diffDaysBetweenIsoDates(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const t1 = Date.UTC(sy, sm - 1, sd);
  const t2 = Date.UTC(ey, em - 1, ed);
  return Math.round((t2 - t1) / 86400000);
}

export function isDashPlaceholder(val: string | undefined | null): boolean {
  if (!val) return false;
  return /^[-–—\s]+$/.test(val.trim());
}

export function normalizeDepartmentComparisonKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^department\s+of\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeFacultyNameForMatch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(?:dr|mr|mrs|ms|miss|prof|vaidya|shri|smt)\.?\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeRegNoForMatch(regNo: string | null | undefined): string {
  if (!regNo) return '';
  return regNo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePhoneForMatch(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  return digits;
}

function getTodayIsoLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function findCanonicalDepartmentSpec(sourceDeptName: string): CanonicalDepartmentSpec | null {
  const targetKey = normalizeDepartmentComparisonKey(sourceDeptName);
  for (const spec of CANONICAL_FACULTY_DEPARTMENTS) {
    if (normalizeDepartmentComparisonKey(spec.sourceName) === targetKey) {
      return spec;
    }
  }
  return null;
}

function generateFallbackDepartmentCode(sourceDeptName: string): string {
  return sourceDeptName
    .trim()
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

/**
 * Parses the KAMCH department-wise faculty source document into structured records,
 * preserving raw values and evaluating data-quality verification flags without mutating source values.
 */
export function parseFacultySourceDocument(
  rawContent: string,
  options?: { referenceDate?: string }
): FacultyParseResult {
  const referenceDate = options?.referenceDate || getTodayIsoLocal();
  const lines = rawContent.split(/\r?\n/);

  const departmentsInOrder: string[] = [];
  const rawEntries: Array<{
    departmentHeader: string;
    headingName: string;
    fields: Record<string, string>;
  }> = [];

  let currentDepartment: string | null = null;
  let currentEntry: {
    departmentHeader: string;
    headingName: string;
    fields: Record<string, string>;
  } | null = null;
  let ignoredTrailingNoiseLines = 0;
  let reachedTrailingNoise = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Detect clipboard webpage noise at the tail of pasted documents
    if (
      reachedTrailingNoise ||
      trimmed.startsWith('To pick up a draggable item') ||
      trimmed.startsWith('While dragging, use the arrow keys') ||
      trimmed.startsWith('Press space again to drop') ||
      (trimmed.startsWith('{') && trimmed.includes('"sessionRefreshOrigin"')) ||
      trimmed.startsWith('{"auth":')
    ) {
      reachedTrailingNoise = true;
      ignoredTrailingNoiseLines++;
      continue;
    }

    // Department section header: `Departmental Faculties of <Dept Name> :`
    const deptMatch = trimmed.match(/^Departmental\s+Faculties\s+of\s+(.+?)\s*:\s*$/i);
    if (deptMatch) {
      if (currentEntry) {
        rawEntries.push(currentEntry);
        currentEntry = null;
      }
      currentDepartment = deptMatch[1].trim();
      if (!departmentsInOrder.includes(currentDepartment)) {
        departmentsInOrder.push(currentDepartment);
      }
      continue;
    }

    // Bullet field line: `- Key: Value`
    const bulletMatch = trimmed.match(/^-\s*([^:]+):\s*(.*)$/);
    if (bulletMatch && currentDepartment) {
      const key = bulletMatch[1].trim();
      const val = bulletMatch[2].trim();
      if (!currentEntry) {
        currentEntry = {
          departmentHeader: currentDepartment,
          headingName: val,
          fields: {},
        };
      }
      currentEntry.fields[key] = val;
      continue;
    }

    // Faculty heading line (e.g. `Dr. Manjunath S. Gavimath`)
    if (currentDepartment) {
      if (currentEntry) {
        rawEntries.push(currentEntry);
      }
      currentEntry = {
        departmentHeader: currentDepartment,
        headingName: trimmed,
        fields: {},
      };
    }
  }

  if (currentEntry) {
    rawEntries.push(currentEntry);
  }

  const getSourceField = (fields: Record<string, string>, ...aliases: string[]): string | undefined => {
    const lowerMap = new Map<string, string>();
    for (const [k, v] of Object.entries(fields)) {
      lowerMap.set(k.trim().toLowerCase(), v);
    }
    for (const alias of aliases) {
      const hit = lowerMap.get(alias.trim().toLowerCase());
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  const records: ParsedFacultyRecord[] = rawEntries.map((entry, idx) => {
    const f = entry.fields;
    const spec = findCanonicalDepartmentSpec(entry.departmentHeader);
    const proposedDepartmentCode =
      spec?.proposedCode || generateFallbackDepartmentCode(entry.departmentHeader);

    const fullName = (getSourceField(f, 'Name') || entry.headingName || '').trim();
    const designation = (getSourceField(f, 'Designation') || '').trim();
    const rawQual = getSourceField(f, 'Qualification')?.trim() || '';
    const qualification = rawQual && !isDashPlaceholder(rawQual) ? rawQual : null;

    const flags: VerificationFlag[] = [];

    // 1. Professional Registration Number (`Reg. No`) — strictly separate from `Teacher code`
    const rawRegNo = getSourceField(f, 'Reg. No', 'Reg No', 'Registration Number');
    let registrationNumber: string | null = null;
    if (rawRegNo === undefined || rawRegNo.trim() === '') {
      flags.push({
        code: 'MISSING_REGISTRATION_NUMBER',
        message: 'Professional registration number (Reg. No) is missing in source.',
      });
    } else if (isDashPlaceholder(rawRegNo)) {
      flags.push({
        code: 'PLACEHOLDER_REGISTRATION_NUMBER',
        message: `Professional registration number has placeholder '${rawRegNo.trim()}' in source.`,
      });
    } else {
      registrationNumber = rawRegNo.trim();
    }

    // 2. NCISM Teacher Code (`Teacher code`) — strictly separate from `Reg. No`
    const rawTeacherCode = getSourceField(f, 'Teacher code', 'Teacher Code');
    let teacherCode: string | null = null;
    let teacherCodeStatus: TeacherCodeStatus = 'NOT_PROVIDED';

    if (rawTeacherCode === undefined || rawTeacherCode.trim() === '' || isDashPlaceholder(rawTeacherCode)) {
      teacherCodeStatus = 'NOT_PROVIDED';
      flags.push({
        code: 'MISSING_TEACHER_CODE',
        message: 'NCISM Teacher code is missing in source.',
      });
    } else if (/applied/i.test(rawTeacherCode)) {
      teacherCode = null;
      teacherCodeStatus = 'APPLIED';
      flags.push({
        code: 'TEACHER_CODE_APPLIED_PENDING',
        message: `Teacher code not yet assigned (source states: '${rawTeacherCode.trim()}').`,
      });
    } else {
      const cleanedTc = rawTeacherCode.trim().toUpperCase();
      if (/^[A-Z0-9\/_-]{4,30}$/.test(cleanedTc)) {
        teacherCode = cleanedTc;
        teacherCodeStatus = 'VERIFIED';
      } else {
        teacherCode = null;
        teacherCodeStatus = 'REQUIRES_VERIFICATION';
        flags.push({
          code: 'UNUSUAL_TEACHER_CODE_FORMAT',
          message: `Unusual Teacher code value '${rawTeacherCode.trim()}' requires verification.`,
        });
      }
    }

    // 3. Dates (DOB, Joining of Service, Joining of Institute)
    const rawDob = getSourceField(f, 'Date of Birth', 'DOB');
    const dobParsed = parseSourceDateToIso(rawDob);
    if (!dobParsed.valid) {
      flags.push({
        code: 'INVALID_OR_MISSING_DATE',
        message: `Date of Birth is missing or invalid ('${rawDob ?? ''}').`,
      });
    } else if (dobParsed.isoDate! > referenceDate) {
      flags.push({
        code: 'FUTURE_DATE',
        message: `Date of Birth (${dobParsed.isoDate}) is in the future relative to ${referenceDate}.`,
      });
    }

    const rawJoinService = getSourceField(f, 'Joining of Service', 'Joining Date of Service');
    const serviceParsed = parseSourceDateToIso(rawJoinService);
    if (!serviceParsed.valid) {
      flags.push({
        code: 'INVALID_OR_MISSING_DATE',
        message: `Joining of Service date is missing or invalid ('${rawJoinService ?? ''}').`,
      });
    } else if (serviceParsed.isoDate! > referenceDate) {
      flags.push({
        code: 'FUTURE_DATE',
        message: `Joining of Service (${serviceParsed.isoDate}) is in the future relative to ${referenceDate}.`,
      });
    }

    const rawJoinInstitute = getSourceField(f, 'Joining of Institute', 'Joining Date of Institute');
    const instituteParsed = parseSourceDateToIso(rawJoinInstitute);
    if (!instituteParsed.valid) {
      flags.push({
        code: 'INVALID_OR_MISSING_DATE',
        message: `Joining of Institute date is missing or invalid ('${rawJoinInstitute ?? ''}').`,
      });
    } else if (instituteParsed.isoDate! > referenceDate) {
      flags.push({
        code: 'FUTURE_DATE',
        message: `Joining of Institute (${instituteParsed.isoDate}) is in the future relative to ${referenceDate}.`,
      });
    }

    if (serviceParsed.isoDate && instituteParsed.isoDate) {
      if (instituteParsed.isoDate < serviceParsed.isoDate) {
        flags.push({
          code: 'INSTITUTE_BEFORE_SERVICE_DATE',
          message: `Joining of Institute (${instituteParsed.isoDate}) precedes Joining of Service (${serviceParsed.isoDate}).`,
        });
      }
    }

    // 4. Verbatim Experience & Discrepancy Checks (Never recalculate or overwrite experience)
    const rawExp = getSourceField(f, 'Experience')?.trim() || '';
    const reportedExperience = rawExp && !isDashPlaceholder(rawExp) ? rawExp : null;
    const expMonths = parseExperienceMonthsForComparison(reportedExperience);

    if (serviceParsed.isoDate && expMonths !== null) {
      // Check A: Does Joining of Institute in 2026+ exceed (Joining of Service + Reported Experience)?
      // This catches suspected year typos (e.g. 20/07/2026 when service+experience implies ~May 2026 snapshot).
      if (instituteParsed.isoDate && instituteParsed.isoDate.startsWith('2026-')) {
        const serviceToInstituteMonths = diffMonthsBetweenIsoDates(
          serviceParsed.isoDate,
          instituteParsed.isoDate
        );
        if (serviceToInstituteMonths - expMonths > 1.25) {
          flags.push({
            code: 'SUSPICIOUS_INSTITUTE_JOINING_DATE',
            message: `Joining of Institute (${rawJoinInstitute} -> ${instituteParsed.isoDate}) exceeds Joining of Service (${serviceParsed.isoDate}) + stated Experience ('${reportedExperience}') and may contain a year typo.`,
          });
        }
      }

      // Check B: Does elapsed time from Joining of Service to referenceDate diverge substantially (>14 months) from stated Experience?
      const elapsedToRefMonths = diffMonthsBetweenIsoDates(serviceParsed.isoDate, referenceDate);
      if (Math.abs(elapsedToRefMonths - expMonths) > 14) {
        flags.push({
          code: 'EXPERIENCE_SERVICE_DATE_DISCREPANCY',
          message: `Stated Experience ('${reportedExperience}', ~${expMonths} mos) differs from elapsed span since Joining of Service (${serviceParsed.isoDate}, ~${Math.round(elapsedToRefMonths)} mos as of ${referenceDate}); verify possible service break or date entry.`,
        });
      }
    }

    // 5. Previous Institute
    const rawPrevInst = getSourceField(f, 'Name of Previous Institute', 'Previous Institute');
    let previousInstitute: string | null = null;
    if (rawPrevInst && !isDashPlaceholder(rawPrevInst)) {
      previousInstitute = rawPrevInst.trim();
    } else if (
      serviceParsed.isoDate &&
      instituteParsed.isoDate &&
      diffDaysBetweenIsoDates(serviceParsed.isoDate, instituteParsed.isoDate) > 60
    ) {
      flags.push({
        code: 'MISSING_PREVIOUS_INSTITUTE',
        message: `Joining of Service (${serviceParsed.isoDate}) precedes Joining of Institute (${instituteParsed.isoDate}), but Name of Previous Institute is blank/placeholder.`,
      });
    }

    // 6. Email & Phone (Preserve exact source values; flag missing or non-standard length)
    const rawEmail = getSourceField(f, 'Email ID', 'Email')?.trim() || '';
    let contactEmail: string | null = null;
    if (!rawEmail || isDashPlaceholder(rawEmail)) {
      flags.push({
        code: 'MISSING_EMAIL',
        message: 'Email ID is missing in source.',
      });
    } else {
      contactEmail = rawEmail.toLowerCase();
    }

    const rawPhone = getSourceField(f, 'Phone', 'Contact Phone')?.trim() || '';
    let contactPhone: string | null = null;
    if (!rawPhone || isDashPlaceholder(rawPhone)) {
      flags.push({
        code: 'MISSING_PHONE',
        message: 'Phone number is missing in source.',
      });
    } else {
      contactPhone = rawPhone; // Preserved verbatim (e.g., '08180025339')
      const onlyDigits = rawPhone.replace(/\D/g, '');
      if (onlyDigits.length !== 10) {
        flags.push({
          code: 'NON_STANDARD_PHONE_FORMAT',
          message: `Phone number '${rawPhone}' has ${onlyDigits.length} digits (preserved verbatim; verify formatting).`,
        });
      }
    }

    // 7. Profile Photo URL (only if an actual URL/path is provided in source)
    const rawPhoto = (
      getSourceField(f, 'Profile Photo', 'Profile Photo URL', 'Photo URL') || ''
    ).trim();
    const profilePhotoUrl =
      rawPhoto && (/^https?:\/\//i.test(rawPhoto) || rawPhoto.startsWith('/'))
        ? rawPhoto
        : null;

    const dataVerificationRequired = flags.length > 0;
    const verificationNotes =
      flags.length > 0 ? flags.map((fl) => `[${fl.code}] ${fl.message}`).join(' | ') : null;

    return {
      sourceIndex: idx + 1,
      departmentSourceName: entry.departmentHeader,
      proposedDepartmentCode,
      headingName: entry.headingName,
      fullName,
      designation,
      qualification,
      dateOfBirth: dobParsed.isoDate,
      registrationNumber,
      teacherCode,
      teacherCodeStatus,
      joiningDateService: serviceParsed.isoDate,
      joiningDateInstitute: instituteParsed.isoDate,
      reportedExperience,
      previousInstitute,
      contactEmail,
      contactPhone,
      profilePhotoUrl,
      dataVerificationRequired,
      verificationFlags: flags,
      verificationNotes,
      rawSourceSnapshot: {
        departmentHeader: entry.departmentHeader,
        headingName: entry.headingName,
        fields: { ...f },
      },
    };
  });

  // Check for internal source duplicates
  const sourceInternalDuplicates: FacultyParseResult['sourceInternalDuplicates'] = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      const reasons: string[] = [];

      if (a.teacherCode && b.teacherCode && a.teacherCode === b.teacherCode) {
        reasons.push(`Same Teacher Code (${a.teacherCode})`);
      }
      const regA = normalizeRegNoForMatch(a.registrationNumber);
      const regB = normalizeRegNoForMatch(b.registrationNumber);
      if (regA && regB && regA === regB) {
        reasons.push(`Same Reg. No (${a.registrationNumber})`);
      }
      if (a.contactEmail && b.contactEmail && a.contactEmail === b.contactEmail) {
        reasons.push(`Same Email (${a.contactEmail})`);
      }
      const phA = normalizePhoneForMatch(a.contactPhone);
      const phB = normalizePhoneForMatch(b.contactPhone);
      if (phA.length >= 10 && phA === phB) {
        reasons.push(`Same Phone (${a.contactPhone})`);
      }
      const nameA = normalizeFacultyNameForMatch(a.fullName);
      const nameB = normalizeFacultyNameForMatch(b.fullName);
      if (nameA && nameA === nameB && a.dateOfBirth && a.dateOfBirth === b.dateOfBirth) {
        reasons.push(`Same Name + DOB (${a.fullName}, ${a.dateOfBirth})`);
      }

      if (reasons.length > 0) {
        sourceInternalDuplicates.push({
          indexA: a.sourceIndex,
          nameA: a.fullName,
          indexB: b.sourceIndex,
          nameB: b.fullName,
          reasons,
        });
      }
    }
  }

  return {
    records,
    departmentsInOrder,
    ignoredTrailingNoiseLines,
    sourceInternalDuplicates,
  };
}

export interface ExistingDepartmentRow {
  id: number;
  code: string;
  name: string;
  description?: string | null;
}

export type DepartmentResolutionOutcome =
  | {
      status: 'REUSE_EXISTING';
      sourceDepartmentName: string;
      proposedCode: string;
      departmentId: number;
      matchedDepartment: ExistingDepartmentRow;
    }
  | {
      status: 'CREATE_NEW';
      sourceDepartmentName: string;
      proposedCode: string;
      description: string;
    }
  | {
      status: 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED';
      sourceDepartmentName: string;
      proposedCode: string;
      reason: string;
      candidateDepartments: ExistingDepartmentRow[];
    };

/**
 * Resolves a source department against existing `departments` rows:
 * - Reuses an exact normalized name or exact proposed code match when unambiguous.
 * - Flags `AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED` (and refuses to create a duplicate department)
 *   if code and name match different rows, multiple rows match, or an existing department partially
 *   matches the subject's distinctive tokens under a different name/spelling.
 */
export function resolveDepartmentMapping(
  sourceDepartmentName: string,
  existingDepartments: ExistingDepartmentRow[]
): DepartmentResolutionOutcome {
  const spec = findCanonicalDepartmentSpec(sourceDepartmentName);
  const proposedCode =
    spec?.proposedCode || generateFallbackDepartmentCode(sourceDepartmentName);
  const description = spec?.description || `Department of ${sourceDepartmentName}`;
  const targetNormName = normalizeDepartmentComparisonKey(sourceDepartmentName);

  const exactNameMatches = existingDepartments.filter(
    (d) => normalizeDepartmentComparisonKey(d.name) === targetNormName
  );
  const exactCodeMatches = existingDepartments.filter(
    (d) => d.code.trim().toUpperCase() === proposedCode.toUpperCase()
  );

  const combinedExactMap = new Map<number, ExistingDepartmentRow>();
  for (const d of [...exactNameMatches, ...exactCodeMatches]) {
    combinedExactMap.set(Number(d.id), d);
  }
  const combinedExact = Array.from(combinedExactMap.values());

  if (combinedExact.length === 1) {
    // Check if the single match matched by code ONLY while having a completely unrelated name
    const matched = combinedExact[0];
    const isSameNormName = normalizeDepartmentComparisonKey(matched.name) === targetNormName;
    if (!isSameNormName && spec) {
      const matchedTokens = normalizeDepartmentComparisonKey(matched.name).split(/\s+/);
      const sharesToken = spec.distinctiveTokens.some((tok) =>
        matchedTokens.some((mt) => mt === tok || mt.includes(tok))
      );
      if (!sharesToken) {
        return {
          status: 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED',
          sourceDepartmentName,
          proposedCode,
          reason: `Existing department #${matched.id} uses code '${matched.code}' with conflicting name '${matched.name}'.`,
          candidateDepartments: [matched],
        };
      }
    }
    return {
      status: 'REUSE_EXISTING',
      sourceDepartmentName,
      proposedCode,
      departmentId: Number(matched.id),
      matchedDepartment: matched,
    };
  }

  if (combinedExact.length > 1) {
    return {
      status: 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED',
      sourceDepartmentName,
      proposedCode,
      reason: `Multiple existing departments match '${sourceDepartmentName}' / code '${proposedCode}'.`,
      candidateDepartments: combinedExact,
    };
  }

  // No exact match — check distinctive subject tokens for partial/variant existing departments
  const tokensToCheck = spec?.distinctiveTokens || targetNormName.split(/\s+/).filter((w) => w.length >= 5);
  const fuzzyCandidates = existingDepartments.filter((d) => {
    const words = `${normalizeDepartmentComparisonKey(d.name)} ${d.code.toLowerCase().replace(/[^a-z0-9]+/g, ' ')}`
      .split(/\s+/)
      .filter(Boolean);
    return tokensToCheck.some((tok) =>
      words.some((w) => w === tok || (tok.length >= 6 && w.includes(tok)))
    );
  });

  if (fuzzyCandidates.length > 0) {
    return {
      status: 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED',
      sourceDepartmentName,
      proposedCode,
      reason: `Existing department(s) [${fuzzyCandidates
        .map((c) => `#${c.id} '${c.name}' (${c.code})`)
        .join(', ')}] partially match '${sourceDepartmentName}'. Refusing to create a duplicate department automatically.`,
      candidateDepartments: fuzzyCandidates,
    };
  }

  return {
    status: 'CREATE_NEW',
    sourceDepartmentName,
    proposedCode,
    description,
  };
}

export interface ExistingTeacherRow {
  id: number;
  employee_code?: string | null;
  teacher_code?: string | null;
  teacher_code_status?: string | null;
  registration_number?: string | null;
  full_name: string;
  designation: string;
  department_id: number;
  date_of_birth?: unknown;
  contact_phone?: string | null;
  contact_email?: string | null;
  status?: string;
}

export type DuplicateCheckOutcome =
  | { kind: 'NO_MATCH' }
  | {
      kind: 'ALREADY_IMPORTED_IDEMPOTENT';
      existingTeacher: ExistingTeacherRow;
      reason: string;
    }
  | {
      kind: 'POTENTIAL_DUPLICATE_CONFLICT';
      existingTeachers: ExistingTeacherRow[];
      reasons: string[];
    };

/**
 * Classifies an incoming source faculty record against existing `teachers` rows
 * without ever merging, overwriting, or deleting existing records.
 */
export function classifyTeacherAgainstExisting(
  incoming: ParsedFacultyRecord,
  existingTeachers: ExistingTeacherRow[]
): DuplicateCheckOutcome {
  const inName = normalizeFacultyNameForMatch(incoming.fullName);
  const inReg = normalizeRegNoForMatch(incoming.registrationNumber);
  const inEmail = incoming.contactEmail ? incoming.contactEmail.trim().toLowerCase() : '';
  const inPhone = normalizePhoneForMatch(incoming.contactPhone);
  const inTc = incoming.teacherCode ? incoming.teacherCode.trim().toUpperCase() : '';

  // 1. Check exact idempotent match from a previous import run
  for (const ex of existingTeachers) {
    const exTc = ex.teacher_code ? String(ex.teacher_code).trim().toUpperCase() : '';
    const exName = normalizeFacultyNameForMatch(ex.full_name || '');
    const exDob = toIsoDateOnly(ex.date_of_birth);
    const exEmail = ex.contact_email ? String(ex.contact_email).trim().toLowerCase() : '';

    if (inTc && exTc && inTc === exTc && inName === exName) {
      return {
        kind: 'ALREADY_IMPORTED_IDEMPOTENT',
        existingTeacher: ex,
        reason: `Exact Teacher Code (${inTc}) and Name match existing teacher #${ex.id}.`,
      };
    }

    if (
      !inTc &&
      incoming.teacherCodeStatus === 'APPLIED' &&
      !exTc &&
      ex.teacher_code_status === 'APPLIED' &&
      inName === exName &&
      incoming.dateOfBirth &&
      exDob === incoming.dateOfBirth &&
      inEmail &&
      exEmail === inEmail
    ) {
      return {
        kind: 'ALREADY_IMPORTED_IDEMPOTENT',
        existingTeacher: ex,
        reason: `Exact Name, DOB (${incoming.dateOfBirth}), Email, and APPLIED teacher-code status match existing teacher #${ex.id}.`,
      };
    }
  }

  // 2. Check any potential duplicate / identifier collision
  const matchedRows: ExistingTeacherRow[] = [];
  const allReasons: string[] = [];

  for (const ex of existingTeachers) {
    const rowReasons: string[] = [];
    const exTc = ex.teacher_code ? String(ex.teacher_code).trim().toUpperCase() : '';
    const exEmp = ex.employee_code ? String(ex.employee_code).trim().toUpperCase() : '';
    const exReg = normalizeRegNoForMatch(ex.registration_number);
    const exEmail = ex.contact_email ? String(ex.contact_email).trim().toLowerCase() : '';
    const exPhone = normalizePhoneForMatch(ex.contact_phone);
    const exName = normalizeFacultyNameForMatch(ex.full_name || '');
    const exDob = toIsoDateOnly(ex.date_of_birth);

    if (inTc && exTc && inTc === exTc) {
      rowReasons.push(`Teacher Code '${inTc}' already assigned to #${ex.id} (${ex.full_name})`);
    }
    if (inTc && exEmp && inTc === exEmp) {
      rowReasons.push(`Teacher Code '${inTc}' matches existing employee_code on #${ex.id} (${ex.full_name})`);
    }
    if (inReg && exReg && inReg === exReg) {
      rowReasons.push(`Reg. No '${incoming.registrationNumber}' matches #${ex.id} (${ex.full_name})`);
    }
    if (inEmail && exEmail && inEmail === exEmail) {
      rowReasons.push(`Email '${inEmail}' matches #${ex.id} (${ex.full_name})`);
    }
    if (inPhone.length >= 10 && exPhone.length >= 10 && inPhone === exPhone) {
      rowReasons.push(`Phone '${incoming.contactPhone}' matches #${ex.id} (${ex.full_name})`);
    }
    if (inName && exName && inName === exName) {
      if (!exDob || !incoming.dateOfBirth || exDob === incoming.dateOfBirth) {
        rowReasons.push(
          `Normalized Name '${incoming.fullName}'${exDob ? ` + DOB (${exDob})` : ' (existing DOB unset)'} matches #${ex.id} (${ex.full_name})`
        );
      }
    }

    if (rowReasons.length > 0) {
      matchedRows.push(ex);
      allReasons.push(...rowReasons);
    }
  }

  if (matchedRows.length > 0) {
    return {
      kind: 'POTENTIAL_DUPLICATE_CONFLICT',
      existingTeachers: matchedRows,
      reasons: allReasons,
    };
  }

  return { kind: 'NO_MATCH' };
}

export interface SqlConnectionLike {
  query: (sql: string, params?: any[]) => Promise<[any, any]>;
  beginTransaction?: () => Promise<void>;
  commit?: () => Promise<void>;
  rollback?: () => Promise<void>;
}

/**
 * Enforces a hard zero-write barrier during `--dry-run`: rejects any SQL statement
 * other than read-only `SELECT` queries and blocks transaction mutations.
 */
export function createReadOnlyConnectionGuard(conn: SqlConnectionLike): {
  guardedConnection: SqlConnectionLike;
  getExecutedQueries: () => string[];
} {
  const executedQueries: string[] = [];

  const guardedConnection: SqlConnectionLike = {
    query: async (sql: string, params?: any[]) => {
      const normalized = sql.trim().replace(/^\/\*[\s\S]*?\*\/\s*/, '').toUpperCase();
      if (!normalized.startsWith('SELECT ') && normalized !== 'SELECT 1') {
        throw new Error(
          `[DRY_RUN_WRITE_VIOLATION] Blocked non-SELECT statement during dry-run: ${sql.slice(0, 120)}`
        );
      }
      executedQueries.push(sql.trim());
      return conn.query(sql, params);
    },
    beginTransaction: async () => {
      throw new Error('[DRY_RUN_WRITE_VIOLATION] Transactions are prohibited during dry-run.');
    },
    commit: async () => {
      throw new Error('[DRY_RUN_WRITE_VIOLATION] Commits are prohibited during dry-run.');
    },
    rollback: async () => {
      throw new Error('[DRY_RUN_WRITE_VIOLATION] Rollbacks are prohibited during dry-run.');
    },
  };

  return {
    guardedConnection,
    getExecutedQueries: () => [...executedQueries],
  };
}

export interface FacultyImportRecordPlan {
  record: ParsedFacultyRecord;
  disposition:
    | 'READY_TO_INSERT'
    | 'INSERTED'
    | 'SKIPPED_IDEMPOTENT'
    | 'SKIPPED_POTENTIAL_DUPLICATE'
    | 'SKIPPED_AMBIGUOUS_DEPARTMENT'
    | 'SKIPPED_INTERNAL_SOURCE_DUPLICATE';
  reason?: string;
  matchedExistingIds?: number[];
  insertedTeacherId?: number;
}

export interface FacultyImportSummaryReport {
  mode: 'DRY_RUN' | 'APPLY';
  referenceDate: string;
  schemaStatus: {
    teachersTableExists: boolean;
    departmentsTableExists: boolean;
    migrationReady: boolean;
    missingTeacherColumns: string[];
  };
  existingDatabaseCounts: {
    departmentsCount: number;
    teachersCount: number;
  };
  sourceSummary: {
    totalParsedRecords: number;
    totalSourceDepartments: number;
    ignoredTrailingNoiseLines: number;
    flaggedForVerificationCount: number;
    cleanRecordsCount: number;
    sourceInternalDuplicatesCount: number;
  };
  departmentResolutions: DepartmentResolutionOutcome[];
  counts: {
    readyOrInserted: number;
    skippedIdempotent: number;
    skippedPotentialDuplicate: number;
    skippedAmbiguousDepartment: number;
    skippedInternalSourceDuplicate: number;
    departmentsCreated: number;
    departmentsReused: number;
    departmentsAmbiguous: number;
  };
  recordPlans: FacultyImportRecordPlan[];
}

export async function runFacultyImportWorkflow(options: {
  connection: SqlConnectionLike;
  mode: 'DRY_RUN' | 'APPLY';
  sourceText?: string;
  sourceFilePath?: string;
  referenceDate?: string;
  actorUserId?: number | null;
}): Promise<FacultyImportSummaryReport> {
  const { mode } = options;
  const referenceDate = options.referenceDate || getTodayIsoLocal();
  const sourceContent =
    options.sourceText !== undefined
      ? options.sourceText
      : fs.readFileSync(options.sourceFilePath || DEFAULT_FACULTY_SOURCE_PATH, 'utf8');

  const parsed = parseFacultySourceDocument(sourceContent, { referenceDate });

  const readGuard =
    mode === 'DRY_RUN' ? createReadOnlyConnectionGuard(options.connection) : null;
  const conn = readGuard ? readGuard.guardedConnection : options.connection;

  // 1. Inspect schema readiness via read-only INFORMATION_SCHEMA queries
  const [deptTableRows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    ['departments']
  );
  const [teacherTableRows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    ['teachers']
  );
  const departmentsTableExists = Number(deptTableRows?.[0]?.cnt || 0) > 0;
  const teachersTableExists = Number(teacherTableRows?.[0]?.cnt || 0) > 0;

  let existingTeacherCols = new Set<string>();
  if (teachersTableExists) {
    const [colRows] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      ['teachers']
    );
    existingTeacherCols = new Set(
      (colRows || []).map((r: any) => String(r.COLUMN_NAME || r.column_name || '').toLowerCase())
    );
  }

  const missingTeacherColumns = teachersTableExists
    ? REQUIRED_TEACHER_MIGRATION_COLUMNS.filter((c) => !existingTeacherCols.has(c))
    : [...REQUIRED_TEACHER_MIGRATION_COLUMNS];

  const migrationReady =
    departmentsTableExists && teachersTableExists && missingTeacherColumns.length === 0;

  if (mode === 'APPLY' && !migrationReady) {
    throw new Error(
      `Schema migration 'teacher_records_v1' has not been applied yet (missing: ${
        !departmentsTableExists
          ? 'departments table'
          : !teachersTableExists
          ? 'teachers table'
          : missingTeacherColumns.join(', ')
      }). Run "npm run db:migrate" first, then re-run the import.`
    );
  }

  // 2. Read existing departments and teachers (using only columns confirmed to exist!)
  const existingDepartments: ExistingDepartmentRow[] = departmentsTableExists
    ? ((await conn.query('SELECT id, code, name, description FROM departments ORDER BY id ASC'))[0] || [])
    : [];

  let existingTeachers: ExistingTeacherRow[] = [];
  if (teachersTableExists) {
    const selectableCols = [
      'id',
      'employee_code',
      'full_name',
      'designation',
      'department_id',
      'contact_phone',
      'contact_email',
      'status',
    ];
    for (const optCol of ['teacher_code', 'teacher_code_status', 'registration_number', 'date_of_birth']) {
      if (existingTeacherCols.has(optCol)) {
        selectableCols.push(optCol);
      }
    }
    const [tRows] = await conn.query(
      `SELECT ${selectableCols.join(', ')} FROM teachers ORDER BY id ASC`
    );
    existingTeachers = tRows || [];
  }

  // 3. Resolve all source departments without mutating DB yet
  const departmentResolutions: DepartmentResolutionOutcome[] = parsed.departmentsInOrder.map(
    (deptName) => resolveDepartmentMapping(deptName, existingDepartments)
  );
  const deptResolutionByName = new Map<string, DepartmentResolutionOutcome>();
  for (const res of departmentResolutions) {
    deptResolutionByName.set(res.sourceDepartmentName, res);
  }

  const internalDupIndexes = new Set<number>();
  for (const d of parsed.sourceInternalDuplicates) {
    internalDupIndexes.add(d.indexA);
    internalDupIndexes.add(d.indexB);
  }

  // 4. Plan each of the 53 records
  const recordPlans: FacultyImportRecordPlan[] = parsed.records.map((rec) => {
    if (internalDupIndexes.has(rec.sourceIndex)) {
      return {
        record: rec,
        disposition: 'SKIPPED_INTERNAL_SOURCE_DUPLICATE',
        reason: 'Record shares an identifier with another entry inside the source file.',
      };
    }

    const deptRes = deptResolutionByName.get(rec.departmentSourceName);
    if (!deptRes || deptRes.status === 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED') {
      return {
        record: rec,
        disposition: 'SKIPPED_AMBIGUOUS_DEPARTMENT',
        reason:
          deptRes?.status === 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED'
            ? deptRes.reason
            : `Unresolved department '${rec.departmentSourceName}'`,
        matchedExistingIds:
          deptRes?.status === 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED'
            ? deptRes.candidateDepartments.map((c) => Number(c.id))
            : [],
      };
    }

    const dupOutcome = classifyTeacherAgainstExisting(rec, existingTeachers);
    if (dupOutcome.kind === 'ALREADY_IMPORTED_IDEMPOTENT') {
      return {
        record: rec,
        disposition: 'SKIPPED_IDEMPOTENT',
        reason: dupOutcome.reason,
        matchedExistingIds: [Number(dupOutcome.existingTeacher.id)],
      };
    }

    if (dupOutcome.kind === 'POTENTIAL_DUPLICATE_CONFLICT') {
      return {
        record: rec,
        disposition: 'SKIPPED_POTENTIAL_DUPLICATE',
        reason: dupOutcome.reasons.join('; '),
        matchedExistingIds: dupOutcome.existingTeachers.map((t) => Number(t.id)),
      };
    }

    return {
      record: rec,
      disposition: 'READY_TO_INSERT',
    };
  });

  let departmentsCreated = 0;
  const departmentsReused = departmentResolutions.filter(
    (d) => d.status === 'REUSE_EXISTING'
  ).length;
  const departmentsAmbiguous = departmentResolutions.filter(
    (d) => d.status === 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED'
  ).length;

  // 5. If APPLY mode and there is work to perform, execute atomically inside a transaction
  if (mode === 'APPLY') {
    const actionablePlans = recordPlans.filter((p) => p.disposition === 'READY_TO_INSERT');
    if (actionablePlans.length > 0) {
      if (conn.beginTransaction) await conn.beginTransaction();
      try {
        const actionableDeptNames = new Set(
          actionablePlans.map((p) => p.record.departmentSourceName)
        );
        const resolvedDeptIdMap = new Map<string, number>();
        for (const res of departmentResolutions) {
          if (res.status === 'REUSE_EXISTING') {
            resolvedDeptIdMap.set(res.sourceDepartmentName, res.departmentId);
          } else if (
            res.status === 'CREATE_NEW' &&
            actionableDeptNames.has(res.sourceDepartmentName)
          ) {
            const [insDept] = await conn.query(
              'INSERT INTO departments (code, name, description) VALUES (?, ?, ?)',
              [res.proposedCode, res.sourceDepartmentName, res.description]
            );
            resolvedDeptIdMap.set(res.sourceDepartmentName, Number(insDept.insertId));
            departmentsCreated++;
          }
        }

        let insertedCount = 0;
        for (const plan of actionablePlans) {
          const r = plan.record;
          const targetDeptId = resolvedDeptIdMap.get(r.departmentSourceName);
          if (!targetDeptId) {
            plan.disposition = 'SKIPPED_AMBIGUOUS_DEPARTMENT';
            plan.reason = `Department '${r.departmentSourceName}' has no resolved target ID.`;
            continue;
          }

          const [insTeacher] = await conn.query(
            `INSERT INTO teachers (
              employee_code,
              teacher_code,
              teacher_code_status,
              registration_number,
              full_name,
              designation,
              department_id,
              qualification,
              date_of_birth,
              joining_date_service,
              joining_date_institute,
              reported_experience,
              previous_institute,
              contact_phone,
              contact_email,
              profile_photo_url,
              status,
              data_verification_required,
              verification_notes,
              raw_source_snapshot,
              created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
            [
              null, // Never fabricate internal HR employee_code
              r.teacherCode,
              r.teacherCodeStatus,
              r.registrationNumber,
              r.fullName,
              r.designation,
              targetDeptId,
              r.qualification,
              r.dateOfBirth,
              r.joiningDateService,
              r.joiningDateInstitute,
              r.reportedExperience,
              r.previousInstitute,
              r.contactPhone,
              r.contactEmail,
              r.profilePhotoUrl,
              r.dataVerificationRequired,
              r.verificationNotes,
              JSON.stringify(r.rawSourceSnapshot),
              options.actorUserId ?? null,
            ]
          );

          plan.disposition = 'INSERTED';
          plan.insertedTeacherId = Number(insTeacher.insertId);
          insertedCount++;
        }

        if (insertedCount > 0 || departmentsCreated > 0) {
          await conn.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, ip_address, details)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              options.actorUserId ?? null,
              'FACULTY_BULK_IMPORT',
              'TEACHERS',
              'BULK',
              '127.0.0.1',
              JSON.stringify({
                insertedFacultyCount: insertedCount,
                departmentsCreated,
                departmentsReused,
                flaggedForVerificationCount: actionablePlans.filter(
                  (p) => p.disposition === 'INSERTED' && p.record.dataVerificationRequired
                ).length,
                referenceDate,
              }),
            ]
          );
        }

        if (conn.commit) await conn.commit();
      } catch (err) {
        if (conn.rollback) await conn.rollback();
        throw err;
      }
    }
  }

  const flaggedForVerificationCount = parsed.records.filter(
    (r) => r.dataVerificationRequired
  ).length;

  return {
    mode,
    referenceDate,
    schemaStatus: {
      teachersTableExists,
      departmentsTableExists,
      migrationReady,
      missingTeacherColumns,
    },
    existingDatabaseCounts: {
      departmentsCount: existingDepartments.length,
      teachersCount: existingTeachers.length,
    },
    sourceSummary: {
      totalParsedRecords: parsed.records.length,
      totalSourceDepartments: parsed.departmentsInOrder.length,
      ignoredTrailingNoiseLines: parsed.ignoredTrailingNoiseLines,
      flaggedForVerificationCount,
      cleanRecordsCount: parsed.records.length - flaggedForVerificationCount,
      sourceInternalDuplicatesCount: parsed.sourceInternalDuplicates.length,
    },
    departmentResolutions,
    counts: {
      readyOrInserted: recordPlans.filter(
        (p) => p.disposition === 'READY_TO_INSERT' || p.disposition === 'INSERTED'
      ).length,
      skippedIdempotent: recordPlans.filter((p) => p.disposition === 'SKIPPED_IDEMPOTENT').length,
      skippedPotentialDuplicate: recordPlans.filter(
        (p) => p.disposition === 'SKIPPED_POTENTIAL_DUPLICATE'
      ).length,
      skippedAmbiguousDepartment: recordPlans.filter(
        (p) => p.disposition === 'SKIPPED_AMBIGUOUS_DEPARTMENT'
      ).length,
      skippedInternalSourceDuplicate: recordPlans.filter(
        (p) => p.disposition === 'SKIPPED_INTERNAL_SOURCE_DUPLICATE'
      ).length,
      departmentsCreated:
        mode === 'DRY_RUN'
          ? departmentResolutions.filter((d) => d.status === 'CREATE_NEW').length
          : departmentsCreated,
      departmentsReused,
      departmentsAmbiguous,
    },
    recordPlans,
  };
}
