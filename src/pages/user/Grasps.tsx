// GRASPS performance-task workspace.
//
// GRASPS is the acronym the assessment framework spells its six parts with —
// Goal, Role, Audience, Situation, Product/Performance, Standards — and this
// page builds one performance task out of them. The Table of Specification's
// banner calls itself "your guide in making the GRASPS", so the flow runs the
// same way: a draft at the top that writes nothing to the database until Save
// is pressed, then a library below of everything this account has filed.
//
// Persistence follows the TOS page's one-writer rule: the editor at the top is
// a draft (mirrored to localStorage so a refresh costs nothing), Save files
// the whole task as one row, and a card's Edit button loads that row back into
// the same editor — one editor, so the draft and the database can never
// disagree about what is stored. Archive and restore are the only removals;
// nothing is ever hard-deleted from here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageBanner from '../../components/PageBanner'
import Icon from '../../components/icons'
import {
  addActivityLog,
  createGraspsTask,
  fetchCourses,
  fetchGraspsTasks,
  fetchPrograms,
  updateGraspsTask,
  type Course,
  type GraspsTaskRow,
  type Program,
} from '../../services/database'
import { supabase } from '../../utils/supabaseClient'
import { downloadGraspsDocx } from '../../utils/graspsDocx'
import {
  buildCourseOptions,
  buildExamTypeOptions,
  buildProgramOptions,
  buildSchoolYearOptions,
  buildSemesterOptions,
  composeTerm,
  describeTosError,
  programIdForLabel,
} from '../../utils/tosOptions'

/**
 * Where the unsaved draft is mirrored, so a refresh or a closed tab does not
 * cost the user their typing. Versioned like the TOS draft key, so a change
 * to the draft's shape cannot resurrect something saved by an older build.
 */
const DRAFT_KEY = 'cqic.grasps.draft.v1'

/**
 * The six GRASPS components, in the order the acronym spells them. `hint` is
 * the one-line prompt shown under each editor; the docx export prints the
 * same six labels, so the screen and the hand-in never disagree.
 */
const GRASPS_PARTS: Array<{
  key: 'goal' | 'role' | 'audience' | 'situation' | 'product' | 'standards'
  letter: string
  label: string
  hint: string
  placeholder: string
}> = [
  {
    key: 'goal',
    letter: 'G',
    label: 'Goal',
    hint: 'The real-world problem or challenge the task works on.',
    placeholder: 'e.g. Design a working inventory system for a local store…',
  },
  {
    key: 'role',
    letter: 'R',
    label: 'Role',
    hint: 'Who the learner becomes while doing the work.',
    placeholder: 'e.g. You are a junior systems analyst…',
  },
  {
    key: 'audience',
    letter: 'A',
    label: 'Audience',
    hint: 'Who the learner performs the work for.',
    placeholder: 'e.g. The store owner and the class as client…',
  },
  {
    key: 'situation',
    letter: 'S',
    label: 'Situation',
    hint: 'The setting or context the work happens in.',
    placeholder: 'e.g. During the store’s peak-sale week…',
  },
  {
    key: 'product',
    letter: 'P',
    label: 'Product / Performance',
    hint: 'What the learner creates or demonstrates by the end.',
    placeholder: 'e.g. A demo of the system with a short walkthrough…',
  },
  {
    key: 'standards',
    letter: 'S',
    label: 'Standards',
    hint: 'The criteria the work is judged against.',
    placeholder: 'e.g. Judged on functionality, completeness and accuracy…',
  },
]

type GraspsKey = (typeof GRASPS_PARTS)[number]['key']
const PART_KEYS = GRASPS_PARTS.map((p) => p.key)

interface GraspsDraft {
  /** The saved row the editor currently holds, or null for a fresh draft. */
  id: string | null
  /** Program label ("BSIT - Bachelor of …"), stored in the row's `code`. */
  code: string
  /** Course label ("IT20 - Data Structures…"), stored in the row's `title`. */
  title: string
  taskType: string
  semester: string
  schoolYear: string
  goal: string
  role: string
  audience: string
  situation: string
  product: string
  standards: string
}

const blankDraft = (): GraspsDraft => ({
  id: null,
  code: '',
  title: '',
  taskType: 'Prelim',
  semester: '',
  schoolYear: '',
  goal: '',
  role: '',
  audience: '',
  situation: '',
  product: '',
  standards: '',
})

/** A saved task, loaded back into the editor as its own editable copy. */
const draftFromRow = (row: GraspsTaskRow): GraspsDraft => ({
  id: row.id,
  code: row.code,
  title: row.title,
  taskType: row.task_type,
  semester: row.semester ?? '',
  schoolYear: row.school_year ?? '',
  goal: row.goal ?? '',
  role: row.role ?? '',
  audience: row.audience ?? '',
  situation: row.situation ?? '',
  product: row.product ?? '',
  standards: row.standards ?? '',
})

/**
 * The draft a previous visit left behind, if there is one. Deliberately
 * sceptical — storage can hold anything, and the page must open on a blank
 * draft rather than crash on a half-written object — so anything unreadable
 * or incomplete restores as nothing and the blank draft takes over.
 */
const readDraft = (): GraspsDraft | null => {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GraspsDraft> | null
    if (!parsed || typeof parsed !== 'object') return null
    return { ...blankDraft(), ...parsed }
  } catch {
    return null
  }
}

/** Archived rows stay in the database but out of a new pick. */
const isActive = <T extends { status?: string }>(x: T) => !x.status || x.status === 'active'

/** The signed-in user's id, which the grasps_tasks insert requires. */
const currentUserId = async (): Promise<string> => {
  const { data, error } = await supabase!.auth.getUser()
  if (error) throw error
  const id = data.user?.id
  if (!id) throw new Error('You are not signed in.')
  return id
}

/** The document's title line, shared by the card and the export. */
const docTitle = (taskType: string) =>
  `GRASPS Performance Task${taskType.trim() ? ` for ${taskType.trim()}` : ''}`

/**
 * Save failures out of the database read like PostgreSQL, and the one a task
 * save can actually hit — code 23505, the UNIQUE constraint refusing two
 * tasks filed under the same program, course, task type, semester and school
 * year — deserves its own words. describeTosError already translates that
 * code in blueprint vocabulary; this checks the code directly and wraps the
 * rest, so the message names the thing on screen.
 */
const describeGraspsError = (e: unknown, fallback: string): string => {
  const code = (e as { code?: unknown } | null | undefined)?.code
  if (code === '23505') {
    return 'A task with this program, course, grading period, semester and school year already exists. Change one of them, or keep editing the one you have.'
  }
  return describeTosError(e, fallback)
}

export default function Grasps() {
  // The draft, restored from localStorage when a previous visit left one.
  const [draft, setDraft] = useState<GraspsDraft>(() => readDraft() ?? blankDraft())
  const [programs, setPrograms] = useState<Program[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /**
   * True from the first keystroke until Save files the draft — the same
   * split the TOS page draws: `dirty` is the draft's own state, `saving` is
   * only the request in flight.
   */
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  /** Every task this account owns, refreshed after each write. */
  const [rows, setRows] = useState<GraspsTaskRow[]>([])
  const [archived, setArchived] = useState(false)
  const [archivedCount, setArchivedCount] = useState(0)

  const fail = useCallback((e: unknown, fallback: string) => {
    setError(describeGraspsError(e, fallback))
  }, [])

  /**
   * Refresh the saved-tasks panel. Runs after every save so the panel is
   * proof the write landed. Both tabs are counted on every refresh, so the
   * Archive tab can show how many are hidden without a second round trip
   * when it is opened.
   */
  const refreshList = useCallback(async () => {
    try {
      const [all, archivedRows] = await Promise.all([
        fetchGraspsTasks('all'),
        fetchGraspsTasks('archived'),
      ])
      setRows(all)
      setArchivedCount(archivedRows.length)
    } catch {
      // A failed list must not take the editor down with it — the draft on
      // screen is the user's work and is unaffected.
    }
  }, [])

  // On load: read the library once, then release the form. Nothing is created
  // on page load — an account with no saved tasks shows an empty panel and a
  // blank draft, and no row is born until Save is pressed.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refreshList()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshList])

  // The draft is mirrored to localStorage on every change, so a refresh or an
  // accidental tab close costs nothing. Clearing needs no separate step: a
  // save or a discard resets this state, and the blank draft that follows
  // overwrites what was stored through this same effect.
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Storage can be unavailable (private mode, quota). The draft still
      // works; it just does not survive a refresh.
    }
  }, [draft])

  // The picker lists are auxiliary: the task is fully usable without them, so
  // a failed read degrades to an empty dropdown instead of locking the page.
  // allSettled keeps one dead table from taking the other down with it.
  useEffect(() => {
    let cancelled = false
    Promise.allSettled([fetchPrograms(), fetchCourses()]).then(([p, c]) => {
      if (cancelled) return
      setPrograms(p.status === 'fulfilled' ? p.value.filter(isActive) : [])
      setCourses(c.status === 'fulfilled' ? c.value.filter(isActive) : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * The gate holds the selects and the component editors still while the
   * library's first read runs and after a failure, so an error sits visibly
   * instead of being buried under more typing. Save itself is NOT behind it —
   * the guard below blocks only the initial load — so pressing Save after a
   * failure clears the error and retries the whole thing, which is the way
   * out of the gate.
   */
  const ready = !loading && !error

  const patchDraft = useCallback((patch: Partial<GraspsDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }, [])

  const patchPart = useCallback(
    (key: GraspsKey, value: string) => {
      setDraft((prev) => ({ ...prev, [key]: value }))
      setDirty(true)
    },
    [],
  )

  // ---- picker options ---------------------------------------------------
  // Built by the shared helpers so the lists match the TOS page's behaviour
  // exactly: a saved value that matches nothing listed stays as its own
  // option rather than silently showing the placeholder.

  /** The program the task is currently filed under, or '' when none/unlisted. */
  const selectedProgramId = useMemo(
    () => programIdForLabel(programs, draft.code),
    [programs, draft.code],
  )

  const programOptions = useMemo(
    () => buildProgramOptions(programs, draft.code),
    [programs, draft.code],
  )

  const courseOptions = useMemo(
    () => buildCourseOptions(courses, selectedProgramId, draft.title),
    [courses, selectedProgramId, draft.title],
  )

  const semesterOptions = useMemo(() => buildSemesterOptions(draft.semester), [draft.semester])
  const schoolYearOptions = useMemo(() => buildSchoolYearOptions(draft.schoolYear), [
    draft.schoolYear,
  ])
  const taskTypeOptions = useMemo(() => buildExamTypeOptions(draft.taskType), [draft.taskType])

  // ---- Save ---------------------------------------------------------------

  /**
   * Save the draft: everything on screen becomes one saved task.
   *
   * The editor is not a database row — nothing here writes as you type. Save
   * is the single write. When the editor holds a loaded task (a card's Edit
   * button put it here) the row is updated; otherwise a row is created, and
   * either way the editor hands over a fresh blank draft and the library
   * re-reads so the card is there to prove it.
   *
   * A draft with nothing in it has nothing to file; Save says so and leaves
   * the form alone rather than stacking an empty card. A failure keeps the
   * draft exactly as it stands — nothing is wiped, nothing is half-filed, and
   * pressing Save again retries the whole thing. A duplicate header (same
   * program, course, grading period, semester and school year as a task
   * already filed) is rejected by the UNIQUE key and explained in plain words
   * by describeGraspsError.
   */
  const saveNow = useCallback(async () => {
    // Not the `ready` gate: a failure must stay recoverable by pressing Save
    // again, and this guard would refuse that retry while the error it needs
    // to clear is still up. Only the initial library read holds Save off.
    if (loading) return
    setSaving(true)
    setError(null)

    const hasContent =
      Boolean(draft.code || draft.title || draft.semester || draft.schoolYear) ||
      PART_KEYS.some((k) => draft[k].trim() !== '')

    if (!hasContent) {
      setSaving(false)
      setError('Nothing to save yet — choose a course or write a component first.')
      return
    }

    // A task filed under no course title would be unreadable in the library
    // (every card opens with "Course Title: …"), so Save asks for one first.
    if (!draft.title.trim()) {
      setSaving(false)
      setError('Choose a course title before saving — the task files under it.')
      return
    }

    try {
      const payload = {
        code: draft.code,
        title: draft.title,
        task_type: draft.taskType,
        // An unselected semester or year is stored as NULL, not '' — the
        // UNIQUE key covers both columns, and NULLs never equal each other,
        // so a header-less task never collides with another. `term`
        // recomposes only from a real selection; '' keeps nothing stale.
        term: draft.semester || draft.schoolYear ? composeTerm(draft.semester, draft.schoolYear) : '',
        semester: draft.semester || null,
        school_year: draft.schoolYear || null,
        goal: draft.goal.trim() || null,
        role: draft.role.trim() || null,
        audience: draft.audience.trim() || null,
        situation: draft.situation.trim() || null,
        product: draft.product.trim() || null,
        standards: draft.standards.trim() || null,
      }

      let id: string
      if (draft.id) {
        const updated = await updateGraspsTask(draft.id, payload)
        id = updated.id
      } else {
        const created = await createGraspsTask(payload, await currentUserId())
        id = created.id
      }

      // A create and an update are different events in the audit trail — the
      // card they produce is the same either way, but the log tells them
      // apart the same way the TOS page's entries do.
      await addActivityLog(draft.id ? 'grasps_task.updated' : 'grasps_task.created', {
        entity: 'grasps_task',
        entity_id: id,
        label: [draft.code, draft.title].filter(Boolean).join(' — ') || 'GRASPS performance task',
      })

      // Filed. The editor starts the next draft; the library re-reads so the
      // card is there to prove it.
      setDraft(blankDraft())
      setDirty(false)
      setSaving(false)
      setSavedAt(new Date().toLocaleTimeString())
      await refreshList()
    } catch (e) {
      fail(e, 'Could not save the task.')
      setSaving(false)
    }
  }, [loading, draft, fail, refreshList])

  /**
   * Throw the draft away and start blank.
   *
   * Nothing here was ever in the database unless the editor holds a loaded
   * task — in which case the saved copy is untouched and a discard only
   * closes the edit — so the confirm says which of the two is being thrown.
   */
  const discardDraft = useCallback(() => {
    if (
      !window.confirm(
        draft.id
          ? 'Close this edit? The saved task is untouched — only the changes on screen are thrown away.'
          : 'Throw away this draft? Nothing in it has been saved yet.',
      )
    )
      return
    setDraft(blankDraft())
    setDirty(false)
    setSaving(false)
    setSavedAt(null)
    setError(null)
  }, [draft.id])

  // ---- library panel ------------------------------------------------------

  const visibleRows = useMemo(
    () => rows.filter((r) => (archived ? r.status === 'archived' : r.status !== 'archived')),
    [rows, archived],
  )

  /** Load a saved task into the editor — the only way a card is edited. */
  const editRow = useCallback((row: GraspsTaskRow) => {
    setDraft(draftFromRow(row))
    setDirty(false)
    setError(null)
    setSavedAt(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /** Archive or restore, then re-read so the panel proves the flip landed. */
  const setRowStatus = useCallback(
    async (id: string, next: 'active' | 'archived') => {
      try {
        await updateGraspsTask(id, { status: next })
        // Archive and restore are separate actions, not one "status changed",
        // so the log can tell which happened — the same settlement the TOS
        // page's audit entries reached.
        await addActivityLog(next === 'archived' ? 'grasps_task.archived' : 'grasps_task.restored', {
          entity: 'grasps_task',
          entity_id: id,
        })
        await refreshList()
      } catch (e) {
        fail(e, 'Could not change the task.')
      }
    },
    [refreshList, fail],
  )

  /** The Word document for a saved task — the file the faculty hand in. */
  const exportRow = useCallback(
    async (row: GraspsTaskRow) => {
      try {
        await downloadGraspsDocx({
          program: row.code,
          course: row.title,
          taskType: row.task_type,
          term: row.term || composeTerm(row.semester ?? '', row.school_year ?? ''),
          goal: row.goal ?? '',
          role: row.role ?? '',
          audience: row.audience ?? '',
          situation: row.situation ?? '',
          product: row.product ?? '',
          standards: row.standards ?? '',
          preparedBy: '',
        })
        await addActivityLog('grasps_task.exported', {
          entity: 'grasps_task',
          entity_id: row.id,
          label: [row.code, row.title].filter(Boolean).join(' — ') || 'GRASPS performance task',
        })
      } catch (e) {
        fail(e, 'Could not build the Word file.')
      }
    },
    [fail],
  )

  /** How many of the six components a row actually carries, for its card. */
  const filledCount = (row: GraspsTaskRow) =>
    PART_KEYS.filter((k) => (row[k] ?? '').trim() !== '').length

  // Auto-expanding textareas: the same three-line routine the CLO page runs,
  // called on every keystroke through the ref callback so the box always fits
  // its text.
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // A restored or loaded task puts saved text into fixed-height boxes; one
  // pass over the component editors grows them to fit, the same routine every
  // keystroke runs. Keyed on the draft's id so loading a card re-fits them
  // too, and plain text restores are covered by the mount pass.
  useEffect(() => {
    document.querySelectorAll<HTMLTextAreaElement>('.grasps-part textarea').forEach(autoResize)
  }, [draft.id, autoResize])

  return (
    <div className="syllabus-doc">
      <PageBanner
        title="Generate GRASPS"
        sub="Design the performance task — Goal, Role, Audience, Situation, Product, Standards."
      />

      {/* ---- task header ---- */}
      <div className="panel tos-panel no-print">
        <div className="tos-field-grid">
          <label className="field">
            <span>Program</span>
            <select
              className="input input--sm"
              value={draft.code}
              disabled={!ready || programs.length === 0}
              onChange={(e) => patchDraft({ code: e.target.value })}
            >
              <option value="">
                {programs.length === 0 ? 'No programs available' : '- select program -'}
              </option>
              {programOptions.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Course title</span>
            <select
              className="input input--sm"
              value={draft.title}
              disabled={!ready || courses.length === 0}
              onChange={(e) => patchDraft({ title: e.target.value })}
            >
              <option value="">
                {courses.length === 0 ? 'No courses available' : '- select course -'}
              </option>
              {courseOptions.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Performance task for</span>
            <select
              className="input input--sm"
              value={draft.taskType}
              disabled={!ready}
              onChange={(e) => patchDraft({ taskType: e.target.value })}
            >
              <option value="">- select grading period -</option>
              {taskTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {/* Semester and School Year sit side by side so the header stays compact. */}
          <div className="field-row">
            <label className="field">
              <span>Semester</span>
              <select
                className="input input--sm"
                value={draft.semester}
                disabled={!ready}
                onChange={(e) => patchDraft({ semester: e.target.value })}
              >
                <option value="">- select semester -</option>
                {semesterOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>School Year</span>
              <select
                className="input input--sm"
                value={draft.schoolYear}
                disabled={!ready}
                onChange={(e) => patchDraft({ schoolYear: e.target.value })}
              >
                <option value="">- select school year -</option>
                {schoolYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="tos-savestate" role="status">
          {error ? (
            <span className="tos-savestate__error">{error}</span>
          ) : loading ? (
            <span>Loading…</span>
          ) : saving ? (
            <span>Saving…</span>
          ) : dirty ? (
            /* The draft's own state, distinct from the last save's timestamp:
               this says there is work on screen the library does not hold. */
            draft.id ? (
              <span>Editing saved task — not saved yet</span>
            ) : (
              <span>Draft — not saved yet</span>
            )
          ) : draft.id ? (
            <span>Editing saved task</span>
          ) : savedAt ? (
            <span>Saved {savedAt}</span>
          ) : null}
        </div>
      </div>

      {/* ---- the six components ---- */}
      <div className="panel tos-panel no-print">
        <div className="grasps-parts">
          {GRASPS_PARTS.map((p) => (
            <div key={p.key} className="grasps-part">
              <div className="grasps-part__head">
                <span className="grasps-part__letter" aria-hidden="true">
                  {p.letter}
                </span>
                <div className="grasps-part__text">
                  <span className="grasps-part__label">{p.label}</span>
                  <span className="grasps-part__hint">{p.hint}</span>
                </div>
              </div>
              <textarea
                className="input input--sm"
                ref={autoResize}
                value={draft[p.key]}
                placeholder={p.placeholder}
                rows={3}
                disabled={!ready}
                onChange={(e) => {
                  patchPart(p.key, e.target.value)
                  autoResize(e.currentTarget)
                }}
              />
            </div>
          ))}
        </div>

        <div className="tos-addrow no-print">
          {/* Only offered when there is something to throw away, so it cannot
              be clicked to "reset" a task that was never edited — the same
              rule the TOS grid's Discard keeps. */}
          {dirty && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={discardDraft}
              disabled={saving}
              title={
                draft.id
                  ? 'Close this edit — the saved task is untouched'
                  : 'Throw away this draft — nothing in it has been saved yet'
              }
            >
              {draft.id ? 'Close edit' : 'Discard'}
            </button>
          )}
          <button
            type="button"
            className={`btn btn--primary btn--sm${dirty ? ' btn--pending' : ''}`}
            onClick={saveNow}
            disabled={saving}
            title={
              draft.id
                ? 'Save your changes to this task'
                : 'Save this task into the library and start a blank draft'
            }
          >
            {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save'}
          </button>
        </div>
      </div>

      {/* ---- saved tasks ----
          The panel is the visible proof that a save landed. It re-reads itself
          after every save rather than assuming success, so what is listed is
          what is actually in the database. Cards file oldest first, so each
          new task appends at the bottom. Last on the page, below the editor it
          describes: the editor is the thing you came here to use, and the list
          is a record of what you have used. */}
      <div className="panel table-wrap tos-library no-print">
        <div className="program-toolbar">
          <div className="sd-tabs" style={{ marginBottom: 0, flex: 1, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`sd-tab ${!archived ? 'sd-tab--active' : ''}`}
              onClick={() => setArchived(false)}
            >
              Active
            </button>
            <button
              type="button"
              className={`sd-tab ${archived ? 'sd-tab--active' : ''}`}
              onClick={() => setArchived(true)}
            >
              Archive {archivedCount > 0 && <span className="sd-tab__count">{archivedCount}</span>}
            </button>
          </div>
        </div>

        <div className="resource-list">
          {visibleRows.length === 0 && (
            <div className="program-empty" style={{ marginTop: 14 }}>
              <strong>{archived ? 'No archived tasks yet.' : 'No saved GRASPS tasks yet.'}</strong>
              <span>
                {archived
                  ? 'Archived tasks stay here — nothing is deleted.'
                  : 'Fill in the task above and press Save.'}
              </span>
            </div>
          )}

          {visibleRows.map((row) => (
            <div
              key={row.id}
              className={`resource-card ${row.status === 'archived' ? 'resource-card--archived' : ''}`}
            >
              <div className="resource-card__body">
                {/* Mirrors the task's own header lines — "Course Title: …" then
                    the term — so a card identifies a task the same way the
                    document and its exported Word file do. */}
                <h4>
                  <span className="tos-card__label">Course Title:</span>{' '}
                  {row.title || 'No course title yet'}
                </h4>
                <p>
                  {row.semester || row.school_year
                    ? composeTerm(row.semester ?? '', row.school_year ?? '')
                    : row.term || 'No semester set'}
                </p>
                {/* The document's own title line, so the card, the editor and
                    the exported file all name the task the same way. */}
                <p className="tos-card__doctitle">{docTitle(row.task_type)}</p>
                <div className="resource-card__meta">
                  <span className={`status-badge status-badge--${row.status}`}>{row.status}</span>
                  {row.code && <span>{row.code}</span>}
                  {/* The six-component frame, counted honestly: an incomplete
                      task says so instead of looking finished. */}
                  <span>
                    {filledCount(row)} of {PART_KEYS.length} components written
                  </span>
                  <span>{new Date(row.updated_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="resource-card__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => editRow(row)}
                  aria-label={`Edit ${row.code || row.title || 'task'}`}
                  title="Edit — loads this task into the editor above"
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void exportRow(row)}
                  aria-label={`Download ${row.code || row.title || 'task'} as Word`}
                  title="Download as Word"
                >
                  <Icon name="download" size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void setRowStatus(row.id, row.status === 'archived' ? 'active' : 'archived')}
                >
                  {row.status === 'archived' ? 'Restore' : 'Archive'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
