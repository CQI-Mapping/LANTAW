// MapBrief: the program's curriculum at a glance — the KPI tiles, the
// Curriculum Mapping Summary and the PO Coverage Chart that used to open the
// Generate Map page (shared/Reports.tsx). Extracted as a self-contained block
// so all three role dashboards can embed it unchanged: it fetches its own
// data, picks the account's program the same way the report does (assignment,
// then BSIT, then first), and renders with nothing but shared CSS. Generate
// Map keeps only its export toolbar; the PDF still prints these figures,
// computed from the same helpers.
//
// Forked from Reports.tsx on purpose rather than shared with it: the page
// wraps these blocks in its own toolbar and export model, and a shared child
// would drag that context back in. When the computation moves — say, coverage
// gets redefined — Reports' PDF model (utils/reportsPdf.ts) and this block
// both read utils/alignment.ts and utils/cloPoMapping.ts, so the engines stay
// single-source even though the rendering forks.
import { useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  fetchPrograms,
  fetchCourses,
  fetchProgramOutcomesStandalone,
  fetchProgramEducationalObjectives,
  fetchCourseLearningOutcomesStandalone,
  fetchCourseLearningOutcomePoolForMap,
  fetchStrategicGoals,
  fetchChedMemoOrders,
} from '../services/database'
import type {
  Program,
  Course,
  ProgramOutcomeStandalone,
  ProgramEducationalObjective,
  CourseLearningOutcomeStandalone,
  StrategicGoal,
  ChedMemoOrder,
  UserRole,
} from '../services/database'
import {
  alignmentSummary,
  buildAnchors,
  courseOutcomes,
  coursesInProgram,
  poOutcomes,
} from '../utils/alignment'
import { buildMappingReport, chartCompleteOutcomes } from '../utils/cloPoMapping'
import { isManagerCmCategory, isManagerOutcome } from '../utils/report'
import type { MappingStatus } from '../utils/reportsPdfModel'
import { normalizeCode, cloLabel } from '../utils/courseCodes'
import PoCoverageBars from './PoCoverageBars'
import type { PoCoverageDetail } from './PoCoverageBars'

interface MapBriefProps {
  /** The fields of the signed-in profile this brief reads: the role names
      where "View All Courses" leads, the program assignment opens it there. */
  profile: { role?: UserRole; program_id?: string | null } | null
  onNavigate?: (page: string) => void
  /** Blocks slotted between the KPI tiles and the two panels — currently the
      dashboard's OBE Curriculum Map (components/MapPreview.tsx), so the
      figures above and the picture below read as one continuous brief. */
  children?: ReactNode
  /** The host dashboard already counts CLOs, POs and PEOs in its own live
      tiles directly above — skip the brief's copies of the same figures
      (Programs, Courses, Coverage, Unmapped stay; those are the brief's own
      dividend and none of the tiles duplicate them). */
  dedupeCoreCounts?: boolean
  /** Tiles to hide on this host, named one by one — a shorthand-free way to
      pick a combination the dedupe flag does not cover (the faculty brief
      hides Programs and the PO/PEO governance figures while keeping its own
      CLO count and the coverage tile). */
  hideTiles?: Array<'programs' | 'courses' | 'clos' | 'pos' | 'peos'>
}

/** Stands in for program assignments the account may not carry yet, the way
 *  the sidebar's PROGRAM_LOGO does: until every account is bound to its
 *  program in the UI, BSIT is the program the system currently serves. */
const FALLBACK_PROGRAM_CODE = 'BSIT'

/**
 * Academic years around the current one, keyed to the same June-start
 * calendar the report uses. The table's per-course year fallback prints the
 * middle entry when a course predates the term columns.
 */
const academicYear = academicYearOptions()[1]
function academicYearOptions(today = new Date()): string[] {
  const start = today.getFullYear() - (today.getMonth() >= 5 ? 0 : 1)
  return [start - 1, start, start + 1].map((s) => `${s} - ${s + 1}`)
}

/**
 * The semester in progress on the same June-start calendar: June–October is
 * the first semester, November–May the second. It backs the summary cells
 * of courses that carry no stored semester.
 */
const reportSemester = currentSemester()
function currentSemester(today = new Date()): string {
  return today.getMonth() >= 5 && today.getMonth() <= 9 ? '1' : '2'
}

/**
 * How a course's stored year reads — program year level for small values
 * ("1st Year"), academic start year for four-digit ones ("AY 2026 - 2027").
 */
function courseYearLabel(v: number | null | undefined): string {
  if (v == null) return ''
  if (v < 100) return `${['1st', '2nd', '3rd'][v - 1] ?? `${v}th`} Year`
  return `AY ${v} - ${v + 1}`
}

/** A course's mapping status badge, worded exactly like the report's table.
 *  "No CLOs" stays distinct from "Unmapped": nothing to map is a different
 *  fact from having outcomes and leaving them unmapped. */
function statusBadge({ mapped, total }: { mapped: number; total: number }): {
  label: MappingStatus
  className: string
} {
  if (total === 0) return { label: 'No CLOs', className: 'status-badge status-badge--none' }
  if (mapped === 0) return { label: 'Unmapped', className: 'status-badge status-badge--unmapped' }
  if (mapped < total)
    return { label: 'Partially Mapped', className: 'status-badge status-badge--partial' }
  return { label: 'Mapped', className: 'status-badge status-badge--mapped' }
}

/** A panel's footer line: a count on the left, a "view all" action on the
 *  right. The action earns its arrow only where it leads somewhere. */
function PanelFoot({
  left,
  action,
  onAction,
}: {
  left: string
  action: string
  onAction?: () => void
}) {
  return (
    <div className="reports-panel__foot">
      <span>{left}</span>
      {onAction ? (
        <button type="button" className="reports-panel__more" onClick={onAction}>
          {action} →
        </button>
      ) : (
        <span className="reports-panel__more">{action} →</span>
      )}
    </div>
  )
}

/** A panel's title line, read by screen readers and the print outline. */
function PanelHead({ title }: { title: string }) {
  return (
    <div className="reports-panel__head">
      <h3>{title}</h3>
    </div>
  )
}

/** One KPI tile: label, figure and qualifier centred as a single column. */
function KpiCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub: string
}) {
  return (
    <div className="stat-card stat-card--2026 reports-kpi card-enter">
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value reports-kpi__value">{value}</span>
      <span className="stat-card__sub">{sub}</span>
    </div>
  )
}

function MapBrief({ profile, onNavigate, children, dedupeCoreCounts, hideTiles }: MapBriefProps) {
  // Which KPI tiles to leave out of the row: the admin's dedupe flag is
  // shorthand for the CLO/PO/PEO trio, hideTiles names tiles individually.
  const skipTiles = new Set(dedupeCoreCounts ? ['clos', 'pos', 'peos'] : (hideTiles ?? []))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [programs, setPrograms] = useState<Program[]>([])
  const [programId, setProgramId] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [pos, setPos] = useState<ProgramOutcomeStandalone[]>([])
  const [peos, setPeos] = useState<ProgramEducationalObjective[]>([])
  const [clos, setClos] = useState<CourseLearningOutcomeStandalone[]>([])
  // The whole outcome pool — every faculty member's rows — backing the
  // faculty brief's Total CLO's tile. Admin and manager read every row
  // through table RLS already, so the pool hop only serves role 'user',
  // whose owner-scoped read would otherwise count a personal figure in a
  // program-inventory tile.
  const [poolClos, setPoolClos] = useState<CourseLearningOutcomeStandalone[]>([])
  const [goals, setGoals] = useState<StrategicGoal[]>([])
  const [cmos, setCmos] = useState<ChedMemoOrder[]>([])

  const viewerProgramId = profile?.program_id ?? null

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetchPrograms(),
      fetchCourses(),
      fetchProgramOutcomesStandalone(),
      fetchProgramEducationalObjectives(),
      fetchCourseLearningOutcomesStandalone(),
      fetchStrategicGoals(),
      fetchChedMemoOrders(),
      // Whole-pool read for the faculty Total CLO's tile: the committee-level
      // fetch the Generate Map uses. Falls back to the owner's own rows (and
      // to a personal-looking figure) until migration 019 installs the RPC.
      profile?.role === 'user'
        ? fetchCourseLearningOutcomePoolForMap().catch((e) => {
            console.warn('map_outcome_pool unavailable; Total CLOs counts you only:', e?.message)
            return fetchCourseLearningOutcomesStandalone()
          })
        : Promise.resolve([] as CourseLearningOutcomeStandalone[]),
    ])
      .then(([p, c, po, peo, clo, sg, cmo, pool]) => {
        setPrograms(p)
        setCourses(c)
        setPos(po)
        setPeos(peo)
        setClos(clo)
        setGoals(sg)
        setCmos(cmo)
        setPoolClos(pool)
        setProgramId((current) => {
          if (current) return current
          if (viewerProgramId && p.some((row) => row.id === viewerProgramId)) return viewerProgramId
          const served = p.find((row) => (row.code ?? '').toUpperCase() === FALLBACK_PROGRAM_CODE)
          return served?.id ?? p[0]?.id ?? null
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the curriculum brief.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const program = programs.find((p) => p.id === programId) ?? null

  // Where "View All Courses" leads: the courses page each role is actually
  // allowed into — the manager's course list, the admin's curriculum. A
  // faculty reader has no courses page in their sidebar, so their footer
  // stays inert text rather than a link that cannot go anywhere.
  const courseListPage =
    profile?.role === 'manager' ? 'course' : profile?.role === 'admin' ? 'curriculum' : null

  // ---- the same derivation Generate Map runs ----
  const anchors = useMemo(() => buildAnchors({ cmos, peos, goals }), [cmos, peos, goals])
  const outcomes = useMemo(() => (pos.length > 0 ? poOutcomes(pos, anchors) : []), [pos, anchors])
  // The brief reports the COMMITTED framework: the outcomes the Program
  // Outcomes page actively offers. Codes parked in the archive (the pre-010
  // hand-typed drift, deliberately saved for reference) stay out of every
  // headline figure — counting them said "40 outcomes" over a page that
  // actively lists 17. An archived spelling that shares a code with an
  // active row still contributes to that outcome's document unions below
  // (poOutcomes merges spellings before this filter runs).
  const activeOutcomes = useMemo(
    () => outcomes.filter((o) => o.status === 'active'),
    [outcomes],
  )
  const archivedOutcomes = outcomes.length - activeOutcomes.length
  // The headline reads the OFFICIAL framework: the CMO 25 S. 2015 document,
  // which migration 010 inserted VERBATIM as manager-sourced rows carrying
  // one of the two category headers. Recognised the SAME way the manager
  // page, the syllabus and the report's mapping matrix recognise it
  // (source='manager' + description in MANAGER_CM_CATEGORIES) — not by the
  // 'admin' label, which belongs to the other (separately curated) universe.
  // Everything else active is disclosed in the qualifier, and mapping still
  // runs on the union of both universes so either stays targetable by CLOs.
  const officialOutcomes = useMemo(
    () =>
      poOutcomes(
        pos.filter((r) => isManagerOutcome(r) && isManagerCmCategory(r)),
        anchors,
      ).filter((o) => o.status === 'active'),
    [pos, anchors],
  )
  const otherActiveOutcomes = activeOutcomes.length - officialOutcomes.length
  const summary = alignmentSummary(activeOutcomes)

  const programCourseList = useMemo(
    () => (program ? coursesInProgram(courses, program.id) : []),
    [courses, program],
  )
  const programClos = useMemo(() => {
    if (!program) return []
    const codes = new Set(programCourseList.map((c) => normalizeCode(c.code)))
    return clos.filter((cl) => codes.has(normalizeCode(cl.course)))
  }, [program, programCourseList, clos])

  // The same program filter over the pool: what "Total CLO's" names for a
  // faculty viewer. The chart, coverage tile and summary table keep reading
  // programClos — per-role truth — so only this tile widens.
  const programPoolClos = useMemo(() => {
    if (!program) return []
    const codes = new Set(programCourseList.map((c) => normalizeCode(c.code)))
    return poolClos.filter((cl) => codes.has(normalizeCode(cl.course)))
  }, [program, programCourseList, poolClos])

  const totalClos = profile?.role === 'user' ? programPoolClos.length : programClos.length

  const yearsOffered = useMemo(
    () => new Set(programCourseList.map((c) => c.year_level).filter((y) => y != null)).size,
    [programCourseList],
  )

  // Mapping runs against the active outcome set: a CLO quoting a parked code
  // is a gap worth surfacing, not a silent match against nothing.
  const mapping = useMemo(() => buildMappingReport(programClos, activeOutcomes), [programClos, activeOutcomes])

  // The coverage chart reads the OFFICIAL framework alone — the verbatim CMO
  // read (officialOutcomes), the 17-PO axis the Program Outcomes page offers
  // — and draws every PO as its own bar, gaps as 0% stubs. Mapping on the
  // active union put the off-page rows into the count as well: 6 covered
  // bars beside "21 outcomes no CLO reaches" hid the real sparse POs in a
  // folded bar instead of naming them. A program with no official rows yet
  // falls back to the active set, so the chart still draws something.
  const chartUniverse = officialOutcomes.length > 0 ? officialOutcomes : activeOutcomes
  const chartMapping = useMemo(
    () => buildMappingReport(programClos, chartUniverse),
    [programClos, chartUniverse],
  )
  const charted = useMemo(() => chartCompleteOutcomes(chartMapping), [chartMapping])

  // What sits behind each bar: the learning outcomes naming the outcome, with
  // their subject and description — so the chart's hover can point at the work
  // instead of just a percentage.
  const poDetails = useMemo(() => {
    // Subject title lookup: a CLO only carries the course code, but the hover
    // should name the subject, so resolve the code against the program's list.
    const courseTitleByCode = new Map(
      programCourseList.map((c) => [normalizeCode(c.code), c.title] as const),
    )
    const byKey = new Map<string, PoCoverageDetail[]>()
    for (const link of mapping.links) {
      for (const key of link.poKeys) {
        const list = byKey.get(key) ?? []
        list.push({
          code: cloLabel(link.clo.code) || link.clo.code,
          course: link.clo.course,
          courseTitle: courseTitleByCode.get(normalizeCode(link.clo.course)) ?? null,
          title: link.clo.title,
          description: link.clo.description,
        })
        byKey.set(key, list)
      }
    }
    const record: Record<string, PoCoverageDetail[]> = {}
    for (const row of mapping.coverage) {
      const list = byKey.get(row.outcome.key)
      if (list && list.length > 0) record[row.outcome.code] = list
    }
    return record
  }, [mapping, programCourseList])

  // Coverage reads per role: the figures, the summary table and its status
  // badges describe the program for a faculty viewer (the whole pool, the
  // same committee-level truth the Generate Map serves), while admins and
  // managers keep their RLS table read, which is already program-wide. The
  // PO Coverage Chart is the deliberate exception — it stays on the
  // viewer's own slice, a personal lens inside a program brief.
  const readsPool = profile?.role === 'user'

  const coverageMapping = useMemo(
    () => (readsPool ? buildMappingReport(programPoolClos, activeOutcomes) : mapping),
    [readsPool, programPoolClos, activeOutcomes, mapping],
  )
  const courseOutcomeRows = useMemo(
    () => courseOutcomes(programCourseList, readsPool ? programPoolClos : programClos),
    [programCourseList, readsPool, programPoolClos, programClos],
  )
  const mappedByCourse = useMemo(() => {
    const byCourse = new Map<string, { mapped: number; total: number }>()
    for (const course of programCourseList) {
      const key = normalizeCode(course.code)
      const total = courseOutcomeRows.find((r) => r.course.id === course.id)?.outcomeCount ?? 0
      const mapped = coverageMapping.links.filter(
        (l) => normalizeCode(l.clo.course) === key && l.poKeys.length > 0,
      ).length
      byCourse.set(course.id, { mapped, total })
    }
    return byCourse
  }, [programCourseList, courseOutcomeRows, coverageMapping])

  // Coverage the way a coordinator reads it: subjects, not learning
  // outcomes — a subject counts when every learning outcome it holds names
  // a program outcome, so the headline and the table's status badges
  // verify each other.
  const subjectCoverage = useMemo(() => {
    let fully = 0
    for (const course of programCourseList) {
      const roll = mappedByCourse.get(course.id)
      if (roll && roll.total > 0 && roll.mapped === roll.total) fully += 1
    }
    const percent =
      programCourseList.length === 0 ? 0 : Math.round((fully / programCourseList.length) * 100)
    return { fully, total: programCourseList.length, percent }
  }, [programCourseList, mappedByCourse])

  // Empty-pipeline honesty: until any faculty member has created the first
  // CLO, the Coverage qualifier names the state ("0 / 33 subjects — no CLOs
  // yet") instead of a plain "(0 / 33)" — the same convention the totals-0
  // branch uses. The value itself keeps the literal 0%.
  const pipelineEmpty = (readsPool ? programPoolClos : programClos).length === 0

  return (
    <div className="map-brief">
      {error && <p className="msg msg--error" role="alert">{error}</p>}
      {loading ? (
        <p className="msg">Loading the curriculum brief…</p>
      ) : !program ? (
        <div className="panel">
          <p className="msg">No programs yet. Create one to brief on it.</p>
        </div>
      ) : (
        <>
          {/* ---- KPI row ----
              Tiles show the label, figure and qualifier that makes the
              figure mean something — a count on its own invites the reader
              to assume it is the answer. */}
          <div className="stat-grid stat-grid--2026 reports-kpis">
            {!skipTiles.has('programs') && (
              <KpiCard label="Total Programs" value={programs.length} sub={program.code} />
            )}
            {!skipTiles.has('courses') && (
              <KpiCard
                label="Total Courses"
                value={programCourseList.length}
                sub={
                  yearsOffered
                    ? `Across ${yearsOffered} year${yearsOffered === 1 ? '' : 's'}`
                    : 'Across all academic years'
                }
              />
            )}
            {/* The host dashboard's live tiles already count CLOs, POs and
                PEOs directly above — its dedupe flag skips the brief's
                copies so the figures appear once, not twice. A faculty
                viewer gets the whole program's figure (pool read), admins
                and managers their table read — same tile, program-wide for
                both. */}
            {!skipTiles.has('clos') && (
              <KpiCard
                label="Total CLO's"
                value={totalClos}
                sub={program ? `${program.code} courses` : 'From all courses'}
              />
            )}
            {!skipTiles.has('pos') && (
              <KpiCard
                label="Total PO's"
                value={officialOutcomes.length}
                sub={[
                  otherActiveOutcomes > 0 ? `${otherActiveOutcomes} additional` : null,
                  archivedOutcomes > 0 ? `${archivedOutcomes} archived` : null,
                ].filter(Boolean).join(' · ') || 'Program Outcomes'}
              />
            )}
            {!skipTiles.has('peos') && (
              <KpiCard
                label="Total PEO's"
                value={peos.length}
                sub="Program Educational Objectives"
              />
            )}
            <KpiCard
              label="Mapping Coverage"
              value={subjectCoverage.total === 0 ? '—' : `${subjectCoverage.percent}%`}
              sub={
                subjectCoverage.total === 0
                  ? 'No subjects in this program yet'
                  : pipelineEmpty
                    ? `0 / ${subjectCoverage.total} subjects — no CLOs yet`
                    : `(${subjectCoverage.fully} / ${subjectCoverage.total} subjects)`
              }
            />
            {/* Gap tile for admin and manager oversight only: to a faculty
                reader "unmapped / unanchored" is an unactionable accusation
                (their own lists and the coverage tile already tell them
                where the work stands), so the faculty brief skips it. */}
            {profile?.role !== 'user' && (
              <KpiCard
                label="Unmapped / Incomplete"
                value={summary.unaligned + mapping.gaps.length}
                sub={
                  pipelineEmpty
                    ? `${summary.unaligned} unanchored outcomes · no CLOs yet`
                    : `${mapping.gaps.length} CLOs unmapped · ${summary.unaligned} outcomes unanchored`
                }
              />
            )}
          </div>

          {/* ---- slotted children between the tiles and the panels ---- */}
          {children}

          {/* ---- panels: two columns, one row ---- */}
          <div className="reports-panels">
            {/* 1 ---- */}
            <section className="panel reports-panel">
              <PanelHead title="Curriculum Mapping Summary" />
              <p className="reports-panel__sub">
                Term placement and mapping coverage of every course in the program.
              </p>
              <div className="table-wrap reports-scroll">
                <table className="table reports-summary">
                  <thead>
                    <tr>
                      <th>Course Code</th>
                      <th>Course Title</th>
                      <th className="reports-num">Year Level</th>
                      <th className="reports-num">Semester</th>
                      <th className="reports-num"># of CLOs</th>
                      <th>Mapping Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseOutcomeRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="reports-empty">No courses in this program yet.</td>
                      </tr>
                    ) : (
                      courseOutcomeRows.map(({ course, outcomeCount }) => {
                        const roll = mappedByCourse.get(course.id) ?? { mapped: 0, total: 0 }
                        const badge = statusBadge(roll)
                        return (
                          <tr key={course.id}>
                            <td>{course.code}</td>
                            <td className="reports-course-title">{course.title}</td>
                            <td className="reports-num">
                              {course.year_level == null ? academicYear : courseYearLabel(course.year_level)}
                            </td>
                            <td className="reports-num">
                              {course.semester ?? reportSemester}
                            </td>
                            <td className="reports-num">{outcomeCount}</td>
                            <td><span className={badge.className}>{badge.label}</span></td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <PanelFoot
                left={`${courseOutcomeRows.length} courses`}
                action="View All Courses"
                onAction={courseListPage ? () => onNavigate?.(courseListPage) : undefined}
              />
            </section>

            {/* 2 ---- */}
            <section className="panel reports-panel">
              <PanelHead title="PO Coverage Chart" />
              <p className="reports-panel__sub">
                Percentage of CLOs mapped to each Program Outcome.
              </p>
              {charted.rows.length === 0 && charted.uncovered === 0 ? (
                <p className="reports-empty">No program outcomes recorded yet.</p>
              ) : (
                <PoCoverageBars
                  rows={charted.rows.map((r) => ({
                    code: r.outcome.code,
                    percent: r.percent,
                    count: r.cloCount,
                  }))}
                  uncovered={charted.uncovered}
                  uncoveredCodes={charted.uncoveredCodes}
                  hidden={charted.hidden}
                  totalClos={mapping.totalClos}
                  details={poDetails}
                  unfold
                />
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

export default MapBrief
