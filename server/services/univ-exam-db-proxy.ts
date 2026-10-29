import { MemoryDatabase } from './memory-db.ts';

/**
 * Handles University Examination queries against the in-memory fallback database.
 */
export function handleUniversityExamQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const upper = sql.trim().toUpperCase();

  // 1. Fetch university subjects
  // SELECT id, code, name, professional_year, scheme_id, max_marks, is_active FROM university_subjects WHERE scheme_id = ? AND professional_year = ? AND is_active = TRUE
  if (upper.includes('FROM UNIVERSITY_SUBJECTS') || upper.includes('FROM `UNIVERSITY_SUBJECTS`')) {
    if (upper.startsWith('SELECT')) {
      let results = [...(memDb.universitySubjects || [])];

      if (upper.includes('WHERE SCHEME_ID = ? AND PROFESSIONAL_YEAR = ?')) {
        const schemeId = Number(params[0]);
        const profYear = Number(params[1]);
        results = results.filter(
          (s) => s.scheme_id === schemeId && s.professional_year === profYear && s.is_active
        );
      } else if (upper.includes('WHERE SCHEME_ID = ?')) {
        const schemeId = Number(params[0]);
        results = results.filter((s) => s.scheme_id === schemeId && s.is_active);
      } else if (upper.includes('WHERE ID = ?')) {
        const id = Number(params[0]);
        results = results.filter((s) => s.id === id);
      }

      if (upper.includes('ORDER BY NAME ASC')) {
        results.sort((a, b) => a.name.localeCompare(b.name));
      }

      return [results, []];
    }
  }

  // 2. Fetch student university exam attempts
  if (
    upper.includes('FROM STUDENT_UNIVERSITY_EXAM_ATTEMPTS') ||
    upper.includes('FROM `STUDENT_UNIVERSITY_EXAM_ATTEMPTS`')
  ) {
    if (upper.startsWith('SELECT')) {
      let results = (memDb.studentUniversityExamAttempts || []).map((a) => {
        const student = (memDb.students || []).find((s) => s.id === a.student_id);
        const subject = (memDb.universitySubjects || []).find((sub) => sub.id === a.subject_id);
        const recorder = (memDb.users || []).find((u) => u.id === a.recorded_by);
        const finalizer = a.finalized_by ? (memDb.users || []).find((u) => u.id === a.finalized_by) : null;
        return {
          ...a,
          student_name: student?.full_name || '',
          full_name: student?.full_name || '',
          student_id_number: student?.student_id_number || '',
          university_reg_number: student?.permanent_university_number || null,
          recorder_name: recorder?.full_name || 'Office Staff',
          finalized_by_name: finalizer?.full_name || null,
          subject_name: subject?.name || '',
          subject_code: subject?.code || '',
          professional_year: subject?.professional_year || 1,
          current_placement_batch_id: student?.current_placement_batch_id || null,
          original_batch_id: student?.original_batch_id || null,
        };
      });

      // Filter by attempt ID: WHERE suea.id = ?
      if (upper.includes('WHERE SUEA.ID = ?') || upper.includes('WHERE ID = ?')) {
        const targetId = Number(params[0]);
        results = results.filter((a) => a.id === targetId);
        return [results, []];
      }

      // Filter by single student: WHERE student_id = ?
      if (upper.includes('WHERE STUDENT_ID = ?') && !upper.includes('STUDENT_ID IN')) {
        const sid = Number(params[0]);
        results = results.filter((a) => a.student_id === sid);

        if (upper.includes('SUBJECT_ID = ?')) {
          const subId = Number(params[1]);
          results = results.filter((a) => a.subject_id === subId);
        }

        if (upper.includes('EXAM_SESSION_REF = ?')) {
          const sRef = String(params[upper.includes('SUBJECT_ID = ?') ? 2 : 1] || '').trim();
          results = results.filter((a) => a.exam_session_ref === sRef);
        }

        if (upper.includes('ATTEMPT_TYPE = ?')) {
          const aIdx = upper.includes('SUBJECT_ID = ?') ? 3 : 2;
          const aType = String(params[aIdx] || '').trim().toUpperCase();
          results = results.filter((a) => a.attempt_type === aType);
        }

        return [results, []];
      }

      // Filter by student ID list: WHERE suea.student_id IN (?)
      if (upper.includes('STUDENT_ID IN')) {
        const idList: number[] = Array.isArray(params[0])
          ? params[0].map(Number)
          : [Number(params[0])];
        results = results.filter((a) => idList.includes(a.student_id));

        if (upper.includes('EXAM_SESSION_REF = ?')) {
          const sRef = String(params[1] || '').trim();
          results = results.filter((a) => a.exam_session_ref === sRef);
        }

        if (upper.includes('ATTEMPT_TYPE = ?')) {
          const aType = String(params[2] || '').trim().toUpperCase();
          results = results.filter((a) => a.attempt_type === aType);
        }

        if (upper.includes('ORDER BY SUEA.RECORDED_AT DESC') || upper.includes('ORDER BY RECORDED_AT DESC')) {
          results.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
        }

        return [results, []];
      }

      // Filter by batch placement: WHERE (s.current_placement_batch_id = ? OR s.original_batch_id = ?)
      if (upper.includes('CURRENT_PLACEMENT_BATCH_ID = ? OR S.ORIGINAL_BATCH_ID = ?')) {
        const bId = Number(params[0]);
        results = results.filter((a) => a.current_placement_batch_id === bId || a.original_batch_id === bId);

        if (upper.includes('EXAM_SESSION_REF = ?')) {
          const sRef = String(params[2] || '').trim();
          results = results.filter((a) => a.exam_session_ref === sRef);
        }

        if (upper.includes('ATTEMPT_TYPE = ?')) {
          const aType = String(params[3] || '').trim().toUpperCase();
          results = results.filter((a) => a.attempt_type === aType);
        }

        if (upper.includes('SUEA.ID IN')) {
          const attIds = Array.isArray(params[4]) ? params[4].map(Number) : [Number(params[4])];
          results = results.filter((a) => attIds.includes(a.id));
        }

        return [results, []];
      }

      if (upper.includes('WHERE A.BATCH_ID = ?') || upper.includes('WHERE BATCH_ID = ?')) {
        const batchId = Number(params[0]);
        results = results.filter((a) => a.batch_id === batchId);

        if (upper.includes('EXAM_SESSION_REF = ?')) {
          const sessionRef = String(params[1] || '').trim();
          results = results.filter((a) => a.exam_session_ref === sessionRef);
        }

        if (upper.includes('ATTEMPT_TYPE = ?')) {
          const attemptIdx = upper.includes('EXAM_SESSION_REF = ?') ? 2 : 1;
          const attemptType = String(params[attemptIdx] || '').trim().toUpperCase();
          results = results.filter((a) => a.attempt_type === attemptType);
        }

        return [results, []];
      }

      return [results, []];
    }
  }

  // 3. Upsert student university exam attempt
  if (
    upper.startsWith('INSERT INTO STUDENT_UNIVERSITY_EXAM_ATTEMPTS') ||
    upper.startsWith('INSERT INTO `STUDENT_UNIVERSITY_EXAM_ATTEMPTS`')
  ) {
    // Expected query params: [student_id, subject_id, exam_session_ref, attempt_type, result_status, marks_obtained, failed_subjects_json, office_decision, recorded_by]
    const studentId = Number(params[0]);
    const subjectId = Number(params[1]);
    const examSessionRef = String(params[2] || '').trim();
    const attemptType = String(params[3] || 'REGULAR').trim().toUpperCase() as 'REGULAR' | 'SUPPLEMENTARY';
    const resultStatus = String(params[4] || 'PENDING').trim().toUpperCase() as 'PASS' | 'FAIL' | 'PENDING' | 'WITHHELD';
    const marksObtained = params[5] !== null && params[5] !== undefined && String(params[5]).trim() !== ''
      ? Number(params[5])
      : null;
    let failedSubjectsJson: any = null;
    try {
      failedSubjectsJson = params[6]
        ? typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6]
        : null;
    } catch {
      failedSubjectsJson = null;
    }
    const officeDecision = (params[7] || 'PENDING') as 'PROMOTED' | 'DETAINED' | 'PENDING';
    const recordedBy = Number(params[8] || 1);
    const nowIso = new Date().toISOString();

    if (!memDb.studentUniversityExamAttempts) {
      memDb.studentUniversityExamAttempts = [];
    }

    const student = (memDb.students || []).find((s) => s.id === studentId);
    const batchId = student?.current_placement_batch_id || student?.original_batch_id || 1;

    const existingIdx = memDb.studentUniversityExamAttempts.findIndex(
      (a) =>
        a.student_id === studentId &&
        a.exam_session_ref === examSessionRef &&
        a.attempt_type === attemptType
    );

    if (existingIdx >= 0) {
      const existing = memDb.studentUniversityExamAttempts[existingIdx];
      existing.result_status = resultStatus;
      existing.marks_obtained = marksObtained;
      existing.failed_subjects_json = failedSubjectsJson;
      existing.office_decision = officeDecision;
      existing.recorded_by = recordedBy;
      existing.recorded_at = nowIso;
      existing.updated_at = nowIso;
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    } else {
      const id = memDb.generateId('studentUniversityExamAttempts');
      memDb.studentUniversityExamAttempts.push({
        id,
        student_id: studentId,
        subject_id: subjectId,
        batch_id: batchId,
        exam_session_ref: examSessionRef,
        attempt_type: attemptType,
        result_status: resultStatus,
        marks_obtained: marksObtained,
        max_marks: 100,
        failed_subjects_json: failedSubjectsJson,
        office_decision: officeDecision,
        remarks: null,
        is_finalized: false,
        finalized_by: null,
        finalized_at: null,
        finalization_remarks: null,
        recorded_by: recordedBy,
        recorded_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
  }

  // 4. Update student university exam attempt (Result Update, Finalization or Reopen)
  if (
    upper.startsWith('UPDATE STUDENT_UNIVERSITY_EXAM_ATTEMPTS') ||
    upper.startsWith('UPDATE `STUDENT_UNIVERSITY_EXAM_ATTEMPTS`')
  ) {
    if (!memDb.studentUniversityExamAttempts) {
      memDb.studentUniversityExamAttempts = [];
    }

    let affected = 0;
    const nowIso = new Date().toISOString();

    // Result Update by ID: SET result_status = ?, marks_obtained = ?, failed_subjects_json = ?, office_decision = ?, recorded_by = ?, recorded_at = CURRENT_TIMESTAMP WHERE id = ?
    if (upper.includes('RESULT_STATUS = ?') && upper.includes('WHERE ID = ?')) {
      const targetId = Number(params[params.length - 1]);
      const att = memDb.studentUniversityExamAttempts.find((a) => a.id === targetId);
      if (att) {
        att.result_status = String(params[0] || 'PENDING').trim().toUpperCase() as any;
        att.marks_obtained = params[1] !== null && params[1] !== undefined && String(params[1]).trim() !== ''
          ? Number(params[1])
          : null;
        try {
          att.failed_subjects_json = params[2]
            ? typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2]
            : null;
        } catch {
          att.failed_subjects_json = null;
        }
        att.office_decision = (params[3] || 'PENDING') as any;
        att.recorded_by = Number(params[4] || att.recorded_by);
        att.recorded_at = nowIso;
        att.updated_at = nowIso;
        affected = 1;
      }
      return [{ affectedRows: affected }, []];
    }

    // Reopen correction: SET is_finalized = FALSE, finalized_by = NULL, finalized_at = NULL, finalization_remarks = NULL WHERE id = ?
    if (upper.includes('IS_FINALIZED = FALSE')) {
      const targetId = Number(params[params.length - 1]);
      const att = memDb.studentUniversityExamAttempts.find((a) => a.id === targetId);
      if (att) {
        att.is_finalized = false;
        att.finalized_by = null;
        att.finalized_at = null;
        att.finalization_remarks = null;
        att.updated_at = nowIso;
        affected = 1;
      }
      return [{ affectedRows: affected }, []];
    }

    // Finalize: SET is_finalized = TRUE, finalized_by = ?, finalized_at = NOW(), finalization_remarks = ? WHERE id IN (?)
    if (upper.includes('IS_FINALIZED = TRUE') || upper.includes('IS_FINALIZED = ?')) {
      let finalizedBy: number | null = null;
      let remarks: string | null = null;
      let targetIds: number[] = [];

      if (upper.includes('IS_FINALIZED = TRUE')) {
        finalizedBy = params[0] !== undefined && params[0] !== null ? Number(params[0]) : null;
        remarks = params[1] !== undefined ? String(params[1]) : null;
        if (Array.isArray(params[2])) {
          targetIds = params[2].map(Number);
        } else if (params[2] !== undefined) {
          targetIds = [Number(params[2])];
        }
      } else {
        finalizedBy = params[1] !== undefined && params[1] !== null ? Number(params[1]) : null;
        remarks = params[2] !== undefined ? String(params[2]) : null;
        if (Array.isArray(params[3])) {
          targetIds = params[3].map(Number);
        } else if (params[3] !== undefined) {
          targetIds = [Number(params[3])];
        }
      }

      for (const att of memDb.studentUniversityExamAttempts) {
        if (targetIds.length === 0 || targetIds.includes(att.id)) {
          att.is_finalized = true;
          att.finalized_by = finalizedBy;
          att.finalized_at = nowIso;
          att.finalization_remarks = remarks;
          att.updated_at = nowIso;
          affected++;
        }
      }
      return [{ affectedRows: affected }, []];
    }

    return [{ affectedRows: 1 }, []];
  }

  return null;
}
