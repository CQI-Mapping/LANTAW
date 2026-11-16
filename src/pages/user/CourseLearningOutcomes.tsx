// User Course Learning Outcomes: standalone CRUD for CLO records
// (admin_course_learning_outcomes table). Code + Description + Program Outcomes;
// the program-outcomes string is stored in the `title` column.
// Owned by the `user` role — the admin no longer has this page.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useEntityCrud } from '../admin/curriculum/useEntityCrud.js'
import Icon from '../../components/icons'
import {
  fetchCourseLearningOutcomesStandalone,
  createCourseLearningOutcomeStandalone,
  updateCourseLearningOutcomeStandalone,
  deleteCourseLearningOutcomeStandalone,
  fetchProgramOutcomesStandalone,
  fetchProgramEducationalObjectives,
  fetchStrategicGoals,
  fetchChedMemoOrders,
  fetchPoFeedback,
  recordPoFeedback,
  fetchCourses,
  fetchActivityLogs,
} from '../../services/database'
import type {
  CourseLearningOutcomeStandalone,
  Course,
  PoFeedback,
  ProgramOutcomeStandalone,
  ProgramEducationalObjective,
  StrategicGoal,
  ChedMemoOrder,
  ActivityLogEntry,
} from '../../services/database'
import { labelAction } from '../admin/ActivityLabels'
import SuggestionInput, { type SuggestionOption } from '../../components/SuggestionInput'
import { rankClosestPos, realContentTokens, type PoText, type RankedPo } from '../../utils/poMatch'
import { rankSemantic, preloadSemantic } from '../../utils/poSemantic'
import { fuseRanked } from '../../utils/poRank'
import { pickedBefore, recordPick, recordRejection, draftSig } from '../../utils/poMemory'
import SyllabusReport from '../../components/SyllabusReport'
import { splitReportPos, buildGroups, outcomeCodeKey, type PoGroup } from '../../utils/report'
import { normalizeCode, cloLabel, cloMatchesSubject } from '../../utils/courseCodes'
import { downloadSyllabusPdf } from '../../utils/syllabusPdf'
import { reportFileName } from '../../utils/download'

const EMPTY = { code: '', course: '', description: '', programOutcomes: '' }

// Semester tab labels for the category row — the same terms the create
// form's Semester filter offers (1st, 2nd, Summer).
const SEM_LABELS: Record<string, string> = { '1': '1st Sem', '2': '2nd Sem', '3': 'Summer' }
const YEAR_LABELS: Record<string, string> = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' }

// Raw reference lists the syllabus document is built from. The CLO page
// already loads all of them for its suggestion machinery, so the reader
// just reuses that fetch instead of querying again.
interface SyllabusSource {
  pos: ProgramOutcomeStandalone[]
  goals: StrategicGoal[]
  peos: ProgramEducationalObjective[]
  cmos: ChedMemoOrder[]
}

const toSuggestion = (i: { code: string; title: string }): SuggestionOption => ({
  value: i.code,
  label: `${i.code} - ${i.title}`.trim(),
})

export default function CourseLearningOutcomes({ userEmail }: { userEmail: string }) {
  const crud = useEntityCrud<CourseLearningOutcomeStandalone>({
    loadFn: fetchCourseLearningOutcomesStandalone,
    createFn: createCourseLearningOutcomeStandalone,
    updateFn: updateCourseLearningOutcomeStandalone,
    deleteFn: deleteCourseLearningOutcomeStandalone,
    scope: 'Course Learning Outcome',
  })
  const { items, loading, error, message, busy, handleCreate, handleUpdate, handleToggleStatus, handleDelete } = crud

  const [poSuggestions, setPoSuggestions] = useState<SuggestionOption[]>([])
  const [poTexts, setPoTexts] = useState<PoText[]>([])
  // Right-side reference: the CURRICULUM MAPPING outcomes (manager-sourced
  // rows in the two official CMO categories), grouped as the syllabus
  // document prints them. Outcomes only — no PEOs, no Strategic Goals.
  const [mappingGroups, setMappingGroups] = useState<PoGroup[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editForm, setEditForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Status view: the prototype's segmented tabs — Active / All / Archived.
  const [listTab, setListTab] = useState<'Active' | 'All' | 'Archived'>('Active')
  // The course accordion open in the list ('' = all collapsed).
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null)
  // Year and semester category filters ('' = all). The dropdowns trail the
  // Active/Archive pair; picking one leaves the archived view and filters
  // the active list, and the status buttons reset both.
  const [yearCat, setYearCat] = useState('')
  const [semCat, setSemCat] = useState('')
  const [query, setQuery] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  // Bumps to re-render fused lists after local reject/memory writes.
  const [memTick, setMemTick] = useState(0)
  // ✕ hides the chip immediately for this page session — rejection memory
  // still demotes it for later drafts (poRank fusion reads it). Keyed per
  // form ("create"/"edit") so each form's list tracks independently.
  const [hiddenPos, setHiddenPos] = useState<Record<string, boolean>>({})
  // Course syllabus reader: the card's eye button opens the linked subject's
  // full syllabus document — the same printable report Generate Map
  // renders, in a scrollable overlay with PDF / Word downloads.
  const [viewClo, setViewClo] = useState<CourseLearningOutcomeStandalone | null>(null)
  const [viewBusy, setViewBusy] = useState(false)
  const [readerError, setReaderError] = useState<string | null>(null)
  // Auto-fill guards: draft text already auto-applied (or dismissed) per form.
  const autoCreateFor = useRef<string | null>(null)
  const autoEditFor = useRef<string | null>(null)
  // Raw reference lists for the syllabus reader, captured once on mount so
  // opening the reader never refetches.
  const reportData = useRef<SyllabusSource | null>(null)
  // PDF export snapshot target — the document root inside the overlay.
  const viewReportRef = useRef<HTMLDivElement>(null)
  // Shared pick/reject log for curation (manager/admin readable; null = hidden).
  const [feedback, setFeedback] = useState<PoFeedback[] | null>(null)
  // Semantic (MPNet via Transformers.js v4) re-rank, frontend-only.
  // Null = model not loaded / failed — the keyword-only floor keeps suggesting.
  const [createSemantic, setCreateSemantic] = useState<RankedPo[] | null>(null)
  const [editSemantic, setEditSemantic] = useState<RankedPo[] | null>(null)

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const isActive = (i: CourseLearningOutcomeStandalone) => !i.status || i.status === 'active'
  // A CLO's place in the curriculum — its year and term — comes from its
  // subject record: the row stores only the course code, resolved leniently
  // the same way the syllabus reader does. Rows whose course text matches
  // nothing belong to no year and no term: they stay in Active and Archive,
  // but neither dropdown claims them.
  const courseSemOf = (i: CourseLearningOutcomeStandalone) => {
    const c = courses.find((x) => cloMatchesSubject(i.course || '', normalizeCode(x.code)))
    return c ? String(c.semester ?? '').trim() : ''
  }
  const courseYearOf = (i: CourseLearningOutcomeStandalone) => {
    const c = courses.find((x) => cloMatchesSubject(i.course || '', normalizeCode(x.code)))
    return c ? String(c.year_level ?? '').trim() : ''
  }
  const q = query.trim().toLowerCase()

  // The manager's assignment is the gate: the faculty member writes CLOs
  // only for subjects handed to them (courses.instructor_id). The embedded
  // join resolves the instructor's email — the identity this page knows.
  // Strict null check: instructor_id is null on unassigned subjects, and
  // typeof null === 'object' would otherwise count every unassigned
  // subject as the faculty member's own.
  const myCourses = useMemo(
    () =>
      courses.filter(
        (c) =>
          c.instructor_id !== null &&
          typeof c.instructor_id === 'object' &&
          c.instructor_id.email === userEmail,
      ),
    [courses, userEmail],
  )

  // The prototype's course-grouped list: one accordion per assigned
  // subject, holding the CLO rows that survive the filters (status tab,
  // the subject's own year/term, and the search across code/title/rows).
  const groups = useMemo(
    () =>
      myCourses.map((course) => {
        const rows = items
          .filter((i) => cloMatchesSubject(i.course || '', normalizeCode(course.code)))
          .filter((i) => (listTab === 'All' ? true : listTab === 'Archived' ? !isActive(i) : isActive(i)))
          .filter((i) => yearCat === '' || String(course.year_level ?? '') === yearCat)
          .filter((i) => semCat === '' || String(course.semester ?? '') === semCat)
          .filter(
            (i) =>
              !q ||
              [course.code, course.title, i.code, i.description, i.title].some(
                (v) => (v || '').toLowerCase().includes(q),
              ),
          )
          .sort((a, b) => (Number(a.code) || 0) - (Number(b.code) || 0))
        return { course, rows }
      }),
    [myCourses, items, listTab, yearCat, semCat, q],
  )
  // A subject stays on the page while it has matching rows — or, when not
  // searching and not on the Archived tab, as an empty group with its own
  // dashed "Add a CLO" invitation (the prototype's behavior).
  const shownGroups = groups.filter(
    (g) => g.rows.length > 0 || (!q && listTab !== 'Archived'),
  )
  const shownRowCount = shownGroups.reduce((n, g) => n + g.rows.length, 0)
  const archivedCount = items.filter((i) => !isActive(i)).length

  // Year and semester dropdown options trailing the Active/Archive pair —
  // one option per year or term the curriculum actually uses, so nothing
  // unused is ever listed. Counts respect the sibling dropdown (slicer
  // rule): semester counts live inside the chosen year, year counts inside
  // the chosen term.
  const semOptions = useMemo(
    () =>
      [...new Set(courses.map((c) => String(c.semester ?? '').trim()).filter(Boolean))]
        .sort()
        .map((s) => ({ value: s, label: SEM_LABELS[s] ?? `Sem ${s}` })),
    [courses],
  )
  const yearOptions = useMemo(
    () =>
      [...new Set(courses.map((c) => String(c.year_level ?? '').trim()).filter(Boolean))]
        .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
        .map((y) => ({ value: y, label: YEAR_LABELS[y] ?? `Year ${y}` })),
    [courses],
  )
  const semCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      if (!isActive(i)) continue
      if (yearCat !== '' && courseYearOf(i) !== yearCat) continue
      const s = courseSemOf(i)
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return counts
  }, [items, courses, yearCat])
  const yearCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      if (!isActive(i)) continue
      if (semCat !== '' && courseSemOf(i) !== semCat) continue
      const y = courseYearOf(i)
      if (y) counts.set(y, (counts.get(y) ?? 0) + 1)
    }
    return counts
  }, [items, courses, semCat])

  // The empty-state scope label: the picks in both dropdowns, e.g.
  // "1st Year · 1st Sem".
  // Year and term labels for a course row's meta line.
  const courseTermLabel = (c: Course) => {
    const y = String(c.year_level ?? '')
    const s = String(c.semester ?? '')
    const yLabel = y ? (YEAR_LABELS[y] ?? `Year ${y}`) : ''
    const sLabel = s ? (SEM_LABELS[s] ?? `Sem ${s}`) : ''
    return [yLabel, sLabel].filter(Boolean).join(' · ') || '—'
  }

  // ── Syllabus reader ──────────────────────────────────────────────────
  // The opened CLO resolves to its subject by lenient course-code matching
  // (the same rule View/Generate Map use), and the document renders from
  // the lists captured on mount — no extra queries when opening.
  const readerSource = reportData.current
  const readerCourse = (() => {
    if (!viewClo) return null
    const text = viewClo.course || ''
    return courses.find((c) => cloMatchesSubject(text, normalizeCode(c.code))) ?? null
  })()
  const readerClos = readerCourse
    ? items.filter((i) => isActive(i) && cloMatchesSubject(i.course || '', normalizeCode(readerCourse.code)))
    : []
  const { adminPos, managerPos } = splitReportPos(readerSource?.pos ?? [])
  const readerAdminGroups = buildGroups(adminPos, readerSource?.cmos ?? [])
  const readerManagerGroups = buildGroups(managerPos, readerSource?.cmos ?? [])

  const openReader = (item: CourseLearningOutcomeStandalone) => {
    setReaderError(null)
    setViewClo(item)
  }

  // Save the open subject's syllabus. PDF rasterises the rendered document;
  // the Word export rebuilds from data alone and loads lazily (~450kB).
  const downloadReader = async (fmt: 'pdf' | 'docx') => {
    if (!readerCourse) return
    setViewBusy(true)
    setReaderError(null)
    try {
      if (fmt === 'pdf') {
        if (!viewReportRef.current) throw new Error('The document is not ready yet.')
        await downloadSyllabusPdf(viewReportRef.current, reportFileName(readerCourse.code, 'pdf'), 'landscape')
      } else {
        const { downloadSyllabusDocx } = await import('../../utils/syllabusDocx')
        await downloadSyllabusDocx(
          {
            course: readerCourse,
            courses,
            goals: readerSource?.goals ?? [],
            peos: readerSource?.peos ?? [],
            adminGroups: readerAdminGroups,
            managerGroups: readerManagerGroups,
            subjectClos: readerClos,
          },
          'landscape',
        )
      }
    } catch (e) {
      setReaderError(e instanceof Error ? e.message : 'Could not create the file.')
    } finally {
      setViewBusy(false)
    }
  }

  // Escape closes the reader.
  useEffect(() => {
    if (!viewClo) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewClo(null) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [viewClo])

  useEffect(() => { crud.load() }, [crud.load])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pos, peos, sgs, cmos] = await Promise.all([
          fetchProgramOutcomesStandalone(),
          fetchProgramEducationalObjectives().catch(() => []),
          fetchStrategicGoals().catch(() => []),
          fetchChedMemoOrders().catch(() => []),
        ])
        const active = pos.filter((p) => !p.status || p.status === 'active')
        // PO-1…PO-4 first, then SD-1…SD-13, numeric within each family —
        // the official CMO 25 s. 2015 list seeds both families, so a
        // plain numeric or alphabetical key would misorder SD-10 vs SD-2.
        active.sort((a, b) => outcomeCodeKey(a.code || '').localeCompare(outcomeCodeKey(b.code || '')))
        // Keep the raw reference lists for the syllabus reader overlay.
        if (!cancelled) {
          reportData.current = {
            pos: active,
            goals: sgs.filter((s) => !s.status || s.status === 'active'),
            peos: peos.filter((p) => !p.status || p.status === 'active'),
            cmos: cmos.filter((m) => !m.status || m.status === 'active'),
          }
        }
        // Enrich thin POs with linked PEO/SG/CMO text so they can still match.
        const peoByCode = new Map(peos.map((p) => [p.code.trim().toLowerCase(), p.title ?? '']))
        const sgByCode = new Map(sgs.map((s) => [s.code.trim().toLowerCase(), s.description ?? '']))
        const cmoById = new Map(cmos.map((c) => [c.id, `${c.title ?? ''} ${c.code ?? ''}`.trim()]))
        const splitCodes = (v: string | null) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        // Right-side reference: the CURRICULUM MAPPING outcomes — manager
        // rows in the two official CMO categories, grouped and ordered
        // exactly as the syllabus document prints them (outcomes only).
        const { managerPos: mappingPos } = splitReportPos(active)
        const activeCmos = cmos.filter((m) => !m.status || m.status === 'active')
        if (!cancelled) setMappingGroups(buildGroups(mappingPos, activeCmos))
        // Suggestions are the Curriculum Mapping outcomes and nothing else —
        // the same rows the panel beside the form prints, so the chips can
        // never offer an outcome the faculty member cannot see in the
        // reference. Manager rows outside the two official CMO categories are
        // left out on both sides by splitReportPos.
        if (!cancelled) setPoSuggestions(mappingPos.map(toSuggestion))
        if (!cancelled) setPoTexts(mappingPos.map((p) => {
          const rec = p as { description?: string | null; cmo_id?: string | null; peo_text?: string | null; sg_text?: string | null }
          const peoTitles = splitCodes(rec.peo_text ?? null).map((c) => peoByCode.get(c.toLowerCase()) ?? '').filter(Boolean)
          const sgDescs = splitCodes(rec.sg_text ?? null).map((c) => sgByCode.get(c.toLowerCase()) ?? '').filter(Boolean)
          const cmoText = (rec.cmo_id && cmoById.get(rec.cmo_id)) || ''
          const extra = [...peoTitles, ...sgDescs, cmoText].filter(Boolean).join(' | ') || null
          return { code: p.code, title: p.title, description: rec.description ?? null, extra }
        }))
      } catch {
        // suggestions are optional; leave the list empty on failure
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchPoFeedback()
      .then((rows) => { if (!cancelled) setFeedback(rows) })
      .catch(() => { if (!cancelled) setFeedback(null) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cs = await fetchCourses()
        // Only active courses, sorted by code for dropdown
        const active = cs.filter((c) => !c.status || c.status === 'active')
        active.sort((a, b) => String(a.code).localeCompare(String(b.code)))
        if (!cancelled) setCourses(active)
      } catch {
        // course list optional; leave empty on failure
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Modification history: the clo.* audit trail for the assigned subjects —
  // including the actions of whoever handled a subject before the manager
  // handed it over. RLS (027) returns exactly that subset; null = loading,
  // [] = read failed or nothing visible.
  const [history, setHistory] = useState<ActivityLogEntry[] | null>(null)

  // The trail loads against the assigned pool (RLS scopes it on the
  // server too), so it refires once the assignments are known.
  useEffect(() => {
    let cancelled = false
    fetchActivityLogs({ limit: 200 })
      .then((rows) => {
        if (cancelled) return
        const assignedCodes = new Set(myCourses.map((c) => normalizeCode(c.code)))
        setHistory(
          rows.filter(
            (r) =>
              r.action?.startsWith('clo.')
              && assignedCodes.has(normalizeCode(r.details?.course || '')),
          ),
        )
      })
      .catch(() => { if (!cancelled) setHistory([]) })
    return () => { cancelled = true }
  }, [myCourses])

  // CLO codes are numbers only — the stored code is the bare digit run.
  // Stripping non-digits at every input and at payload time keeps legacy
  // lettered codes ("Clo1", "CLO-1") from being re-saved.
  const digitsOnly = (v: string) => v.replace(/\D/g, '')

  const outPayload = (f: typeof EMPTY) => ({
    code: digitsOnly(f.code),
    course: f.course.trim(),
    title: f.programOutcomes.trim(),
    description: f.description.trim() || null,
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (await handleCreate(outPayload(form), 'clo.created', { code: digitsOnly(form.code), course: form.course.trim() })) {
      setForm(EMPTY)
      autoCreateFor.current = null
    }
  }

  const startEdit = (i: CourseLearningOutcomeStandalone) => {
    setEditingId(i.id)
    autoEditFor.current = null
    setEditForm({ code: digitsOnly(i.code), course: i.course || '', description: i.description || '', programOutcomes: i.title || '' })
  }

  const saveEdit = async () => {
    const target = editingId ? items.find((i) => i.id === editingId) : undefined
    if (await handleUpdate(editingId, outPayload(editForm), 'clo.updated', target)) setEditingId(null)
  }

  // Bulk align: fused top-1 for the visible filtered CLOs with empty PO.
  const flatRows = groups.flatMap((g) => g.rows)
  const bulkTargets = flatRows.filter((i) => !(i.title ?? '').trim() && (i.description ?? '').trim())
    .map((i) => {
      const raw = i.description ?? ''
      // Same real-word floor as the interactive chips — bulk never applies a
      // suggestion to a description that is too short or letter salad.
      const [top] = suggestable(raw)
        ? fuseRanked(raw, rankClosestPos(raw, poTexts, Math.max(1, poTexts.length)), null, poTexts, 1)
        : []
      return { item: i, top }
    })
    .filter((t) => t.top && t.top.score > 0)

  const bulkApply = async () => {
    if (bulkTargets.length === 0 || bulkBusy || editingId !== null) return
    if (!window.confirm(`Apply top suggestion to ${bulkTargets.length} empty CLO${bulkTargets.length === 1 ? '' : 's'}?`)) return
    setBulkBusy(true)
    try {
      for (const t of bulkTargets) {
        await handleUpdate(t.item.id, { title: t.top.code }, 'clo.updated', t.item)
      }
    } finally {
      setBulkBusy(false)
    }
  }

  // Shared + local pick/reject logging for curation (fire-and-forget server).
  const logPick = (draft: string, code: string) => {
    recordPick(draft, code)
    const sig = draftSig(draft)
    if (sig) void recordPoFeedback(sig, code, 'picked')
    setMemTick((t) => t + 1)
  }
  const logReject = (draft: string, formKey: 'create' | 'edit', code: string) => {
    recordRejection(draft, code)
    const sig = draftSig(draft)
    if (sig) void recordPoFeedback(sig, code, 'rejected')
    setHiddenPos((h) => ({ ...h, [`${formKey}:${code}`]: true }))
    setMemTick((t) => t + 1)
  }

  // Closest-PO suggestions: rank POs by word overlap with the typed description.
  // Clicking a suggestion appends its code to the Program Outcomes field.
  const appendPo = (current: string, code: string) => {
    const parts = current.split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.some((p) => p.toLowerCase() === code.toLowerCase())) parts.push(code)
    return parts.join(', ')
  }

  // Suggestions wait for real content: short drafts score trivia in the
  // keyword ranker, so nothing renders — chips or the no-match hint — until
  // the description reaches DRAFT_MIN characters. The semantic engine
  // shares this floor.
  const DRAFT_MIN = 35
  // A second, stricter floor: the semantic engine scores similarity for ANY
  // text, so letter salad ("sdasdsdfsjdv…", "adhiucsfviurhvusvnseic") used to
  // squeeze out chips at full length. Suggestions only compute when the draft
  // carries at least MIN_REAL_WORDS English-shaped tokens (utils/poMatch.ts
  // realContentTokens); salad gets its own honest hint instead of fake scores.
  const MIN_REAL_WORDS = 2
  const suggestable = (draft: string) =>
    draft.trim().length >= DRAFT_MIN && realContentTokens(draft).length >= MIN_REAL_WORDS
  const mushy = (draft: string) =>
    draft.trim().length >= DRAFT_MIN && realContentTokens(draft).length < MIN_REAL_WORDS
  const MUSH_HINT =
    'The description is mostly random letters — write the outcome in plain English (e.g. "Design and implement a secure login module").'
  const createClosest = suggestable(form.description)
    ? rankClosestPos(form.description, poTexts, Math.max(3, poTexts.length))
    : []
  const editClosest = suggestable(editForm.description)
    ? rankClosestPos(editForm.description, poTexts, Math.max(3, poTexts.length))
    : []
  // Hybrid fusion: keyword + semantic + exact-phrase + Bloom + click memory.
  // memTick re-runs fusion after local reject/memory writes (read sync).
  void memTick
  // Rejected chips leave the filtered list before rendering — remove them
  // all and the row falls back to the no-match hint. Chips show just the PO
  // code (the b05 style): no bar, no body text. Auto-fill reads the same
  // filtered lists, so a removed chip never auto-fills either.
  const createShown = fuseRanked(form.description, createClosest, createSemantic, poTexts, 3)
    .filter((r) => !hiddenPos[`create:${r.code}`])
  const editShown = fuseRanked(editForm.description, editClosest, editSemantic, poTexts, 3)
    .filter((r) => !hiddenPos[`edit:${r.code}`])
  const createDisplay = createShown
  const editDisplay = editShown

  // Warm the semantic model in the background once the page settles, so by
  // the time faculty type a description the premium re-rank is already live.
  // The model loads silently — no progress banner, faculty just see the
  // suggestions improve.
  useEffect(() => {
    const t = setTimeout(() => preloadSemantic(), 1200)
    return () => clearTimeout(t)
  }, [])

  // Debounced semantic re-rank for the create-form description.
  useEffect(() => {
    const draft = form.description.trim()
    if (!suggestable(draft) || poTexts.length === 0) { setCreateSemantic(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      rankSemantic(draft, poTexts, 3).then((res) => {
        if (cancelled) return
        setCreateSemantic(res && res.ranked.length > 0 ? res.ranked : null)
      })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.description, poTexts])

  // Debounced semantic re-rank for the edit-form description.
  useEffect(() => {
    const draft = editForm.description.trim()
    if (editingId === null || !suggestable(draft) || poTexts.length === 0) { setEditSemantic(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      rankSemantic(draft, poTexts, 3).then((res) => {
        if (cancelled) return
        setEditSemantic(res && res.ranked.length > 0 ? res.ranked : null)
      })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [editForm.description, poTexts, editingId])

  // Top-1 auto-fill: score ≥85 with a ≥20 gap over #2 auto-fills an empty PO
  // field once per draft, with an Undo chip to revert.
  const autoFillGap = (shown: RankedPo[]) =>
    shown.length <= 1 ? 100 : shown[0].score - shown[1].score
  useEffect(() => {
    const draft = form.description
    if (!draft.trim() || form.programOutcomes.trim() || autoCreateFor.current === draft) return
    if (createShown.length === 0 || createShown[0].score < 85 || autoFillGap(createShown) < 20) return
    autoCreateFor.current = draft
    setForm((f) => (f.programOutcomes.trim() ? f : { ...f, programOutcomes: createShown[0].code }))
  }, [form.description, form.programOutcomes, createShown])
  useEffect(() => {
    const draft = editForm.description
    if (editingId === null || !draft.trim() || editForm.programOutcomes.trim() || autoEditFor.current === draft) return
    if (editShown.length === 0 || editShown[0].score < 85 || autoFillGap(editShown) < 20) return
    autoEditFor.current = draft
    setEditForm((f) => (f.programOutcomes.trim() ? f : { ...f, programOutcomes: editShown[0].code }))
  }, [editForm.description, editForm.programOutcomes, editShown, editingId])

  const totalCount = items.length
  const activeCount = items.filter(isActive).length

  // Chosen-subject summary: the stored value is the course CODE, so the
  // human-readable name is resolved from the loaded course list for display
  // ("IT10 — Web Systems and Technologies"). Unresolved (deleted) codes
  // display the bare code.
  const courseTitleByCode = (code: string) => courses.find((c) => c.code === code)?.title || ''

  // Course list filters for the create form: Year and Semester sit on top of
  // the Course (Subject Code) picker and narrow its dropdown to the term the
  // faculty member is writing CLOs for. The pool is already the assigned
  // subjects only; the filters just trim it — never invalidating an
  // already-chosen course.
  const [courseYear, setCourseYear] = useState('')
  const [courseSem, setCourseSem] = useState('')
  const filteredCourses = useMemo(() => {
    if (courseYear === '' && courseSem === '') return myCourses
    return myCourses.filter(
      (c) =>
        (courseYear === '' || String(c.year_level ?? '') === courseYear)
        && (courseSem === '' || String(c.semester ?? '') === courseSem),
    )
  }, [myCourses, courseYear, courseSem])

  // Shared edit form used by both grid and list card styles. Wrapped in
  // .resource-card__edit so the fields stack: the list card is a flex ROW
  // (body + actions side by side), and without the wrapper the edit fields
  // become that row's children — picker, code, description, PO input and
  // the Save/Cancel pair all sprawling sideways across the card.
  const renderEdit = () => (
    <div className="resource-card__edit">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {editForm.course ? (
          <div className="input input--sm subject-picker__chosen">
            <span className="subject-picker__text">
              {editForm.course}{courseTitleByCode(editForm.course) ? ` — ${courseTitleByCode(editForm.course)}` : ''}
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditForm((f) => ({ ...f, course: '' }))}>
              Change
            </button>
          </div>
        ) : (
          <select className="input input--sm" value={editForm.course} onChange={(e) => setEditForm({ ...editForm, course: e.target.value })}>
            <option value="">Select course</option>
            {myCourses.map((c) => (
              <option key={c.id} value={c.code}>{c.code} — {c.title}</option>
            ))}
            {myCourses.length === 0 && (
              <option value="" disabled>No subjects assigned to you yet</option>
            )}
          </select>
        )}
        <div className="clo-code-input">
          <span className={`clo-code-input__prefix${editForm.code !== '' ? '' : ' clo-code-input__prefix--hidden'}`} aria-hidden="true">CLO</span>
          <input className="input input--sm clo-code-input__field" type="text" inputMode="numeric" value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: digitsOnly(e.target.value) })} placeholder="1" />
        </div>
      </div>
      <textarea className="input input--sm" rows={2} ref={autoResize} value={editForm.description} onChange={(e) => { setEditForm({ ...editForm, description: e.target.value }); autoResize(e.target) }} placeholder="Description" />
      <SuggestionInput value={editForm.programOutcomes} onChange={(v) => setEditForm({ ...editForm, programOutcomes: v })} options={poSuggestions} placeholder="Type to search POs" />
      {editDisplay.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', width: '100%' }}>
            Suggested POs for this draft.
          </span>
          {editDisplay.map((r) => (
            <span key={r.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <button type="button" className="btn btn--ghost btn--sm"
                title={r.label}
                onClick={() => { logPick(editForm.description, r.code); setEditForm((f) => ({ ...f, programOutcomes: appendPo(f.programOutcomes, r.code) })) }}>
                {r.code}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" title={`Remove this ${r.code} suggestion`}
                aria-label={`Remove the ${r.code} suggestion for this description`}
                onClick={() => logReject(editForm.description, 'edit', r.code)}>✕</button>
            </span>
          ))}
        </div>
      ) : editForm.description.trim().length >= DRAFT_MIN && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0' }}>
          {poTexts.length === 0
            ? 'No Curriculum Mapping outcomes yet — add them on the Program Outcomes page first.'
            : mushy(editForm.description)
              ? MUSH_HINT
              : 'No close match — try words like design, develop, evaluate, or pick manually above.'}
        </div>
      )}
      {autoEditFor.current === editForm.description && editForm.programOutcomes.trim() && (
        <div style={{ fontSize: 12, color: 'var(--primary-dark)', margin: '6px 0' }}>
          Auto-filled {editForm.programOutcomes.trim()} —{' '}
          <button type="button" className="btn btn--ghost btn--sm"
            onClick={() => {
              autoEditFor.current = `dismissed:${editForm.description}`
              setEditForm((f) => ({ ...f, programOutcomes: '' }))
            }}>
            Undo
          </button>
        </div>
      )}
                      <div className="program-card__actions">
                        <button className="btn btn--primary btn--sm" onClick={saveEdit} disabled={busy}><Icon name="check" size={13} /> Save</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
    </div>
  )

  return (
    <div className="programs-page curriculum-view">
      <div className="program-hero">
        <div className="program-hero__left">
          <div className="program-hero__icon">CLO</div>
          <div className="program-hero__titles">
            <h2>Course Learning Outcomes</h2>
            <p>Define CLOs per subject code and align them to Program Outcomes.</p>
          </div>
        </div>
      </div>

      <div className="program-stats">
        <div className="program-stat">
          <div className="program-stat__label">Total</div>
          <div className="program-stat__value">{totalCount}</div>
          <div className="program-stat__sub">All CLOs</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Active</div>
          <div className="program-stat__value" style={{ color: 'var(--primary)' }}>{activeCount}</div>
          <div className="program-stat__sub">Currently mapped</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Archived</div>
          <div className="program-stat__value" style={{ color: 'var(--text-muted)' }}>{archivedCount}</div>
          <div className="program-stat__sub">Hidden</div>
        </div>
      </div>

      {error && <p className="msg msg--error" role="alert">{error}</p>}
      {message && <p className="msg msg--success" role="status">{message}</p>}

      {/* The create form and the Curriculum Mapping reference form one
          same-height pair; the CLO list flows below at full width. */}
      <div className="clo-layout">
        <div className="clo-layout__main">
        <div className="clo-layout__pair">
      <form className="panel create-resource clo-create-panel" onSubmit={submit} style={{ borderTop: '3px solid var(--primary)' }}>
        <h3>New Course Learning Outcome</h3>
        {/* Year · Semester filters on top: two compact picks that narrow the
            Course dropdown below. "All years" / "All semesters" reset them;
            an already-chosen course is never invalidated by a change here. */}
        <div className="clo-form-filters">
          <label className="field">
            <span>Year</span>
            <select className="input input--sm" value={courseYear}
              onChange={(e) => setCourseYear(e.target.value)}>
              <option value="">All years</option>
              {[1, 2, 3, 4].map((y) => (
                <option key={y} value={y}>{['1st', '2nd', '3rd', '4th'][y - 1]} Year</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Semester</span>
            <select className="input input--sm" value={courseSem}
              onChange={(e) => setCourseSem(e.target.value)}>
              <option value="">All semesters</option>
              <option value="1">1st Sem</option>
              <option value="2">2nd Sem</option>
              <option value="3">Summer</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Course (Subject Code)</span>
          {/* Once a subject is chosen the picker collapses to a read-only
              summary, so only the selected course shows. "Change" reopens it. */}
          {form.course ? (
            <div className="input input--sm subject-picker__chosen">
              <span className="subject-picker__text">
                {form.course}{courseTitleByCode(form.course) ? ` — ${courseTitleByCode(form.course)}` : ''}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm((f) => ({ ...f, course: '' }))}>
                Change
              </button>
            </div>
          ) : (
            <select className="input input--sm" value={form.course}
              onChange={(e) => {
                const code = e.target.value
                setForm({ ...form, course: code })
                // Picking a subject directly auto-fills the Year/Semester
                // slicers from the subject's own placement, so they read as
                // the subject's term instead of leftover filters.
                const picked = myCourses.find((c) => c.code === code)
                setCourseYear(picked ? String(picked.year_level ?? '') : '')
                setCourseSem(picked ? String(picked.semester ?? '') : '')
              }} required>
              <option value="">Select course</option>
              {filteredCourses.map((c) => (
                <option key={c.id} value={c.code}>{c.code} — {c.title}</option>
              ))}
              {filteredCourses.length === 0 && (
                <option value="" disabled>
                  {myCourses.length === 0
                    ? 'No subjects assigned to you yet — the program head assigns them in Assign Faculty'
                    : courseYear || courseSem
                      ? 'No courses in this Year · Semester — change the filters or create the course in Course page first'
                      : 'No courses available — create one in Course page first'}
                </option>
              )}
            </select>
          )}
        </label>
        <label className="field">
          <span>CLO Code</span>
          <div className="clo-code-input">
            <span className={`clo-code-input__prefix${form.code !== '' ? '' : ' clo-code-input__prefix--hidden'}`} aria-hidden="true">CLO</span>
            <input className="input input--sm clo-code-input__field" type="text" inputMode="numeric" placeholder="1" value={form.code}
              onChange={(e) => setForm({ ...form, code: digitsOnly(e.target.value) })} required />
          </div>
        </label>
        <label className="field">
          <span>Description</span>
          <textarea className="input input--sm" rows={2} placeholder="e.g. Compare and contrast..." ref={autoResize}
            value={form.description}
            onChange={(e) => { setForm({ ...form, description: e.target.value }); autoResize(e.target) }} />
        </label>
        <label className="field">
          <span>Program Outcomes</span>
          <SuggestionInput
            value={form.programOutcomes}
            onChange={(v) => setForm({ ...form, programOutcomes: v })}
            options={poSuggestions}
            placeholder="Type to search POs"
          />
        </label>
        {createDisplay.length > 0 ? (
          <div className="field" style={{ marginTop: -4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Suggested POs for this draft.
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {createDisplay.map((r) => (
                <span key={r.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <button type="button" className="btn btn--ghost btn--sm"
                    title={r.label}
                    onClick={() => { logPick(form.description, r.code); setForm((f) => ({ ...f, programOutcomes: appendPo(f.programOutcomes, r.code) })) }}>
                    {r.code}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" title={`Remove this ${r.code} suggestion`}
                    aria-label={`Remove the ${r.code} suggestion for this description`}
                    onClick={() => logReject(form.description, 'create', r.code)}>✕</button>
                </span>
              ))}
            </div>
          </div>
        ) : form.description.trim().length >= DRAFT_MIN && (
          <div className="field" style={{ marginTop: -4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {poTexts.length === 0
                ? 'No Curriculum Mapping outcomes yet — add them on the Program Outcomes page first.'
                : mushy(form.description)
                  ? MUSH_HINT
                  : 'No close match — try words like design, develop, evaluate, or pick manually above.'}
            </span>
          </div>
        )}
        {autoCreateFor.current === form.description && form.programOutcomes.trim() && (
          <div className="field" style={{ marginTop: -4 }}>
            <span style={{ fontSize: 12, color: 'var(--primary-dark)' }}>
              Auto-filled {form.programOutcomes.trim()} —{' '}
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => {
                  autoCreateFor.current = `dismissed:${form.description}`
                  setForm((f) => ({ ...f, programOutcomes: '' }))
                }}>
                Undo
              </button>
            </span>
          </div>
        )}
        <div className="create-resource__submit">
          <button className="btn btn--primary btn--sm" type="submit" disabled={busy || myCourses.length === 0}>
            {busy ? 'Saving...' : (<><Icon name="plus" size={13} /> Add</>)}
          </button>
          {myCourses.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
              No subjects assigned to you yet — the program head assigns them in Assign Faculty.
            </span>
          )}
        </div>
      </form>

      {/* Right side of the pair: the CURRICULUM MAPPING outcomes as a writing
          reference. Numbered continuously across the CMO groups — the same
          run the syllabus document prints. Outcomes only: no Program
          Educational Objectives, no Strategic Goals. Positioned absolutely
          so the panel is exactly as tall as the form beside it; the list
          scrolls inside its own box. */}
      <aside className="panel clo-layout__ref" aria-label="Curriculum Mapping reference">
        {/* No panel title — the CMO group headings below speak for
            themselves; the screen space is better spent on the list. */}
        <div className="clo-layout__ref-scroll">
          {mappingGroups.length === 0 ? (
            <p className="clo-layout__ref-empty">No Curriculum Mapping outcomes yet — they come from the manager&rsquo;s Program Outcomes.</p>
          ) : (
            mappingGroups.map((group, gi) => {
              const rowBase = mappingGroups.slice(0, gi).reduce((n, prior) => n + prior.items.length, 0)
              return (
                <div key={group.heading} className="clo-layout__ref-group">
                  <p className="clo-layout__ref-head">{group.heading}</p>
                  {group.items.map((p, i) => (
                    <div key={p.id} className="clo-layout__ref-row">
                      <span className="clo-layout__ref-num">{rowBase + i + 1}.</span>
                      <span>{p.title.replace(/\.$/, '')}</span>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      </aside>
      </div>

      {loading ? (
        <div className="program-grid" style={{ marginTop: 8 }}>
          {[0,1,2].map((i)=> (
            <div key={i} className="program-card--2026" style={{ opacity: 0.6 }}>
              <div style={{ height: 12, background: 'var(--bg-soft)', borderRadius: 6, width: '40%' }} />
              <div style={{ height: 16, background: 'var(--bg-soft)', borderRadius: 6 }} />
              <div style={{ height: 40, background: 'var(--bg-soft)', borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="clo-2026">
          {/* Toolbar: search, the two slicers and the status tabs in one bar. */}
          <div className="clo26-toolbar">
            <div className="clo26-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20L15.5 15.5" /></svg>
              <input type="search" placeholder="Search course code, title, or CLO..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search CLOs" />
            </div>
            <select className="clo26-select" aria-label="Filter by year" value={yearCat}
              onChange={(e) => { setYearCat(e.target.value); if (e.target.value) setListTab('Active') }}>
              <option value="">All years</option>
              {yearOptions.map((y) => (
                <option key={y.value} value={y.value}>
                  {(yearCounts.get(y.value) ?? 0) > 0 ? `${y.label} (${yearCounts.get(y.value)})` : y.label}
                </option>
              ))}
            </select>
            <select className="clo26-select" aria-label="Filter by semester" value={semCat}
              onChange={(e) => { setSemCat(e.target.value); if (e.target.value) setListTab('Active') }}>
              <option value="">All semesters</option>
              {semOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {(semCounts.get(s.value) ?? 0) > 0 ? `${s.label} (${semCounts.get(s.value)})` : s.label}
                </option>
              ))}
            </select>
            {bulkTargets.length > 0 && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={bulkApply} disabled={busy || bulkBusy || editingId !== null}
                title="Fill each empty CLO below with its top suggestion">
                {bulkBusy ? 'Applying…' : `Apply top to ${bulkTargets.length} empty`}
              </button>
            )}
            <div className="clo26-viewtabs" role="tablist" aria-label="Status view">
              {(['Active', 'All', 'Archived'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={listTab === t}
                  className={`clo26-tab ${listTab === t ? 'active' : ''}`}
                  onClick={() => { setListTab(t); setYearCat(''); setSemCat('') }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {feedback !== null && feedback.length > 0 && (
            <details style={{ fontSize: 12, color: 'var(--text-muted)', margin: '-8px 0 14px' }}>
              <summary style={{ cursor: 'pointer' }}>Feedback log ({feedback.length})</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 2, maxHeight: 120, overflowY: 'auto' }}>
                {feedback.slice(0, 20).map((f) => (
                  <li key={f.id}>
                    <strong>{f.verdict === 'rejected' ? '✕' : '✓'} {f.po_code}</strong> — {f.draft_sig.slice(0, 60)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="clo26-section-head">
            <p>
              Showing {shownRowCount} CLO record{shownRowCount === 1 ? '' : 's'} across{' '}
              {shownGroups.length} of {myCourses.length} assigned subject{myCourses.length === 1 ? '' : 's'}
            </p>
            <button type="button" className="clo26-textbtn" onClick={() => setExpandedCourse(null)}>
              Collapse all
            </button>
          </div>
          {myCourses.length === 0 ? (
            <div className="clo26-empty">
              No subjects assigned to you yet — the program head assigns them in Assign Faculty.
            </div>
          ) : shownGroups.length === 0 ? (
            <div className="clo26-empty">
              {query ? `No results for "${query}"` : 'No CLO records match this view — change the filters or add a CLO above.'}
            </div>
          ) : (
            <div className="clo26-list">
              {shownGroups.map(({ course, rows }) => {
                const open = expandedCourse === course.id
                const courseActive = !course.status || course.status === 'active'
                return (
                  <article key={course.id} className={`clo26-course ${open ? 'open' : ''}`}>
                    <button type="button" className="clo26-course-head" onClick={() => setExpandedCourse(open ? null : course.id)}
                      aria-expanded={open}>
                      <div className="clo26-code">{course.code}</div>
                      <div className="clo26-info">
                        <strong>{course.title}</strong>
                        <small>{courseTermLabel(course)}</small>
                      </div>
                      <div className="clo26-meta">
                        <span className="clo26-count">{rows.length} CLO record{rows.length === 1 ? '' : 's'}</span>
                        <span className="clo26-status">{courseActive ? 'Active' : 'Archived'}</span>
                        <span className="clo26-chevron" aria-hidden="true">›</span>
                      </div>
                    </button>
                    {open && (
                      <div className="clo26-body">
                        {rows.length ? (
                          <>
                            <div className="clo26-thead">
                              <span>CLO No.</span><span>Learning outcome</span><span>Mapped POs</span><span />
                            </div>
                            {rows.map((row) => (
                              editingId === row.id ? (
                                <div key={row.id} className="clo26-editrow">{renderEdit()}</div>
                              ) : (
                                <div key={row.id} className="clo26-row">
                                  <div className="clo26-id">{cloLabel(row.code) || '—'}</div>
                                  <div className="clo26-desc">{row.description || 'No description.'}</div>
                                  <div className="clo26-pos">
                                    {(row.title || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => (
                                      <span key={p} className="clo26-tag">{p}</span>
                                    ))}
                                    {(row.title || '').trim() ? null : (
                                      <span className="clo26-tag clo26-tag--muted">Not mapped</span>
                                    )}
                                  </div>
                                  <div className="clo26-actions">
                                    <button type="button" onClick={() => openReader(row)} disabled={busy || !!editingId}>View</button>
                                    <button type="button" onClick={() => startEdit(row)} disabled={busy || !!editingId}>Edit</button>
                                    <button type="button" onClick={() => handleToggleStatus(row, `clo.${isActive(row) ? 'archived' : 'restored'}`)} disabled={busy || !!editingId}>
                                      {isActive(row) ? 'Archive' : 'Restore'}
                                    </button>
                                    {!isActive(row) && (
                                      <button type="button" className="clo26-danger" onClick={() => handleDelete(row.id, 'clo.deleted', row)} disabled={busy || !!editingId}>
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            ))}
                          </>
                        ) : (
                          <div className="clo26-empty">
                            No CLO records in this subject yet.{' '}
                            <button type="button" className="clo26-textbtn"
                              onClick={() => {
                                setForm((f) => ({ ...f, course: course.code }))
                                // Same auto-fill as a direct pick: the
                                // slicers read the subject's placement.
                                setCourseYear(String(course.year_level ?? ''))
                                setCourseSem(String(course.semester ?? ''))
                                document.querySelector('.clo-create-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }}>
                              Add a CLO
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}
      </div>
      </div>

      {/* Modification history: the clo.* audit entries for the assigned
          subjects — the faculty member's own edits and, when the manager
          hands over a subject, the trail of whoever handled it before. */}
      {myCourses.length > 0 && (
        <section className="panel" style={{ marginTop: 14 }} aria-label="Modification history">
          <div className="panel-head" style={{ marginBottom: 10 }}>
            <div>
              <h3>Modification history</h3>
              <p>Changes to your assigned subjects&rsquo; outcomes — yours and the ones before you.</p>
            </div>
          </div>
          {history === null ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>Loading history…</p>
          ) : history.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
              No changes recorded yet for your assigned subjects.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {history.map((h) => (
                <li key={h.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {new Date(h.created_at).toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--g700)', flexShrink: 0 }}>
                    {labelAction(h.action)}
                  </span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.details?.label || (h.details?.code ? `CLO ${h.details.code}` : '')}
                    {h.details?.course ? (
                      <span style={{ color: 'var(--text-muted)' }}> · {h.details.course}</span>
                    ) : null}
                  </span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
                    {h.user_email}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {viewClo && (
        <div
          className="syl-reader"
          role="dialog"
          aria-modal="true"
          aria-label={`Course syllabus${readerCourse ? ` — ${readerCourse.code}` : ''}`}
          onClick={() => setViewClo(null)}
        >
          <div className="syl-reader__bar" onClick={(e) => e.stopPropagation()}>
            <div className="syl-reader__title">
              <h3>Course Syllabus{readerCourse ? ` — ${readerCourse.code}` : ''}</h3>
              <span>{readerCourse ? readerCourse.title || viewClo.course : 'Unlinked outcome'}</span>
            </div>
            <div className="syl-reader__actions">
              {!readerCourse && (
                <span className="syl-reader__warn">
                  This outcome is not linked to a subject yet — its course text must match a course code (e.g. IT21).
                </span>
              )}
              {readerCourse && (
                <>
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => downloadReader('pdf')} disabled={viewBusy || !!readerError} title="Save the syllabus as PDF">
                    <Icon name="download" size={13} /> {viewBusy ? 'Preparing…' : 'Download PDF'}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => downloadReader('docx')} disabled={viewBusy || !!readerError} title="Save the syllabus as Word">
                    Download Word
                  </button>
                </>
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setViewClo(null)}>Close</button>
            </div>
          </div>
          <div className="syl-reader__scroll" onClick={(e) => e.stopPropagation()}>
            {readerError && <p className="msg msg--error">{readerError}</p>}
            {readerCourse ? (
              <div className="syl-reader__doc">
                <SyllabusReport
                  rootRef={viewReportRef}
                  course={readerCourse}
                  courses={courses}
                  goals={readerSource?.goals ?? []}
                  peos={readerSource?.peos ?? []}
                  adminGroups={readerAdminGroups}
                  managerGroups={readerManagerGroups}
                  subjectClos={readerClos}
                />
              </div>
            ) : (
              <div className="syl-reader__doc syl-reader__doc--empty">
                <p>No subject matches this outcome&rsquo;s course text, so there is no syllabus to open yet.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
