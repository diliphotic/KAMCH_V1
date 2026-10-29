import { MemoryDatabase, MemoryStudent } from './memory-db.ts';

/**
 * Parses `INSERT INTO table (col1, col2, ...) VALUES (expr1, expr2, ...)` into a `{ [colName]: value }`
 * map, resolving `?` parameter placeholders alongside SQL literals (`NULL`, `'text'`, `NOW()`, `TRUE`, `FALSE`, numbers).
 */
function parseSqlInsertObject(sql: string, params: any[]): Record<string, any> {
  const match = sql.match(/INSERT\s+INTO\s+[`\w]+\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*)\)/i);
  if (!match) return {};

  const cols = match[1]
    .split(',')
    .map((c) => c.replace(/`/g, '').trim().toLowerCase())
    .filter(Boolean);

  const valuesRaw = match[2].trim();
  const tokens: string[] = [];
  let cur = '';
  let inSingle = false;
  let parenDepth = 0;

  for (let i = 0; i < valuesRaw.length; i++) {
    const ch = valuesRaw[i];
    if (ch === "'" && valuesRaw[i - 1] !== '\\') {
      inSingle = !inSingle;
      cur += ch;
    } else if (!inSingle && ch === '(') {
      parenDepth++;
      cur += ch;
    } else if (!inSingle && ch === ')') {
      if (parenDepth > 0) {
        parenDepth--;
        cur += ch;
      } else {
        break;
      }
    } else if (!inSingle && parenDepth === 0 && ch === ',') {
      tokens.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) {
    tokens.push(cur.trim());
  }

  let paramIdx = 0;
  const out: Record<string, any> = {};
  const nowIso = new Date().toISOString();

  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const tok = tokens[i] ?? 'NULL';
    const upperTok = tok.toUpperCase();

    if (tok === '?') {
      out[col] = params[paramIdx++];
    } else if (upperTok === 'NULL') {
      out[col] = null;
    } else if (upperTok === 'TRUE') {
      out[col] = true;
    } else if (upperTok === 'FALSE') {
      out[col] = false;
    } else if (upperTok === 'NOW()' || upperTok === 'CURRENT_TIMESTAMP' || upperTok === 'CURRENT_TIMESTAMP()') {
      out[col] = nowIso;
    } else if (tok.startsWith("'") && tok.endsWith("'")) {
      out[col] = tok.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'");
    } else if (/^-?\d+(\.\d+)?$/.test(tok)) {
      out[col] = Number(tok);
    } else {
      out[col] = tok;
    }
  }

  return out;
}

/**
 * Dedicated SQL query handler for Student Management tables and tagged queries
 * when running in standalone fallback mode (when local MySQL is unreachable).
 * Preserves full relational parity with real MySQL/MariaDB queries.
 */
export function handleStudentModuleQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const trimmed = sql.trim();
  const stripped = trimmed.replace(/^(\/\*[\s\S]*?\*\/\s*)+/, '').trim();
  const upper = stripped.toUpperCase();

  // ============================================================================
  // 0. TAGGED STUDENT MANAGEMENT QUERIES (`/* SM:... */` — checked first so subqueries/joins never shadow them)
  // ============================================================================
  if (sql.includes('/* SM:STUDENT_AUDIT_LOGS */')) {
    const studentIdStr = String(params[0]);
    const list = memDb.auditLogs
      .filter((l) => l.target_type === 'STUDENT' && String(l.target_id) === studentIdStr)
      .sort((a, b) => b.id - a.id)
      .slice(0, 100)
      .map((l) => {
        const actor = l.actor_id ? memDb.users.find((u) => u.id === l.actor_id) : null;
        const actorRole = actor ? memDb.roles.find((r) => r.id === actor.role_id) : null;
        return {
          ...l,
          actor_username: actor?.username || null,
          actor_full_name: actor?.full_name || null,
          actor_role_code: actorRole?.code || null,
        };
      });
    return [list, []];
  }

  if (sql.includes('/* SM:CHECK_IDENTIFIER_CONFLICT */')) {
    const target = String(params[0]).toUpperCase();
    const excludeId = Number(params[3] ?? -1);
    const conflictStudent = memDb.students.filter(
      (s) =>
        s.id !== excludeId &&
        (s.student_id_number.toUpperCase() === target ||
          (s.temporary_roll_number && s.temporary_roll_number.toUpperCase() === target) ||
          (s.permanent_university_number && s.permanent_university_number.toUpperCase() === target))
    );
    if (conflictStudent.length > 0) return [conflictStudent, []];
    const histConflict = memDb.identifierHistory.filter(
      (h) =>
        h.student_id !== excludeId &&
        (String(h.new_identifier).toUpperCase() === target ||
          (h.previous_identifier && String(h.previous_identifier).toUpperCase() === target))
    );
    return [histConflict, []];
  }

  if (sql.includes('/* SM:CHECK_DUPLICATE_CANDIDATE */')) {
    return [memDb.students.map((s) => ({ ...s })), []];
  }

  if (sql.includes('/* SM:GET_STUDENT_DETAIL */')) {
    const studentId = Number(params[0]);
    const st = memDb.students.find((s) => s.id === studentId);
    if (!st) return [[], []];
    return [[enrichStudentRow(memDb, st)], []];
  }

  if (sql.includes('/* SM:LIST_STUDENTS */')) {
    const enriched = memDb.students
      .slice()
      .sort((a, b) => b.id - a.id)
      .map((s) => enrichStudentRow(memDb, s));
    return [enriched, []];
  }

  // ============================================================================
  // 1. CURRICULUM SCHEMES (`curriculum_schemes`)
  // ============================================================================
  if (upper.includes('FROM CURRICULUM_SCHEMES') || upper.includes('FROM `CURRICULUM_SCHEMES`')) {
    if (upper.includes('WHERE ID = ?')) {
      const id = Number(params[0]);
      const found = memDb.curriculumSchemes.find((s) => s.id === id);
      return [found ? [{ ...found }] : [], []];
    }
    if (upper.includes('WHERE CODE = ?')) {
      const code = String(params[0]).toUpperCase();
      const excludeId = upper.includes('AND ID != ?') ? Number(params[1]) : -1;
      const found = memDb.curriculumSchemes.filter(
        (s) => s.code.toUpperCase() === code && s.id !== excludeId
      );
      return [found.map((s) => ({ ...s })), []];
    }
    const list = [...memDb.curriculumSchemes].sort((a, b) => a.id - b.id);
    return [list.map((s) => ({ ...s })), []];
  }

  if (
    upper.startsWith('INSERT INTO CURRICULUM_SCHEMES') ||
    upper.startsWith('INSERT INTO `CURRICULUM_SCHEMES`')
  ) {
    const id = memDb.generateId('curriculumSchemes');
    const now = new Date().toISOString();
    memDb.curriculumSchemes.push({
      id,
      code: String(params[0]),
      name: String(params[1]),
      course_name: String(params[2] || 'BAMS'),
      is_legacy_minimal: Boolean(params[3]),
      professional_years_count: Number(params[4] ?? 3),
      regular_pass_max_failed_for_provisional: Number(params[5] ?? 2),
      allow_provisional_promotion: Boolean(params[6]),
      passing_criteria_verified: Boolean(params[7]),
      passing_rule_config: params[8] ? (typeof params[8] === 'string' ? JSON.parse(params[8]) : params[8]) : null,
      supplementary_cycle_months: Number(params[9] ?? 6),
      default_internship_days: Number(params[10] ?? 365),
      is_active: params[11] !== undefined ? Boolean(params[11]) : true,
      notes: params[12] ?? null,
      created_at: now,
      updated_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (
    upper.startsWith('UPDATE CURRICULUM_SCHEMES') ||
    upper.startsWith('UPDATE `CURRICULUM_SCHEMES`')
  ) {
    const targetId = Number(params[params.length - 1]);
    const scheme = memDb.curriculumSchemes.find((s) => s.id === targetId);
    if (!scheme) return [{ affectedRows: 0 }, []];
    scheme.name = String(params[0]);
    scheme.course_name = String(params[1] || 'BAMS');
    scheme.professional_years_count = Number(params[2]);
    scheme.regular_pass_max_failed_for_provisional = Number(params[3]);
    scheme.allow_provisional_promotion = Boolean(params[4]);
    scheme.passing_criteria_verified = Boolean(params[5]);
    scheme.supplementary_cycle_months = Number(params[6]);
    scheme.default_internship_days = Number(params[7]);
    scheme.is_active = Boolean(params[8]);
    scheme.notes = params[9] ?? null;
    scheme.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  // ============================================================================
  // 2. ACADEMIC BATCHES (`academic_batches`)
  // ============================================================================
  if (upper.includes('FROM ACADEMIC_BATCHES') || upper.includes('FROM `ACADEMIC_BATCHES`')) {
    const enrichBatch = (b: any) => {
      const scheme = memDb.curriculumSchemes.find((s) => s.id === b.scheme_id);
      const junior = b.junior_batch_id
        ? memDb.academicBatches.find((jb) => jb.id === b.junior_batch_id)
        : null;
      const origCount = memDb.students.filter((st) => st.original_batch_id === b.id).length;
      const currentCount = memDb.students.filter(
        (st) => st.current_placement_batch_id === b.id
      ).length;
      const detainedInCount = memDb.students.filter(
        (st) =>
          st.current_placement_batch_id === b.id &&
          st.original_batch_id !== null &&
          st.original_batch_id !== b.id
      ).length;
      return {
        ...b,
        scheme_code: scheme?.code || 'RS7',
        scheme_name: scheme?.name || '',
        is_legacy_minimal: Boolean(scheme?.is_legacy_minimal),
        junior_batch_code: junior?.code || null,
        junior_batch_name: junior?.name || null,
        original_student_count: origCount,
        current_placement_count: currentCount,
        detained_placed_here_count: detainedInCount,
      };
    };

    if (upper.includes('WHERE B.ID = ?') || upper.includes('WHERE ID = ?')) {
      const id = Number(params[0]);
      const found = memDb.academicBatches.find((b) => b.id === id);
      return [found ? [enrichBatch(found)] : [], []];
    }
    if (upper.includes('WHERE CODE = ?') || upper.includes('WHERE B.CODE = ?')) {
      const code = String(params[0]).toUpperCase();
      const excludeId = upper.includes('AND ID != ?') ? Number(params[1]) : -1;
      const found = memDb.academicBatches.filter(
        (b) => b.code.toUpperCase() === code && b.id !== excludeId
      );
      return [found.map(enrichBatch), []];
    }

    const list = [...memDb.academicBatches]
      .sort((a, b) => a.display_order - b.display_order || a.id - b.id)
      .map(enrichBatch);
    return [list, []];
  }

  if (
    upper.startsWith('INSERT INTO ACADEMIC_BATCHES') ||
    upper.startsWith('INSERT INTO `ACADEMIC_BATCHES`')
  ) {
    const id = memDb.generateId('academicBatches');
    const now = new Date().toISOString();
    memDb.academicBatches.push({
      id,
      code: String(params[0]),
      name: String(params[1]),
      admission_academic_year: String(params[2]),
      admission_year_start: params[3] !== null && params[3] !== undefined ? Number(params[3]) : null,
      course_name: String(params[4] || 'BAMS'),
      scheme_id: Number(params[5]),
      current_cohort_stage: String(params[6]),
      current_professional_year:
        params[7] !== null && params[7] !== undefined ? Number(params[7]) : null,
      junior_batch_id: params[8] !== null && params[8] !== undefined ? Number(params[8]) : null,
      admission_status: params[9] || 'IN_PROGRESS',
      is_active: Boolean(params[10]),
      display_order: Number(params[11] ?? 100),
      notes: params[12] ?? null,
      created_by: params[13] !== null && params[13] !== undefined ? Number(params[13]) : null,
      created_at: now,
      updated_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (
    upper.startsWith('UPDATE ACADEMIC_BATCHES') ||
    upper.startsWith('UPDATE `ACADEMIC_BATCHES`')
  ) {
    if (upper.includes('SET CURRENT_COHORT_STAGE = ?')) {
      const nextStage = String(params[0]);
      const targetId = Number(params[1]);
      const expectedStage = String(params[2]);
      const batch = memDb.academicBatches.find((b) => b.id === targetId);
      if (!batch) return [{ affectedRows: 0 }, []];
      const currentStage = String(batch.current_cohort_stage || '').trim().toUpperCase();
      if (currentStage === expectedStage.toUpperCase()) {
        batch.current_cohort_stage = nextStage;
        batch.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }
    const targetId = Number(params[params.length - 1]);
    const batch = memDb.academicBatches.find((b) => b.id === targetId);
    if (!batch) return [{ affectedRows: 0 }, []];
    batch.name = String(params[0]);
    batch.admission_academic_year = String(params[1]);
    batch.admission_year_start =
      params[2] !== null && params[2] !== undefined ? Number(params[2]) : null;
    batch.scheme_id = Number(params[3]);
    batch.current_cohort_stage = String(params[4]);
    batch.current_professional_year =
      params[5] !== null && params[5] !== undefined ? Number(params[5]) : null;
    batch.junior_batch_id =
      params[6] !== null && params[6] !== undefined ? Number(params[6]) : null;
    batch.admission_status = params[7];
    batch.is_active = Boolean(params[8]);
    batch.display_order = Number(params[9] ?? batch.display_order);
    batch.notes = params[10] ?? null;
    batch.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  // ============================================================================
  // 3. ROLL NUMBER SEQUENCES (`student_roll_sequences`)
  // ============================================================================
  if (
    upper.startsWith('INSERT INTO STUDENT_ROLL_SEQUENCES') ||
    upper.startsWith('INSERT INTO `STUDENT_ROLL_SEQUENCES`')
  ) {
    const year = Number(params[0]);
    const existing = memDb.rollSequences.find((r) => r.admission_year === year);
    if (!existing) {
      memDb.rollSequences.push({
        admission_year: year,
        last_seq: 0,
        updated_at: new Date().toISOString(),
      });
    }
    return [{ affectedRows: 1 }, []];
  }

  if (
    upper.includes('FROM STUDENT_ROLL_SEQUENCES') ||
    upper.includes('FROM `STUDENT_ROLL_SEQUENCES`')
  ) {
    const year = Number(params[0]);
    const existing = memDb.rollSequences.find((r) => r.admission_year === year);
    return [existing ? [{ ...existing }] : [], []];
  }

  if (
    upper.startsWith('UPDATE STUDENT_ROLL_SEQUENCES') ||
    upper.startsWith('UPDATE `STUDENT_ROLL_SEQUENCES`')
  ) {
    const nextSeq = Number(params[0]);
    const year = Number(params[1]);
    const existing = memDb.rollSequences.find((r) => r.admission_year === year);
    if (existing) {
      existing.last_seq = nextSeq;
      existing.updated_at = new Date().toISOString();
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  }

  // ============================================================================
  // 4. INSTITUTIONAL SETTINGS (`institutional_settings` & `institutional_setting_history`)
  // ============================================================================
  if (
    upper.includes('FROM INSTITUTIONAL_SETTINGS') ||
    upper.includes('FROM `INSTITUTIONAL_SETTINGS`')
  ) {
    const key = String(params[0] || 'MAX_COURSE_DURATION_YEARS');
    const row = memDb.institutionalSettings.find((s) => s.setting_key === key);
    if (!row) return [[], []];
    const updater = row.updated_by ? memDb.users.find((u) => u.id === row.updated_by) : null;
    const updaterRole = updater ? memDb.roles.find((r) => r.id === updater.role_id) : null;
    return [
      [
        {
          ...row,
          updated_by_name: updater?.full_name || null,
          updated_by_role: updaterRole?.code || null,
        },
      ],
      [],
    ];
  }

  if (
    upper.startsWith('INSERT INTO INSTITUTIONAL_SETTINGS') ||
    upper.startsWith('UPDATE INSTITUTIONAL_SETTINGS')
  ) {
    if (upper.startsWith('UPDATE INSTITUTIONAL_SETTINGS')) {
      const val = String(params[0]);
      const effDate = String(params[1]);
      const updatedBy = params[2] !== null && params[2] !== undefined ? Number(params[2]) : null;
      const reason = params[3] ?? null;
      const key = String(params[4]);
      const row = memDb.institutionalSettings.find((s) => s.setting_key === key);
      if (row) {
        row.setting_value = val;
        row.effective_date = effDate;
        row.updated_by = updatedBy;
        row.updated_reason = reason;
        row.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      memDb.institutionalSettings.push({
        setting_key: key,
        setting_value: val,
        effective_date: effDate,
        updated_by: updatedBy,
        updated_reason: reason,
        updated_at: new Date().toISOString(),
      });
      return [{ affectedRows: 1 }, []];
    }
  }

  if (
    upper.includes('FROM INSTITUTIONAL_SETTING_HISTORY') ||
    upper.includes('FROM `INSTITUTIONAL_SETTING_HISTORY`')
  ) {
    const key = String(params[0] || 'MAX_COURSE_DURATION_YEARS');
    const rows = memDb.settingHistory
      .filter((h) => h.setting_key === key)
      .sort((a, b) => b.id - a.id)
      .map((h) => {
        const authUser = memDb.users.find((u) => u.id === h.authorized_by);
        const authRole = authUser ? memDb.roles.find((r) => r.id === authUser.role_id) : null;
        return {
          ...h,
          authorizer_name: authUser?.full_name || 'Principal',
          authorizer_username: authUser?.username || '',
          authorizer_role: authRole?.code || '',
        };
      });
    return [rows, []];
  }

  if (
    upper.startsWith('INSERT INTO INSTITUTIONAL_SETTING_HISTORY') ||
    upper.startsWith('INSERT INTO `INSTITUTIONAL_SETTING_HISTORY`')
  ) {
    const id = memDb.generateId('settingHistory');
    memDb.settingHistory.push({
      id,
      setting_key: String(params[0]),
      previous_value: String(params[1]),
      new_value: String(params[2]),
      effective_date: String(params[3]),
      reason: String(params[4]),
      authorized_by: Number(params[5]),
      created_at: new Date().toISOString(),
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  // ============================================================================
  // 5. IDENTIFIER HISTORY (`student_identifier_history`)
  // ============================================================================
  if (
    upper.includes('FROM STUDENT_IDENTIFIER_HISTORY') ||
    upper.includes('FROM `STUDENT_IDENTIFIER_HISTORY`')
  ) {
    if (upper.includes('WHERE NEW_IDENTIFIER = ? OR PREVIOUS_IDENTIFIER = ?')) {
      const val = String(params[0]).toUpperCase();
      const found = memDb.identifierHistory.filter(
        (h) =>
          String(h.new_identifier).toUpperCase() === val ||
          (h.previous_identifier && String(h.previous_identifier).toUpperCase() === val)
      );
      return [found, []];
    }
    const studentId = Number(params[0]);
    const list = memDb.identifierHistory
      .filter((h) => h.student_id === studentId)
      .sort((a, b) => b.id - a.id)
      .map((h) => {
        const actor = h.actor_id ? memDb.users.find((u) => u.id === h.actor_id) : null;
        const actorRole = actor ? memDb.roles.find((r) => r.id === actor.role_id) : null;
        const verifier = h.verified_by ? memDb.users.find((u) => u.id === h.verified_by) : null;
        const verifierRole = verifier ? memDb.roles.find((r) => r.id === verifier.role_id) : null;
        return {
          ...h,
          actor_name: actor?.full_name || null,
          actor_role: actorRole?.code || null,
          verifier_name: verifier?.full_name || null,
          verifier_role: verifierRole?.code || null,
        };
      });
    return [list, []];
  }

  if (
    upper.startsWith('INSERT INTO STUDENT_IDENTIFIER_HISTORY') ||
    upper.startsWith('INSERT INTO `STUDENT_IDENTIFIER_HISTORY`')
  ) {
    const id = memDb.generateId('identifierHistory');
    const now = new Date().toISOString();
    const row = parseSqlInsertObject(sql, params);
    memDb.identifierHistory.push({
      id,
      student_id: Number(row.student_id),
      identifier_type: row.identifier_type,
      previous_identifier:
        row.previous_identifier !== null && row.previous_identifier !== undefined
          ? String(row.previous_identifier)
          : null,
      new_identifier: String(row.new_identifier),
      verification_status: row.verification_status || 'VERIFIED',
      reason: String(row.reason || ''),
      actor_id:
        row.actor_id !== null && row.actor_id !== undefined ? Number(row.actor_id) : null,
      verified_by:
        row.verified_by !== null && row.verified_by !== undefined ? Number(row.verified_by) : null,
      verified_at: row.verified_at ?? (row.verification_status === 'VERIFIED' ? now : null),
      created_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  // ============================================================================
  // 6. STUDENT DOCUMENTS METADATA (`student_documents`)
  // ============================================================================
  if (upper.includes('FROM STUDENT_DOCUMENTS') || upper.includes('FROM `STUDENT_DOCUMENTS`')) {
    if (upper.includes('WHERE ID = ? AND STUDENT_ID = ?')) {
      const docId = Number(params[0]);
      const studentId = Number(params[1]);
      const doc = memDb.studentDocuments.find((d) => d.id === docId && d.student_id === studentId);
      return [doc ? [{ ...doc }] : [], []];
    }
    const studentId = Number(params[0]);
    const list = memDb.studentDocuments
      .filter((d) => d.student_id === studentId)
      .sort((a, b) => a.id - b.id)
      .map((d) => {
        const verifier = d.verified_by ? memDb.users.find((u) => u.id === d.verified_by) : null;
        const verifierRole = verifier ? memDb.roles.find((r) => r.id === verifier.role_id) : null;
        return {
          ...d,
          verifier_name: verifier?.full_name || null,
          verifier_role: verifierRole?.code || null,
        };
      });
    return [list, []];
  }

  if (
    upper.startsWith('INSERT INTO STUDENT_DOCUMENTS') ||
    upper.startsWith('INSERT INTO `STUDENT_DOCUMENTS`')
  ) {
    const id = memDb.generateId('studentDocuments');
    const now = new Date().toISOString();
    memDb.studentDocuments.push({
      id,
      student_id: Number(params[0]),
      document_type: String(params[1]),
      document_label: params[2] ?? null,
      reference_number: params[3] ?? null,
      issue_date: params[4] ?? null,
      received_status: params[5] || 'PENDING',
      verification_status: params[6] || 'UNVERIFIED',
      verified_by: params[7] !== null && params[7] !== undefined ? Number(params[7]) : null,
      verified_at: params[8] ?? null,
      remarks: params[9] ?? null,
      updated_by: params[10] !== null && params[10] !== undefined ? Number(params[10]) : null,
      created_at: now,
      updated_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (
    upper.startsWith('UPDATE STUDENT_DOCUMENTS') ||
    upper.startsWith('UPDATE `STUDENT_DOCUMENTS`')
  ) {
    const docId = Number(params[params.length - 2]);
    const studentId = Number(params[params.length - 1]);
    const doc = memDb.studentDocuments.find((d) => d.id === docId && d.student_id === studentId);
    if (!doc) return [{ affectedRows: 0 }, []];
    doc.document_type = String(params[0]);
    doc.document_label = params[1] ?? null;
    doc.reference_number = params[2] ?? null;
    doc.issue_date = params[3] ?? null;
    doc.received_status = params[4];
    doc.verification_status = params[5];
    doc.verified_by = params[6] !== null && params[6] !== undefined ? Number(params[6]) : null;
    doc.verified_at = params[7] ?? null;
    doc.remarks = params[8] ?? null;
    doc.updated_by = params[9] !== null && params[9] !== undefined ? Number(params[9]) : null;
    doc.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  // ============================================================================
  // 7. ACADEMIC PROGRESSION EVENTS (`student_progression_events`)
  // ============================================================================
  if (
    upper.includes('FROM STUDENT_PROGRESSION_EVENTS') ||
    upper.includes('FROM `STUDENT_PROGRESSION_EVENTS`')
  ) {
    if (upper.includes('WHERE ID = ? AND STUDENT_ID = ?')) {
      const eventId = Number(params[0]);
      const studentId = Number(params[1]);
      const ev = memDb.progressionEvents.find(
        (e) => e.id === eventId && e.student_id === studentId
      );
      return [ev ? [{ ...ev }] : [], []];
    }
    const studentId = Number(params[0]);
    const list = memDb.progressionEvents
      .filter((e) => e.student_id === studentId)
      .sort((a, b) => b.id - a.id)
      .map((e) => {
        const enteredUser = e.entered_by ? memDb.users.find((u) => u.id === e.entered_by) : null;
        const enteredRole = enteredUser
          ? memDb.roles.find((r) => r.id === enteredUser.role_id)
          : null;
        const confirmedUser = e.confirmed_by
          ? memDb.users.find((u) => u.id === e.confirmed_by)
          : null;
        const confirmedRole = confirmedUser
          ? memDb.roles.find((r) => r.id === confirmedUser.role_id)
          : null;
        const prevBatch = e.previous_placement_batch_id
          ? memDb.academicBatches.find((b) => b.id === e.previous_placement_batch_id)
          : null;
        const propBatch = e.proposed_placement_batch_id
          ? memDb.academicBatches.find((b) => b.id === e.proposed_placement_batch_id)
          : null;
        return {
          ...e,
          entered_by_name: enteredUser?.full_name || null,
          entered_by_role: enteredRole?.code || null,
          confirmed_by_name: confirmedUser?.full_name || null,
          confirmed_by_role: confirmedRole?.code || null,
          previous_batch_name: prevBatch?.name || null,
          proposed_batch_name: propBatch?.name || null,
        };
      });
    return [list, []];
  }

  if (
    upper.startsWith('INSERT INTO STUDENT_PROGRESSION_EVENTS') ||
    upper.startsWith('INSERT INTO `STUDENT_PROGRESSION_EVENTS`')
  ) {
    const id = memDb.generateId('progressionEvents');
    const row = parseSqlInsertObject(sql, params);
    const parseJsonSafe = (v: any) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          return v;
        }
      }
      return v;
    };
    memDb.progressionEvents.push({
      id,
      student_id: Number(row.student_id),
      scheme_id:
        row.scheme_id !== null && row.scheme_id !== undefined ? Number(row.scheme_id) : null,
      event_type: row.event_type,
      exam_session_ref: row.exam_session_ref ?? null,
      exam_attempt_type: row.exam_attempt_type || 'NOT_APPLICABLE',
      evaluated_professional_year:
        row.evaluated_professional_year !== null && row.evaluated_professional_year !== undefined
          ? Number(row.evaluated_professional_year)
          : null,
      previous_professional_year:
        row.previous_professional_year !== null && row.previous_professional_year !== undefined
          ? Number(row.previous_professional_year)
          : null,
      proposed_professional_year:
        row.proposed_professional_year !== null && row.proposed_professional_year !== undefined
          ? Number(row.proposed_professional_year)
          : null,
      previous_placement_batch_id:
        row.previous_placement_batch_id !== null && row.previous_placement_batch_id !== undefined
          ? Number(row.previous_placement_batch_id)
          : null,
      proposed_placement_batch_id:
        row.proposed_placement_batch_id !== null && row.proposed_placement_batch_id !== undefined
          ? Number(row.proposed_placement_batch_id)
          : null,
      previous_detention_stage: Number(row.previous_detention_stage ?? 0),
      proposed_detention_stage: Number(row.proposed_detention_stage ?? 0),
      subjects_evaluated_count: Number(row.subjects_evaluated_count ?? 0),
      subjects_passed: parseJsonSafe(row.subjects_passed),
      subjects_outstanding: parseJsonSafe(row.subjects_outstanding),
      placement_rule_applied: String(row.placement_rule_applied || ''),
      proposed_status: String(row.proposed_status || ''),
      workflow_state: row.workflow_state || 'PROPOSED',
      review_issue_explanation: row.review_issue_explanation ?? null,
      classroom_mapping: parseJsonSafe(row.classroom_mapping),
      supplementary_cycle_note: row.supplementary_cycle_note ?? null,
      max_duration_years_snapshot: Number(row.max_duration_years_snapshot ?? 9),
      exceeds_max_duration_flag: Boolean(row.exceeds_max_duration_flag),
      entered_by:
        row.entered_by !== null && row.entered_by !== undefined ? Number(row.entered_by) : null,
      confirmed_by:
        row.confirmed_by !== null && row.confirmed_by !== undefined
          ? Number(row.confirmed_by)
          : null,
      confirmed_at: row.confirmed_at ?? null,
      effective_date: row.effective_date ?? null,
      reason_or_remarks: row.reason_or_remarks ?? null,
      created_at: new Date().toISOString(),
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (
    upper.startsWith('UPDATE STUDENT_PROGRESSION_EVENTS') ||
    upper.startsWith('UPDATE `STUDENT_PROGRESSION_EVENTS`')
  ) {
    if (upper.includes("WORKFLOW_STATE = 'CONFIRMED'")) {
      const confirmedBy = Number(params[0]);
      const remarks = params[1] ?? null;
      const eventId = Number(params[2]);
      const ev = memDb.progressionEvents.find((e) => e.id === eventId);
      if (ev) {
        ev.workflow_state = 'CONFIRMED';
        ev.confirmed_by = confirmedBy;
        ev.confirmed_at = new Date().toISOString();
        if (remarks) ev.reason_or_remarks = remarks;
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }
    if (upper.includes("WORKFLOW_STATE = 'SUPERSEDED'")) {
      const eventId = Number(params[0]);
      const ev = memDb.progressionEvents.find((e) => e.id === eventId);
      if (ev) {
        ev.workflow_state = 'SUPERSEDED';
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }
  }

  // ============================================================================
  // 8. INTERNSHIPS & EXTENSIONS (`student_internships`, `student_internship_extensions`)
  // ============================================================================
  if (
    upper.includes('FROM STUDENT_INTERNSHIPS') ||
    upper.includes('FROM `STUDENT_INTERNSHIPS`')
  ) {
    const studentId = Number(params[0]);
    const rec = memDb.internships.find((i) => i.student_id === studentId);
    if (!rec) return [[], []];
    const verifier = rec.completion_verified_by
      ? memDb.users.find((u) => u.id === rec.completion_verified_by)
      : null;
    const verifierRole = verifier ? memDb.roles.find((r) => r.id === verifier.role_id) : null;
    return [
      [
        {
          ...rec,
          verifier_name: verifier?.full_name || null,
          verifier_role: verifierRole?.code || null,
        },
      ],
      [],
    ];
  }

  if (
    upper.startsWith('INSERT INTO STUDENT_INTERNSHIPS') ||
    upper.startsWith('INSERT INTO `STUDENT_INTERNSHIPS`')
  ) {
    const row = parseSqlInsertObject(sql, params);
    const studentId = Number(row.student_id);
    const existing = memDb.internships.find((i) => i.student_id === studentId);
    if (existing) return [{ insertId: existing.id, affectedRows: 0 }, []];
    const id = memDb.generateId('internships');
    const now = new Date().toISOString();
    memDb.internships.push({
      id,
      student_id: studentId,
      start_date: row.start_date ?? null,
      base_required_days: Number(row.base_required_days ?? 365),
      approved_extension_days: Number(row.approved_extension_days ?? 0),
      adjusted_required_days: Number(row.adjusted_required_days ?? 365),
      credited_days_completed: Number(row.credited_days_completed ?? 0),
      attendance_source: row.attendance_source || 'PENDING_ATTENDANCE_MODULE',
      attendance_reconciliation_status:
        row.attendance_reconciliation_status || 'UNAVAILABLE_PENDING_INTEGRATION',
      last_attendance_sync_ref: row.last_attendance_sync_ref ?? null,
      expected_completion_date: row.expected_completion_date ?? null,
      internship_status: row.internship_status || 'ELIGIBLE',
      completion_verified_by: null,
      completion_verified_at: null,
      actual_completion_date: null,
      completion_remarks: row.completion_remarks ?? null,
      created_by:
        row.created_by !== null && row.created_by !== undefined ? Number(row.created_by) : null,
      created_at: now,
      updated_at: now,
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (
    upper.startsWith('UPDATE STUDENT_INTERNSHIPS') ||
    upper.startsWith('UPDATE `STUDENT_INTERNSHIPS`')
  ) {
    const targetId = Number(params[params.length - 1]);
    const rec = memDb.internships.find((i) => i.id === targetId || i.student_id === targetId);
    if (!rec) return [{ affectedRows: 0 }, []];

    if (sql.includes('/* SM:UPDATE_INTERNSHIP_START */')) {
      rec.start_date = params[0] ?? null;
      rec.expected_completion_date = params[1] ?? null;
      rec.internship_status = params[2];
      rec.completion_remarks = params[3] ?? rec.completion_remarks;
    } else if (sql.includes('/* SM:UPDATE_INTERNSHIP_EXTENSION */')) {
      rec.approved_extension_days = Number(params[0]);
      rec.adjusted_required_days = Number(params[1]);
      rec.expected_completion_date = params[2] ?? rec.expected_completion_date;
      rec.internship_status = params[3];
    } else if (sql.includes('/* SM:UPDATE_INTERNSHIP_ATTENDANCE */')) {
      rec.credited_days_completed = Number(params[0]);
      rec.attendance_source = params[1];
      rec.attendance_reconciliation_status = params[2];
      rec.last_attendance_sync_ref = params[3] ?? null;
    } else if (sql.includes('/* SM:COMPLETE_INTERNSHIP */')) {
      rec.internship_status = 'COMPLETED';
      rec.completion_verified_by = Number(params[0]);
      rec.completion_verified_at = new Date().toISOString();
      rec.actual_completion_date = String(params[1]);
      rec.completion_remarks = params[2] ?? null;
    }
    rec.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  if (
    upper.includes('FROM STUDENT_INTERNSHIP_EXTENSIONS') ||
    upper.includes('FROM `STUDENT_INTERNSHIP_EXTENSIONS`')
  ) {
    const studentId = Number(params[0]);
    const list = memDb.internshipExtensions
      .filter((e) => e.student_id === studentId)
      .sort((a, b) => b.id - a.id)
      .map((e) => {
        const authUser = memDb.users.find((u) => u.id === e.authorized_by);
        const authRole = authUser ? memDb.roles.find((r) => r.id === authUser.role_id) : null;
        return {
          ...e,
          authorizer_name: authUser?.full_name || 'Principal',
          authorizer_role: authRole?.code || 'PRINCIPAL',
        };
      });
    return [list, []];
  }

  if (
    upper.startsWith('INSERT INTO STUDENT_INTERNSHIP_EXTENSIONS') ||
    upper.startsWith('INSERT INTO `STUDENT_INTERNSHIP_EXTENSIONS`')
  ) {
    const id = memDb.generateId('internshipExtensions');
    memDb.internshipExtensions.push({
      id,
      internship_id: Number(params[0]),
      student_id: Number(params[1]),
      additional_days: Number(params[2]),
      previous_required_total: Number(params[3]),
      new_required_total: Number(params[4]),
      reason: String(params[5]),
      authorized_by: Number(params[6]),
      authorized_at: new Date().toISOString(),
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  // ============================================================================
  // 9. TAGGED STUDENT MUTATION QUERIES (`/* SM:... */`)
  // ============================================================================
  if (sql.includes('/* SM:INSERT_STUDENT */')) {
    const id = memDb.generateId('students');
    const now = new Date().toISOString();
    const parseJson = (v: any) =>
      v && typeof v === 'string'
        ? JSON.parse(v)
        : v ?? null;

    const record: MemoryStudent = {
      id,
      student_id_number: String(params[0]),
      temporary_roll_number: params[1] ?? String(params[0]),
      permanent_university_number: params[2] ?? null,
      university_reg_status: params[3] || 'NOT_ENTERED',
      university_reg_verified_by: null,
      university_reg_verified_at: null,
      full_name: String(params[4]),
      university_recorded_name: params[5] ?? null,
      date_of_birth: params[6] ?? null,
      gender: params[7] ?? null,
      nationality: params[8] ?? 'Indian',
      contact_phone: params[9] ?? null,
      contact_email: params[10] ?? null,
      current_address: params[11] ?? null,
      permanent_address: params[12] ?? null,
      state: params[13] ?? null,
      district: params[14] ?? null,
      city_town: params[15] ?? null,
      pin_code: params[16] ?? null,
      profile_remarks: params[17] ?? null,
      father_name: params[18] ?? null,
      father_phone: params[19] ?? null,
      mother_name: params[20] ?? null,
      mother_phone: params[21] ?? null,
      guardian_name: params[22] ?? null,
      guardian_relationship: params[23] ?? null,
      guardian_phone: params[24] ?? null,
      emergency_contact_name: params[25] ?? null,
      emergency_contact_relationship: params[26] ?? null,
      emergency_contact_phone: params[27] ?? null,
      parent_guardian_address: params[28] ?? null,
      scheme_id: params[29] !== null && params[29] !== undefined ? Number(params[29]) : null,
      original_batch_id: params[30] !== null && params[30] !== undefined ? Number(params[30]) : null,
      current_placement_batch_id:
        params[31] !== null && params[31] !== undefined ? Number(params[31]) : null,
      admission_academic_year: params[32] ?? null,
      admission_year: Number(params[33]),
      admission_date: params[34] ?? null,
      admission_category: params[35],
      seat_category: params[36] ?? null,
      reservation_details: params[37] ?? null,
      is_kea_eligible: Boolean(params[38]),
      kea_acknowledgement_no: params[39] ?? null,
      neet_roll_number: params[40] ?? null,
      neet_score: params[41] ?? null,
      application_identifier: params[42] ?? null,
      qualifying_exam: params[43] ?? null,
      qualifying_board: params[44] ?? null,
      qualifying_year: params[45] !== null && params[45] !== undefined ? Number(params[45]) : null,
      qualifying_marks_percentage: params[46] ?? null,
      admission_order_ref: params[47] ?? null,
      admission_status: params[48] || 'PROVISIONAL',
      confirmation_date: params[49] ?? null,
      admission_remarks: params[50] ?? null,
      current_year_of_study: Number(params[51] ?? 1),
      detention_stage: Number(params[52] ?? 0),
      progression_status: String(params[53] || 'REGULAR_ACTIVE'),
      classroom_mapping: parseJson(params[54]),
      outstanding_backlogs_count: 0,
      supplementary_due_cycle: null,
      rs6_internship_completed:
        params[55] === null || params[55] === undefined ? null : Boolean(params[55]),
      rs6_academic_summary: params[56] ?? null,
      administrative_status: params[57] || 'ACTIVE',
      administrative_status_reason: params[58] ?? null,
      status: params[59] || 'ACTIVE',
      course_duration_flag: Boolean(params[60]),
      mess_enrolled: Boolean(params[61]),
      hostel_enrolled: Boolean(params[62]),
      created_at: now,
      updated_at: now,
    };

    memDb.students.push(record);
    return [{ insertId: id, affectedRows: 1 }, []];
  }

  if (sql.includes('/* SM:UPDATE_STUDENT_PROFILE */')) {
    const studentId = Number(params[params.length - 1]);
    const st = memDb.students.find((s) => s.id === studentId);
    if (!st) return [{ affectedRows: 0 }, []];
    st.full_name = String(params[0]);
    st.university_recorded_name = params[1] ?? null;
    st.date_of_birth = params[2] ?? null;
    st.gender = params[3] ?? null;
    st.nationality = params[4] ?? null;
    st.contact_phone = params[5] ?? null;
    st.contact_email = params[6] ?? null;
    st.current_address = params[7] ?? null;
    st.permanent_address = params[8] ?? null;
    st.state = params[9] ?? null;
    st.district = params[10] ?? null;
    st.city_town = params[11] ?? null;
    st.pin_code = params[12] ?? null;
    st.profile_remarks = params[13] ?? null;
    st.father_name = params[14] ?? null;
    st.father_phone = params[15] ?? null;
    st.mother_name = params[16] ?? null;
    st.mother_phone = params[17] ?? null;
    st.guardian_name = params[18] ?? null;
    st.guardian_relationship = params[19] ?? null;
    st.guardian_phone = params[20] ?? null;
    st.emergency_contact_name = params[21] ?? null;
    st.emergency_contact_relationship = params[22] ?? null;
    st.emergency_contact_phone = params[23] ?? null;
    st.parent_guardian_address = params[24] ?? null;
    st.scheme_id = params[25] !== null && params[25] !== undefined ? Number(params[25]) : null;
    st.original_batch_id =
      params[26] !== null && params[26] !== undefined ? Number(params[26]) : null;
    st.current_placement_batch_id =
      params[27] !== null && params[27] !== undefined ? Number(params[27]) : null;
    st.admission_academic_year = params[28] ?? null;
    st.admission_year = Number(params[29]);
    st.admission_date = params[30] ?? null;
    st.admission_category = params[31];
    st.seat_category = params[32] ?? null;
    st.reservation_details = params[33] ?? null;
    st.is_kea_eligible = Boolean(params[34]);
    st.kea_acknowledgement_no = params[35] ?? null;
    st.neet_roll_number = params[36] ?? null;
    st.neet_score = params[37] ?? null;
    st.application_identifier = params[38] ?? null;
    st.qualifying_exam = params[39] ?? null;
    st.qualifying_board = params[40] ?? null;
    st.qualifying_year =
      params[41] !== null && params[41] !== undefined ? Number(params[41]) : null;
    st.qualifying_marks_percentage = params[42] ?? null;
    st.admission_order_ref = params[43] ?? null;
    st.admission_status = params[44];
    st.confirmation_date = params[45] ?? null;
    st.admission_remarks = params[46] ?? null;
    st.current_year_of_study = Number(params[47]);
    st.rs6_internship_completed =
      params[48] === null || params[48] === undefined ? null : Boolean(params[48]);
    st.rs6_academic_summary = params[49] ?? null;
    st.administrative_status = params[50];
    st.administrative_status_reason = params[51] ?? null;
    st.status = params[52];
    st.course_duration_flag = Boolean(params[53]);
    st.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  if (sql.includes('/* SM:UPDATE_UNIVERSITY_NUMBER */')) {
    const studentId = Number(params[params.length - 1]);
    const st = memDb.students.find((s) => s.id === studentId);
    if (!st) return [{ affectedRows: 0 }, []];
    st.student_id_number = String(params[0]);
    st.permanent_university_number = String(params[1]);
    st.university_reg_status = params[2];
    st.university_reg_verified_by =
      params[3] !== null && params[3] !== undefined ? Number(params[3]) : null;
    st.university_reg_verified_at = params[4] ?? null;
    st.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  if (sql.includes('/* SM:UPDATE_STUDENT_PROGRESSION */')) {
    const studentId = Number(params[params.length - 1]);
    const st = memDb.students.find((s) => s.id === studentId);
    if (!st) return [{ affectedRows: 0 }, []];
    st.current_year_of_study = Number(params[0]);
    st.current_placement_batch_id =
      params[1] !== null && params[1] !== undefined ? Number(params[1]) : null;
    st.detention_stage = Number(params[2]);
    st.progression_status = String(params[3]);
    st.outstanding_backlogs_count = Number(params[4] ?? 0);
    st.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  if (sql.includes('/* SM:FLAG_STUDENT_PENDING_REVIEW */')) {
    const studentId = Number(params[params.length - 1]);
    const st = memDb.students.find((s) => s.id === studentId);
    if (!st) return [{ affectedRows: 0 }, []];
    st.progression_status = 'PENDING_OFFICE_REVIEW';
    st.course_duration_flag = Boolean(params[0]);
    st.updated_at = new Date().toISOString();
    return [{ affectedRows: 1 }, []];
  }

  return null;
}

function enrichStudentRow(memDb: MemoryDatabase, s: MemoryStudent): Record<string, any> {
  const scheme = s.scheme_id
    ? memDb.curriculumSchemes.find((sc) => sc.id === s.scheme_id)
    : null;
  const origBatch = s.original_batch_id
    ? memDb.academicBatches.find((b) => b.id === s.original_batch_id)
    : null;
  const currBatch = s.current_placement_batch_id
    ? memDb.academicBatches.find((b) => b.id === s.current_placement_batch_id)
    : null;
  const verifier = s.university_reg_verified_by
    ? memDb.users.find((u) => u.id === s.university_reg_verified_by)
    : null;
  const verifierRole = verifier ? memDb.roles.find((r) => r.id === verifier.role_id) : null;
  const histIds = memDb.identifierHistory
    .filter((h) => h.student_id === s.id)
    .flatMap((h) => [h.previous_identifier, h.new_identifier].filter(Boolean));

  return {
    ...s,
    temporary_roll_number: s.temporary_roll_number ?? s.student_id_number,
    permanent_university_number: s.permanent_university_number ?? null,
    university_reg_status: s.university_reg_status ?? 'NOT_ENTERED',
    administrative_status: s.administrative_status ?? 'ACTIVE',
    admission_status: s.admission_status ?? 'PROVISIONAL',
    progression_status: s.progression_status ?? 'REGULAR_ACTIVE',
    detention_stage: s.detention_stage ?? 0,
    scheme_code: scheme?.code || null,
    scheme_name: scheme?.name || null,
    is_legacy_minimal: Boolean(scheme?.is_legacy_minimal),
    original_batch_code: origBatch?.code || null,
    original_batch_name: origBatch?.name || null,
    current_placement_batch_code: currBatch?.code || null,
    current_placement_batch_name: currBatch?.name || null,
    university_verifier_name: verifier?.full_name || null,
    university_verifier_role: verifierRole?.code || null,
    historical_identifiers_concat: histIds.join(' | '),
  };
}
