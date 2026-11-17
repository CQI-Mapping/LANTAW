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
import Icon from '../../components/icons'
import {
  addActivityLog,
  createGraspsTask,
  fetchCourses,
  fetchGraspsTasks,
  fetchPrograms,
  updateGraspsTask,
  type Course,
  type GraspsRubricRow,
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
  /** The card's question line, as the reference design words them. */
  question: string
  hint: string
  tip: string
  /** The Quick Reference modal's one-liner for this component. */
  guide: string
  placeholder: string
}> = [
  {
    key: 'goal',
    letter: 'G',
    label: 'Goal',
    question: 'What should the learner accomplish?',
    hint: 'Define the real-world problem, challenge, or purpose of the task.',
    tip: 'Be specific about the intended outcome.',
    guide: 'The challenge or outcome to accomplish.',
    placeholder: 'e.g. Design a working inventory system for a local store…',
  },
  {
    key: 'role',
    letter: 'R',
    label: 'Role',
    question: 'Who will the learner become?',
    hint: 'Describe the role or professional identity the learner will take on.',
    tip: 'Use a role that fits the discipline.',
    guide: 'The perspective or responsibility of the learner.',
    placeholder: 'e.g. You are a junior systems analyst…',
  },
  {
    key: 'audience',
    letter: 'A',
    label: 'Audience',
    question: 'Who will receive the work?',
    hint: 'Identify the target users, clients, reviewers, or beneficiaries.',
    tip: 'Name the people who will use or assess it.',
    guide: 'The intended users, clients, or evaluators.',
    placeholder: 'e.g. The store owner and the class as client…',
  },
  {
    key: 'situation',
    letter: 'S',
    label: 'Situation',
    question: 'What is the context or challenge?',
    hint: 'Set the scenario, constraints, and context for the performance.',
    tip: 'Give the task a realistic context.',
    guide: 'The real-world context or scenario.',
    placeholder: 'e.g. During the store’s peak-sale week…',
  },
  {
    key: 'product',
    letter: 'P',
    label: 'Product / Performance',
    question: 'What will the learner create or present?',
    hint: 'Specify the tangible output, demonstration, or performance.',
    tip: 'Describe the expected deliverables.',
    guide: 'The output or demonstration to be completed.',
    placeholder: 'e.g. A demo of the system with a short walkthrough…',
  },
  {
    key: 'standards',
    letter: 'S',
    label: 'Standards for Success',
    question: 'How will success be evaluated?',
    hint: 'List the criteria, quality indicators, or rubric expectations.',
    tip: 'Align criteria with the learning outcomes.',
    guide: 'The criteria used to judge quality and success.',
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
  /** The analytic rubric rows (034), edited below the Standards card. */
  rubric: GraspsRubricRow[]
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
  rubric: [],
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
  rubric: row.rubric ?? [],
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

  // The analytic rubric's rows: add, edit a cell, remove. The remove
  // button never reorders surviving rows — index-spliced, like a table.
  const addRubricRow = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      rubric: [...prev.rubric, { criteria: '', points: 0, excellent: '', proficient: '', developing: '', beginning: '' }],
    }))
    setDirty(true)
  }, [])

  const removeRubricRow = useCallback((idx: number) => {
    setDraft((prev) => ({ ...prev, rubric: prev.rubric.filter((_, i) => i !== idx) }))
    setDirty(true)
  }, [])

  const patchRubricRow = useCallback((idx: number, patch: Partial<GraspsRubricRow>) => {
    setDraft((prev) => ({
      ...prev,
      rubric: prev.rubric.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
    setDirty(true)
  }, [])

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

    // Blank rubric rows are dropped, not saved — an empty row in the
    // document reads as unfinished work rather than an honest gap.
    const cleanRubric = draft.rubric.filter(
      (r) =>
        r.criteria.trim() || r.excellent.trim() || r.proficient.trim()
        || r.developing.trim() || r.beginning.trim() || (r.points ?? 0) !== 0,
    )

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
        rubric: cleanRubric,
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
          rubric: row.rubric ?? [],
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
    document.querySelectorAll<HTMLTextAreaElement>('.g26-part textarea, .g26-rubric textarea').forEach(autoResize)
  }, [draft.id, autoResize])

  // The Quick Reference guide opens from the hero and closes on Escape or
  // an outside click, like the syllabus reader's dialog.
  const [guideOpen, setGuideOpen] = useState(false)
  useEffect(() => {
    if (!guideOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGuideOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guideOpen])

  // The completion meter: how many of the six components the draft fills.
  const draftFilled = PART_KEYS.filter((k) => draft[k].trim() !== '').length
  const pct = Math.round((draftFilled / PART_KEYS.length) * 100)
  const activeCount = rows.filter((r) => r.status !== 'archived').length
  // The rubric's live point total — the section head reads it while typing.
  const rubricTotal = draft.rubric.reduce((s, r) => s + (r.points ?? 0), 0)

  return (
    <div className="programs-page curriculum-view grasps26-page">
      {/* ---- hero ---- */}
      <div className="program-hero g26-hero">
        <div className="program-hero__left">
          <div className="program-hero__icon">G</div>
          <div className="program-hero__titles">
            <span className="g26-kicker">Performance task builder</span>
            <h2>Generate GRASPS</h2>
            <p>Build a clear, outcomes-aligned performance task using the six GRASPS components.</p>
          </div>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGuideOpen(true)}>
          <Icon name="book" size={13} /> GRASPS Guide
        </button>
      </div>

      {/* ---- task setup ---- */}
      <section className="panel g26-setup no-print">
        <div className="g26-setup__head">
          <h3>Task setup</h3>
          <p>Start by identifying the course and assessment period.</p>
        </div>
        <div className="g26-setup__card">
          <span className="g26-setup__tag">Draft workspace</span>
          <div className="g26-setup__grid">
            <label className="field">
              <span>Program *</span>
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
              <span>Course title *</span>
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
          </div>
          <div className="g26-setup__grid" style={{ gridTemplateColumns: '1.4fr 1fr 1fr' }}>
            <div className="field">
              <span>Performance task for</span>
              <div className="clo26-viewtabs" role="tablist" aria-label="Grading period">
                {taskTypeOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`clo26-tab${draft.taskType === opt ? ' active' : ''}`}
                    onClick={() => patchDraft({ taskType: opt })}
                    disabled={!ready}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
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
              <span>School year</span>
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
          <div className="tos-savestate" role="status">
            {error ? (
              <span className="tos-savestate__error">{error}</span>
            ) : loading ? (
              <span>Loading…</span>
            ) : saving ? (
              <span>Saving…</span>
            ) : dirty ? (
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
      </section>

      {/* ---- the six components ---- */}
      <section className="panel g26-partspanel no-print">
        <div className="g26-sectionhead">
          <div>
            <span className="g26-kicker">The six components</span>
            <h3>Build your performance task</h3>
            <p>Complete each section to create a meaningful real-world learning experience.</p>
          </div>
          <div className="g26-progress">
            <strong>{pct}%</strong>
            <span>{draftFilled} of {GRASPS_PARTS.length} components completed</span>
          </div>
        </div>
        <div className="g26-parts">
          {GRASPS_PARTS.map((p) => {
            const done = draft[p.key].trim() !== ''
            return (
              <div key={p.key} className={`g26-part${done ? ' g26-part--done' : ''}`}>
                <div className="g26-part__head">
                  <span className="g26-part__badge" aria-hidden="true">{p.letter}</span>
                  <div className="g26-part__titles">
                    <h4>{p.label}</h4>
                    <span className="g26-part__q">{p.question}</span>
                  </div>
                  <span className="g26-part__dot" aria-hidden="true">{done ? '●' : '○'}</span>
                </div>
                <p className="g26-part__hint">{p.hint}</p>
                <p className="g26-part__tip">{p.tip}</p>
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
                <span className="g26-part__count">{draft[p.key].trim().length} characters</span>
                {p.key === 'standards' && (
                  <div className="g26-rubric">
                    {/* The Standards component's companion: criteria scored across
                        the four performance levels, saved with the task (034) and
                        printed on the Word export — inside the card, directly
                        under its textarea. */}
              <div className="g26-rubric__head">
                <h4>Analytic Rubric ({rubricTotal} points)</h4>
                <button type="button" className="btn btn--ghost btn--sm" onClick={addRubricRow} disabled={!ready}>
                  <Icon name="plus" size={13} /> Add criterion
                </button>
              </div>
              <div className="g26-rubric__scroll">
                <table className="g26-rubric__table">
                  <thead>
                    <tr>
                      <th>Criteria</th>
                      <th>Excellent (4)</th>
                      <th>Proficient (3)</th>
                      <th>Developing (2)</th>
                      <th>Beginning (1)</th>
                      <th>Points</th>
                      <th aria-label="Remove criterion" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.rubric.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <textarea
                            className="g26-rubric__input g26-rubric__input--name"
                            rows={1}
                            ref={autoResize}
                            value={r.criteria}
                            placeholder="e.g. Sketch Wireframes"
                            disabled={!ready}
                            onChange={(e) => {
                              patchRubricRow(i, { criteria: e.target.value })
                              autoResize(e.currentTarget)
                            }}
                          />
                        </td>
                        <td>
                          <textarea
                            className="g26-rubric__input"
                            rows={1}
                            ref={autoResize}
                            value={r.excellent}
                            placeholder="Descriptor…"
                            disabled={!ready}
                            onChange={(e) => {
                              patchRubricRow(i, { excellent: e.target.value })
                              autoResize(e.currentTarget)
                            }}
                          />
                        </td>
                        <td>
                          <textarea
                            className="g26-rubric__input"
                            rows={1}
                            ref={autoResize}
                            value={r.proficient}
                            placeholder="Descriptor…"
                            disabled={!ready}
                            onChange={(e) => {
                              patchRubricRow(i, { proficient: e.target.value })
                              autoResize(e.currentTarget)
                            }}
                          />
                        </td>
                        <td>
                          <textarea
                            className="g26-rubric__input"
                            rows={1}
                            ref={autoResize}
                            value={r.developing}
                            placeholder="Descriptor…"
                            disabled={!ready}
                            onChange={(e) => {
                              patchRubricRow(i, { developing: e.target.value })
                              autoResize(e.currentTarget)
                            }}
                          />
                        </td>
                        <td>
                          <textarea
                            className="g26-rubric__input"
                            rows={1}
                            ref={autoResize}
                            value={r.beginning}
                            placeholder="Descriptor…"
                            disabled={!ready}
                            onChange={(e) => {
                              patchRubricRow(i, { beginning: e.target.value })
                              autoResize(e.currentTarget)
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="g26-rubric__input g26-rubric__input--pts"
                            type="text"
                            inputMode="numeric"
                            value={r.points ?? 0}
                                                        disabled={!ready}
                            onChange={(e) => patchRubricRow(i, { points: e.target.value === '' ? null : Number(e.target.value.replace(/D/g, '')) })}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="g26-rubric__remove"
                            aria-label={`Remove criterion ${i + 1}`}
                            title="Remove this criterion"
                            onClick={() => removeRubricRow(i)}
                            disabled={!ready}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draft.rubric.length === 0 && (
                <p className="g26-rubric__empty">
                  No criteria yet — add a criterion to build the rubric the task is scored against.
                </p>
              )}
            </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="g26-draftnote">Your work is saved as a local draft while you type.</p>
        <div className="g26-actions">
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
              {draft.id ? 'Close edit' : 'Clear draft'}
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
            {saving ? 'Saving…' : draft.id ? 'Save changes →' : 'Save GRASPS task →'}
          </button>
        </div>
      </section>

      {/* ---- saved tasks ----
          The panel is the visible proof that a save landed. It re-reads itself
          after every save rather than assuming success, so what is listed is
          what is actually in the database. Cards file oldest first, so each
          new task appends at the bottom. Last on the page, below the editor it
          describes: the editor is the thing you came here to use, and the list
          is a record of what you have used. */}
      <section className="panel g26-library no-print">
        <div className="g26-sectionhead">
          <div>
            <span className="g26-kicker">Your workspace</span>
            <h3>Saved GRASPS tasks</h3>
            <p>Review and continue working on your previously created performance tasks.</p>
          </div>
          <div className="clo26-viewtabs" role="tablist" aria-label="Status view">
            <button
              type="button"
              className={`clo26-tab${!archived ? ' active' : ''}`}
              onClick={() => setArchived(false)}
            >
              Active{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
            <button
              type="button"
              className={`clo26-tab${archived ? ' active' : ''}`}
              onClick={() => setArchived(true)}
            >
              Archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
            </button>
          </div>
        </div>

        <div className="clo26-list">
          {visibleRows.length === 0 && (
            <div className="clo26-empty">
              {archived ? 'No archived tasks yet.' : 'No saved GRASPS tasks yet.'}
              <span style={{ display: 'block', marginTop: 4 }}>
                {archived
                  ? 'Archived tasks stay here — nothing is deleted.'
                  : 'Fill in the task above and press Save.'}
              </span>
            </div>
          )}

          {visibleRows.map((row) => (
            <article
              key={row.id}
              className={`clo26-course ${row.status === 'archived' ? 'clo26-course--archived' : ''}`}
            >
              <div className="po26-head">
                <div className="clo26-code">{row.code || 'GRASPS'}</div>
                <div className="po26-info">
                  <strong>{row.title || 'No course title yet'}</strong>
                  <small>
                    {row.semester || row.school_year
                      ? composeTerm(row.semester ?? '', row.school_year ?? '')
                      : row.term || 'No semester set'}
                  </small>
                  <small className="tos-card__doctitle">{docTitle(row.task_type)}</small>
                </div>
                <div className="clo26-meta">
                  <span className="clo26-count">
                    {filledCount(row)} of {PART_KEYS.length} written
                  </span>
                  <span className={`clo26-status${row.status === 'archived' ? ' clo26-status--archived' : ''}`}>{row.status === 'archived' ? 'Archived' : 'Active'}</span>
                </div>
              </div>
              <div className="po26-actions">
                <button type="button" onClick={() => editRow(row)}
                  aria-label={`Edit ${row.code || row.title || 'task'}`}>
                  Edit
                </button>
                <button type="button" onClick={() => void exportRow(row)}
                  aria-label={`Download ${row.code || row.title || 'task'} as Word`}>
                  Download
                </button>
                <button type="button" onClick={() => void setRowStatus(row.id, row.status === 'archived' ? 'active' : 'archived')}>
                  {row.status === 'archived' ? 'Restore' : 'Archive'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---- quick reference ---- */}
      {guideOpen && (
        <div
          className="g26-guide"
          role="dialog"
          aria-modal="true"
          aria-label="GRASPS quick reference"
          onClick={() => setGuideOpen(false)}
        >
          <div className="g26-guide__panel" onClick={(e) => e.stopPropagation()}>
            <div className="g26-guide__bar">
              <div>
                <span className="g26-kicker">Quick reference</span>
                <h3>Understanding GRASPS</h3>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGuideOpen(false)}>
                <Icon name="x" size={13} /> Close
              </button>
            </div>
            <p className="g26-guide__intro">
              Use the six components to frame an authentic performance task with a clear
              purpose and measurable expectations.
            </p>
            <ul className="g26-guide__list">
              {GRASPS_PARTS.map((p) => (
                <li key={p.key}>
                  <span className="g26-part__badge g26-part__badge--sm" aria-hidden="true">{p.letter}</span>
                  <div>
                    <strong>{p.letter} · {p.label}</strong>
                    <span>{p.guide}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
