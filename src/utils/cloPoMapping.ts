// Which program outcomes each learning outcome is mapped to.
//
// clo_po_matrix exists in the schema and has a service layer, but it holds no
// rows and no page writes to it. The mapping that has actually been entered is
// in the learning outcome's TITLE field, as a list of codes:
//
//     CLO1  IT21  "PO-12, PO-6"
//     CLO2  IT21  "PO-8, PO-14"
//
// So this reads it from there, and says so wherever the report shows a number
// derived from it. The alternative -- leaving the mapping panels empty while the
// only mapping data in the system sits unread -- would be worse, and the
// extraction is narrow on purpose:
//
//   - It matches PO<number> and nothing else. A course called "IT-PO 4" or a
//     title mentioning "PO Box" cannot produce a link.
//   - A code that resolves to no outcome is dropped, not counted. An alignment
//     to a program outcome that does not exist cannot go into a report meant to
//     be evidence, so those are reported separately as unresolved.
//   - It matches on the punctuation-insensitive key, so "PO-12" finds an outcome
//     stored as "PO 12" -- the same fold the outcome grouping uses, which is why
//     that key lives in alignment.ts.
//
// Pure, like the rest of the report's data layer.

import type { CourseLearningOutcomeStandalone } from '../services/database'
import { anchorKey } from './alignment'
import type { PoOutcome } from './alignment'

/** A "PO" followed by a number, and nothing looser. */
const PO_CODE = /PO[\s-]?(\d+)/gi

/** One learning outcome and the outcomes it names. */
export interface CloLink {
  clo: CourseLearningOutcomeStandalone
  /** Program outcome keys this CLO names, resolved and deduplicated. */
  poKeys: string[]
  /** Codes that looked like a PO but name no outcome on file. */
  unresolved: string[]
}

export interface PoCoverageRow {
  outcome: PoOutcome
  /** Learning outcomes naming this outcome. */
  cloCount: number
  /** Share of ALL the program's learning outcomes. */
  percent: number
  /** Share of the learning outcomes that name any outcome at all. */
  percentOfMapped: number
}

export interface MappingReport {
  links: CloLink[]
  /** Per program outcome, in outcome order. */
  coverage: PoCoverageRow[]
  totalClos: number
  /** Learning outcomes naming at least one outcome on file. */
  mappedClos: number
  /** Percent of all learning outcomes, to one decimal. */
  coveragePercent: number
  /** Learning outcomes naming nothing that resolves. */
  gaps: CloLink[]
  /** Codes that looked like a PO but name nothing. */
  unresolvedCodes: string[]
}

/** Every PO code named in a learning outcome's free text, deduplicated. */
export function extractPoCodes(raw: string | null | undefined): string[] {
  const found = new Set<string>()
  for (const m of (raw || '').matchAll(PO_CODE)) {
    found.add(`PO${m[1]}`)
  }
  return [...found]
}

/**
 * Outcome codes as they are drawn, not as they were typed: the database
 * writes "PO 12" and "PO-14" into the same outcome (the punctuation fold
 * keys them together), and a chart that kept every letter of whichever
 * spelling won the count would show the one family under two names. Any run
 * of separators becomes a single space, so every chart on the report spells
 * the family the same way: "PO 14" -- "PO 12" -- "GOAL 3" -- whatever is in
 * the record, presented once.
 */
export function poLabel(code: string): string {
  return code.trim().replace(/[^A-Za-z0-9]+/g, ' ')
}

/**
 * Build the mapping report.
 *
 * `outcomes` is the deduplicated outcome list, so a link points at one outcome
 * however many ways its code has been spelled in the database.
 */
export function buildMappingReport(
  clos: CourseLearningOutcomeStandalone[],
  outcomes: PoOutcome[],
): MappingReport {
  const known = new Map(outcomes.map((o) => [o.key, o]))

  const links: CloLink[] = clos.map((clo) => {
    // Title first, then description: the title is where the codes were entered,
    // but a description that names outcomes is still a claim about mapping.
    const tokens = [
      ...extractPoCodes(clo.title),
      ...extractPoCodes(clo.description),
    ]
    const unique = [...new Set(tokens)]
    return {
      clo,
      poKeys: unique.filter((k) => known.has(k)),
      unresolved: unique.filter((k) => !known.has(k)),
    }
  })

  const perOutcome = new Map<string, Set<string>>()
  for (const link of links) {
    for (const key of link.poKeys) {
      const set = perOutcome.get(key) ?? new Set<string>()
      set.add(link.clo.id)
      perOutcome.set(key, set)
    }
  }

  const totalClos = clos.length
  const mappedClos = links.filter((l) => l.poKeys.length > 0).length

  return {
    links,
    coverage: outcomes.map((outcome) => {
      const cloCount = perOutcome.get(outcome.key)?.size ?? 0
      return {
        outcome,
        cloCount,
        percent: totalClos === 0 ? 0 : Math.round((cloCount / totalClos) * 100),
        percentOfMapped: mappedClos === 0 ? 0 : Math.round((cloCount / mappedClos) * 100),
      }
    }),
    totalClos,
    mappedClos,
    coveragePercent:
      totalClos === 0 ? 0 : Math.round((mappedClos / totalClos) * 1000) / 10,
    gaps: links.filter((l) => l.poKeys.length === 0),
    unresolvedCodes: [...new Set(links.flatMap((l) => l.unresolved))].sort(),
  }
}

/**
 * The outcomes worth charting: those a learning outcome names, plus one bar for
 * the ones none does.
 *
 * A bar per outcome would mean 27 columns in a third-width panel, of which 23
 * are the same 2% stub. So the chart shows the covered outcomes and folds the
 * remainder into one "no CLO mapped" bar -- which is the finding, and is exactly
 * what the "No Mapping" entry in the matrix legend does.
 */
export function chartableOutcomes(report: MappingReport, limit = 12): {
  rows: PoCoverageRow[]
  uncovered: number
  /** The uncovered codes themselves, chart order — a bare count strands
   *  questions like "where is PO 2?" with nothing to point at. */
  uncoveredCodes: string[]
  hidden: number
} {
  // Chart order is outcome order, not entry order: the fold keys are uniform
  // "PO 6" shapes, so numeric collation walks 1, 6, 8, 12, 14 in one run. The
  // display code cannot be the sort key — canonical spellings mix separators
  // across families ("PO 12" beside "PO-14"), and the collation reads that
  // separator before it reads the digits, so space-spelled families cluster
  // before hyphen-spelled ones instead of the numbers deciding.
  const byKey = (a: { outcome: PoOutcome }, b: { outcome: PoOutcome }) =>
    a.outcome.key.localeCompare(b.outcome.key, undefined, { numeric: true })
  const covered = report.coverage.filter((r) => r.cloCount > 0).sort(byKey)
  const rows = covered.slice(0, limit)
  const uncoveredCodes = report.coverage
    .filter((r) => r.cloCount === 0)
    .sort(byKey)
    .map((r) => poLabel(r.outcome.code))
  const uncovered = uncoveredCodes.length
  const hidden = Math.max(covered.length - limit, 0)
  return { rows, uncovered, uncoveredCodes, hidden }
}

/**
 * The complete axis: every outcome on file draws as its own bar, in outcome
 * order — uncovered outcomes stay in the chart as 0% stubs instead of folding
 * into one "None" bar. chartableOutcomes folds to spare a panel's width; the
 * brief's coverage chart wanted the opposite (the official 17-PO column
 * list), so the reader can point at the exact grey PO and hover it for the
 * same pointer the covered bars get. The universe stays the caller's to
 * narrow: hand it a report built on the official outcomes only, or the axis
 * grows past the framework the Program Outcomes page offers.
 */
export function chartCompleteOutcomes(report: MappingReport): {
  rows: PoCoverageRow[]
  uncovered: number
  /** The zero-coverage codes themselves, chart order — the footnote can
   *  spell them out once the width question is off. */
  uncoveredCodes: string[]
  hidden: number
} {
  // Same key-based run as chartableOutcomes: display spellings mix
  // separators, and the collation reads a separator before it reads digits.
  const byKey = (a: { outcome: PoOutcome }, b: { outcome: PoOutcome }) =>
    a.outcome.key.localeCompare(b.outcome.key, undefined, { numeric: true })
  const rows = [...report.coverage].sort(byKey)
  const uncoveredCodes = rows
    .filter((r) => r.cloCount === 0)
    .map((r) => poLabel(r.outcome.code))
  return { rows, uncovered: uncoveredCodes.length, uncoveredCodes, hidden: 0 }
}

/** Anchor keys in play, for the matrix's column list. */
export const anchorKeysOf = (report: MappingReport): string[] => {
  const used = new Set(report.links.flatMap((l) => l.poKeys))
  return [...used].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** What a cell in the matrix holds. */
export interface MatrixLine {
  code: string
  description: string
  courseCode: string
  /** Anchor keys this outcome names. */
  poKeys: string[]
}

/**
 * One row per learning outcome, for the matrix.
 *
 * Built from the learning outcome list rather than from the links, so an
 * outcome that names nothing still gets a row of dashes -- a matrix built only
 * from the links would hide exactly what it exists to expose.
 */
export function matrixRows(
  report: MappingReport,
  courseCodeOf: (courseId: string) => string,
): MatrixLine[] {
  return report.links.map((link) => ({
    code: link.clo.code.trim(),
    description: (link.clo.title || link.clo.description || '').trim(),
    courseCode: courseCodeOf(link.clo.course),
    poKeys: link.poKeys,
  }))
}

/** Re-exported so callers do not reach past this module for the key rule. */
export { anchorKey }
