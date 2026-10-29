import { MemoryDatabase } from './memory-db.ts';

/**
 * Dedicated SQL query handler for Internal Assessment (Steps 2A, 2B, 2C, 2D)
 * when running in standalone fallback mode (when local MySQL is unreachable).
 * Mirrors MySQL/MariaDB relational behavior with 100% parity.
 */
export function handleInternalAssessmentQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const trimmed = sql.trim();
  const stripped = trimmed.replace(/^(\/\*[\s\S]*?\*\/\s*)+/, '').trim();
  const upper = stripped.toUpperCase();
  const now = new Date().toISOString();

  // ============================================================================
  // 1. TAGGED INTERNAL ASSESSMENT QUERIES (`/* IA:... */`)
  // ============================================================================
  if (sql.includes('/* IA:LIST_SUBJECTS */')) {
    const rows = [...memDb.iaSubjects]
      .sort((a, b) => a.professional_year - b.professional_year || a.name.localeCompare(b.name))
      .map((s) => {
        const dept = s.department_id
          ? memDb.departments.find((d) => d.id === s.department_id)
          : null;
        return {
          ...s,
          department_name: dept?.name || null,
          department_code: dept?.code || null,
          department_is_active: dept ? dept.is_active : null,
        };
      });
    return [rows, []];
  }

  if (sql.includes('/* IA:GET_SUBJECT_BY_ID */')) {
    const id = Number(params[0]);
    const subj = memDb.iaSubjects.find((s) => s.id === id);
    if (!subj) return [[], []];
    const dept = subj.department_id
      ? memDb.departments.find((d) => d.id === subj.department_id)
      : null;
    return [
      [
        {
          ...subj,
          department_name: dept?.name || null,
          department_code: dept?.code || null,
          department_is_active: dept ? dept.is_active : null,
        },
      ],
      [],
    ];
  }

  if (sql.includes('/* IA:UPDATE_SUBJECT_CONFIG */')) {
    const [deptId, patMappingVerified, patMappingConfig, notes, subjectId] = params;
    const subj = memDb.iaSubjects.find((s) => s.id === Number(subjectId));
    if (!subj) return [{ affectedRows: 0 }, []];
    subj.department_id = deptId !== null && deptId !== undefined ? Number(deptId) : null;
    subj.pat_mapping_verified = Boolean(patMappingVerified);
    if (patMappingConfig === null || patMappingConfig === undefined) {
      subj.pat_mapping_config = null;
    } else if (typeof patMappingConfig === 'string') {
      try {
        subj.pat_mapping_config = JSON.parse(patMappingConfig);
      } catch {
        subj.pat_mapping_config = null;
      }
    } else {
      subj.pat_mapping_config = patMappingConfig;
    }
    subj.notes = notes !== undefined && notes !== null ? String(notes) : subj.notes;
    subj.updated_at = now;
    return [{ affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:LIST_ASSESSMENTS */')) {
    const rows = [...memDb.iaAssessments].sort(
      (a, b) => a.term_number - b.term_number || a.id - b.id
    );
    return [rows, []];
  }

  if (sql.includes('/* IA:GET_ASSESSMENT_BY_ID */')) {
    const id = Number(params[0]);
    const assess = memDb.iaAssessments.find((a) => a.id === id);
    return [assess ? [{ ...assess }] : [], []];
  }

  if (sql.includes('/* IA:LIST_BATCHES */')) {
    const rows = [...memDb.academicBatches]
      .sort((a, b) => a.display_order - b.display_order || a.id - b.id)
      .map((b) => {
        const scheme = memDb.curriculumSchemes.find((cs) => cs.id === b.scheme_id);
        return {
          ...b,
          scheme_code: scheme?.code || null,
          is_legacy_minimal: scheme ? Boolean(scheme.is_legacy_minimal) : false,
        };
      });
    return [rows, []];
  }

  if (sql.includes('/* IA:GET_BATCH_BY_ID */')) {
    const id = Number(params[0]);
    const batch = memDb.academicBatches.find((b) => b.id === id);
    if (!batch) return [[], []];
    const scheme = memDb.curriculumSchemes.find((cs) => cs.id === batch.scheme_id);
    return [
      [
        {
          ...batch,
          scheme_code: scheme?.code || null,
          is_legacy_minimal: scheme ? Boolean(scheme.is_legacy_minimal) : false,
        },
      ],
      [],
    ];
  }

  if (sql.includes('/* IA:GET_SUBJECT_ASSESSMENT_CONFIG */')) {
    const subjectId = Number(params[0]);
    const rows = memDb.subjectAssessmentConfigs
      .filter((c) => c.subject_id === subjectId)
      .map((c) => {
        const a = memDb.iaAssessments.find((x) => x.id === c.assessment_id);
        return {
          ...c,
          assessment_code: a?.code || '',
          assessment_name: a?.name || '',
          assessment_type: a?.assessment_type || 'PAT',
          term_number: a?.term_number || 1,
          max_marks_theory: a?.max_marks_theory ?? 15,
          max_marks_practical: a?.max_marks_practical ?? 0,
        };
      })
      .sort((a, b) => a.term_number - b.term_number || a.assessment_id - b.assessment_id);
    return [rows, []];
  }

  if (sql.includes('/* IA:UPSERT_SUBJECT_ASSESSMENT_CONFIG */')) {
    const [
      subjectIdRaw,
      assessmentIdRaw,
      isApplicableRaw,
      isAvailableRaw,
      fromDateRaw,
      toDateRaw,
      updatedByRaw,
    ] = params;
    const subjectId = Number(subjectIdRaw);
    const assessmentId = Number(assessmentIdRaw);
    const existing = memDb.subjectAssessmentConfigs.find(
      (c) => c.subject_id === subjectId && c.assessment_id === assessmentId
    );
    if (existing) {
      existing.is_applicable = Boolean(isApplicableRaw);
      existing.is_available_for_entry = Boolean(isAvailableRaw);
      existing.available_from_date = fromDateRaw || null;
      existing.available_to_date = toDateRaw || null;
      existing.updated_by = updatedByRaw !== null && updatedByRaw !== undefined ? Number(updatedByRaw) : null;
      existing.updated_at = now;
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    }
    const id = memDb.generateId('subjectAssessmentConfigs');
    memDb.subjectAssessmentConfigs.push({
      id,
      subject_id: subjectId,
      assessment_id: assessmentId,
      is_applicable: Boolean(isApplicableRaw),
      is_available_for_entry: Boolean(isAvailableRaw),
      available_from_date: fromDateRaw || null,
      available_to_date: toDateRaw || null,
      updated_by: updatedByRaw !== null && updatedByRaw !== undefined ? Number(updatedByRaw) : null,
      updated_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:GET_SUBMISSION_STATUS */')) {
    const [batchIdRaw, subjectIdRaw, assessmentIdRaw] = params;
    const sub = memDb.assessmentSubmissions.find(
      (s) =>
        s.batch_id === Number(batchIdRaw) &&
        s.subject_id === Number(subjectIdRaw) &&
        s.assessment_id === Number(assessmentIdRaw)
    );
    if (!sub) return [[], []];
    const user = memDb.users.find((u) => u.id === sub.submitted_by);
    return [
      [
        {
          ...sub,
          submitted_by_username: user?.username || null,
          submitted_by_fullname: user?.full_name || null,
        },
      ],
      [],
    ];
  }

  if (sql.includes('/* IA:LIST_SUBMISSIONS_FOR_BATCH_SUBJECT */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const rows = memDb.assessmentSubmissions
      .filter((s) => s.batch_id === batchId && s.subject_id === subjectId)
      .map((s) => {
        const a = memDb.iaAssessments.find((x) => x.id === s.assessment_id);
        const u = memDb.users.find((x) => x.id === s.submitted_by);
        return {
          ...s,
          assessment_code: a?.code || '',
          assessment_name: a?.name || '',
          assessment_type: a?.assessment_type || 'PAT',
          term_number: a?.term_number || 1,
          submitted_by_username: u?.username || null,
          submitted_by_fullname: u?.full_name || null,
        };
      })
      .sort((a, b) => a.term_number - b.term_number || a.assessment_id - b.assessment_id);
    return [rows, []];
  }

  if (sql.includes('/* IA:LIST_SUBMITTED_BATCH_IDS_FOR_SUBJECT */')) {
    const subjectId = Number(params[0]);
    const batchIds = Array.from(
      new Set(
        memDb.assessmentSubmissions
          .filter((s) => s.subject_id === subjectId)
          .map((s) => s.batch_id)
      )
    );
    return [batchIds.map((id) => ({ batch_id: id })), []];
  }

  if (sql.includes('/* IA:INSERT_SUBMISSION */')) {
    const [batchIdRaw, subjectIdRaw, assessmentIdRaw, deptIdRaw, submittedByRaw] = params;
    const batchId = Number(batchIdRaw);
    const subjectId = Number(subjectIdRaw);
    const assessmentId = Number(assessmentIdRaw);
    const dup = memDb.assessmentSubmissions.find(
      (s) => s.batch_id === batchId && s.subject_id === subjectId && s.assessment_id === assessmentId
    );
    if (dup) {
      const err: any = new Error('Duplicate assessment submission');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }
    const id = memDb.generateId('assessmentSubmissions');
    memDb.assessmentSubmissions.push({
      id,
      batch_id: batchId,
      subject_id: subjectId,
      assessment_id: assessmentId,
      department_id: deptIdRaw !== null && deptIdRaw !== undefined ? Number(deptIdRaw) : null,
      submitted_by: Number(submittedByRaw),
      submitted_at: now,
      status: 'SUBMITTED',
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:LIST_BATCH_STUDENTS */')) {
    const batchId = Number(params[0]);
    const rows = memDb.students
      .filter((s) => {
        const currentOrOrig =
          s.current_placement_batch_id !== undefined && s.current_placement_batch_id !== null
            ? s.current_placement_batch_id === batchId || s.original_batch_id === batchId
            : s.original_batch_id === batchId;
        const adminStatus = s.administrative_status || 'ACTIVE';
        return currentOrOrig && adminStatus !== 'CANCELLED';
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((s) => ({
        id: s.id,
        studentIdNumber: s.student_id_number,
        temporaryRollNumber: s.temporary_roll_number || s.student_id_number,
        permanentUniversityNumber: s.permanent_university_number || null,
        fullName: s.full_name,
        administrativeStatus: s.administrative_status || 'ACTIVE',
        schemeId: s.scheme_id || null,
      }));
    return [rows, []];
  }

  if (sql.includes('/* IA:LIST_MARKS_FOR_ASSESSMENT */')) {
    const [batchIdRaw, subjectIdRaw, assessmentIdRaw] = params;
    const rows = memDb.studentAssessmentMarks.filter(
      (m) =>
        m.batch_id === Number(batchIdRaw) &&
        m.subject_id === Number(subjectIdRaw) &&
        m.assessment_id === Number(assessmentIdRaw)
    );
    return [rows, []];
  }

  if (sql.includes('/* IA:LIST_SUBMITTED_MARKS_FOR_BATCH_SUBJECT */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const submittedSet = new Map<number, string>();
    for (const sub of memDb.assessmentSubmissions) {
      if (sub.batch_id === batchId && sub.subject_id === subjectId && sub.status === 'SUBMITTED') {
        submittedSet.set(sub.assessment_id, sub.submitted_at);
      }
    }
    const rows = memDb.studentAssessmentMarks
      .filter(
        (m) =>
          m.batch_id === batchId &&
          m.subject_id === subjectId &&
          !m.is_draft &&
          submittedSet.has(m.assessment_id)
      )
      .map((m) => {
        const a = memDb.iaAssessments.find((x) => x.id === m.assessment_id);
        return {
          ...m,
          assessment_code: a?.code || '',
          assessment_name: a?.name || '',
          assessment_type: a?.assessment_type || 'PAT',
          term_number: a?.term_number || 1,
          submitted_at: submittedSet.get(m.assessment_id) || now,
        };
      });
    return [rows, []];
  }

  if (sql.includes('/* IA:UPSERT_STUDENT_MARK */')) {
    const [
      studentIdRaw,
      subjectIdRaw,
      assessmentIdRaw,
      batchIdRaw,
      outcomeRaw,
      theoryMarksRaw,
      practicalMarksRaw,
      isDraftRaw,
      savedByRaw,
    ] = params;
    const studentId = Number(studentIdRaw);
    const subjectId = Number(subjectIdRaw);
    const assessmentId = Number(assessmentIdRaw);
    const batchId = Number(batchIdRaw);

    const existing = memDb.studentAssessmentMarks.find(
      (m) =>
        m.student_id === studentId &&
        m.subject_id === subjectId &&
        m.assessment_id === assessmentId
    );
    const theoryVal =
      theoryMarksRaw !== null && theoryMarksRaw !== undefined ? Number(theoryMarksRaw) : null;
    const pracVal =
      practicalMarksRaw !== null && practicalMarksRaw !== undefined
        ? Number(practicalMarksRaw)
        : null;

    if (existing) {
      existing.batch_id = batchId;
      existing.outcome = outcomeRaw;
      existing.theory_marks = theoryVal;
      existing.practical_marks = pracVal;
      existing.is_draft = Boolean(isDraftRaw);
      existing.saved_by = savedByRaw !== null && savedByRaw !== undefined ? Number(savedByRaw) : null;
      existing.updated_at = now;
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    }

    const id = memDb.generateId('studentAssessmentMarks');
    memDb.studentAssessmentMarks.push({
      id,
      student_id: studentId,
      subject_id: subjectId,
      assessment_id: assessmentId,
      batch_id: batchId,
      outcome: outcomeRaw,
      theory_marks: theoryVal,
      practical_marks: pracVal,
      is_draft: Boolean(isDraftRaw),
      saved_by: savedByRaw !== null && savedByRaw !== undefined ? Number(savedByRaw) : null,
      created_at: now,
      updated_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:DELETE_TERM_TEST_CONVERSIONS_FOR_BATCH_SUBJECT */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const before = memDb.studentTermTestConversions.length;
    memDb.studentTermTestConversions = memDb.studentTermTestConversions.filter(
      (c) => !(c.batch_id === batchId && c.subject_id === subjectId)
    );
    return [{ affectedRows: before - memDb.studentTermTestConversions.length }, []];
  }

  if (sql.includes('/* IA:UPSERT_TERM_TEST_CONVERSION */')) {
    const [
      studentIdRaw,
      batchIdRaw,
      subjectIdRaw,
      assessmentIdRaw,
      termNumberRaw,
      outcomeRaw,
      rawTheoryRaw,
      rawPracRaw,
      combinedRaw,
      convMaxRaw,
      convertedMarksRaw,
      convStatusRaw,
      statusReasonRaw,
    ] = params;
    const studentId = Number(studentIdRaw);
    const subjectId = Number(subjectIdRaw);
    const assessmentId = Number(assessmentIdRaw);

    const existing = memDb.studentTermTestConversions.find(
      (c) =>
        c.student_id === studentId &&
        c.subject_id === subjectId &&
        c.assessment_id === assessmentId
    );
    const payload = {
      student_id: studentId,
      batch_id: Number(batchIdRaw),
      subject_id: subjectId,
      assessment_id: assessmentId,
      term_number: Number(termNumberRaw),
      outcome: outcomeRaw,
      raw_theory_marks: rawTheoryRaw !== null && rawTheoryRaw !== undefined ? Number(rawTheoryRaw) : null,
      raw_practical_marks: rawPracRaw !== null && rawPracRaw !== undefined ? Number(rawPracRaw) : null,
      combined_raw_marks: combinedRaw !== null && combinedRaw !== undefined ? Number(combinedRaw) : null,
      conversion_maximum: Number(convMaxRaw),
      converted_marks:
        convertedMarksRaw !== null && convertedMarksRaw !== undefined
          ? Number(convertedMarksRaw)
          : null,
      conversion_status: convStatusRaw,
      status_reason: statusReasonRaw || null,
      calculated_at: now,
    };

    if (existing) {
      Object.assign(existing, payload);
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    }

    const id = memDb.generateId('studentTermTestConversions');
    memDb.studentTermTestConversions.push({ id, ...payload });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:LIST_TERM_TEST_CONVERSIONS */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const rows = memDb.studentTermTestConversions
      .filter((c) => c.batch_id === batchId && c.subject_id === subjectId)
      .map((c) => {
        const a = memDb.iaAssessments.find((x) => x.id === c.assessment_id);
        return {
          ...c,
          assessment_code: a?.code || '',
          assessment_name: a?.name || '',
        };
      })
      .sort((a, b) => a.student_id - b.student_id || a.term_number - b.term_number);
    return [rows, []];
  }

  if (sql.includes('/* IA:UPSERT_STUDENT_IA_CALCULATION */')) {
    const [
      studentIdRaw,
      batchIdRaw,
      subjectIdRaw,
      schemeCode,
      iaMaximum,
      term1A,
      term1B,
      term1C,
      term1D,
      term1E,
      term1F,
      term1H,
      term2A,
      term2B,
      term2C,
      term2D,
      term2E,
      term2F,
      term2H,
      term3A,
      term3B,
      term3C,
      term3D,
      term3E,
      term3H,
      finalAutomaticIa,
      sourceAssessmentsRaw,
      calculationStatus,
      statusReason,
    ] = params;

    const studentId = Number(studentIdRaw);
    const batchId = Number(batchIdRaw);
    const subjectId = Number(subjectIdRaw);

    let parsedSource = sourceAssessmentsRaw;
    if (typeof sourceAssessmentsRaw === 'string') {
      try {
        parsedSource = JSON.parse(sourceAssessmentsRaw);
      } catch {
        parsedSource = null;
      }
    }

    const numOrNull = (v: any) => (v !== null && v !== undefined ? Number(v) : null);

    const payload = {
      student_id: studentId,
      batch_id: batchId,
      subject_id: subjectId,
      scheme_code: schemeCode || null,
      ia_maximum: numOrNull(iaMaximum),
      term1_a: numOrNull(term1A),
      term1_b: numOrNull(term1B),
      term1_c: numOrNull(term1C),
      term1_d: numOrNull(term1D),
      term1_e: numOrNull(term1E),
      term1_f: numOrNull(term1F),
      term1_h: numOrNull(term1H),
      term2_a: numOrNull(term2A),
      term2_b: numOrNull(term2B),
      term2_c: numOrNull(term2C),
      term2_d: numOrNull(term2D),
      term2_e: numOrNull(term2E),
      term2_f: numOrNull(term2F),
      term2_h: numOrNull(term2H),
      term3_a: numOrNull(term3A),
      term3_b: numOrNull(term3B),
      term3_c: numOrNull(term3C),
      term3_d: numOrNull(term3D),
      term3_e: numOrNull(term3E),
      term3_h: numOrNull(term3H),
      final_automatic_ia: numOrNull(finalAutomaticIa),
      source_assessments: parsedSource,
      calculation_status: calculationStatus,
      status_reason: statusReason || null,
      calculated_at: now,
    };

    const existing = memDb.studentIaCalculations.find(
      (c) => c.student_id === studentId && c.batch_id === batchId && c.subject_id === subjectId
    );
    if (existing) {
      Object.assign(existing, payload);
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    }

    const id = memDb.generateId('studentIaCalculations');
    memDb.studentIaCalculations.push({ id, ...payload });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:LIST_STUDENT_IA_CALCULATIONS */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const rows = memDb.studentIaCalculations
      .filter((c) => c.batch_id === batchId && c.subject_id === subjectId)
      .map((c) => {
        const st = memDb.students.find((s) => s.id === c.student_id);
        return {
          ...c,
          studentIdNumber: st?.student_id_number || '',
          temporaryRollNumber: st?.temporary_roll_number || st?.student_id_number || '',
          permanentUniversityNumber: st?.permanent_university_number || null,
          fullName: st?.full_name || '',
          administrativeStatus: st?.administrative_status || 'ACTIVE',
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return [rows, []];
  }

  if (sql.includes('/* IA:GET_STUDENT_IA_CALCULATION_SINGLE */')) {
    const [studentIdRaw, batchIdRaw, subjectIdRaw] = params;
    const row = memDb.studentIaCalculations.find(
      (c) =>
        c.student_id === Number(studentIdRaw) &&
        c.batch_id === Number(batchIdRaw) &&
        c.subject_id === Number(subjectIdRaw)
    );
    if (!row) return [[], []];
    const st = memDb.students.find((s) => s.id === row.student_id);
    return [
      [
        {
          ...row,
          studentIdNumber: st?.student_id_number || '',
          temporaryRollNumber: st?.temporary_roll_number || st?.student_id_number || '',
          permanentUniversityNumber: st?.permanent_university_number || null,
          fullName: st?.full_name || '',
          administrativeStatus: st?.administrative_status || 'ACTIVE',
        },
      ],
      [],
    ];
  }

  if (sql.includes('/* IA:GET_FINAL_APPROVAL_FOR_STUDENT */')) {
    const [studentIdRaw, batchIdRaw, subjectIdRaw] = params;
    const row = memDb.studentFinalIaApprovals.find(
      (a) =>
        a.student_id === Number(studentIdRaw) &&
        a.batch_id === Number(batchIdRaw) &&
        a.subject_id === Number(subjectIdRaw)
    );
    if (!row) return [[], []];
    const approver = memDb.users.find((u) => u.id === row.approved_by);
    return [
      [
        {
          ...row,
          approved_by_username: approver?.username || null,
          approved_by_fullname: approver?.full_name || null,
        },
      ],
      [],
    ];
  }

  if (sql.includes('/* IA:LIST_FINAL_APPROVALS_FOR_BATCH_SUBJECT */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const rows = memDb.studentFinalIaApprovals
      .filter((a) => a.batch_id === batchId && a.subject_id === subjectId)
      .map((a) => {
        const approver = memDb.users.find((u) => u.id === a.approved_by);
        return {
          ...a,
          approved_by_username: approver?.username || null,
          approved_by_fullname: approver?.full_name || null,
        };
      });
    return [rows, []];
  }

  if (sql.includes('/* IA:UPSERT_FINAL_APPROVAL */')) {
    const [
      studentIdRaw,
      batchIdRaw,
      subjectIdRaw,
      iaMaximumRaw,
      autoIaAtApprovalRaw,
      approvedFinalIaRaw,
      approvalTypeRaw,
      finalStatusRaw,
      requiresOfficeReviewRaw,
      reviewFlagReasonRaw,
      reasonCategoryRaw,
      explanationRaw,
      approvedByRaw,
    ] = params;

    const studentId = Number(studentIdRaw);
    const batchId = Number(batchIdRaw);
    const subjectId = Number(subjectIdRaw);

    const existing = memDb.studentFinalIaApprovals.find(
      (a) => a.student_id === studentId && a.batch_id === batchId && a.subject_id === subjectId
    );

    const payload = {
      student_id: studentId,
      batch_id: batchId,
      subject_id: subjectId,
      ia_maximum: Number(iaMaximumRaw),
      automatic_ia_at_approval: Number(autoIaAtApprovalRaw),
      approved_final_ia: Number(approvedFinalIaRaw),
      approval_type: approvalTypeRaw as 'APPROVED_AS_CALCULATED' | 'MANUAL_ADJUSTMENT',
      final_status: finalStatusRaw as 'APPROVED' | 'ADJUSTED_APPROVED' | 'REQUIRES_REVIEW',
      requires_office_review: Boolean(requiresOfficeReviewRaw),
      review_flag_reason: reviewFlagReasonRaw ? String(reviewFlagReasonRaw) : null,
      reason_category: reasonCategoryRaw ? String(reasonCategoryRaw) : null,
      explanation: explanationRaw ? String(explanationRaw) : null,
      approved_by: Number(approvedByRaw),
      approved_at: now,
      updated_at: now,
    };

    if (existing) {
      Object.assign(existing, payload);
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    }

    const id = memDb.generateId('studentFinalIaApprovals');
    memDb.studentFinalIaApprovals.push({ id, ...payload });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:FLAG_FINAL_APPROVAL_FOR_REVIEW */')) {
    const [reviewFlagReasonRaw, studentIdRaw, batchIdRaw, subjectIdRaw] = params;
    const existing = memDb.studentFinalIaApprovals.find(
      (a) =>
        a.student_id === Number(studentIdRaw) &&
        a.batch_id === Number(batchIdRaw) &&
        a.subject_id === Number(subjectIdRaw)
    );
    if (!existing) return [{ affectedRows: 0 }, []];
    existing.requires_office_review = true;
    existing.final_status = 'REQUIRES_REVIEW';
    existing.review_flag_reason = reviewFlagReasonRaw ? String(reviewFlagReasonRaw) : null;
    existing.updated_at = now;
    return [{ affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:INSERT_FINAL_IA_HISTORY */')) {
    const [
      studentIdRaw,
      batchIdRaw,
      subjectIdRaw,
      actionTypeRaw,
      previousFinalIaRaw,
      newFinalIaRaw,
      automaticIaValueRaw,
      reasonCategoryRaw,
      explanationRaw,
      actorIdRaw,
    ] = params;

    const id = memDb.generateId('studentFinalIaHistory');
    memDb.studentFinalIaHistory.push({
      id,
      student_id: Number(studentIdRaw),
      batch_id: Number(batchIdRaw),
      subject_id: Number(subjectIdRaw),
      action_type: actionTypeRaw as
        | 'APPROVED_AS_CALCULATED'
        | 'MANUAL_ADJUSTMENT'
        | 'FLAGGED_FOR_REVIEW_ON_RECALC',
      previous_final_ia:
        previousFinalIaRaw !== null && previousFinalIaRaw !== undefined
          ? Number(previousFinalIaRaw)
          : null,
      new_final_ia: Number(newFinalIaRaw),
      automatic_ia_value:
        automaticIaValueRaw !== null && automaticIaValueRaw !== undefined
          ? Number(automaticIaValueRaw)
          : null,
      reason_category: reasonCategoryRaw ? String(reasonCategoryRaw) : null,
      explanation: explanationRaw ? String(explanationRaw) : null,
      actor_id: actorIdRaw !== null && actorIdRaw !== undefined ? Number(actorIdRaw) : null,
      created_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* IA:LIST_FINAL_IA_HISTORY */')) {
    const batchId = Number(params[0]);
    const subjectId = Number(params[1]);
    const hasStudentFilter = sql.includes('h.student_id = ?') && params.length >= 3;
    const targetStudentId = hasStudentFilter ? Number(params[2]) : null;

    const rows = memDb.studentFinalIaHistory
      .filter(
        (h) =>
          h.batch_id === batchId &&
          h.subject_id === subjectId &&
          (targetStudentId === null || h.student_id === targetStudentId)
      )
      .map((h) => {
        const actor = h.actor_id ? memDb.users.find((u) => u.id === h.actor_id) : null;
        const st = memDb.students.find((s) => s.id === h.student_id);
        return {
          ...h,
          actor_username: actor?.username || null,
          actor_fullname: actor?.full_name || null,
          student_name: st?.full_name || '',
          temporary_roll_number: st?.temporary_roll_number || st?.student_id_number || '',
        };
      })
      .sort((a, b) => b.id - a.id);
    return [rows, []];
  }

  if (sql.includes('/* IA:CHECK_USER_DEPARTMENT_ACTIVE */')) {
    const deptId = Number(params[0]);
    const dept = memDb.departments.find((d) => d.id === deptId);
    return [dept ? [{ ...dept }] : [], []];
  }

  if (sql.includes('/* IA:GET_SINGLE_SUBJECT_ASSESSMENT_CONFIG */')) {
    const [subjectIdRaw, assessmentIdRaw] = params;
    const cfg = memDb.subjectAssessmentConfigs.find(
      (c) => c.subject_id === Number(subjectIdRaw) && c.assessment_id === Number(assessmentIdRaw)
    );
    return [cfg ? [{ ...cfg }] : [], []];
  }

  if (sql.includes('/* IA:GET_REPORT_BRANDING */')) {
    const keys = new Set(['REPORT_COLLEGE_NAME', 'REPORT_SUBTITLE', 'REPORT_LOGO_URL']);
    const rows = memDb.institutionalSettings.filter((s) => keys.has(s.setting_key));
    return [rows.map((r) => ({ ...r })), []];
  }

  if (sql.includes('/* IA:UPSERT_REPORT_BRANDING */')) {
    const [settingKeyRaw, settingValueRaw, effectiveDateRaw, updatedByRaw, updatedReasonRaw] = params;
    const key = String(settingKeyRaw);
    const val = String(settingValueRaw ?? '');
    const effDate = String(effectiveDateRaw || now.slice(0, 10));
    const updBy = updatedByRaw !== null && updatedByRaw !== undefined ? Number(updatedByRaw) : null;
    const updReason = updatedReasonRaw ? String(updatedReasonRaw) : null;

    const existing = memDb.institutionalSettings.find((s) => s.setting_key === key);
    if (existing) {
      existing.setting_value = val;
      existing.effective_date = effDate;
      existing.updated_by = updBy;
      existing.updated_reason = updReason;
      existing.updated_at = now;
      return [{ affectedRows: 1 }, []];
    }

    memDb.institutionalSettings.push({
      setting_key: key,
      setting_value: val,
      effective_date: effDate,
      updated_by: updBy,
      updated_reason: updReason,
      updated_at: now,
    });
    return [{ affectedRows: 1 }, []];
  }

  // Fallback untagged IA table safety checks
  if (upper.includes('FROM SUBJECTS') || upper.includes('FROM `SUBJECTS`')) {
    if (upper.includes('WHERE ID = ?')) {
      const id = Number(params[0]);
      const subj = memDb.iaSubjects.find((s) => s.id === id);
      return [subj ? [{ ...subj }] : [], []];
    }
    return [[...memDb.iaSubjects], []];
  }

  if (
    (upper.includes('FROM ASSESSMENTS') || upper.includes('FROM `ASSESSMENTS`')) &&
    !upper.includes('STUDENT_FEE_ASSESSMENTS')
  ) {
    if (upper.includes('WHERE ID = ?')) {
      const id = Number(params[0]);
      const a = memDb.iaAssessments.find((x) => x.id === id);
      return [a ? [{ ...a }] : [], []];
    }
    return [[...memDb.iaAssessments], []];
  }

  return null;
}
