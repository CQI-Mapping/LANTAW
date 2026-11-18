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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { LETTERHEAD_URL } from '../../utils/letterhead'
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
/** True when the draft text carries rich lines — a bullet ("- item"), a
 *  numbered item ("1. item") or inline bold ("**text**") — so the live
 *  preview has something to show. */
const hasBulletLines = (text: string) =>
  /(^|\n)\s*[-*•]\s+/.test(text) || /(^|\n)\s*\d+[.)]\s+/.test(text) || text.includes('**')

// ---------------------------------------------------------------------------
// The rich component editor
//
// The six component boxes are Word-style editors: the text inside renders
// bold, italic, underline and real bullet/numbered lists while typing. The
// draft keeps the same plain marker text everything else reads (**bold**,
// _italic_, ++underline++, "- " bullets, "1." numbers), and the two forms
// convert through the grammar below - markers to HTML for the box, the
// box's DOM back to markers for the draft. The box is uncontrolled: its
// HTML is reset only when the incoming marker text differs from what the
// box last emitted (typing round-trips identically, so the caret never
// jumps), and every input serializes back through the same grammar.
// ---------------------------------------------------------------------------

/** Reconnects sentence fragments an old paste left on separate lines -
 *  a legacy draft's soft-wrap artifacts ("Part 1: Sketch" / "Wireframes").
 *  Strong signals only: a trailing space, a next line starting lowercase,
 *  or a short heading-like line containing ':' ("Part 3: Design"). Real
 *  breaks - list items, numbered lines, lines ending in punctuation - are
 *  left alone. Applied on every read/export, so even an old draft prints
 *  whole sentences, and the editor's next emit self-heals the draft. */
function repairWrappedLines(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  const isList = (s: string) => /^\s*(?:[-*•–]\s+|\d+[.)]\s+)/.test(s)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    while (i + 1 < lines.length) {
      const next = lines[i + 1]
      if (!next.trim() || isList(next)) break
      if (/[.!?:;,]$/.test(line.trimEnd())) break
      const trailingSpace = /\s$/.test(line)
      const lowercaseNext = /^[a-z]/.test(next.trim())
      const headingFragment = line.includes(':') && line.trim().length < 40
      if (!(trailingSpace || lowercaseNext || headingFragment)) break
      line = line.trimEnd() + ' ' + next.trim()
      i += 1
    }
    out.push(line)
  }
  return out.join('\n')
}

/** Marker text -> editor HTML: bullet and numbered lines become real
 *  lists, the inline markers become their tags, everything is escaped. */
function markersToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<i>$1</i>')
      .replace(/_(.+?)_/g, '<i>$1</i>')
      .replace(/\+\+(.+?)\+\+/g, '<u>$1</u>')
      // Unpaired leftovers - a legacy draft's half-applied style - lose
      // their markers rather than printing them.
      .replace(/\*\*|__|\+\+/g, '')
  const out: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null
  const flush = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`)
      list = null
    }
  }
  for (const raw of repairWrappedLines(text).split('\n')) {
    const line = raw.trim()
    if (line === '') {
      flush()
      continue
    }
    const bullet = line.match(/^[-*•–]\s+(.*)$/)
    const num = line.match(/^\d+[.)]\s+(.*)$/)
    if (bullet) {
      if (!list || list.tag !== 'ul') {
        flush()
        list = { tag: 'ul', items: [] }
      }
      list.items.push(inline(bullet[1]))
    } else if (num) {
      if (!list || list.tag !== 'ol') {
        flush()
        list = { tag: 'ol', items: [] }
      }
      list.items.push(inline(num[1]))
    } else {
      flush()
      out.push(`<div>${inline(line)}</div>`)
    }
  }
  flush()
  return out.join('')
}

/** Editor DOM -> marker text: real lists back to "- "/"1." lines, the
 *  inline tags back to their markers, every block a line. */
function htmlToMarkers(root: HTMLElement): string {
  const lines: string[] = []
  const BLOCKISH = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol'])
  const inlineOf = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      // A list met inside inline content (Chrome wraps lists in divs)
      // still becomes its lines - joined with breaks, never concatenated
      // into one run of text.
      let n = 1
      return Array.from(el.querySelectorAll(':scope > li'))
        .map((li) => {
          const content = inlineOf(li)
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean)
            .join(' ')
          return tag === 'ul' ? `- ${content}` : `${n++}. ${content}`
        })
        .join('\n')
    }
    const inner = Array.from(el.childNodes).map(inlineOf).join('')
    if (tag === 'b' || tag === 'strong') return `**${inner.replace(/\n+/g, ' ')}**`
    if (tag === 'i' || tag === 'em') return `_${inner.replace(/\n+/g, ' ')}_`
    if (tag === 'u') return `++${inner.replace(/\n+/g, ' ')}++`
    if (tag === 'br') return '\n'
    // A block met in inline context breaks the line: children join with
    // breaks so the caller's split turns them into separate lines. This
    // is what keeps Word-paste source newlines from tearing a sentence
    // in half - they become line splits at honest boundaries or are
    // flattened inside the inline markers.
    if (BLOCKISH.has(tag)) return Array.from(el.childNodes).map(inlineOf).join('\n')
    return inner
  }
  const pushInline = (node: Node) => {
    // Inline content may hold <br> breaks: each becomes its own line.
    inlineOf(node)
      .split('\n')
      .forEach((part) => {
        const t = part.trim()
        if (t) lines.push(t)
      })
  }
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushInline(node)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      let n = 1
      el.querySelectorAll(':scope > li').forEach((li) => {
        const content = inlineOf(li)
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean)
          .join(' ')
        lines.push(tag === 'ul' ? `- ${content}` : `${n++}. ${content}`)
      })
      return
    }
    if (BLOCKISH.has(tag)) {
      const hasBlockChild = Array.from(el.children).some((c) => BLOCKISH.has(c.tagName.toLowerCase()))
      if (!hasBlockChild) {
        pushInline(el)
      } else {
        Array.from(el.childNodes).forEach(walk)
      }
      return
    }
    Array.from(el.childNodes).forEach(walk)
  }
  Array.from(root.childNodes).forEach(walk)
  return lines.join('\n')
}

/** Paste sanitizer: only the grammar's tags survive a paste - b/strong,
 *  i/em, u, br, ul/ol/li and block lines - everything else (styles, fonts,
 *  tables, script) is unwrapped or dropped, so Word's hidden markup
 *  cannot ride in. */
function sanitizeRich(html: string): string {
  const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'ul', 'ol', 'li', 'p', 'div'])
  const clean = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.textContent ?? '')]
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return []
    if (ALLOWED.has(tag)) {
      const copy = document.createElement(tag)
      Array.from(el.childNodes)
        .flatMap(clean)
        .forEach((c) => copy.appendChild(c))
      return [copy]
    }
    return Array.from(el.childNodes).flatMap(clean)
  }
  const probe = document.createElement('div')
  Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes)
    .flatMap(clean)
    .forEach((c) => probe.appendChild(c))
  return probe.innerHTML
}

/** The bullet library the toolbar's caret opens - the same styles Word's
 *  library offers, rendered as the box's list marker and the Word file's
 *  bullet glyph. 'none' removes the bullets (list lines print as prose). */
const BULLET_STYLES: Array<{ id: string; glyph: string; label: string; title: string }> = [
  { id: 'none', glyph: '', label: 'None', title: 'No bullets - the list lines print as plain text' },
  { id: 'disc', glyph: '●', label: '', title: 'Filled round bullet' },
  { id: 'circle', glyph: '○', label: '', title: 'Hollow circle bullet' },
  { id: 'square', glyph: '■', label: '', title: 'Square bullet' },
  { id: 'diamond', glyph: '❖', label: '', title: 'Diamond bullet' },
  { id: 'arrow', glyph: '➤', label: '', title: 'Arrow bullet' },
  { id: 'check', glyph: '✓', label: '', title: 'Check-mark bullet' },
]

interface RichEditorProps {
  /** The draft's marker text for this component. */
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  placeholder: string
  /** The bullet library choice - the box's list marker follows it. */
  bulletStyle?: string
}

function RichEditor({ value, onChange, disabled, placeholder, bulletStyle }: RichEditorProps) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const lastEmitted = useRef<string>('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    if (value === lastEmitted.current) return
    box.innerHTML = markersToHtml(value)
    lastEmitted.current = value
  }, [value])

  const emit = () => {
    const box = boxRef.current
    if (!box) return
    const text = htmlToMarkers(box)
    lastEmitted.current = text
    if (text !== value) onChange(text)
  }

  return (
    <div
      ref={boxRef}
      className={`g26-rich${focused ? ' g26-rich--focused' : ''}${bulletStyle && bulletStyle !== 'disc' ? ` g26-rich--bullet-${bulletStyle}` : ''}`}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        emit()
      }}
      onInput={emit}
      onPaste={(e) => {
        e.preventDefault()
        const html = e.clipboardData.getData('text/html')
        if (html) {
          document.execCommand('insertHTML', false, sanitizeRich(html))
        } else {
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
        }
        emit()
      }}
    />
  )
}


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
  /** The bullet library choice (035) - which glyph the lists print. */
  bulletStyle: string
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
  bulletStyle: 'disc',
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
  bulletStyle: row.bullet_style ?? 'disc',
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
  // The task the View reader holds - the card's eye into its document.
  const [viewRow, setViewRow] = useState<GraspsTaskRow | null>(null)

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

  // The signed-in faculty's email — the identity the assignment gate below
  // compares against, the same rule the CLO page applies.
  const [myEmail, setMyEmail] = useState('')
  useEffect(() => {
    let cancelled = false
    supabase!
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setMyEmail(data.user?.email ?? '')
      })
      .catch(() => {
        // An unreadable session degrades to an empty picker, not a lock.
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

  // The assignment gate: the Course picker lists only the subjects the
  // manager handed to this faculty member — the primary instructor (the
  // denormalized column) or any course_instructors junction row (028).
  // Strict null checks: typeof null === 'object' would count every
  // unassigned subject as their own.
  const assignedCourses = useMemo(
    () =>
      courses.filter(
        (c) =>
          (c.instructor_id !== null &&
            typeof c.instructor_id === 'object' &&
            c.instructor_id.email === myEmail) ||
          (c.course_instructors ?? []).some(
            (ci) => ci.faculty_id !== null && ci.faculty_id.email === myEmail,
          ),
      ),
    [courses, myEmail],
  )

  const courseOptions = useMemo(
    () => buildCourseOptions(assignedCourses, selectedProgramId, draft.title),
    [assignedCourses, selectedProgramId, draft.title],
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
        bullet_style: draft.bulletStyle,
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
          bulletStyle: row.bullet_style ?? 'disc',
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
    document.querySelectorAll<HTMLTextAreaElement>('.g26-rubric textarea').forEach(autoResize)
  }, [draft.id, autoResize])

  // The Quick Reference guide opens from the hero and closes on Escape or
  // an outside click, like the syllabus reader's dialog.
  const [guideOpen, setGuideOpen] = useState(false)
  // The bullet library popover: which card's caret is open (null = closed).
  const [bulletLibFor, setBulletLibFor] = useState<string | null>(null)
  useEffect(() => {
    if (!bulletLibFor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBulletLibFor(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bulletLibFor])

  useEffect(() => {
    if (!viewRow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewRow(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewRow])
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
  // The rubric's live total reads the first number of each entry, so a
  // typed "/20" or "20" both count as 20.
  const rubricScored = draft.rubric.filter((r) => r.points !== null && String(r.points).trim() !== '')
  const rubricNumbers = rubricScored.map((r) => {
    const m = String(r.points).match(/\d+(?:\.\d+)?/)
    return m ? Number(m[0]) : null
  })
  const rubricAllNumeric = rubricNumbers.every((n) => n !== null)
  const rubricTotal = rubricNumbers.reduce<number>((s, n) => s + (n ?? 0), 0)

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
                disabled={!ready || assignedCourses.length === 0}
                onChange={(e) => patchDraft({ title: e.target.value })}
              >
                <option value="">
                  {assignedCourses.length === 0
                    ? courses.length === 0
                      ? 'No courses available'
                      : 'No subjects assigned to you yet — the program head assigns them in Assign Faculty'
                    : '- select course -'}
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
            <p>
              Complete each section to create a meaningful real-world learning experience. For list items,
              start a line with{' '}
              <code style={{ background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>-&nbsp;</code>{' '}
              and the Word download renders it as a bullet point; number a line{' '}
              <code style={{ background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>1.&nbsp;</code>{' '}
              for a numbered list. Wrap text in{' '}
              <code style={{ background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>**bold**</code>{' '}
              and it prints bold.
            </p>
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
                {/* The Word-style mini toolbar: B / I / U wrap the selection
                    in the inline markers, the list buttons mark or clear the
                    touched lines — the box below stays the plain-text
                    source of truth. */}
                <div className="g26-toolbar">
                  <button type="button" title="Bold" disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('bold')}>
                    <strong>B</strong>
                  </button>
                  <button type="button" title="Italic" disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('italic')}>
                    <em>I</em>
                  </button>
                  <button type="button" title="Underline" disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('underline')}>
                    <u>U</u>
                  </button>
                  <span className="g26-toolbar__sep" aria-hidden="true" />
                  <span className="g26-toolbar__split">
                    <button type="button" title="Bullet list" disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('insertUnorderedList')}>
                      &bull;
                    </button>
                    <button
                      type="button"
                      className="g26-toolbar__caret"
                      title="Bullet library"
                      disabled={!ready}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setBulletLibFor(bulletLibFor === p.key ? null : p.key)}
                    >
                      ▾
                    </button>
                    {bulletLibFor === p.key && (
                      <>
                        <div className="g26-bulletlib__backdrop" onClick={() => setBulletLibFor(null)} />
                        <div className="g26-bulletlib">
                          <span className="g26-bulletlib__head">Bullet library</span>
                          {BULLET_STYLES.map((bl) => (
                            <button
                              key={bl.id}
                              type="button"
                              className={`g26-bulletlib__tile${draft.bulletStyle === bl.id ? ' active' : ''}${bl.id === 'none' ? ' g26-bulletlib__tile--text' : ''}`}
                              title={bl.title}
                              disabled={!ready}
                              onClick={() => {
                                patchDraft({ bulletStyle: bl.id })
                                setBulletLibFor(null)
                              }}
                            >
                              {bl.glyph || bl.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </span>

                  <button type="button" title="Numbered list" disabled={!ready} onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('insertOrderedList')}>
                    1.
                  </button>
                </div>
                <RichEditor value={draft[p.key]} onChange={(next) => patchPart(p.key, next)} disabled={!ready} placeholder={p.placeholder} bulletStyle={draft.bulletStyle} />
                <span className="g26-part__count">{draft[p.key].trim().length} characters</span>
                {hasBulletLines(draft[p.key]) && (
                  <div className="g26-preview">
                    <span className="g26-preview__tag">In the Word file</span>
                    <div className="g26-preview__doc">
                      {(() => {
                        // The preview renders through the SAME converter the
                        // editor box loads with (markersToHtml), so it can
                        // never disagree with the box or the document - the
                        // typed markers become the exact tags both render.
                        const lines = draft[p.key].split('\n').map((l) => l.trim()).filter((l) => l !== '')
                        const labelAlone = lines[0].endsWith(':')
                        const firstIsPlain = !/^[-*•–]\s+/.test(lines[0]) && !/^\d+[.)]\s+/.test(lines[0])
                        if (labelAlone || !firstIsPlain) {
                          return (
                            <>
                              <p className="g26-preview__line">
                                <strong>{p.label}:</strong>
                              </p>
                              <div dangerouslySetInnerHTML={{ __html: markersToHtml(draft[p.key]) }} />
                            </>
                          )
                        }
                        const restHtml = markersToHtml(lines.slice(1).join('\n'))
                        const firstHtml = markersToHtml(lines[0]).replace(/^<div>/, '').replace(/<\/div>$/, '')
                        return (
                          <>
                            <p className="g26-preview__line">
                              <strong>{p.label}:</strong> <span dangerouslySetInnerHTML={{ __html: firstHtml }} />
                            </p>
                            <div dangerouslySetInnerHTML={{ __html: restHtml }} />
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}

                {p.key === 'standards' && (
                  <div className="g26-rubric">
                    {/* The Standards component's companion: criteria scored across
                        the four performance levels, saved with the task (034) and
                        printed on the Word export — inside the card, directly
                        under its textarea. */}
              <div className="g26-rubric__head">
                <h4>{rubricAllNumeric && rubricScored.length > 0 ? `Analytic Rubric (${rubricTotal} points)` : 'Analytic Rubric'}</h4>
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
                            onChange={(e) => patchRubricRow(i, { points: e.target.value === '' ? null : e.target.value })}
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
                <button type="button" onClick={() => setViewRow(row)}
                  aria-label={`View ${row.code || row.title || 'task'}`}>
                  View
                </button>
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
      {/* ---- view reader ----
          The saved task laid out as the document the export prints - the
          same header block, labeled components through the same converter
          the editor loads with, and the rubric table - with the Word
          download one click away. */}
      {viewRow && (
        <div
          className="syl-reader"
          role="dialog"
          aria-modal="true"
          aria-label="GRASPS task preview"
          onClick={() => setViewRow(null)}
        >
          <div className="syl-reader__bar" onClick={(e) => e.stopPropagation()}>
            <div className="syl-reader__title">
              <h3>GRASPS Performance Task{viewRow.task_type.trim() ? ` for ${viewRow.task_type.trim()}` : ''}</h3>
              <span>{[viewRow.code, viewRow.title].filter(Boolean).join(' — ') || 'GRASPS task'}</span>
            </div>
            <div className="syl-reader__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void exportRow(viewRow)}>
                <Icon name="download" size={13} /> Download Word
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setViewRow(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="syl-reader__scroll">
            <div className={`syl-reader__doc g26-reader g26-rich--bullet-${viewRow.bullet_style ?? 'disc'}`}>
              <div className="g26-reader__page">
                <img className="g26-reader__letterhead" src={LETTERHEAD_URL} alt="Letterhead" />
                <p className="g26-reader__center">Institute for Computer Studies</p>
                <p className="g26-reader__center g26-reader__strong">
                  {(() => {
                    const m = viewRow.title.match(/^([A-Za-z0-9 .+()]+?)\s*[-–]\s*(.+)$/)
                    return m ? `${m[1].trim()}: ${m[2].trim()}` : viewRow.title
                  })()}
                </p>
                <p className="g26-reader__center">
                  {(() => {
                    const term = viewRow.term || composeTerm(viewRow.semester ?? '', viewRow.school_year ?? '')
                    return term.includes(',')
                      ? term.replace(/,/, ', S.Y.: ').replace(/S\.Y\.:\s+/, 'S.Y.: ')
                      : term
                  })()}
                </p>
                <p className="g26-reader__center g26-reader__strong">{viewRow.task_type || 'GRASPS'}</p>
                <p className="g26-reader__heading">Performance/Product-based Assessment through GRASPS Model</p>

                {GRASPS_PARTS.map((p) => {
                  const text = (viewRow[p.key] ?? '').trim()
                  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
                  if (lines.length === 0) return null
                  // The reader speaks the export's labels - the document
                  // says "Product/Performance:" without the spaces.
                  const label = p.key === 'product' ? 'Product/Performance' : p.label
                  const labelAlone = lines[0].endsWith(':')
                  const firstIsPlain = !/^[-*•–]\s+/.test(lines[0]) && !/^\d+[.)]\s+/.test(lines[0])
                  const bodyHtml = markersToHtml(text)
                  return (
                    <div key={p.key} className="g26-reader__part">
                      {labelAlone || !firstIsPlain ? (
                        <p className="g26-reader__line"><strong>{label}:</strong></p>
                      ) : (
                        <p className="g26-reader__line">
                          <strong>{label}:</strong>{' '}
                          <span dangerouslySetInnerHTML={{ __html: markersToHtml(lines[0]).replace(/^<div>/, '').replace(/<\/div>$/, '') }} />
                        </p>
                      )}
                      <div dangerouslySetInnerHTML={{ __html: labelAlone || !firstIsPlain ? bodyHtml : markersToHtml(lines.slice(1).join('\n')) }} />
                    </div>
                  )
                })}

                {(() => {
                  const rows = (viewRow.rubric ?? []).filter(
                    (r) =>
                      r.criteria.trim() || r.excellent.trim() || r.proficient.trim()
                      || r.developing.trim() || r.beginning.trim() || (r.points ?? 0) !== 0,
                  )
                  if (rows.length === 0) return null
                  const rubricNumber = (v: unknown): number | null => {
                    const m = String(v ?? '').match(/\d+(?:\.\d+)?/)
                    return m ? Number(m[0]) : null
                  }
                  const rubricCriterion = (r: GraspsRubricRow) => {
                    const name = r.criteria.trim()
                    return /\(.*?points\)\s*$/i.test(name) || r.points == null
                      ? name
                      : `${name} (${r.points} points)`
                  }
                  const rubricPointsCell = (v: unknown) => {
                    const s = String(v).trim()
                    return s.startsWith('/') ? s : `/${s}`
                  }
                  const scored = rows.filter((r) => r.points !== null && String(r.points).trim() !== '')
                  const numbers = scored.map((r) => rubricNumber(r.points))
                  const allNumeric = numbers.every((n) => n !== null)
                  const total = numbers.reduce<number>((s, n) => s + (n ?? 0), 0)
                  return (
                    <div className="g26-reader__rubric">
                      <p className="g26-reader__heading">{allNumeric && scored.length > 0 ? `Analytic Rubric (${total} points)` : 'Analytic Rubric'}</p>
                      <table className="g26-rubric__table">
                        <thead>
                          <tr>
                            <th>Criteria</th>
                            <th>Excellent (4)</th>
                            <th>Proficient (3)</th>
                            <th>Developing (2)</th>
                            <th>Beginning (1)</th>
                            <th>Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i}>
                              <td><strong>{rubricCriterion(r)}</strong></td>
                              <td>{r.excellent.trim() || '—'}</td>
                              <td>{r.proficient.trim() || '—'}</td>
                              <td>{r.developing.trim() || '—'}</td>
                              <td>{r.beginning.trim() || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{r.points != null ? rubricPointsCell(r.points) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
