// Word (.docx) export for a GRASPS performance task.
//
// The Generate GRASPS page keeps each task as six plain-text components, and
// this export rebuilds them as the document faculty hand in: the letterhead
// up top, the identifying header lines, then a two-column GRASPS table —
// component name left, the written description right — and a prepared-by
// line. Real Word constructs (paragraphs, one bordered table), so the file
// stays editable rather than a rasterised page.
//
// Metrics follow the house report style shared with utils/syllabusDocx.ts:
// Arial 10pt, 8.5 x 13in paper, 0.5in margins, letterhead repeated on every
// page via a real page header. `docx` is imported dynamically — see the note
// in syllabusDocx.ts for why it must never ride the main bundle.

import type { Paragraph as DocxParagraph, Table as DocxTable } from 'docx'
import type { GraspsRubricRow } from '../services/database'
import { saveBlob } from './download'
import {
  LETTERHEAD_URL,
  LETTERHEAD_ASPECT,
  LETTERHEAD_WIDTH_RATIO,
  headerBandIn,
  pageWidthIn,
} from './letterhead'

const FONT = 'Arial'
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


async function fetchLetterhead(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(LETTERHEAD_URL)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    // A missing letterhead degrades the document but must not fail the export.
    return null
  }
}

export async function downloadGraspsDocx(data: GraspsDocxData): Promise<void> {
  const {
    AlignmentType, BorderStyle, Document, Header, ImageRun, Packer,
    Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
    convertInchesToTwip,
  } = await import('docx')

  const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string } = {}) =>
    new TextRun({ text, bold: o.bold, italics: o.italics, color: o.color, font: FONT, size: SZ })

  const para = (
    text: string,
    o: { bold?: boolean; italics?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {},
  ) =>
    new Paragraph({
      alignment: o.align ?? AlignmentType.LEFT,
      spacing: { after: 0 },
      children: [run(text, o)],
    })

  // Inline bold: "**Part 1: Sketch Wireframes**" prints its middle bold.
  // Splitting on the marker pair yields plain/bold alternating segments —
  // odd indexes are the bold ones — and empty segments are dropped so a
  // lone "**" pair never prints an empty run.
  const runsOf = (text: string, o: { bold?: boolean; italics?: boolean } = {}) =>
    text
      .split(/\*\*(.+?)\*\*/g)
      .map((seg, i) => ({ seg, bold: i % 2 === 1 }))
      .filter((s) => s.seg !== '')
      .map((s) => run(s.seg, { ...o, bold: s.bold || o.bold }))

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
  const inch = (v: number) => convertInchesToTwip(v)

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
  const linePara = (l: string) => {
    const m = l.match(/^[-*•]\s+(.+)$/)
    if (m) return new Paragraph({ bullet: { level: 0 }, children: runsOf(m[1]) })
    return new Paragraph({ alignment: JUSTIFIED, children: runsOf(l) })
  }

  const parts: Array<{ label: string; value: string }> = [
    { label: 'Goal', value: data.goal },
    { label: 'Role', value: data.role },
    { label: 'Audience', value: data.audience },
    { label: 'Situation', value: data.situation },
    { label: 'Product/Performance', value: data.product },
    { label: 'Standards for Success', value: data.standards },
  ]

  parts.forEach((c) => {
    const lines = c.value.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    const labelPara = (firstInline: boolean) =>
      new Paragraph({
        alignment: JUSTIFIED,
        children: [
          run(`${c.label}:`, { bold: true }),
          ...(firstInline ? [run(' '), ...runsOf(lines[0])] : []),
        ],
      })
    if (lines.length === 0) {
      children.push(labelPara(false))
    } else if (lines[0].endsWith(':')) {
      children.push(labelPara(false))
      lines.forEach((l) => children.push(linePara(l)))
    } else {
      children.push(labelPara(true))
      lines.slice(1).forEach((l) => children.push(linePara(l)))
    }
    children.push(new Paragraph({ spacing: { after: 100 }, children: [] }))
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
    const scored = rubricRows.filter((r) => r.points !== null && String(r.points).trim() !== '')
    const allNumeric = scored.every((r) => Number.isFinite(Number(String(r.points).trim())))
    const total = scored.reduce((s, r) => s + (Number(String(r.points).trim()) || 0), 0)
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
                  [para(`${r.criteria.trim()}${r.points != null ? ` (${r.points} points)` : ''}`, { bold: true })],
                  18,
                ),
                cell([para(r.excellent.trim() || '—')], 19),
                cell([para(r.proficient.trim() || '—')], 19),
                cell([para(r.developing.trim() || '—')], 19),
                cell([para(r.beginning.trim() || '—')], 19),
                cell([para(r.points != null ? `/${r.points}` : '—', { align: CENTER })], 6),
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

  // ---- Page + letterhead header ------------------------------------------
  const pageWIn = pageWidthIn('portrait')
  const bandTwip = Math.round(headerBandIn(pageWIn) * 1440)
  const HEADER_DIST_TWIP = Math.round(0.14 * 1440) // LETTERHEAD_TOP_IN

  const letterhead = await fetchLetterhead()
  const headerChildren: DocxParagraph[] = []
  if (letterhead) {
    const widthPx = Math.round(pageWIn * LETTERHEAD_WIDTH_RATIO * 96)
    headerChildren.push(
      new Paragraph({
        alignment: CENTER,
        children: [
          new ImageRun({
            type: 'png',
            data: letterhead,
            transformation: { width: widthPx, height: Math.round(widthPx / LETTERHEAD_ASPECT) },
          }),
        ],
      }),
    )
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: inch(8.5), height: inch(13) },
            margin: {
              top: bandTwip,
              right: inch(0.5),
              bottom: inch(0.5),
              left: inch(0.5),
              header: HEADER_DIST_TWIP,
            },
          },
        },
        ...(headerChildren.length
          ? { headers: { default: new Header({ children: headerChildren }) } }
          : {}),
        children,
      },
    ],
  })

  saveBlob(await Packer.toBlob(doc), graspsFileName(data.course, data.taskType))
}
