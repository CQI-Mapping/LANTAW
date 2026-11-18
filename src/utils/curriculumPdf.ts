// Curriculum PDF import: extracts the subject rows from a curriculum
// checklist PDF (the ICS "Student Grades" form) using Mozilla's pdf.js,
// entirely in the browser — no server, no upload of the file itself.
//
// The checklist's layout, as the text layer lays it out (x = left offset):
//   [36]Year Level [87]FIRST            — section marker
//   [51]FG [87]CODE [134]Course … Units [251]Pre-Req   ← left table
//   [336]FG [369]CODE …                 ← right table starts past x≈300
//   [77]IT10 [117]Introduction to Computing [223]3 [257]None
//       [293]#### [359]IT12 [400]Human Computer Interaction …
//   — two semester tables side by side per section; a '####' separator
//   sits between them, but right-only rows (and the midyear's single
//   table) don't carry one, so the split is by x-position: tokens past
//   x≈300 belong to the right table.
//   "Third | Midyear" — the summer term belongs to the year it trails.
//   A subject row is  CODE — title tokens — Units(number) — Pre-Req
//   tokens; the title may wrap ("Hardware Implementation" +
//   "Technologies"), so everything between the code and the bare number
//   is the title.
//
// The parser is heuristic by nature; the import modal shows every parsed
// row in an editable review grid before anything is written, so the
// program head fixes whatever the extraction misread — the "manual
// input" half of the feature.

export interface ParsedCurriculumSubject {
  code: string
  title: string
  units: number
  prereq: string
  year: number
  semester: number // 1 | 2 | 3 — 3 is the midyear/summer term
}

interface TextItem {
  str: string
  x: number
  y: number
}

/** The x offset where a section's right-hand semester table begins. */
const RIGHT_TABLE_X = 300

/** Pull the text items of every page, grouped into visual lines by their
 *  y coordinate, keeping each item's x so left/right column order holds. */
async function extractLines(file: File | ArrayBuffer): Promise<TextItem[][]> {
  // The legacy build runs in the browser and in Node (tests, scripts) alike.
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
    GlobalWorkerOptions.workerSrc = workerUrl
  } catch {
    // Outside a bundler pdf.js falls back to a fake worker.
  }
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const doc = await getDocument({ data }).promise
  const lines: TextItem[][] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    let lastY: number | null = null
    let current: TextItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const x = item.transform[4]
      const y = Math.round(item.transform[5])
      if (lastY === null || Math.abs(y - lastY) > 3) {
        if (current.length) lines.push(current)
        current = []
        lastY = y
      }
      current.push({ str: item.str, x, y })
      lastY = y
    }
    if (current.length) lines.push(current)
  }
  return lines
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,11}$/
const NUMBER_RE = /^\d+(?:\.\d+)?$/
const SEPARATOR = '####'

const YEAR_OF: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
}

/** Turn one visual line's items into [left tokens, right tokens]: the
 *  '####' separator splits the two semester tables when present, and any
 *  token past the right table's x offset does too (right-only rows carry
 *  no separator). */
function splitLine(items: TextItem[]): [string[], string[]] {
  const left: string[] = []
  const right: string[] = []
  for (const item of items) {
    const s = item.str.trim()
    if (!s || s === SEPARATOR) continue
    if (item.x >= RIGHT_TABLE_X) right.push(s)
    else left.push(s)
  }
  return [left, right]
}

/** Read one half-line's tokens as a subject: code first, title tokens until
 *  the bare units number, then the prereq tokens. */
function readSubject(tokens: string[]): { code: string; title: string; units: number; prereq: string } | null {
  const clean = tokens.map((t) => t.trim()).filter(Boolean).filter((t) => t !== 'FG')
  if (clean.length === 0) return null
  const code = clean[0]
  if (!CODE_RE.test(code)) return null
  let units = 3
  let titleEnd = clean.length
  for (let i = 1; i < clean.length; i++) {
    if (NUMBER_RE.test(clean[i])) {
      units = Number(clean[i])
      titleEnd = i
      break
    }
  }
  if (titleEnd <= 1) return null
  const title = clean.slice(1, titleEnd).join(' ').replace(/\s+/g, ' ').trim()
  const prereq = clean.slice(titleEnd + 1).join(', ').trim()
  return { code: code.toUpperCase(), title, units, prereq }
}

/** Parse a curriculum checklist PDF into subject rows. Year sections carry
 *  the year; each section's two tables are sem 1 and sem 2 (a "Midyear"
 *  marker makes its section sem 3). Rows already present in the checklist
 *  with the same code+year+sem are skipped (duplicates across pages). */
export async function parseCurriculumPdf(file: File | ArrayBuffer): Promise<ParsedCurriculumSubject[]> {
  const lines = await extractLines(file)
  const out: ParsedCurriculumSubject[] = []
  const seen = new Set<string>()
  let year = 0
  let semester = 1
  let midyear = false

  const push = (tokens: string[], sem: number) => {
    const subject = readSubject(tokens)
    if (!subject || !year) return
    const key = `${subject.code}|${year}|${sem}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ ...subject, year, semester: sem })
  }

  for (const lineItems of lines) {
    const [left, right] = splitLine(lineItems)
    const text = left.join(' ').toLowerCase()

    if (text.startsWith('year level')) {
      const words = left.map((t) => t.toLowerCase())
      year = YEAR_OF[words.find((w) => w in YEAR_OF) ?? ''] ?? year
      midyear = words.includes('midyear')
      semester = midyear ? 3 : 1
      continue
    }
    // A fresh header row belongs to the section's left table — the right
    // half of a section is sem 2 unless the section is the midyear (sem 3).
    if (left[0] === 'FG' && left[1] === 'CODE') continue
    // The side decides the semester: left table = the section's first
    // semester; right table = the second (the midyear has no second half).
    push(left, semester)
    if (right.length) push(right, midyear ? 3 : semester + 1)
  }
  return out.sort(
    (a, b) =>
      a.year - b.year ||
      a.semester - b.semester ||
      outcomeOrder(a.code).localeCompare(outcomeOrder(b.code)),
  )
}

/** Curriculum code order: PO-1…PO-4 before SD-…, numeric within a family —
 *  the same rule the syllabus document prints with. */
function outcomeOrder(code: string): string {
  return code.replace(/\d+/g, (d) => d.padStart(3, '0'))
}
