// Manager Curriculum Structure - the plan view from the reference design:
// courses grouped by year level and term, with per-term totals, program and
// academic-year filters, a search box, expand-all, and the evaluation line.
// Keeps its data read-only here; the existing management panel below edits
// curriculum records and the Course page creates subjects.
import { Fragment, useEffect, useMemo, useState } from 'react'
import Icon from '../../components/icons'
import CurriculumPdfImport from '../../components/CurriculumPdfImport'
import {
  fetchPrograms,
  fetchResources,
  fetchCourses,
  updateCourse,
  addActivityLog,
  type Course,
  type Program,
  type Resource,
} from '../../services/database'
import { visiblePrograms } from '../../utils/programScope'

interface Props {
  profile?: { role?: string | null; program_id?: string | null } | null
  onNavigate?: (page: string) => void
}

const relId = (v: string | { id: string } | null | undefined) =>
  v && typeof v === 'object' ? v.id : v || ''

const TERMS: Array<{ label: string; year: number; sem: number }> = [
  { label: 'First Year - First Semester', year: 1, sem: 1 },
  { label: 'Second Semester', year: 1, sem: 2 },
  { label: 'Second Year - First Semester', year: 2, sem: 1 },
  { label: 'Second Semester', year: 2, sem: 2 },
  { label: '3rd Year - 1st Semester', year: 3, sem: 1 },
  { label: '3rd Year - 2nd Semester', year: 3, sem: 2 },
  { label: '3rd Year Summer', year: 3, sem: 3 },
  { label: '4th Year - 1st Semester', year: 4, sem: 1 },
  { label: '4th Year - 2nd Semester', year: 4, sem: 2 },
]

const subjectOf = (code: string) => (code.match(/^[A-Za-z]+/) || [''])[0]

const yearLabel = (y: number) =>
  ['', 'First Year', 'Second Year', 'Third Year', 'Fourth Year'][y] || `Year ${y}`
const semLabel = (s: number) =>
  s === 3 ? 'Midyear' : s === 2 ? 'Second Semester' : 'First Semester'

export default function CurriculumStructure({ profile, onNavigate }: Props) {
  const [programs, setPrograms] = useState<Program[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [programId, setProgramId] = useState('')
  const [yearStart, setYearStart] = useState('')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [removingId, setRemovingId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const myProgramId = profile?.program_id ?? null

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchPrograms(), fetchResources(), fetchCourses()]).then(([p, r, c]) => {
      if (cancelled) return
      const scopedPrograms = p.status === 'fulfilled' ? visiblePrograms(p.value, profile) : []
      setPrograms(scopedPrograms)
      const activeResources =
        r.status === 'fulfilled' ? r.value.filter((x) => !x.status || x.status === 'active') : []
      setResources(activeResources)
      setCourses(c.status === 'fulfilled' ? c.value : [])
      setProgramId((prev) =>
        prev && scopedPrograms.some((x) => x.id === prev)
          ? prev
          : myProgramId && scopedPrograms.some((x) => x.id === myProgramId)
            ? myProgramId
            : scopedPrograms[0]?.id ?? '',
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [profile, myProgramId])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const r of resources) {
      if (r.sy_start != null) set.add(Number(r.sy_start))
    }
    return [...set].sort((a, b) => a - b)
  }, [resources])

  const working = useMemo(
    () =>
      resources.find((r) => {
        const pid = relId((r as Resource & { program_id?: string | null }).program_id)
        return (!pid || pid === programId) && String(r.sy_start ?? '') === yearStart
      }) ?? null,
    [resources, programId, yearStart],
  )

  const q = query.trim().toLowerCase()
  const scopedCourses = useMemo(
    () =>
      courses.filter((c) => {
        if (programId && relId(c.program_id) !== programId) return false
        if (working && relId(c.curriculum_id) !== working.id) return false
        if (!q) return !c.status || c.status === 'active'
        return (
          [c.code, c.title, c.description].some((v) => (v || '').toLowerCase().includes(q)) &&
          (!c.status || c.status === 'active')
        )
      }),
    [courses, programId, working, q],
  )

  const groups = useMemo(() => {
    const list = TERMS.map((term) => ({
      ...term,
      label: term.year === 1 && term.sem === 1 ? `${yearLabel(term.year)} - ${semLabel(term.sem)}` : term.label,
      rows: scopedCourses
        .filter((c) => Number(c.year_level) === term.year && Number(c.semester) === term.sem)
        .sort((a, b) => String(a.code).localeCompare(String(b.code))),
    })).filter((g) => g.rows.length > 0)
    return list
  }, [scopedCourses])

  const allCollapsed = collapsed.size > 0 && collapsed.size === groups.length
  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.label + g.year)))
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleTerm = (rows: Course[]) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = rows.every((c) => next.has(c.id))
      for (const c of rows) {
        if (allSelected) next.delete(c.id)
        else next.add(c.id)
      }
      return next
    })

  // Removing a subject is a soft archive: managers may update courses
  // but hard deletion is admin-only, and archived rows leave every plan.
  const handleRemove = async (course: Course) => {
    if (
      !window.confirm(
        `Remove ${course.code} — ${course.title} from the curriculum? The subject is archived, not permanently deleted.`,
      )
    )
      return
    setRemovingId(course.id)
    try {
      await updateCourse(course.id, { status: 'archived' })
      await addActivityLog('course.archived', {
        entity: 'course',
        entity_id: course.id,
        label: `${course.code} — ${course.title}`,
      })
      setCourses((prev) => prev.map((c) => (c.id === course.id ? { ...c, status: 'archived' } : c)))
      setNotice(`${course.code} was removed from the curriculum plan.`)
    } catch (e) {
      setNotice('Failed to remove the subject: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setRemovingId('')
    }
  }

  const handleRemoveSelected = async () => {
    const picked = courses.filter((c) => selectedIds.has(c.id))
    if (picked.length === 0) return
    if (
      !window.confirm(
        `Remove ${picked.length} subject${picked.length === 1 ? '' : 's'} from the curriculum? They are archived, not permanently deleted.`,
      )
    )
      return
    setRemovingId('bulk')
    let removed = 0
    try {
      for (const course of picked) {
        await updateCourse(course.id, { status: 'archived' })
        await addActivityLog('course.archived', {
          entity: 'course',
          entity_id: course.id,
          label: `${course.code} — ${course.title}`,
        })
        removed++
      }
      const ids = new Set(picked.map((c) => c.id))
      setCourses((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, status: 'archived' } : c)))
      setSelectedIds(new Set())
      setNotice(`${removed} subject${removed === 1 ? '' : 's'} removed from the curriculum plan.`)
    } catch (e) {
      setNotice('Failed to remove the subjects: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setRemovingId('')
    }
  }

  const programLabel = programs.find((p) => p.id === programId)
  const yearText = yearStart ? `${yearStart}-${Number(yearStart) + 1}` : ''

  return (
    <div className="curriculum26">
      <nav className="curriculum26__crumb" aria-label="Breadcrumb">
        Curriculum Management <span>/</span>{' '}
        <strong>{programLabel?.code || programLabel?.name || 'Curriculum'}</strong>
      </nav>

      <div className="curriculum26__hero">
        <div>
          <span className="curriculum26__kicker">Program curriculum</span>
          <h2>{programLabel?.code || 'Program'} Curriculum Structure</h2>
          <p>View and maintain courses by year level and semester.</p>
        </div>
        <div className="curriculum26__hero-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImportOpen(true)}>
            <Icon name="doc" size={13} /> Upload curriculum
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => window.print()}>
            <Icon name="print" size={13} /> Print curriculum
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => onNavigate?.('course')}>
            <Icon name="plus" size={13} /> Add course
          </button>
        </div>
      </div>

      {notice && <p className="curriculum26__notice" role="status">{notice}</p>}

      <div className="curriculum26__filters">
        <label className="field">
          <span>Program</span>
          <select className="input input--sm" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {programs.length === 0 && <option value="">No programs available</option>}
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.code} ({p.code})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Academic Year</span>
          <select className="input input--sm" value={yearStart} onChange={(e) => setYearStart(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}-{y + 1}
              </option>
            ))}
          </select>
        </label>
        <span className="curriculum26__status">
          <span className="curriculum26__dot" /> Working curriculum ·{' '}
          {working?.title || working?.code || yearText || 'all years'}
        </span>
      </div>

      <div className="curriculum26__plan">
        <div className="curriculum26__plan-head">
          <div>
            <h3>Curriculum Plan</h3>
            <p>Course listing by year level and term</p>
          </div>
          <div className="curriculum26__plan-tools no-print">
            <input
              className="input input--sm"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search course code or description"
              aria-label="Search course code or description"
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={toggleAll}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
            {selectedIds.size > 0 && (
              <>
                <span className="curriculum26__selected">{selectedIds.size} selected</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
                <button type="button" className="btn btn--danger btn--sm" onClick={() => void handleRemoveSelected()} disabled={removingId === 'bulk'}>
                  {removingId === 'bulk' ? 'Removing…' : `Remove ${selectedIds.size}`}
                </button>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <p className="curriculum26__empty">Loading curriculum…</p>
        ) : groups.length === 0 ? (
          <p className="curriculum26__empty">
            No courses found for this program and academic year.
          </p>
        ) : (
          <div className="curriculum26__grid">
            {[1, 2, 3, 4].map((year) => {
              const yearGroups = groups.filter((g) => g.year === year)
              if (yearGroups.length === 0) return null
              return (
                <Fragment key={year}>
                  <h4 className="curriculum26__year">
                    {year === 3
                      ? 'THIRD YEAR'
                      : year === 4
                        ? 'FOURTH YEAR'
                        : `${yearLabel(year).toUpperCase()}`}
                  </h4>
                  {yearGroups.map((g) => {
                    const key = g.label + g.year
                    const open = !collapsed.has(key)
                    const totalLec = g.rows.reduce((s, c) => s + (Number(c.credit_lecture) || 0), 0)
                    const totalLab = g.rows.reduce((s, c) => s + (Number(c.credit_laboratory) || 0), 0)
                    const totalUnits = g.rows.reduce((s, c) => s + (Number(c.units) || 0), 0)
                    return (
                      <section key={key} className="curriculum26__term">
                        <button
                          type="button"
                          className={`curriculum26__term-head${year >= 3 ? ' curriculum26__term-head--green' : ''}`}
                          onClick={() => toggle(key)}
                        >
                          <span>{g.label}</span>
                          <span className="curriculum26__term-count">
                            {g.rows.length} course{g.rows.length === 1 ? '' : 's'}
                          </span>
                        </button>
                        {open && (
                          <table className="curriculum26__table">
                            <thead>
                              <tr>
                                <th>
                                  <input
                                    type="checkbox"
                                    checked={g.rows.length > 0 && g.rows.every((c) => selectedIds.has(c.id))}
                                    onChange={() => toggleTerm(g.rows)}
                                    aria-label={`Select all subjects in ${g.label}`}
                                  />
                                </th>
                                <th>FG</th>
                                <th>SUBJ</th>
                                <th>Code</th>
                                <th>Descriptive Title</th>
                                <th>Lec</th>
                                <th>Lab</th>
                                <th>Units</th>
                                <th>Pre-Req</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((c) => (
                                <tr key={c.id}>
                                  <td className="curriculum26__check-cell">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(c.id)}
                                      onChange={() => toggleSelected(c.id)}
                                      aria-label={`Select ${c.code} for removal`}
                                    />
                                  </td>
                                  <td>{subjectOf(c.code)}</td>
                                  <td className="curriculum26__code">{c.code}</td>
                                  <td>{c.title}</td>
                                  <td>{c.credit_lecture}</td>
                                  <td>{c.credit_laboratory}</td>
                                  <td>{c.units}</td>
                                  <td>{c.prerequisite || 'None'}</td>
                                  <td className="curriculum26__remove-cell">
                                    <button
                                      type="button"
                                      className="curriculum26__remove"
                                      title={`Remove ${c.code} from the curriculum`}
                                      aria-label={`Remove ${c.code} from the curriculum`}
                                      disabled={removingId === c.id}
                                      onClick={() => void handleRemove(c)}
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              <tr className="curriculum26__total">
                                <td colSpan={5}>TOTAL</td>
                                <td>{totalLec}</td>
                                <td>{totalLab}</td>
                                <td>{totalUnits}</td>
                                <td colSpan={2} />
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </section>
                    )
                  })}
                </Fragment>
              )
            })}
          </div>
        )}

      </div>
      {importOpen && programId && (
        <CurriculumPdfImport
          programId={programId}
          programCode={programLabel?.code ?? undefined}
          curriculumId={working?.id ?? ''}
          curriculumLabel={working?.title || working?.code || undefined}
          courses={courses}
          onClose={() => setImportOpen(false)}
          onImported={(created, skipped) => {
            setImportOpen(false)
            setNotice(
              `Imported ${created} subject${created === 1 ? '' : 's'}` +
                (skipped ? `, skipped ${skipped} already on file.` : '.'),
            )
            fetchCourses()
              .then(setCourses)
              .catch(() => {})
          }}
        />
      )}
    </div>
  )
}
