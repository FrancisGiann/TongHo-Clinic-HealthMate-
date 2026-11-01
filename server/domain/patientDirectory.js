export const patientDirectoryPageSizes = Object.freeze([10, 25, 50]);

const patientSorts = new Set(['name', 'grade', 'latestVisit']);
const patientTypes = new Set(['all', 'student', 'faculty']);

export function validatePatientDirectoryQuery(query = {}) {
  const page = Number.parseInt(String(query.page || '1'), 10);
  const pageSize = Number.parseInt(String(query.pageSize || '25'), 10);
  const type = String(query.type || 'all');
  const sort = String(query.sort || 'name');
  const order = String(query.order || 'asc');
  const q = String(query.q || '');
  const grade = String(query.grade || '');
  const section = String(query.section || '');

  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
    return { valid: false, message: 'Page must be a positive whole number.' };
  }
  if (!patientDirectoryPageSizes.includes(pageSize)) {
    return { valid: false, message: 'Page size must be 10, 25, or 50.' };
  }
  if (!patientTypes.has(type)) return { valid: false, message: 'Record type must be all, student, or faculty.' };
  if (!patientSorts.has(sort)) return { valid: false, message: 'Sort must be name, grade, or latestVisit.' };
  if (!['asc', 'desc'].includes(order)) return { valid: false, message: 'Order must be asc or desc.' };
  if (q.length > 200 || grade.length > 80 || section.length > 120) {
    return { valid: false, message: 'Search and filter values are too long.' };
  }

  return {
    valid: true,
    value: {
      page,
      pageSize,
      type,
      sort,
      order,
      q,
      grade: type === 'faculty' ? '' : grade,
      section: type === 'faculty' ? '' : section,
    },
  };
}

export function escapeLikeLiteral(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function whereClause({ type, grade, section, q }) {
  const predicates = [];
  const params = [type === 'all' ? null : type, grade || null, section || null, escapeLikeLiteral(q)];
  predicates.push('($1::text IS NULL OR p.patient_type=$1)');
  predicates.push("($2::text IS NULL OR p.data->>'gradeLevel'=$2)");
  predicates.push("($3::text IS NULL OR p.data->>'section'=$3)");
  predicates.push(`($4::text='' OR concat_ws(' ',
    COALESCE(p.data->>'name',''),COALESCE(NULLIF(p.data->>'studentId',''),p.data->>'facultyId',''),
    COALESCE(p.data->>'gradeLevel',''),COALESCE(p.data->>'section',''),
    COALESCE(p.data->>'department',''),COALESCE(p.data->>'position','')
  ) ILIKE ('%' || $4 || '%') ESCAPE E'\\\\')`);
  return { sql: predicates.join('\n      AND '), params };
}

export function buildPatientDirectoryQuery(query, { includePage = true } = {}) {
  const filtered = whereClause(query);
  // Latest-visit order intentionally returns a narrow full candidate set for
  // the shared baseline JavaScript date parser and comparator in repository.js.
  // PostgreSQL must not approximate Date.parse's legacy-format behavior.
  const clientLatestVisitSort = query.sort === 'latestVisit';
  const paged = includePage && !clientLatestVisitSort;
  const params = [...filtered.params];
  if (paged) params.push(query.pageSize, query.page);

  const direction = query.order.toUpperCase();
  const nameSort = `NULLIF(p.name,'') COLLATE patient_name_natural_ci ${direction} NULLS LAST`;
  const gradeRank = `CASE
    WHEN lower(btrim(COALESCE(p.grade_level,''))) IN ('k','kindergarten') THEN 0
    WHEN (regexp_match(lower(btrim(COALESCE(p.grade_level,''))), '(grade[[:space:]]*)?([0-9]{1,2})'))[2] IS NOT NULL
      THEN ((regexp_match(lower(btrim(p.grade_level)), '(grade[[:space:]]*)?([0-9]{1,2})'))[2])::int
    ELSE NULL END`;
  const orderBy = query.sort === 'grade'
    ? `${gradeRank} ${direction} NULLS LAST, NULLIF(p.grade_level,'') COLLATE patient_name_natural_ci ${direction} NULLS LAST, p.id COLLATE patient_name_natural_ci ASC`
    : `${nameSort}, p.id COLLATE patient_name_natural_ci ASC`;
  const pageCtes = paged ? `,
  page_info AS (
    SELECT count(*)::int AS filtered_total,
      GREATEST(1,CEIL(count(*)::numeric/$5)::int) AS page_count
    FROM filtered
  ),
  effective_page AS (
    SELECT LEAST($6,page_count) AS page_no FROM page_info
  ),
  page_candidates AS (
    SELECT p.* FROM filtered p ORDER BY ${orderBy}
    LIMIT $5 OFFSET ((SELECT page_no FROM effective_page)-1)*$5
  ),
  page_rows AS (
    SELECT p.*,row_number() OVER (ORDER BY ${orderBy}) AS position
    FROM page_candidates p
  )` : `,
  page_rows AS (
    SELECT p.*,row_number() OVER (ORDER BY p.id COLLATE patient_name_natural_ci ASC) AS position
    FROM filtered p
  )`;
  const sql = `WITH filtered AS (
    SELECT p.id,p.patient_type,p.data->>'name' AS name,p.data->>'studentId' AS student_id,
      p.data->>'facultyId' AS faculty_id,p.data->>'gradeLevel' AS grade_level,
      p.data->>'section' AS section,p.data->>'department' AS department,
      p.data->>'position' AS job_position,p.data->>'adviser' AS adviser,
      p.data->>'allergies' AS allergies
    FROM patients p
    WHERE ${filtered.sql}
  )${pageCtes}
  SELECT
    ${paged ? '(SELECT filtered_total FROM page_info)' : '(SELECT count(*)::int FROM filtered)'} AS filtered_total,
    ${paged ? '(SELECT page_no FROM effective_page)' : '1'} AS page_no,
    ${paged ? '(SELECT page_count FROM page_info)' : '1'} AS page_count,
    (SELECT count(*)::int FROM patients) AS roster_total,
    (SELECT version FROM clinic_settings WHERE id=1) AS schema_version,
    (SELECT jsonb_build_object(
      'schoolName',data->'schoolName','schoolYear',data->'schoolYear','nurseName',data->'nurseName'
    ) FROM clinic_settings WHERE id=1) AS settings,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',page_rows.id,'patient_type',page_rows.patient_type,
      'data',jsonb_strip_nulls(jsonb_build_object(
        'studentId',page_rows.student_id,'facultyId',page_rows.faculty_id,
        'name',page_rows.name,'gradeLevel',page_rows.grade_level,
        'section',page_rows.section,'department',page_rows.department,
        'position',page_rows.job_position,'adviser',page_rows.adviser,
        'allergies',page_rows.allergies
      )),
      'latestVisit',NULL::jsonb
    ) ORDER BY page_rows.position) FROM page_rows),'[]'::jsonb) AS patients,
    COALESCE((SELECT jsonb_agg(grade ORDER BY
      CASE WHEN lower(btrim(grade)) IN ('k','kindergarten') THEN 0
        WHEN (regexp_match(lower(btrim(grade)), '(grade[[:space:]]*)?([0-9]{1,2})'))[2] IS NOT NULL
          THEN ((regexp_match(lower(btrim(grade)), '(grade[[:space:]]*)?([0-9]{1,2})'))[2])::int
        ELSE NULL END NULLS LAST, grade COLLATE patient_name_natural_ci)
      FROM (SELECT DISTINCT data->>'gradeLevel' AS grade FROM patients
            WHERE patient_type='student' AND COALESCE(data->>'gradeLevel','')<>'') options),'[]'::jsonb) AS grades,
    COALESCE((SELECT jsonb_agg(section ORDER BY section COLLATE patient_name_ci)
      FROM (SELECT DISTINCT data->>'section' AS section FROM patients
            WHERE patient_type='student' AND COALESCE(data->>'section','')<>''
              AND ($2::text IS NULL OR data->>'gradeLevel'=$2)) options),'[]'::jsonb) AS sections`;
  return { sql, params, clientLatestVisitSort };
}
