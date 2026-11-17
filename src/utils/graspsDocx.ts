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
const SZ = 20 // half-points -> 10pt

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

/** "grasps-IT20-2026-11-11.docx" — the syllabus name pattern, GRASPS-prefixed. */
function graspsFileName(course: string): string {
  const d = new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
  const safe = course.trim().replace(/[^\w-]+/g, '-').replace(/-+/g, '-')
  return `grasps-${safe || 'task'}-${stamp}.docx`
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
  const inch = (v: number) => convertInchesToTwip(v)

  const children: (DocxParagraph | DocxTable)[] = []

  // ---- Title block ------------------------------------------------------
  children.push(
    para('GRASPS', { bold: true, color: NAVY, align: CENTER }),
    para(
      `Performance Task${data.taskType.trim() ? ` for ${data.taskType.trim()}` : ''}`,
      { bold: true, align: CENTER },
    ),
    para(data.course || 'No course yet', { bold: true, italics: true, align: CENTER }),
    para([data.program, data.term].filter(Boolean).join(' · '), { bold: true, align: CENTER }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  )

  // ---- The GRASPS table --------------------------------------------------
  // One row per component, in the order the acronym spells. An empty
  // component still prints its row with a blank description, so the document
  // shows the task's own gaps instead of silently dropping them.
  const components: Array<{ key: string; label: string; value: string }> = [
    { key: 'G', label: 'Goal', value: data.goal },
    { key: 'R', label: 'Role', value: data.role },
    { key: 'A', label: 'Audience', value: data.audience },
    { key: 'S', label: 'Situation', value: data.situation },
    { key: 'P', label: 'Product / Performance', value: data.product },
    { key: 'S', label: 'Standards for Success', value: data.standards },
  ]

  children.push(
    new Table({
      width: pct(100),
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            cell([para('GRASPS', { bold: true, color: NAVY, align: CENTER })], 10),
            cell([para('COMPONENT', { bold: true, color: NAVY, align: CENTER })], 22),
            cell([para('DESCRIPTION', { bold: true, color: NAVY, align: CENTER })], 68),
          ],
        }),
        ...components.map((c) =>
          new TableRow({
            children: [
              cell([para(c.key, { bold: true, align: CENTER })], 10),
              cell([para(c.label, { bold: true })], 22),
              cell(
                [para(c.value.trim() || '—', { italics: c.value.trim() === '' })],
                68,
              ),
            ],
          }),
        ),
      ],
    }),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
  )

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
      para(allNumeric ? `Analytic Rubric (${total} points)` : 'Analytic Rubric', { bold: true, color: NAVY }),
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

  saveBlob(await Packer.toBlob(doc), graspsFileName(data.course))
}
