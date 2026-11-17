// Assign Faculty — the manager's dedicated module for handing subjects to
// faculty members (sidebar: between Course and Generate Map). Two panes: the
// faculty roster on the left, the picked member's subjects plus the assign
// bar on the right, so an assignment never needs the Course editor.
//
// Writes go through assignCourseInstructor and carry the same
// course.instructor_assigned audit entry the Course page writes, so the two
// surfaces never split the trail's voice. Assignment stays per program —
// subjects belong to programs, and the counts answer "how many here".

import { useState, useEffect, useCallback } from 'react'
import Icon from '../../components/icons'
import SubjectMultiAssign from '../../components/SubjectMultiAssign'
import {
  fetchPrograms,
  fetchCourses,
  fetchAllProfiles,
  addCourseInstructor,
  removeCourseInstructor,
  addActivityLog,
} from '../../services/database'
import type { Program, Course, Profile } from '../../services/database'

// Term placement readback, worded exactly like the Course page ("2nd Year ·
// 1st Sem") so the two surfaces never disagree about the same subject.
const ordYear = (n: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`
const termLabelOf = (c: Pick<Course, 'year_level' | 'semester'>): string => {
  if (c.year_level == null) return ''
  const sem = c.semester === 1 ? '1st Sem' : c.semester === 2 ? '2nd Sem' : c.semester === 3 ? 'Summer' : ''
  return sem ? `${ordYear(c.year_level)} Year · ${sem}` : `${ordYear(c.year_level)} Year`
}

const isActive = (c: Course) => !c.status || c.status === 'active'

const instructorIdOf = (v: Course['instructor_id']) =>
  v && typeof v === 'object' ? v.id : (v || '')
const instructorLabelOf = (v: Course['instructor_id']) =>
  v && typeof v === 'object' ? v.full_name || v.email : ''

// The order subjects are listed and offered in: year, then semester, then
// code — the curriculum's own walk.
const curriculumOrder = (a: Course, b: Course) =>
  (a.year_level ?? 99) - (b.year_level ?? 99) ||
  (a.semester ?? 9) - (b.semester ?? 9) ||
  a.code.localeCompare(b.code, undefined, { numeric: true })

const initialsOf = (name: string | null | undefined, email: string) =>
  ((name ?? '').trim() || email)
    .split(/[\s@.\-]+/)
    .map((w) => w[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'F'

interface FacultyAssignProps {
  profile?: Profile | null
}

export default function AssignFaculty({ profile }: FacultyAssignProps) {
  const [programs, setPrograms] = useState<Program[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  // Active faculty accounts only — archived accounts are not handed subjects,
  // and managers/admins do not teach.
  const [faculty, setFaculty] = useState<Profile[]>([])
  const [programId, setProgramId] = useState('')
  const [facultyId, setFacultyId] = useState('')
  // Multi-pick: the subjects checked in the assign list, waiting for one
  // Assign press that files them all at once.
  const [picks, setPicks] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const errMsg = (e: unknown) => {
    if (e instanceof Error) return e.message
    if (e && typeof e === 'object') {
      const m = (e as Record<string, unknown>).message
      return typeof m === 'string' ? m : JSON.stringify(e)
    }
    return String(e)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [p, c, profiles] = await Promise.all([fetchPrograms(), fetchCourses(), fetchAllProfiles()])
      setPrograms(p)
      setCourses(c)
      setFaculty(profiles.filter((pr) => pr.role === 'user' && pr.status !== 'archived'))
      setProgramId((prev) => {
        if (prev && p.some((x) => x.id === prev)) return prev
        // Open on the account's own program assignment when it is a real
        // program — the same courtesy MapBrief and Reports extend — else the
        // first program on file.
        const mine = profile?.program_id ? p.find((x) => x.id === profile.program_id) : null
        return mine ? mine.id : (p[0]?.id ?? '')
      })
    } catch (e) {
      setError('Unable to load the assignment data: ' + errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { load() }, [load])

  const programCourses = courses.filter(
    (c) => (typeof c.program_id === 'object' ? c.program_id.id : c.program_id) === programId,
  )
  const activeCourses = programCourses.filter(isActive).sort(curriculumOrder)
  // Co-teaching (028): a subject is "held" by a faculty member when they
  // are one of its course_instructors — the junction, not the single
  // denormalized column.
  const instructorsOf = (c: Course) =>
    (c.course_instructors ?? [])
      .map((ci) => ci.faculty_id)
      .filter((f): f is { id: string; full_name: string | null; email: string } => Boolean(f))
  const heldBy = (c: Course, fid: string) =>
    instructorsOf(c).some((f) => f.id === fid)

  const assignedCount = activeCourses.filter((c) => instructorsOf(c).length > 0).length
  const unassignedCount = activeCourses.length - assignedCount

  const selected = faculty.find((f) => f.id === facultyId) ?? null
  const held = activeCourses.filter((c) => heldBy(c, facultyId))
  // Subjects the picked member could take over: every active subject here they
  // do not already hold AND that has not reached the co-teaching cap of 3
  // instructors. A subject someone else teaches says so in its option
  // label — a hand-over should never be a silent one.
  const MAX_INSTRUCTORS = 3
  const assignable = activeCourses.filter((c) => !heldBy(c, facultyId) && instructorsOf(c).length < MAX_INSTRUCTORS)

  const nameOf = (fid: string) => {
    const f = faculty.find((x) => x.id === fid)
    return f ? (f.full_name || f.email) : ''
  }

  const togglePick = (id: string) =>
    setPicks((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  const selectAllPicks = () => setPicks(assignable.map((c) => c.id))

  const handleAssign = async () => {
    if (!facultyId || picks.length === 0) return
    setError('')
    setMessage('')
    setBusy(true)
    try {
      // One junction row per picked subject — co-teaching: a subject can
      // hold several faculty, so assigning adds rather than overwrites.
      for (const id of picks) {
        await addCourseInstructor(id, facultyId)
        await addActivityLog('course.instructor_assigned', {
          entity: 'course',
          entity_id: id,
          label: `${courses.find((c) => c.id === id)?.code || 'Subject'} → ${nameOf(facultyId) || 'faculty'}`,
        })
      }
      setMessage(`Assigned ${picks.length} subject${picks.length === 1 ? '' : 's'} to ${nameOf(facultyId)}.`)
      setPicks([])
      load()
    } catch (err) {
      setError('Failed to assign subjects: ' + errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const handleUnassign = async (course: Course) => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await removeCourseInstructor(course.id, facultyId)
      await addActivityLog('course.instructor_assigned', {
        entity: 'course',
        entity_id: course.id,
        label: `${course.code} → unassigned from ${nameOf(facultyId) || 'faculty'}`,
      })
      setMessage(`Removed ${course.code} from ${nameOf(facultyId)}.`)
      load()
    } catch (err) {
      setError('Failed to unassign instructor: ' + errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const displayName = (f: Profile) => f.full_name || f.email

  return (
    <div className="programs-page">
      <div className="program-hero">
        <div className="program-hero__left">
          <div className="program-hero__icon">A</div>
          <div className="program-hero__titles">
            <h2>Assign Faculty</h2>
            <p>Hand each subject to the faculty member who teaches it.</p>
          </div>
        </div>
      </div>

      <div className="program-stats">
        <div className="program-stat">
          <div className="program-stat__label">Faculty</div>
          <div className="program-stat__value">{faculty.length}</div>
          <div className="program-stat__sub">Active accounts</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Subjects</div>
          <div className="program-stat__value">{activeCourses.length}</div>
          <div className="program-stat__sub">Active in program</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Assigned</div>
          <div className="program-stat__value" style={{ color: 'var(--primary)' }}>{assignedCount}</div>
          <div className="program-stat__sub">Have an instructor</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Unassigned</div>
          <div className="program-stat__value" style={{ color: '#b47a32' }}>{unassignedCount}</div>
          <div className="program-stat__sub">Still need one</div>
        </div>
      </div>

      {error && <p className="msg msg--error" role="alert">{error}</p>}
      {message && <p className="msg msg--success" role="status">{message}</p>}
      {loading ? (
        <p>Loading faculty and subjects...</p>
      ) : (
        <>
          <div className="program-panel" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0, minWidth: 240 }}>
              <span>Program</span>
              <select className="input" value={programId}
                onChange={(e) => { setProgramId(e.target.value); setPicks([]) }}>
                {programs.length === 0 && <option value="">No programs yet</option>}
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Assignment is per program — the roster counts and subject list follow this pick.
            </span>
          </div>

          <div className="assign-grid">
            {/* Left pane: the faculty roster. One row per active faculty
                account, with the count of this program's subjects they hold. */}
            <div className="program-panel">
              <h3 style={{ margin: 0 }}>Faculty</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Pick a member to work on their subjects.
              </p>
              <div className="assign-fac-list">
                {faculty.length === 0 ? (
                  <div className="program-empty">
                    <strong>No faculty accounts yet.</strong>
                    <span>Create faculty users under Users &amp; Accounts, then assign subjects here.</span>
                  </div>
                ) : (
                  faculty.map((f) => {
                    const count = activeCourses.filter((c) => heldBy(c, f.id)).length
                    return (
                      <button key={f.id} type="button"
                        className={`assign-fac ${facultyId === f.id ? 'assign-fac--active' : ''}`}
                        onClick={() => { setFacultyId(f.id); setPicks([]); setMessage(''); setError('') }}>
                        <span className="assign-fac__avatar">{initialsOf(f.full_name, f.email)}</span>
                        <span className="assign-fac__body">
                          <span className="assign-fac__name">{displayName(f)}</span>
                          <span className="assign-fac__mail">{f.email}</span>
                        </span>
                        {count > 0 && <span className="assign-fac__count">{count}</span>}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* Right pane: the picked member's workspace — their subjects,
                a Remove button on each, and the assign bar underneath. */}
            <div className="program-panel">
              {!selected ? (
                <div className="program-empty">
                  <strong>Select a faculty member.</strong>
                  <span>Their subjects and the assign bar appear here.</span>
                </div>
              ) : activeCourses.length === 0 ? (
                <>
                  <div className="assign-head">
                    <span className="assign-fac__avatar">{initialsOf(selected.full_name, selected.email)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ margin: 0, fontSize: 16 }}>{displayName(selected)}</h3>
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{selected.email}</span>
                    </div>
                  </div>
                  <div className="program-empty">
                    <strong>No active subjects in this program yet.</strong>
                    <span>Create them on the Course page, then assign them here.</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="assign-head">
                    <span className="assign-fac__avatar">{initialsOf(selected.full_name, selected.email)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ margin: 0, fontSize: 16 }}>{displayName(selected)}</h3>
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{selected.email}</span>
                    </div>
                    <span className="assign-fac__count">{held.length} subject{held.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="assign-subject-list">
                    {held.length === 0 ? (
                      <div className="program-empty">
                        <strong>No subjects assigned yet.</strong>
                        <span>Pick a subject below and press Assign.</span>
                      </div>
                    ) : (
                      held.map((c) => (
                        <div key={c.id} className="assign-subject" style={{ flexWrap: 'wrap' }}>
                          <span className="assign-subject__code">{c.code}</span>
                          <span className="assign-subject__title" title={c.title}>{c.title}</span>
                          {termLabelOf(c) && <span className="assign-subject__term">{termLabelOf(c)}</span>}
                          {instructorsOf(c).length > 1 && (
                            <span style={{ fontSize: 10, color: 'var(--primary)', background: 'var(--g100)', padding: '3px 8px', borderRadius: 999, fontWeight: 700 }}>
                              Shared · {instructorsOf(c).map((f) => f.full_name || f.email).join(', ')}
                            </span>
                          )}
                          <button className="btn btn--ghost btn--sm" onClick={() => handleUnassign(c)} disabled={busy}
                            aria-label={`Remove ${c.code} from ${displayName(selected)}`}
                            title={`Remove from ${displayName(selected)}`}>
                            <Icon name="x" size={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <SubjectMultiAssign
                    facultyName={displayName(selected)}
                    options={assignable.map((c) => {
                      const currentNames = instructorsOf(c).map((f) => f.full_name || f.email)
                      return {
                        id: c.id,
                        code: c.code,
                        title: c.title,
                        current: currentNames.length > 0 ? currentNames.join(', ') : null,
                      }
                    })}
                    picks={picks}
                    onToggle={togglePick}
                    onSelectAll={selectAllPicks}
                    onClear={() => setPicks([])}
                    onAssign={handleAssign}
                    busy={busy}
                    emptyHint={'Every assignable subject is taken — a subject can have at most 3 instructors.'}
                  />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
