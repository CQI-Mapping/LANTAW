// Word (.docx) export for a GRASPS performance task.
//
// The Generate GRASPS page keeps each task as six plain-text components, and
// this export rebuilds them as the document faculty hand in: the official
// form's header and footer bands (utils/nbscForm.ts, repeated on every page),
// the identifying header lines, the six components as labeled paragraphs,
// the analytic rubric table, and a prepared-by line. Real Word constructs
// (paragraphs, one bordered table), so the file stays editable rather than a
// rasterised page.
//
// Metrics are the model form's own — FM-NBSC-CID-030 is A4 portrait with
// one-inch margins (see FORM_PAGE in nbscForm.ts). `docx` is imported
// dynamically — see the note in syllabusDocx.ts for why it must never ride
// the main bundle.

import type { Paragraph as DocxParagraph, Table as DocxTable } from 'docx'
import type { GraspsRubricRow } from '../services/database'
import { saveBlob } from './download'
import { FORM_PAGE, buildFormChrome } from './nbscForm'

const FONT = 'Arial'
/** The bullet library's glyphs, one numbering reference each - the
 *  toolbar's picker chooses which one the bullet lines print with. */
const BULLET_LISTS: Array<{ id: string; glyph: string }> = [
  { id: 'disc', glyph: '●' },
  { id: 'circle', glyph: '○' },
  { id: 'square', glyph: '■' },
  { id: 'diamond', glyph: '❖' },
  { id: 'arrow', glyph: '➤' },
  { id: 'check', glyph: '✓' },
]

const NAVY = '002060'
const SZ = 22 // half-points -> 11pt (the GRASPS model format)

export interface GraspsDocxData {
  program: string
  course: string
  /** The grading period the task is for — Prelim, Midterm, Finals. */
  taskType: string
  term: string
  goal: string
  role: string
  audience: string
  situation: string
  product: string
  standards: string
  /** The analytic rubric, printed after the components table. */
  rubric?: GraspsRubricRow[]
  /** The bullet library choice - which glyph the bullet lists print. */
  bulletStyle?: string
  preparedBy: string
}

/** The export's file name: the GRASPS model form code, the course's short
 *  name (initials of the title's words, e.g. HCI) and the grading period —
 *  "FM-NBSC-CID-030 GRASPS Model - HCI - Prelim.docx". */
const GRASPS_STOP_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'a', 'an', 'to'])

function courseShortName(course: string): string {
  const title = course.split(/\s*[-–:]\s*/).slice(1).join(' ').trim()
  if (!title) return course.trim() || 'task'
  const words = title.split(/[\s-]+/).filter((w) => !GRASPS_STOP_WORDS.has(w.toLowerCase()))
  const initials = words.map((w) => (w[0] ?? '').toUpperCase()).join('')
  return initials.slice(0, 4) || course.trim() || 'task'
}

function graspsFileName(course: string, taskType: string): string {
  const period = taskType.trim() || 'GRASPS'
  return `FM-NBSC-CID-030 GRASPS Model - ${courseShortName(course)} - ${period}.docx`
}


export async function downloadGraspsDocx(data: GraspsDocxData): Promise<void> {
  const d = await import('docx')
  const {
    AlignmentType, BorderStyle, Document, LevelFormat, Packer,
    Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
  } = d

  const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; underline?: boolean } = {}) =>
    new TextRun({
      text,
      bold: o.bold,
      italics: o.italics,
      color: o.color,
      underline: o.underline ? {} : undefined,
      font: FONT,
      size: SZ,
    })

  const para = (
    text: string,
    o: { bold?: boolean; italics?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {},
  ) =>
    new Paragraph({
      alignment: o.align ?? AlignmentType.LEFT,
      spacing: { after: 0 },
      children: [run(text, o)],
    })

  // The inline grammar the toolbar and the typed markers share: **bold**,
  // _italic_ and ++underline++ segments become their Word equivalents;
  // anything outside the markers keeps the caller's base style. The walk
  // is flat — no nested markers — which is all the document needs.
  const runsOf = (text: string, o: { bold?: boolean; italics?: boolean; underline?: boolean } = {}) => {
    // The doubled-underscore form is tolerated: a nested italic wrap
    // serializes as __text__, and the grammar reads it the same as _text_.
    const re = /\*\*(.+?)\*\*|\+\+(.+?)\+\+|__(.+?)__|_(.+?)_/g
    const out: ReturnType<typeof run>[] = []
    let last = 0
    let m: RegExpExecArray | null
    // Unpaired leftover markers (a legacy draft's half-applied style) are
    // stripped from the runs outside a matched pair.
    const plain = (s: string) => s.replace(/\*\*|__|\+\+/g, '')
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(run(plain(text.slice(last, m.index)), o))
      if (m[1] !== undefined) out.push(run(m[1], { ...o, bold: true }))
      else if (m[2] !== undefined) out.push(run(m[2], { ...o, underline: true }))
      else if (m[3] !== undefined) out.push(run(m[3], { ...o, italics: true }))
      else if (m[4] !== undefined) out.push(run(m[4], { ...o, italics: true }))
      last = m.index + m[0].length
    }
    if (last < text.length) out.push(run(plain(text.slice(last)), o))
    return out.length ? out : [run(text, o)]
  }

  const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
  const pct = (v: number) => ({ size: Math.round(v), type: WidthType.PERCENTAGE })

  const cell = (children: DocxParagraph[], widthPct?: number) =>
    new TableCell({
      borders: CELL_BORDERS,
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      ...(widthPct === undefined ? {} : { width: pct(widthPct) }),
      children,
    })

  const CENTER = AlignmentType.CENTER
  const JUSTIFIED = AlignmentType.JUSTIFIED

  const children: (DocxParagraph | DocxTable)[] = []

  // ---- Header block ------------------------------------------------------
  // The house GRASPS format: the institute line under the letterhead band,
  // the course, the term, the grading period, then the assessment title —
  // and the six components as labeled paragraphs rather than a table.
  const courseLine = (() => {
    const m = data.course.match(/^([A-Za-z0-9 .+()]+?)\s*[-–]\s*(.+)$/)
    return m ? `${m[1].trim()}: ${m[2].trim()}` : data.course
  })()
  const termLine = data.term.includes(',')
    ? data.term.replace(/,/, ', S.Y.: ')
    : data.term

  children.push(
    para('Institute for Computer Studies', { align: CENTER }),
    para(courseLine || 'No course yet', { bold: true, align: CENTER }),
    ...(termLine.trim() ? [para(termLine, { align: CENTER })] : []),
    para(data.taskType || 'GRASPS', { bold: true, align: CENTER }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
    para('Performance/Product-based Assessment through GRASPS Model', { bold: true, align: JUSTIFIED }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  )

  // ---- The components as labeled paragraphs ------------------------------
  // A single-line component runs on after its bold label ("Goal: Your goal
  // is to …"). When the first line is itself a heading ("Your audience
  // includes:"), the label stands alone and every line follows as its own
  // paragraph — the way the model document lays the six parts out.
  // A line that opens with "- ", "* " or "• " becomes a real Word bullet —
  // the model document's list style. The marker is stripped; the text runs
  // at the bullet's own indent, so the faculty composes lists by typing a
  // dash before each item.
  // The bullet library: the task's chosen style picks the numbering
  // reference; 'none' prints the list lines as plain prose.
  const styleId = BULLET_LISTS.some((b) => b.id === (data.bulletStyle ?? 'disc'))
    ? data.bulletStyle ?? 'disc'
    : 'disc'
  const bulletRef = styleId === 'none' ? '' : `grasps-bullet-${styleId}`

  const linePara = (l: string) => {
    const m = l.match(/^[-*•–]\s+(.+)$/)
    if (m) {
      if (!bulletRef) {
        return new Paragraph({ alignment: JUSTIFIED, children: runsOf(m[1]) })
      }
      return new Paragraph({
        numbering: { reference: bulletRef, level: 0 },
        // The model document's list paragraphs carry a small before/after
        // gap (Word's 100-twip autospacing ≈ 5pt) — copied here so the
        // export breathes the same way.
        spacing: { before: 100, after: 100 },
        children: runsOf(m[1]),
      })
    }
    return new Paragraph({ alignment: JUSTIFIED, children: runsOf(l) })
  }

  // Numbered lines ("1. item") become real Word numbered lists — a fresh
  // numbering instance per contiguous block, so each list restarts at 1
  // the way the model document's parts do. Word owns the counter, so
  // inserting an item renumbers the list without retyping it. Faculty
  // bullet styles vary across the department: dashes, asterisks, typed
  // bullets and en-dashes all read as bullets; digits+dot/paren read as
  // numbers; anything else is prose.
  const isNumbered = (l: string) => /^\d+[.)]\s+/.test(l)
  let numInstance = 0
  let prevNumbered = false
  const numPara = (l: string, instance: number) =>
    new Paragraph({
      numbering: { reference: 'grasps-numbered', level: 0, instance },
      spacing: { before: 100, after: 100 },
      children: runsOf(l.replace(/^\d+[.)]\s+/, '')),
    })

  const parts: Array<{ label: string; value: string }> = [
    { label: 'Goal', value: data.goal },
    { label: 'Role', value: data.role },
    { label: 'Audience', value: data.audience },
    { label: 'Situation', value: data.situation },
    { label: 'Product/Performance', value: data.product },
    { label: 'Standards for Success', value: data.standards },
  ]

  parts.forEach((c) => {
    prevNumbered = false
    const lines = c.value.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    const labelPara = (firstInline: boolean) =>
      new Paragraph({
        alignment: JUSTIFIED,
        spacing: { before: 100, after: 100 },
        children: [
          run(`${c.label}:`, { bold: true }),
          ...(firstInline ? [run(' '), ...runsOf(lines[0])] : []),
        ],
      })
    const emitLines = (list: string[]) => {
      list.forEach((l) => {
        if (isNumbered(l)) {
          if (!prevNumbered) numInstance += 1
          children.push(numPara(l, numInstance))
        } else {
          children.push(linePara(l))
        }
        prevNumbered = isNumbered(l)
      })
    }
    if (lines.length === 0) {
      children.push(labelPara(false))
    } else if (lines[0].endsWith(':')) {
      children.push(labelPara(false))
      emitLines(lines)
    } else {
      children.push(labelPara(true))
      emitLines(lines.slice(1))
    }
  })

  // ---- Analytic rubric ---------------------------------------------------
  // Criteria scored across the four performance levels, the companion of
  // the Standards component. Blank rows are dropped, and the section only
  // prints when at least one criterion carries content — a task filed
  // without a rubric keeps its document rubric-free.
  const rubricRows = (data.rubric ?? []).filter(
    (r) =>
      r.criteria.trim() || r.excellent.trim() || r.proficient.trim()
      || r.developing.trim() || r.beginning.trim() || (r.points ?? 0) !== 0,
  )
  if (rubricRows.length) {
    // The criterion's points note is appended only when the typed name
    // does not already carry one - a pasted "Sketch Wireframes (20
    // points)" never prints the note twice. The Points cell normalizes a
    // typed "/20" (the slash is the column's own), and the heading's
    // total reads the first number of each entry, so "/20" counts as 20.
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
    const scored = rubricRows.filter((r) => r.points !== null && String(r.points).trim() !== '')
    const numbers = scored.map((r) => rubricNumber(r.points))
    const allNumeric = numbers.every((n) => n !== null)
    const total = numbers.reduce<number>((s, n) => s + (n ?? 0), 0)
    children.push(
      para(allNumeric ? `Analytic Rubric (${total} points)` : 'Analytic Rubric'),
      new Paragraph({ spacing: { after: 80 }, children: [] }),
      new Table({
        width: pct(100),
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              cell([para('Criteria', { bold: true, color: NAVY, align: CENTER })], 18),
              cell([para('Excellent (4)', { bold: true, color: NAVY, align: CENTER })], 19),
              cell([para('Proficient (3)', { bold: true, color: NAVY, align: CENTER })], 19),
              cell([para('Developing (2)', { bold: true, color: NAVY, align: CENTER })], 19),
              cell([para('Beginning (1)', { bold: true, color: NAVY, align: CENTER })], 19),
              cell([para('Points', { bold: true, color: NAVY, align: CENTER })], 6),
            ],
          }),
          ...rubricRows.map((r) =>
            new TableRow({
              children: [
                cell(
                  [para(rubricCriterion(r), { bold: true })],
                  18,
                ),
                cell([para(r.excellent.trim() || '—')], 19),
                cell([para(r.proficient.trim() || '—')], 19),
                cell([para(r.developing.trim() || '—')], 19),
                cell([para(r.beginning.trim() || '—')], 19),
                cell([para(r.points != null ? rubricPointsCell(r.points) : '—', { align: CENTER })], 6),
              ],
            }),
          ),
        ],
      }),
      new Paragraph({ spacing: { after: 200 }, children: [] }),
    )
  }

  // ---- Prepared by -------------------------------------------------------
  if (data.preparedBy.trim()) {
    children.push(
      para('Prepared by:', { bold: true }),
      para(data.preparedBy.trim(), { italics: true }),
    )
  }

  // ---- Page + the official form chrome ------------------------------------
  // The model form's own section — A4 portrait, one-inch margins — with the
  // college's header and footer bands repeating on every page. Both bands are
  // real Word content, so Word grows them over the margins and keeps the body
  // clear on every page the way the form itself lays out.
  const { header, footer } = await buildFormChrome(d)

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    numbering: {
      config: [
        ...BULLET_LISTS.map((b) => ({
          reference: `grasps-bullet-${b.id}`,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: b.glyph,
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        })),
        {
          reference: 'grasps-numbered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: FORM_PAGE.size.width, height: FORM_PAGE.size.height },
            margin: { ...FORM_PAGE.margin },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children,
      },
    ],
  })

  saveBlob(await Packer.toBlob(doc), graspsFileName(data.course, data.taskType))
}
