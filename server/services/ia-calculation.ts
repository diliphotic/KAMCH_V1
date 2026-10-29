import { PoolConnection } from 'mysql2/promise';
import { getPool } from '../db.ts';

export type AssessmentOutcome = 'MARKS_ENTERED' | 'ABSENT' | 'NOT_APPEARED' | 'EXEMPTED';
export type IaCalculationStatus = 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';

export interface TermPatMapping {
  A: string;
  B: string;
  C: string;
}

export interface PatMappingConfig {
  term1: TermPatMapping;
  term2: TermPatMapping;
  term3: TermPatMapping;
}

export interface SubjectIaProfile {
  id: number;
  code: string;
  name: string;
  iaMaximum: number;
  isIaEnabled: boolean;
  iaCalculationRule: string | null;
  iaFormulaVerified: boolean;
  patMappingVerified: boolean;
  patMappingConfig: PatMappingConfig | null;
}

export interface BatchSchemeProfile {
  id: number;
  code: string;
  name: string;
  schemeCode: string | null;
  isLegacyMinimal: boolean;
}

export interface SubmittedAssessmentRecord {
  assessmentId: number;
  assessmentCode: string;
  assessmentName: string;
  assessmentType: 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM';
  termNumber: number;
  outcome: AssessmentOutcome;
  theoryMarks: number | null;
  practicalMarks: number | null;
  submittedAt?: string | null;
}

export interface TermTestConversionResult {
  assessmentId: number;
  assessmentCode: string;
  termNumber: 1 | 2;
  outcome: AssessmentOutcome;
  rawTheoryMarks: number | null;
  rawPracticalMarks: number | null;
  combinedRawMarks: number | null;
  conversionMaximum: 15 | 30;
  unroundedConvertedMarks: number | null;
  convertedMarks: number | null;
  conversionStatus: 'CONVERTED' | 'PENDING_OUTCOME_RULE';
  statusReason: string | null;
}

export interface PeriodicTermResult {
  termNumber: 1 | 2 | 3;
  inputCodes: TermPatMapping;
  A: number | null;
  B: number | null;
  C: number | null;
  unroundedD: number | null;
  D: number | null;
  unroundedE: number | null;
  E: number | null;
  missingOrBlockedReason: string | null;
}

export interface StudentAutomaticIaEvaluation {
  calculationStatus: IaCalculationStatus;
  statusReason: string | null;
  iaMaximum: 15 | 30 | null;
  schemeCode: string | null;
  termTestConversions: TermTestConversionResult[];
  term1: {
    A: number | null;
    B: number | null;
    C: number | null;
    D: number | null;
    E: number | null;
    F: number | null;
    H: number | null;
  };
  term2: {
    A: number | null;
    B: number | null;
    C: number | null;
    D: number | null;
    E: number | null;
    F: number | null;
    H: number | null;
  };
  term3: {
    A: number | null;
    B: number | null;
    C: number | null;
    D: number | null;
    E: number | null;
    H: number | null;
  };
  finalAutomaticIa: number | null;
  sourceAssessments: {
    patMappingVerified: boolean;
    patMapping: PatMappingConfig | null;
    submittedCodes: string[];
    usedInCalculation: string[];
    missingRequiredCodes: string[];
  };
}

const VALID_PAT_CODES = new Set([
  'PAT_1',
  'PAT_2',
  'PAT_3',
  'PAT_4',
  'PAT_5',
  'PAT_6',
  'PAT_7',
  'PAT_8',
  'PAT_9',
]);

/**
 *Confirmed 9 verified subjects per KAMCH curriculum rules:
 * - 15 marks: Samhita Adhyayana 1, 2, 3
 * - 30 marks: Kayachikitsa, Panchakarma, Shalya Tantra, Prasuti Tantra evam Stree Roga, Shalakya Tantra, Kaumarabhritya
 */
export const VERIFIED_IA_SUBJECT_MAXIMA: Record<string, 15 | 30> = {
  SAMHITA_1: 15,
  SAMHITA_2: 15,
  SAMHITA_3: 15,
  KAYACHIKITSA: 30,
  PANCHAKARMA: 30,
  SHALYA_TANTRA: 30,
  PRASUTI_TANTRA: 30,
  SHALAKYA_TANTRA: 30,
  KAUMARABHRITYA: 30,
};

/**
 * Consistent 2-decimal precision helper applied ONLY at stored/displayed boundaries,
 * never during intermediate formula steps.
 */
export function roundConsistent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Validates an explicit PAT-to-periodic-input (A, B, C) configuration object.
 * Requires explicit PAT_1..PAT_9 assignments for Term 1, Term 2, and Term 3 with no duplicates within a term.
 */
export function validatePatMappingConfig(
  raw: unknown
): { valid: true; config: PatMappingConfig } | { valid: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'PAT mapping configuration must define term1, term2, and term3 inputs (A, B, C).' };
  }

  const candidate = raw as Record<string, any>;
  const terms: Array<'term1' | 'term2' | 'term3'> = ['term1', 'term2', 'term3'];
  const normalized: Partial<PatMappingConfig> = {};

  for (const termKey of terms) {
    const t = candidate[termKey];
    if (!t || typeof t !== 'object') {
      return { valid: false, error: `Missing periodic input mapping for ${termKey}.` };
    }
    const A = String(t.A || '').trim().toUpperCase();
    const B = String(t.B || '').trim().toUpperCase();
    const C = String(t.C || '').trim().toUpperCase();

    if (!VALID_PAT_CODES.has(A) || !VALID_PAT_CODES.has(B) || !VALID_PAT_CODES.has(C)) {
      return {
        valid: false,
        error: `Invalid PAT code in ${termKey}. Inputs A, B, and C must reference PAT_1 through PAT_9.`,
      };
    }

    if (new Set([A, B, C]).size !== 3) {
      return {
        valid: false,
        error: `Inputs A, B, and C within ${termKey} must reference three distinct PAT assessments.`,
      };
    }

    normalized[termKey] = { A, B, C };
  }

  return {
    valid: true,
    config: normalized as PatMappingConfig,
  };
}

/**
 * Pure formula: Term-test conversion (Theory + Practical out of 200 -> 15 or 30).
 * Validates raw mark bounds (0..100 each) and preserves unrounded intermediate value.
 */
export function computeTermTestConversion(params: {
  assessmentId: number;
  assessmentCode: string;
  termNumber: 1 | 2;
  outcome: AssessmentOutcome;
  rawTheoryMarks: number | null;
  rawPracticalMarks: number | null;
  conversionMaximum: 15 | 30;
}): TermTestConversionResult {
  const {
    assessmentId,
    assessmentCode,
    termNumber,
    outcome,
    rawTheoryMarks,
    rawPracticalMarks,
    conversionMaximum,
  } = params;

  if (conversionMaximum !== 15 && conversionMaximum !== 30) {
    throw new Error(`Invalid term-test conversion maximum: ${conversionMaximum}. Expected 15 or 30.`);
  }

  if (outcome === 'NOT_APPEARED' || outcome === 'EXEMPTED') {
    return {
      assessmentId,
      assessmentCode,
      termNumber,
      outcome,
      rawTheoryMarks: null,
      rawPracticalMarks: null,
      combinedRawMarks: null,
      conversionMaximum,
      unroundedConvertedMarks: null,
      convertedMarks: null,
      conversionStatus: 'PENDING_OUTCOME_RULE',
      statusReason: `Outcome '${outcome}' in ${assessmentCode} has no assumed exclusion or zero-mark rule.`,
    };
  }

  let theory = 0;
  let practical = 0;

  if (outcome === 'ABSENT') {
    theory = 0;
    practical = 0;
  } else {
    if (
      rawTheoryMarks === null ||
      rawTheoryMarks === undefined ||
      Number.isNaN(Number(rawTheoryMarks)) ||
      rawPracticalMarks === null ||
      rawPracticalMarks === undefined ||
      Number.isNaN(Number(rawPracticalMarks))
    ) {
      throw new Error(`Missing theory or practical marks for ${assessmentCode} with MARKS_ENTERED outcome.`);
    }
    theory = Number(rawTheoryMarks);
    practical = Number(rawPracticalMarks);

    if (theory < 0 || theory > 100) {
      throw new Error(`Term-test theory marks out of valid range [0, 100]: received ${theory}.`);
    }
    if (practical < 0 || practical > 100) {
      throw new Error(`Term-test practical marks out of valid range [0, 100]: received ${practical}.`);
    }
  }

  const combined = theory + practical;
  const unroundedF = (combined / 200) * conversionMaximum;

  return {
    assessmentId,
    assessmentCode,
    termNumber,
    outcome,
    rawTheoryMarks: roundConsistent(theory),
    rawPracticalMarks: roundConsistent(practical),
    combinedRawMarks: roundConsistent(combined),
    conversionMaximum,
    unroundedConvertedMarks: unroundedF,
    convertedMarks: roundConsistent(unroundedF),
    conversionStatus: 'CONVERTED',
    statusReason: null,
  };
}

/**
 * Pure formula: Periodic assessment for a single term given verified PAT inputs A, B, C (each out of 15):
 * D = (A + B + C) / 3
 * E = (D / 15) * iaMaximum
 */
export function computePeriodicTermAssessment(params: {
  termNumber: 1 | 2 | 3;
  mapping: TermPatMapping;
  submittedByCode: Map<string, SubmittedAssessmentRecord>;
  iaMaximum: 15 | 30;
}): PeriodicTermResult {
  const { termNumber, mapping, submittedByCode, iaMaximum } = params;

  if (iaMaximum !== 15 && iaMaximum !== 30) {
    throw new Error(`Invalid IA maximum: ${iaMaximum}. Expected 15 or 30.`);
  }

  const resolveInput = (code: string): { value: number | null; reason: string | null } => {
    const rec = submittedByCode.get(code);
    if (!rec) {
      return { value: null, reason: `${code} is not yet submitted` };
    }
    if (rec.outcome === 'NOT_APPEARED' || rec.outcome === 'EXEMPTED') {
      return {
        value: null,
        reason: `Outcome '${rec.outcome}' in ${code} requires institutional review (no exclusion rule assumed)`,
      };
    }
    if (rec.outcome === 'ABSENT') {
      return { value: 0, reason: null };
    }
    if (rec.theoryMarks === null || rec.theoryMarks === undefined || Number.isNaN(Number(rec.theoryMarks))) {
      return { value: null, reason: `Missing numeric PAT marks in ${code}` };
    }
    const mark = Number(rec.theoryMarks);
    if (mark < 0 || mark > 15) {
      throw new Error(`PAT marks in ${code} out of valid range [0, 15]: received ${mark}.`);
    }
    return { value: mark, reason: null };
  };

  const resA = resolveInput(mapping.A);
  const resB = resolveInput(mapping.B);
  const resC = resolveInput(mapping.C);

  const reasons = [resA.reason, resB.reason, resC.reason].filter(Boolean) as string[];
  if (reasons.length > 0 || resA.value === null || resB.value === null || resC.value === null) {
    return {
      termNumber,
      inputCodes: mapping,
      A: resA.value !== null ? roundConsistent(resA.value) : null,
      B: resB.value !== null ? roundConsistent(resB.value) : null,
      C: resC.value !== null ? roundConsistent(resC.value) : null,
      unroundedD: null,
      D: null,
      unroundedE: null,
      E: null,
      missingOrBlockedReason: reasons.join('; '),
    };
  }

  const unroundedD = (resA.value + resB.value + resC.value) / 3;
  const unroundedE = (unroundedD / 15) * iaMaximum;

  return {
    termNumber,
    inputCodes: mapping,
    A: roundConsistent(resA.value),
    B: roundConsistent(resB.value),
    C: roundConsistent(resC.value),
    unroundedD,
    D: roundConsistent(unroundedD),
    unroundedE,
    E: roundConsistent(unroundedE),
    missingOrBlockedReason: null,
  };
}

/**
 * Pure deterministic evaluator for a student's Automatic IA across all 3 terms.
 * Enforces:
 * - Research Methodology & Atyaikachikitsa exclusions
 * - Legacy RS6 exclusion
 * - Verified 15/30 subject maxima check
 * - Critical PAT mapping restriction (never averages all 9 PATs or assumes unverified mapping)
 * - Unrounded intermediate precision for D, E, F, H1, H2, H3 -> Final Automatic IA
 */
export function evaluateStudentAutomaticIA(params: {
  subject: SubjectIaProfile;
  batch: BatchSchemeProfile;
  submittedRecords: SubmittedAssessmentRecord[];
}): StudentAutomaticIaEvaluation {
  const { subject, batch, submittedRecords } = params;

  const emptyTerm12 = { A: null, B: null, C: null, D: null, E: null, F: null, H: null };
  const emptyTerm3 = { A: null, B: null, C: null, D: null, E: null, H: null };
  const submittedCodes = submittedRecords.map((r) => r.assessmentCode).sort();

  // 1. Explicit Subject & Scheme Exclusions
  if (subject.code === 'RESEARCH_METHODOLOGY' || subject.iaCalculationRule === 'NO_IA') {
    return {
      calculationStatus: 'NOT_APPLICABLE',
      statusReason: 'Research Methodology and Medical Statistics has no Internal Assessment calculation.',
      iaMaximum: null,
      schemeCode: batch.schemeCode,
      termTestConversions: [],
      term1: { ...emptyTerm12 },
      term2: { ...emptyTerm12 },
      term3: { ...emptyTerm3 },
      finalAutomaticIa: null,
      sourceAssessments: {
        patMappingVerified: false,
        patMapping: null,
        submittedCodes,
        usedInCalculation: [],
        missingRequiredCodes: [],
      },
    };
  }

  if (subject.code === 'ATYAIKACHIKITSA' || subject.iaCalculationRule === 'SUBJECT_ONLY') {
    return {
      calculationStatus: 'NOT_APPLICABLE',
      statusReason: 'Atyaikachikitsa is maintained as a subject record only with no assessment structure or IA calculation.',
      iaMaximum: null,
      schemeCode: batch.schemeCode,
      termTestConversions: [],
      term1: { ...emptyTerm12 },
      term2: { ...emptyTerm12 },
      term3: { ...emptyTerm3 },
      finalAutomaticIa: null,
      sourceAssessments: {
        patMappingVerified: false,
        patMapping: null,
        submittedCodes,
        usedInCalculation: [],
        missingRequiredCodes: [],
      },
    };
  }

  if (batch.isLegacyMinimal || batch.schemeCode === 'RS6') {
    return {
      calculationStatus: 'NOT_APPLICABLE',
      statusReason: 'Automatic RS7 Internal Assessment calculation does not apply to legacy RS6 minimal cohorts.',
      iaMaximum: null,
      schemeCode: batch.schemeCode,
      termTestConversions: [],
      term1: { ...emptyTerm12 },
      term2: { ...emptyTerm12 },
      term3: { ...emptyTerm3 },
      finalAutomaticIa: null,
      sourceAssessments: {
        patMappingVerified: false,
        patMapping: null,
        submittedCodes,
        usedInCalculation: [],
        missingRequiredCodes: [],
      },
    };
  }

  // 2. Verify subject IA configuration & confirmed maximum (15 or 30)
  const expectedVerifiedMax = VERIFIED_IA_SUBJECT_MAXIMA[subject.code];
  const numericMax = Number(subject.iaMaximum);
  if (
    !subject.isIaEnabled ||
    !subject.iaFormulaVerified ||
    (numericMax !== 15 && numericMax !== 30) ||
    (expectedVerifiedMax !== undefined && expectedVerifiedMax !== numericMax)
  ) {
    return {
      calculationStatus: 'PENDING',
      statusReason: 'Subject IA configuration and applicable maximum (15 or 30) have not been verified.',
      iaMaximum: numericMax === 15 || numericMax === 30 ? numericMax : null,
      schemeCode: batch.schemeCode,
      termTestConversions: [],
      term1: { ...emptyTerm12 },
      term2: { ...emptyTerm12 },
      term3: { ...emptyTerm3 },
      finalAutomaticIa: null,
      sourceAssessments: {
        patMappingVerified: false,
        patMapping: null,
        submittedCodes,
        usedInCalculation: [],
        missingRequiredCodes: [],
      },
    };
  }

  const iaMax: 15 | 30 = numericMax;
  const submittedByCode = new Map<string, SubmittedAssessmentRecord>();
  for (const rec of submittedRecords) {
    submittedByCode.set(rec.assessmentCode, rec);
  }

  // 3. Compute Term-Test Conversions (F1 for TERM_TEST_1, F2 for TERM_TEST_2) whenever submitted
  // Raw marks remain untouched; converted marks are stored separately.
  const termTestConversions: TermTestConversionResult[] = [];
  const usedInCalculation = new Set<string>();
  const pendingReasons: string[] = [];

  const tt1 = submittedByCode.get('TERM_TEST_1');
  let conv1: TermTestConversionResult | null = null;
  if (tt1) {
    conv1 = computeTermTestConversion({
      assessmentId: tt1.assessmentId,
      assessmentCode: 'TERM_TEST_1',
      termNumber: 1,
      outcome: tt1.outcome,
      rawTheoryMarks: tt1.theoryMarks,
      rawPracticalMarks: tt1.practicalMarks,
      conversionMaximum: iaMax,
    });
    termTestConversions.push(conv1);
    if (conv1.conversionStatus === 'CONVERTED') {
      usedInCalculation.add('TERM_TEST_1');
    } else if (conv1.statusReason) {
      pendingReasons.push(conv1.statusReason);
    }
  }

  const tt2 = submittedByCode.get('TERM_TEST_2');
  let conv2: TermTestConversionResult | null = null;
  if (tt2) {
    conv2 = computeTermTestConversion({
      assessmentId: tt2.assessmentId,
      assessmentCode: 'TERM_TEST_2',
      termNumber: 2,
      outcome: tt2.outcome,
      rawTheoryMarks: tt2.theoryMarks,
      rawPracticalMarks: tt2.practicalMarks,
      conversionMaximum: iaMax,
    });
    termTestConversions.push(conv2);
    if (conv2.conversionStatus === 'CONVERTED') {
      usedInCalculation.add('TERM_TEST_2');
    } else if (conv2.statusReason) {
      pendingReasons.push(conv2.statusReason);
    }
  }

  // 4. Critical PAT Mapping Restriction Check
  const patValidation = subject.patMappingVerified
    ? validatePatMappingConfig(subject.patMappingConfig)
    : ({ valid: false, error: 'PAT-to-periodic-input (A, B, C) mapping is not configured or verified for this subject.' } as const);

  if (!patValidation.valid) {
    return {
      calculationStatus: 'PENDING',
      statusReason:
        'PAT-to-periodic-input (A, B, C) mapping is not configured or verified for this subject. Submitted PAT marks and any Term-Test conversions are preserved without assuming an unverified PAT mapping.',
      iaMaximum: iaMax,
      schemeCode: batch.schemeCode,
      termTestConversions,
      term1: {
        ...emptyTerm12,
        F: conv1?.convertedMarks ?? null,
      },
      term2: {
        ...emptyTerm12,
        F: conv2?.convertedMarks ?? null,
      },
      term3: { ...emptyTerm3 },
      finalAutomaticIa: null,
      sourceAssessments: {
        patMappingVerified: false,
        patMapping: null,
        submittedCodes,
        usedInCalculation: Array.from(usedInCalculation).sort(),
        missingRequiredCodes: [],
      },
    };
  }

  const patMapping = patValidation.config;

  // 5. Periodic Assessments E1, E2, E3 using verified PAT mapping
  const p1 = computePeriodicTermAssessment({
    termNumber: 1,
    mapping: patMapping.term1,
    submittedByCode,
    iaMaximum: iaMax,
  });
  const p2 = computePeriodicTermAssessment({
    termNumber: 2,
    mapping: patMapping.term2,
    submittedByCode,
    iaMaximum: iaMax,
  });
  const p3 = computePeriodicTermAssessment({
    termNumber: 3,
    mapping: patMapping.term3,
    submittedByCode,
    iaMaximum: iaMax,
  });

  for (const p of [p1, p2, p3]) {
    for (const code of [p.inputCodes.A, p.inputCodes.B, p.inputCodes.C]) {
      const rec = submittedByCode.get(code);
      if (rec && (rec.outcome === 'MARKS_ENTERED' || rec.outcome === 'ABSENT')) {
        usedInCalculation.add(code);
      }
    }
  }

  const requiredCodes = [
    patMapping.term1.A,
    patMapping.term1.B,
    patMapping.term1.C,
    'TERM_TEST_1',
    patMapping.term2.A,
    patMapping.term2.B,
    patMapping.term2.C,
    'TERM_TEST_2',
    patMapping.term3.A,
    patMapping.term3.B,
    patMapping.term3.C,
  ];
  const missingRequiredCodes = Array.from(
    new Set(requiredCodes.filter((code) => !submittedByCode.has(code)))
  );

  if (p1.missingOrBlockedReason) pendingReasons.push(`Term 1 Periodic: ${p1.missingOrBlockedReason}`);
  if (!tt1) pendingReasons.push('Term 1 Test: TERM_TEST_1 is not yet submitted');
  if (p2.missingOrBlockedReason) pendingReasons.push(`Term 2 Periodic: ${p2.missingOrBlockedReason}`);
  if (!tt2) pendingReasons.push('Term 2 Test: TERM_TEST_2 is not yet submitted');
  if (p3.missingOrBlockedReason) pendingReasons.push(`Term 3 Periodic: ${p3.missingOrBlockedReason}`);

  // 6. Term Assessments H1, H2, H3 (unrounded intermediate precision)
  // Term 1: H1 = (E1 + F1) / 2
  const unroundedH1 =
    p1.unroundedE !== null && conv1 && conv1.unroundedConvertedMarks !== null
      ? (p1.unroundedE + conv1.unroundedConvertedMarks) / 2
      : null;

  // Term 2: H2 = (E2 + F2) / 2
  const unroundedH2 =
    p2.unroundedE !== null && conv2 && conv2.unroundedConvertedMarks !== null
      ? (p2.unroundedE + conv2.unroundedConvertedMarks) / 2
      : null;

  // Term 3: H3 = E3 (no third term test)
  const unroundedH3 = p3.unroundedE !== null ? p3.unroundedE : null;

  // 7. Final Automatic IA = (H1 + H2 + H3) / 3
  const isComplete =
    unroundedH1 !== null && unroundedH2 !== null && unroundedH3 !== null && pendingReasons.length === 0;

  const unroundedFinalIa = isComplete
    ? (unroundedH1! + unroundedH2! + unroundedH3!) / 3
    : null;

  return {
    calculationStatus: isComplete ? 'CALCULATED' : 'PENDING',
    statusReason: isComplete
      ? null
      : pendingReasons.join(' | ') || 'Awaiting submission of remaining required assessments.',
    iaMaximum: iaMax,
    schemeCode: batch.schemeCode,
    termTestConversions,
    term1: {
      A: p1.A,
      B: p1.B,
      C: p1.C,
      D: p1.D,
      E: p1.E,
      F: conv1?.convertedMarks ?? null,
      H: unroundedH1 !== null ? roundConsistent(unroundedH1) : null,
    },
    term2: {
      A: p2.A,
      B: p2.B,
      C: p2.C,
      D: p2.D,
      E: p2.E,
      F: conv2?.convertedMarks ?? null,
      H: unroundedH2 !== null ? roundConsistent(unroundedH2) : null,
    },
    term3: {
      A: p3.A,
      B: p3.B,
      C: p3.C,
      D: p3.D,
      E: p3.E,
      H: unroundedH3 !== null ? roundConsistent(unroundedH3) : null,
    },
    finalAutomaticIa: unroundedFinalIa !== null ? roundConsistent(unroundedFinalIa) : null,
    sourceAssessments: {
      patMappingVerified: true,
      patMapping,
      submittedCodes,
      usedInCalculation: Array.from(usedInCalculation).sort(),
      missingRequiredCodes,
    },
  };
}

/**
 * Persists recalculated Term-Test conversions and Automatic IA results for all applicable students
 * in `(batchId, subjectId)`. Accepts an existing transaction connection or opens one from pool.
 * Never mutates raw marks in `student_assessment_marks`.
 */
export async function recalculateSubjectBatchIA(
  batchId: number,
  subjectId: number,
  existingConnection?: PoolConnection,
  actorId?: number | null
): Promise<{
  studentCount: number;
  calculatedCount: number;
  pendingCount: number;
  notApplicableCount: number;
  flaggedForReviewCount: number;
}> {
  const pool = getPool();
  const conn = existingConnection || (await pool.getConnection());
  const ownsConnection = !existingConnection;

  try {
    if (ownsConnection) {
      await conn.beginTransaction();
    }

    const [subjRows] = await conn.query<any[]>(
      `/* IA:GET_SUBJECT_BY_ID */
       SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
       FROM subjects s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE s.id = ? LIMIT 1`,
      [subjectId]
    );
    if (!subjRows || subjRows.length === 0) {
      throw new Error(`Subject ID ${subjectId} not found for IA calculation.`);
    }
    const rawSubj = subjRows[0];

    let parsedPatMapping: PatMappingConfig | null = null;
    if (rawSubj.pat_mapping_config) {
      const rawCfg =
        typeof rawSubj.pat_mapping_config === 'string'
          ? JSON.parse(rawSubj.pat_mapping_config)
          : rawSubj.pat_mapping_config;
      const v = validatePatMappingConfig(rawCfg);
      if (v.valid) parsedPatMapping = v.config;
    }

    const subjectProfile: SubjectIaProfile = {
      id: Number(rawSubj.id),
      code: String(rawSubj.code),
      name: String(rawSubj.name),
      iaMaximum: Number(rawSubj.ia_maximum || 0),
      isIaEnabled: Boolean(rawSubj.is_ia_enabled),
      iaCalculationRule: rawSubj.ia_calculation_rule || null,
      iaFormulaVerified: Boolean(rawSubj.ia_formula_verified),
      patMappingVerified: Boolean(rawSubj.pat_mapping_verified),
      patMappingConfig: parsedPatMapping,
    };

    const [batchRows] = await conn.query<any[]>(
      `/* IA:GET_BATCH_BY_ID */
       SELECT b.id, b.code, b.name, b.admission_academic_year, b.current_cohort_stage,
              b.current_professional_year, b.is_active, b.scheme_id,
              cs.code AS scheme_code, cs.is_legacy_minimal
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
       WHERE b.id = ? LIMIT 1`,
      [batchId]
    );
    if (!batchRows || batchRows.length === 0) {
      throw new Error(`Academic Batch ID ${batchId} not found for IA calculation.`);
    }
    const rawBatch = batchRows[0];
    const batchProfile: BatchSchemeProfile = {
      id: Number(rawBatch.id),
      code: String(rawBatch.code),
      name: String(rawBatch.name),
      schemeCode: rawBatch.scheme_code || null,
      isLegacyMinimal: Boolean(rawBatch.is_legacy_minimal),
    };

    const [students] = await conn.query<any[]>(
      `/* IA:LIST_BATCH_STUDENTS */
       SELECT id, student_id_number AS studentIdNumber, temporary_roll_number AS temporaryRollNumber,
              permanent_university_number AS permanentUniversityNumber, full_name AS fullName,
              administrative_status AS administrativeStatus, scheme_id AS schemeId
       FROM students
       WHERE (current_placement_batch_id = ? OR original_batch_id = ?)
         AND administrative_status != 'CANCELLED'
       ORDER BY full_name ASC`,
      [batchId, batchId]
    );

    const [submittedMarksRows] = await conn.query<any[]>(
      `/* IA:LIST_SUBMITTED_MARKS_FOR_BATCH_SUBJECT */
       SELECT sam.id, sam.student_id, sam.subject_id, sam.assessment_id, sam.batch_id,
              sam.outcome, sam.theory_marks, sam.practical_marks, sam.is_draft,
              a.code AS assessment_code, a.name AS assessment_name, a.assessment_type, a.term_number,
              sub.submitted_at
       FROM student_assessment_marks sam
       JOIN assessment_submissions sub
         ON sub.batch_id = sam.batch_id
        AND sub.subject_id = sam.subject_id
        AND sub.assessment_id = sam.assessment_id
       JOIN assessments a ON a.id = sam.assessment_id
       WHERE sam.batch_id = ? AND sam.subject_id = ? AND sam.is_draft = FALSE`,
      [batchId, subjectId]
    );

    const marksByStudent = new Map<number, SubmittedAssessmentRecord[]>();
    for (const row of submittedMarksRows) {
      const studentId = Number(row.student_id);
      if (!marksByStudent.has(studentId)) {
        marksByStudent.set(studentId, []);
      }
      marksByStudent.get(studentId)!.push({
        assessmentId: Number(row.assessment_id),
        assessmentCode: String(row.assessment_code),
        assessmentName: String(row.assessment_name),
        assessmentType: row.assessment_type,
        termNumber: Number(row.term_number),
        outcome: row.outcome,
        theoryMarks: row.theory_marks !== null && row.theory_marks !== undefined ? Number(row.theory_marks) : null,
        practicalMarks:
          row.practical_marks !== null && row.practical_marks !== undefined ? Number(row.practical_marks) : null,
        submittedAt: row.submitted_at || null,
      });
    }

    // Snapshot previous automatic calculations and existing office Final IA approvals
    // so we can detect genuine post-approval changes without overwriting approved Final IA values.
    const [existingCalcRows] = await conn.query<any[]>(
      `/* IA:LIST_STUDENT_IA_CALCULATIONS */
       SELECT siac.*,
              s.student_id_number AS studentIdNumber,
              s.temporary_roll_number AS temporaryRollNumber,
              s.permanent_university_number AS permanentUniversityNumber,
              s.full_name AS fullName,
              s.administrative_status AS administrativeStatus
       FROM student_ia_calculations siac
       JOIN students s ON s.id = siac.student_id
       WHERE siac.batch_id = ? AND siac.subject_id = ?
       ORDER BY s.full_name ASC`,
      [batchId, subjectId]
    );
    const prevCalcByStudent = new Map<number, any>();
    for (const c of existingCalcRows || []) {
      prevCalcByStudent.set(Number(c.student_id), c);
    }

    const [existingApprovalRows] = await conn.query<any[]>(
      `/* IA:LIST_FINAL_APPROVALS_FOR_BATCH_SUBJECT */
       SELECT sfia.*, u.username AS approved_by_username, u.full_name AS approved_by_fullname
       FROM student_final_ia_approvals sfia
       LEFT JOIN users u ON u.id = sfia.approved_by
       WHERE sfia.batch_id = ? AND sfia.subject_id = ?`,
      [batchId, subjectId]
    );
    const existingApprovalByStudent = new Map<number, any>();
    for (const a of existingApprovalRows || []) {
      existingApprovalByStudent.set(Number(a.student_id), a);
    }

    // Refresh term-test conversions cleanly for this batch+subject before inserting current conversions
    await conn.query(
      `/* IA:DELETE_TERM_TEST_CONVERSIONS_FOR_BATCH_SUBJECT */
       DELETE FROM student_term_test_conversions WHERE batch_id = ? AND subject_id = ?`,
      [batchId, subjectId]
    );

    let calculatedCount = 0;
    let pendingCount = 0;
    let notApplicableCount = 0;
    let flaggedForReviewCount = 0;

    for (const student of students) {
      const studentId = Number(student.id);
      const studentSubmitted = marksByStudent.get(studentId) || [];

      const evaluation = evaluateStudentAutomaticIA({
        subject: subjectProfile,
        batch: batchProfile,
        submittedRecords: studentSubmitted,
      });

      if (evaluation.calculationStatus === 'CALCULATED') calculatedCount++;
      else if (evaluation.calculationStatus === 'NOT_APPLICABLE') notApplicableCount++;
      else pendingCount++;

      // Persist separate Term-Test Conversions
      for (const conv of evaluation.termTestConversions) {
        await conn.query(
          `/* IA:UPSERT_TERM_TEST_CONVERSION */
           INSERT INTO student_term_test_conversions
             (student_id, batch_id, subject_id, assessment_id, term_number, outcome,
              raw_theory_marks, raw_practical_marks, combined_raw_marks,
              conversion_maximum, converted_marks, conversion_status, status_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             term_number = VALUES(term_number),
             outcome = VALUES(outcome),
             raw_theory_marks = VALUES(raw_theory_marks),
             raw_practical_marks = VALUES(raw_practical_marks),
             combined_raw_marks = VALUES(combined_raw_marks),
             conversion_maximum = VALUES(conversion_maximum),
             converted_marks = VALUES(converted_marks),
             conversion_status = VALUES(conversion_status),
             status_reason = VALUES(status_reason),
             calculated_at = CURRENT_TIMESTAMP`,
          [
            studentId,
            batchId,
            subjectId,
            conv.assessmentId,
            conv.termNumber,
            conv.outcome,
            conv.rawTheoryMarks,
            conv.rawPracticalMarks,
            conv.combinedRawMarks,
            conv.conversionMaximum,
            conv.convertedMarks,
            conv.conversionStatus,
            conv.statusReason,
          ]
        );
      }

      // Persist separate Automatic IA Calculation record
      await conn.query(
        `/* IA:UPSERT_STUDENT_IA_CALCULATION */
         INSERT INTO student_ia_calculations
           (student_id, batch_id, subject_id, scheme_code, ia_maximum,
            term1_a, term1_b, term1_c, term1_d, term1_e, term1_f, term1_h,
            term2_a, term2_b, term2_c, term2_d, term2_e, term2_f, term2_h,
            term3_a, term3_b, term3_c, term3_d, term3_e, term3_h,
            final_automatic_ia, source_assessments, calculation_status, status_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           scheme_code = VALUES(scheme_code),
           ia_maximum = VALUES(ia_maximum),
           term1_a = VALUES(term1_a),
           term1_b = VALUES(term1_b),
           term1_c = VALUES(term1_c),
           term1_d = VALUES(term1_d),
           term1_e = VALUES(term1_e),
           term1_f = VALUES(term1_f),
           term1_h = VALUES(term1_h),
           term2_a = VALUES(term2_a),
           term2_b = VALUES(term2_b),
           term2_c = VALUES(term2_c),
           term2_d = VALUES(term2_d),
           term2_e = VALUES(term2_e),
           term2_f = VALUES(term2_f),
           term2_h = VALUES(term2_h),
           term3_a = VALUES(term3_a),
           term3_b = VALUES(term3_b),
           term3_c = VALUES(term3_c),
           term3_d = VALUES(term3_d),
           term3_e = VALUES(term3_e),
           term3_h = VALUES(term3_h),
           final_automatic_ia = VALUES(final_automatic_ia),
           source_assessments = VALUES(source_assessments),
           calculation_status = VALUES(calculation_status),
           status_reason = VALUES(status_reason),
           calculated_at = CURRENT_TIMESTAMP`,
        [
          studentId,
          batchId,
          subjectId,
          evaluation.schemeCode,
          evaluation.iaMaximum,
          evaluation.term1.A,
          evaluation.term1.B,
          evaluation.term1.C,
          evaluation.term1.D,
          evaluation.term1.E,
          evaluation.term1.F,
          evaluation.term1.H,
          evaluation.term2.A,
          evaluation.term2.B,
          evaluation.term2.C,
          evaluation.term2.D,
          evaluation.term2.E,
          evaluation.term2.F,
          evaluation.term2.H,
          evaluation.term3.A,
          evaluation.term3.B,
          evaluation.term3.C,
          evaluation.term3.D,
          evaluation.term3.E,
          evaluation.term3.H,
          evaluation.finalAutomaticIa,
          JSON.stringify(evaluation.sourceAssessments),
          evaluation.calculationStatus,
          evaluation.statusReason,
        ]
      );

      // Step 2E: If an office Final IA approval already exists and recalculation changes the Automatic IA
      // (or invalidates calculation status), preserve approved_final_ia untouched and flag for office review.
      const existingApproval = existingApprovalByStudent.get(studentId);
      if (existingApproval) {
        const approvedAtAutoIa = Number(existingApproval.automatic_ia_at_approval);
        const preservedFinalIa = Number(existingApproval.approved_final_ia);
        const divergedFromApproval =
          evaluation.calculationStatus !== 'CALCULATED' ||
          evaluation.finalAutomaticIa === null ||
          Math.abs(evaluation.finalAutomaticIa - approvedAtAutoIa) > 0.001;

        if (divergedFromApproval) {
          const prevCalc = prevCalcByStudent.get(studentId);
          const prevAutoIa =
            prevCalc && prevCalc.final_automatic_ia !== null && prevCalc.final_automatic_ia !== undefined
              ? Number(prevCalc.final_automatic_ia)
              : null;
          const prevStatus = prevCalc ? String(prevCalc.calculation_status) : null;

          const hasNewChange =
            !Boolean(existingApproval.requires_office_review) ||
            prevStatus !== evaluation.calculationStatus ||
            prevAutoIa !== evaluation.finalAutomaticIa;

          if (hasNewChange) {
            const flagReason =
              evaluation.calculationStatus === 'CALCULATED' && evaluation.finalAutomaticIa !== null
                ? `Automatic IA changed from ${approvedAtAutoIa.toFixed(2)} (at approval) to ${evaluation.finalAutomaticIa.toFixed(2)} after source assessment recalculation. Previously approved Final IA (${preservedFinalIa.toFixed(2)}) is preserved; office review is required to re-approve or adjust.`
                : `Automatic IA calculation status became ${evaluation.calculationStatus} after recalculation (was ${approvedAtAutoIa.toFixed(2)} at approval). Previously approved Final IA (${preservedFinalIa.toFixed(2)}) is preserved; office review is required.`;

            await conn.query(
              `/* IA:FLAG_FINAL_APPROVAL_FOR_REVIEW */
               UPDATE student_final_ia_approvals
               SET requires_office_review = TRUE,
                   final_status = 'REQUIRES_REVIEW',
                   review_flag_reason = ?
               WHERE student_id = ? AND batch_id = ? AND subject_id = ?`,
              [flagReason, studentId, batchId, subjectId]
            );

            await conn.query(
              `/* IA:INSERT_FINAL_IA_HISTORY */
               INSERT INTO student_final_ia_history
                 (student_id, batch_id, subject_id, action_type, previous_final_ia, new_final_ia,
                  automatic_ia_value, reason_category, explanation, actor_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                studentId,
                batchId,
                subjectId,
                'FLAGGED_FOR_REVIEW_ON_RECALC',
                preservedFinalIa,
                preservedFinalIa,
                evaluation.finalAutomaticIa,
                'SOURCE_MARK_RECALCULATION',
                flagReason,
                actorId ?? null,
              ]
            );
          }

          flaggedForReviewCount++;
        } else if (Boolean(existingApproval.requires_office_review)) {
          flaggedForReviewCount++;
        }
      }
    }

    if (ownsConnection) {
      await conn.commit();
    }

    return {
      studentCount: students.length,
      calculatedCount,
      pendingCount,
      notApplicableCount,
      flaggedForReviewCount,
    };
  } catch (err) {
    if (ownsConnection) {
      await conn.rollback();
    }
    throw err;
  } finally {
    if (ownsConnection) {
      conn.release();
    }
  }
}

/**
 * Recalculates IA for all batches that already have submitted assessments for a subject
 * (invoked automatically when subject PAT mapping configuration is verified/changed).
 */
export async function recalculateAllBatchesForSubject(subjectId: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `/* IA:LIST_SUBMITTED_BATCH_IDS_FOR_SUBJECT */
     SELECT DISTINCT batch_id FROM assessment_submissions WHERE subject_id = ?`,
    [subjectId]
  );
  for (const r of rows) {
    if (r.batch_id) {
      await recalculateSubjectBatchIA(Number(r.batch_id), subjectId);
    }
  }
}

/**
 * Internal authorized service helper for updating a submitted source mark (e.g. via future authorized correction process)
 * and atomically triggering automatic IA recalculation within the same database transaction.
 * Note: Department accounts cannot invoke this; assessment locking remains strictly enforced on routes.
 */
export async function updateSubmittedMarkThroughAuthorizedProcess(params: {
  batchId: number;
  subjectId: number;
  assessmentId: number;
  studentId: number;
  outcome: AssessmentOutcome;
  theoryMarks: number | null;
  practicalMarks: number | null;
  authorizedActorId: number;
}): Promise<void> {
  const {
    batchId,
    subjectId,
    assessmentId,
    studentId,
    outcome,
    theoryMarks,
    practicalMarks,
    authorizedActorId,
  } = params;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [assessRows] = await conn.query<any[]>(
      `/* IA:GET_ASSESSMENT_BY_ID */
       SELECT id, code, name, assessment_type, term_number, max_marks_theory, max_marks_practical, is_active
       FROM assessments WHERE id = ? LIMIT 1`,
      [assessmentId]
    );
    if (!assessRows || assessRows.length === 0) {
      throw new Error('Assessment not found');
    }
    const isPat = assessRows[0].assessment_type === 'PAT';

    let cleanTheory: number | null = null;
    let cleanPrac: number | null = null;
    if (outcome === 'MARKS_ENTERED') {
      if (theoryMarks === null || Number.isNaN(Number(theoryMarks)) || Number(theoryMarks) < 0) {
        throw new Error('Invalid theory marks');
      }
      if (isPat && Number(theoryMarks) > 15) {
        throw new Error('PAT marks cannot exceed 15');
      }
      if (!isPat && Number(theoryMarks) > 100) {
        throw new Error('Term-test theory marks cannot exceed 100');
      }
      cleanTheory = Number(theoryMarks);

      if (!isPat) {
        if (practicalMarks === null || Number.isNaN(Number(practicalMarks)) || Number(practicalMarks) < 0 || Number(practicalMarks) > 100) {
          throw new Error('Term-test practical marks must be between 0 and 100');
        }
        cleanPrac = Number(practicalMarks);
      }
    } else if (outcome === 'ABSENT') {
      cleanTheory = 0;
      cleanPrac = 0;
    }

    await conn.query(
      `/* IA:UPSERT_STUDENT_MARK */
       INSERT INTO student_assessment_marks
         (student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         outcome = VALUES(outcome),
         theory_marks = VALUES(theory_marks),
         practical_marks = VALUES(practical_marks),
         is_draft = VALUES(is_draft),
         saved_by = VALUES(saved_by)`,
      [studentId, subjectId, assessmentId, batchId, outcome, cleanTheory, cleanPrac, false, authorizedActorId]
    );

    await recalculateSubjectBatchIA(batchId, subjectId, conn, authorizedActorId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ============================================================================
// STEP 2E: OFFICE REVIEW, FINAL IA APPROVAL & MANUAL ADJUSTMENT SERVICES
// ============================================================================

export const AUTHORIZED_FINAL_IA_OFFICE_ROLES = new Set([
  'SUPER_ADMIN',
  'PRINCIPAL',
  'SECRETARY',
  'OFFICE',
  'STAFF',
]);

export interface FinalIaReasonCategoryOption {
  code: string;
  label: string;
  description: string;
}

export const FINAL_IA_REASON_CATEGORIES: readonly FinalIaReasonCategoryOption[] = [
  {
    code: 'ACADEMIC_EXCELLENCE',
    label: 'Academic Excellence',
    description: 'Consistent exemplary academic performance, clinical merit, or scholarly distinction.',
  },
  {
    code: 'MEDICAL_EXIGENCY',
    label: 'Verified Medical Exigency',
    description: 'Approved medical leave or hospitalization verified with institutional documentation.',
  },
  {
    code: 'INSTITUTIONAL_REPRESENTATION',
    label: 'Official Institutional Representation',
    description: 'Authorized participation in university, state, or national academic/cultural/sports events.',
  },
  {
    code: 'ASSESSMENT_RECONCILIATION',
    label: 'Documented Assessment Reconciliation',
    description: 'Verified practical/clinical record reconciliation approved by the examination office.',
  },
  {
    code: 'ACADEMIC_COMMITTEE_DIRECTIVE',
    label: 'Academic Committee Directive',
    description: 'Formal resolution or directive recorded by the Institutional Internal Assessment Committee.',
  },
  {
    code: 'OTHER_ACADEMIC_JUSTIFICATION',
    label: 'Other Documented Academic Justification',
    description: 'Other legitimate, documented institutional academic reason.',
  },
] as const;

const VALID_REASON_CATEGORY_CODES = new Set(FINAL_IA_REASON_CATEGORIES.map((r) => r.code));

export class IaActionError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'IaActionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function assertAuthorizedOfficeActor(actorId: number, actorRole: string): void {
  if (!actorId || Number.isNaN(Number(actorId))) {
    throw new IaActionError('Authenticated user is required.', 401, 'UNAUTHORIZED');
  }
  const normalizedRole = String(actorRole || '').trim().toUpperCase();
  if (!AUTHORIZED_FINAL_IA_OFFICE_ROLES.has(normalizedRole)) {
    throw new IaActionError(
      'Forbidden: Department and unauthorized accounts cannot approve or adjust Final IA marks.',
      403,
      'FORBIDDEN_FINAL_IA_APPROVAL'
    );
  }
}

export interface FinalIaApprovalResult {
  studentId: number;
  batchId: number;
  subjectId: number;
  iaMaximum: number;
  automaticIaAtApproval: number;
  previousFinalIa: number | null;
  approvedFinalIa: number;
  approvalType: 'APPROVED_AS_CALCULATED' | 'MANUAL_ADJUSTMENT';
  finalStatus: 'APPROVED' | 'ADJUSTED_APPROVED';
  requiresOfficeReview: false;
  reasonCategory: string | null;
  explanation: string | null;
  approvedBy: number;
}

/**
 * Approves a student's valid calculated Automatic IA result as their Final IA mark.
 * Stores approved Final IA separately from `student_ia_calculations` and records chronological history.
 */
export async function approveStudentFinalIA(params: {
  studentId: number;
  batchId: number;
  subjectId: number;
  actorId: number;
  actorRole: string;
}): Promise<FinalIaApprovalResult> {
  const { studentId, batchId, subjectId, actorId, actorRole } = params;
  assertAuthorizedOfficeActor(actorId, actorRole);

  if (!studentId || !batchId || !subjectId) {
    throw new IaActionError('Student ID, Batch ID, and Subject ID are required.', 400, 'MISSING_FIELDS');
  }

  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Ensure automatic calculations reflect latest submitted assessments before approval
    await recalculateSubjectBatchIA(batchId, subjectId, conn);

    const [subjRows] = await conn.query<any[]>(
      `/* IA:GET_SUBJECT_BY_ID */
       SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
       FROM subjects s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE s.id = ? LIMIT 1`,
      [subjectId]
    );
    if (!subjRows || subjRows.length === 0) {
      throw new IaActionError('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    }
    const subject = subjRows[0];
    const iaMaximum = Number(subject.ia_maximum || 0);

    if (!subject.is_ia_enabled || !subject.ia_formula_verified || (iaMaximum !== 15 && iaMaximum !== 30)) {
      throw new IaActionError(
        `Cannot approve Final IA for "${subject.name}": subject IA configuration or maximum is not applicable/verified.`,
        400,
        'SUBJECT_NOT_ELIGIBLE'
      );
    }

    const [calcRows] = await conn.query<any[]>(
      `/* IA:GET_STUDENT_IA_CALCULATION_SINGLE */
       SELECT siac.*,
              s.student_id_number AS studentIdNumber,
              s.temporary_roll_number AS temporaryRollNumber,
              s.permanent_university_number AS permanentUniversityNumber,
              s.full_name AS fullName,
              s.administrative_status AS administrativeStatus
       FROM student_ia_calculations siac
       JOIN students s ON s.id = siac.student_id
       WHERE siac.student_id = ? AND siac.batch_id = ? AND siac.subject_id = ?
       LIMIT 1`,
      [studentId, batchId, subjectId]
    );

    if (!calcRows || calcRows.length === 0) {
      throw new IaActionError(
        'No Automatic IA calculation record found for this student in the selected batch and subject.',
        404,
        'CALCULATION_NOT_FOUND'
      );
    }

    const calc = calcRows[0];
    if (calc.calculation_status !== 'CALCULATED' || calc.final_automatic_ia === null || calc.final_automatic_ia === undefined) {
      throw new IaActionError(
        `Cannot approve Final IA while Automatic IA status is ${calc.calculation_status}${
          calc.status_reason ? ` (${calc.status_reason})` : ''
        }.`,
        400,
        'CALCULATION_NOT_APPROVABLE'
      );
    }

    const autoIa = roundConsistent(Number(calc.final_automatic_ia));
    if (Number.isNaN(autoIa) || autoIa < 0 || autoIa > iaMaximum) {
      throw new IaActionError(
        `Automatic IA value (${autoIa}) is outside configured subject IA maximum [0, ${iaMaximum}].`,
        400,
        'FINAL_MARK_OUT_OF_RANGE'
      );
    }

    const [existingRows] = await conn.query<any[]>(
      `/* IA:GET_FINAL_APPROVAL_FOR_STUDENT */
       SELECT sfia.*, u.username AS approved_by_username, u.full_name AS approved_by_fullname
       FROM student_final_ia_approvals sfia
       LEFT JOIN users u ON u.id = sfia.approved_by
       WHERE sfia.student_id = ? AND sfia.batch_id = ? AND sfia.subject_id = ?
       LIMIT 1`,
      [studentId, batchId, subjectId]
    );
    const previousFinalIa =
      existingRows && existingRows.length > 0 ? roundConsistent(Number(existingRows[0].approved_final_ia)) : null;

    await conn.query(
      `/* IA:UPSERT_FINAL_APPROVAL */
       INSERT INTO student_final_ia_approvals
         (student_id, batch_id, subject_id, ia_maximum, automatic_ia_at_approval, approved_final_ia,
          approval_type, final_status, requires_office_review, review_flag_reason,
          reason_category, explanation, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         ia_maximum = VALUES(ia_maximum),
         automatic_ia_at_approval = VALUES(automatic_ia_at_approval),
         approved_final_ia = VALUES(approved_final_ia),
         approval_type = VALUES(approval_type),
         final_status = VALUES(final_status),
         requires_office_review = VALUES(requires_office_review),
         review_flag_reason = VALUES(review_flag_reason),
         reason_category = VALUES(reason_category),
         explanation = VALUES(explanation),
         approved_by = VALUES(approved_by),
         approved_at = CURRENT_TIMESTAMP`,
      [
        studentId,
        batchId,
        subjectId,
        iaMaximum,
        autoIa,
        autoIa,
        'APPROVED_AS_CALCULATED',
        'APPROVED',
        false,
        null,
        null,
        null,
        actorId,
      ]
    );

    await conn.query(
      `/* IA:INSERT_FINAL_IA_HISTORY */
       INSERT INTO student_final_ia_history
         (student_id, batch_id, subject_id, action_type, previous_final_ia, new_final_ia,
          automatic_ia_value, reason_category, explanation, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        batchId,
        subjectId,
        'APPROVED_AS_CALCULATED',
        previousFinalIa,
        autoIa,
        autoIa,
        null,
        'Approved calculated Automatic IA as Final IA.',
        actorId,
      ]
    );

    await conn.commit();

    return {
      studentId,
      batchId,
      subjectId,
      iaMaximum,
      automaticIaAtApproval: autoIa,
      previousFinalIa,
      approvedFinalIa: autoIa,
      approvalType: 'APPROVED_AS_CALCULATED',
      finalStatus: 'APPROVED',
      requiresOfficeReview: false,
      reasonCategory: null,
      explanation: null,
      approvedBy: actorId,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Records an authorized manual Final IA adjustment for a student with a valid calculated Automatic IA.
 * Requires reasonCategory + written explanation, validates [0, iaMaximum], preserves `student_ia_calculations`
 * completely unchanged, and appends to `student_final_ia_history`.
 */
export async function adjustStudentFinalIA(params: {
  studentId: number;
  batchId: number;
  subjectId: number;
  adjustedFinalIa: number;
  reasonCategory: string;
  explanation: string;
  actorId: number;
  actorRole: string;
}): Promise<FinalIaApprovalResult> {
  const {
    studentId,
    batchId,
    subjectId,
    adjustedFinalIa,
    reasonCategory,
    explanation,
    actorId,
    actorRole,
  } = params;
  assertAuthorizedOfficeActor(actorId, actorRole);

  if (!studentId || !batchId || !subjectId) {
    throw new IaActionError('Student ID, Batch ID, and Subject ID are required.', 400, 'MISSING_FIELDS');
  }

  const normalizedCategory = String(reasonCategory || '').trim().toUpperCase();
  if (!normalizedCategory || !VALID_REASON_CATEGORY_CODES.has(normalizedCategory)) {
    throw new IaActionError(
      'A valid adjustment reason category is required (e.g., Academic Excellence or other authorized category).',
      400,
      'INVALID_REASON_CATEGORY'
    );
  }

  const trimmedExplanation = String(explanation || '').trim();
  if (!trimmedExplanation) {
    throw new IaActionError(
      'A written academic explanation is mandatory when manually adjusting Final IA marks.',
      400,
      'MISSING_EXPLANATION'
    );
  }

  if (adjustedFinalIa === null || adjustedFinalIa === undefined || String(adjustedFinalIa).trim() === '') {
    throw new IaActionError('Adjusted Final IA mark is required.', 400, 'MISSING_ADJUSTED_MARK');
  }
  const numericAdjusted = Number(adjustedFinalIa);
  if (Number.isNaN(numericAdjusted)) {
    throw new IaActionError('Adjusted Final IA mark must be a valid number.', 400, 'INVALID_ADJUSTED_MARK');
  }

  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Ensure automatic calculations reflect latest submitted assessments before adjustment
    await recalculateSubjectBatchIA(batchId, subjectId, conn);

    const [subjRows] = await conn.query<any[]>(
      `/* IA:GET_SUBJECT_BY_ID */
       SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
       FROM subjects s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE s.id = ? LIMIT 1`,
      [subjectId]
    );
    if (!subjRows || subjRows.length === 0) {
      throw new IaActionError('Subject not found.', 404, 'SUBJECT_NOT_FOUND');
    }
    const subject = subjRows[0];
    const iaMaximum = Number(subject.ia_maximum || 0);

    if (!subject.is_ia_enabled || !subject.ia_formula_verified || (iaMaximum !== 15 && iaMaximum !== 30)) {
      throw new IaActionError(
        `Cannot adjust Final IA for "${subject.name}": subject IA configuration or maximum is not applicable/verified.`,
        400,
        'SUBJECT_NOT_ELIGIBLE'
      );
    }

    if (numericAdjusted < 0 || numericAdjusted > iaMaximum) {
      throw new IaActionError(
        `Adjusted Final IA mark (${numericAdjusted}) must be between 0 and the subject IA maximum of ${iaMaximum}.`,
        400,
        'FINAL_MARK_OUT_OF_RANGE'
      );
    }
    const roundedAdjusted = roundConsistent(numericAdjusted);

    const [calcRows] = await conn.query<any[]>(
      `/* IA:GET_STUDENT_IA_CALCULATION_SINGLE */
       SELECT siac.*,
              s.student_id_number AS studentIdNumber,
              s.temporary_roll_number AS temporaryRollNumber,
              s.permanent_university_number AS permanentUniversityNumber,
              s.full_name AS fullName,
              s.administrative_status AS administrativeStatus
       FROM student_ia_calculations siac
       JOIN students s ON s.id = siac.student_id
       WHERE siac.student_id = ? AND siac.batch_id = ? AND siac.subject_id = ?
       LIMIT 1`,
      [studentId, batchId, subjectId]
    );

    if (!calcRows || calcRows.length === 0) {
      throw new IaActionError(
        'No Automatic IA calculation record found for this student in the selected batch and subject.',
        404,
        'CALCULATION_NOT_FOUND'
      );
    }

    const calc = calcRows[0];
    if (calc.calculation_status !== 'CALCULATED' || calc.final_automatic_ia === null || calc.final_automatic_ia === undefined) {
      throw new IaActionError(
        `Cannot approve or adjust Final IA while Automatic IA status is ${calc.calculation_status}${
          calc.status_reason ? ` (${calc.status_reason})` : ''
        }.`,
        400,
        'CALCULATION_NOT_APPROVABLE'
      );
    }

    const autoIa = roundConsistent(Number(calc.final_automatic_ia));

    const [existingRows] = await conn.query<any[]>(
      `/* IA:GET_FINAL_APPROVAL_FOR_STUDENT */
       SELECT sfia.*, u.username AS approved_by_username, u.full_name AS approved_by_fullname
       FROM student_final_ia_approvals sfia
       LEFT JOIN users u ON u.id = sfia.approved_by
       WHERE sfia.student_id = ? AND sfia.batch_id = ? AND sfia.subject_id = ?
       LIMIT 1`,
      [studentId, batchId, subjectId]
    );
    const previousFinalIa =
      existingRows && existingRows.length > 0 ? roundConsistent(Number(existingRows[0].approved_final_ia)) : null;

    await conn.query(
      `/* IA:UPSERT_FINAL_APPROVAL */
       INSERT INTO student_final_ia_approvals
         (student_id, batch_id, subject_id, ia_maximum, automatic_ia_at_approval, approved_final_ia,
          approval_type, final_status, requires_office_review, review_flag_reason,
          reason_category, explanation, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         ia_maximum = VALUES(ia_maximum),
         automatic_ia_at_approval = VALUES(automatic_ia_at_approval),
         approved_final_ia = VALUES(approved_final_ia),
         approval_type = VALUES(approval_type),
         final_status = VALUES(final_status),
         requires_office_review = VALUES(requires_office_review),
         review_flag_reason = VALUES(review_flag_reason),
         reason_category = VALUES(reason_category),
         explanation = VALUES(explanation),
         approved_by = VALUES(approved_by),
         approved_at = CURRENT_TIMESTAMP`,
      [
        studentId,
        batchId,
        subjectId,
        iaMaximum,
        autoIa,
        roundedAdjusted,
        'MANUAL_ADJUSTMENT',
        'ADJUSTED_APPROVED',
        false,
        null,
        normalizedCategory,
        trimmedExplanation,
        actorId,
      ]
    );

    await conn.query(
      `/* IA:INSERT_FINAL_IA_HISTORY */
       INSERT INTO student_final_ia_history
         (student_id, batch_id, subject_id, action_type, previous_final_ia, new_final_ia,
          automatic_ia_value, reason_category, explanation, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        batchId,
        subjectId,
        'MANUAL_ADJUSTMENT',
        previousFinalIa,
        roundedAdjusted,
        autoIa,
        normalizedCategory,
        trimmedExplanation,
        actorId,
      ]
    );

    await conn.commit();

    return {
      studentId,
      batchId,
      subjectId,
      iaMaximum,
      automaticIaAtApproval: autoIa,
      previousFinalIa,
      approvedFinalIa: roundedAdjusted,
      approvalType: 'MANUAL_ADJUSTMENT',
      finalStatus: 'ADJUSTED_APPROVED',
      requiresOfficeReview: false,
      reasonCategory: normalizedCategory,
      explanation: trimmedExplanation,
      approvedBy: actorId,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
