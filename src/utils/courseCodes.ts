// Shared subject/course code helpers.
//
// Codes in the database are free text and inconsistent — "IT 21", "IT21",
// "IT 21 - OOP", "IT21-OOP", "IT-21" all refer to the same subject. These
// helpers normalize a code to a comparable key and loosely match a CLO's
// `course` field against a subject code. Used by the Subject Graph and the
// Curriculum Report so both agree on which CLOs belong to which subject.

export const normalizeCode = (code: string) =>
  code.trim().toUpperCase().replace(/[\s\-–—._/,]+/g, '')

// ── Standing-typed prerequisites ──
// Some prerequisites name a classification, not a subject: "3rd Yr. Standing",
// "3rd Yr Standing", "3rd Year Standing", "4th Yr Standing". Normalized they
// all collapse to one shape ("3RDYRSTANDING"), so a typed token is enough to
// recognize every spelling the courses table actually stores. Returns the
// standing year (1–6) when the token IS a standing requirement, null when it
// is an ordinary course code. Together with everythingTakenPrereq — the two
// make up the standing family — the curriculum maps expand a member into
// connector lines from the column immediately LEFT of the dependent subject's
// own column, with the Summer-left carve-out spelled out over there.
export const standingPrereqYear = (token: string): number | null => {
  const m = normalizeCode(token).match(/^(\d+)(?:ST|ND|RD|TH)?(?:YR|YEARS?)STANDING$/)
  if (!m) return null
  const year = Number(m[1])
  return year >= 1 && year <= 6 ? year : null
}

// And some skip the classification and demand the whole program up front:
// IT44 (On-Job-Training) records "100% of the Profession Subjects are Taken"
// — the DB spells it "Profession", and both that and "Professional" must be
// caught. Same lenient recognition as standingPrereqYear (normalized first,
// so spacing, periods and commas don't matter). As a member of the standing
// family it obeys the same expansion: lines from the column immediately
// LEFT of the dependent's own column — for IT44 that is the Yr4·S1 cohort
// (IT41, IT42, IT43), refined 2026-11-09 away from the earlier
// everything-before-me version.
export const everythingTakenPrereq = (token: string): boolean => {
  const norm = normalizeCode(token)
  return norm.startsWith('100') && norm.includes('PROFESSION') && norm.includes('SUBJECTS') && norm.includes('TAKEN')
}

// ── Pre-/co-requisite reference helpers shared by the report and the graph ──
// References are free text ("IT13", "IT13 - Fundamentals of Programming 2"),
// so each token is resolved to "CODE - Title" from the loaded course list and
// de-duplicated, giving one line per course.

type CodeTitle = { code: string; title: string }

/** Comma-separated reference string → de-duplicated, trimmed tokens. */
export const listItems = (s?: string | null) =>
  Array.from(new Set((s || '').split(',').map((t) => t.trim()).filter(Boolean)))

/** Resolve a single reference to "CODE - Title", falling back to the raw text. */
export const resolvedCourseLabel = (ref: string, courses: CodeTitle[]) => {
  const norm = normalizeCode(ref)
  const exact = courses.find((c) => norm === normalizeCode(c.code))
  if (exact) return `${exact.code} - ${exact.title}`
  const lead = normalizeCode(ref.split(/[\s\-–—]+/)[0])
  const byLead = courses.find((c) => normalizeCode(c.code) === lead)
  return byLead ? `${byLead.code} - ${byLead.title}` : ref
}

/** One entry per resolved course — "IT13" and "IT13 - Fundamentals of
 *  Programming 2" collapse to a single line. */
export const uniqueResolvedRefs = (s: string, courses: CodeTitle[]) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of listItems(s)) {
    const label = resolvedCourseLabel(raw, courses)
    if (!seen.has(label)) {
      seen.add(label)
      out.push(label)
    }
  }
  return out
}

// ── Credit / contact-hour wording shared by the Curriculum Report (Syllabus.tsx)
// and the Subject Graph's About card (admin/Map.tsx), so both read the same.

export const SEMESTER_WEEKS = 18

// A subject's weekly contact hours come from its unit load, not from how those
// units are split between lecture and laboratory — a 3-unit subject runs 5
// hours a week whether it is 2L/1Lab, 1L/2Lab or 0L/3Lab, over an 18-week
// semester ("5 hours ... or 90 hours").
export const EXTRA_WEEKLY_HOURS = 2

type CreditFields = {
  units?: number | null
  credit_lecture?: number | null
  credit_laboratory?: number | null
}

/** "3 units (2 units Lecture and 1 laboratory)" — the report's V. Credit line. */
export const courseCreditLabel = (c: CreditFields) =>
  `${c.units ?? 0} units (${c.credit_lecture ?? 0} units Lecture and ${c.credit_laboratory ?? 0} laboratory)`

/** "5 hours in every week for 18 weeks, or 90 hours in a semester". */
export const courseHoursSentence = (c: CreditFields) => {
  const units = Number(c.units) || 0
  if (units <= 0) return 'No hours recorded for this subject yet.'
  const weekly = units + EXTRA_WEEKLY_HOURS
  const semester = weekly * SEMESTER_WEEKS
  return `${weekly} hours in every week for ${SEMESTER_WEEKS} weeks, or ${semester} hours in a semester`
}

const firstToken = (s: string) => {
  const m = s.trim().split(/[\s\-–—]+/)[0]
  return m || ''
}

// True when a CLO record's `course` field refers to the given subject code.
// `subjectKey` is expected to be already normalized via normalizeCode().
// Lenient: handles "IT 21", "IT21", "IT 21 - OOP", "IT21-OOP", "IT-21" etc.
export const cloMatchesSubject = (cloCourse: string, subjectKey: string) => {
  const raw = (cloCourse || '').trim()
  if (!raw) return false
  const norm = normalizeCode(raw)
  if (norm === subjectKey) return true
  if (normalizeCode(firstToken(raw)) === subjectKey) return true
  if (norm.includes(subjectKey)) return true
  const tokens = raw
    .split(/[\s,;|]+/)
    .map((s) => normalizeCode(s))
    .filter(Boolean)
  return tokens.includes(subjectKey)
}

// ── CLO display names ──
// A CLO's stored code is the bare digit run ("1") — the create/edit form
// draws "CLO" as the field's visual prefix (clo-code-input__prefix) — so
// every reader that names an outcome composes the family name here instead
// of printing the raw column: "CLO1 — IT20 — Data Structures and Algorithm",
// not "1 — IT20 — …". Older hand-typed rows may already spell the family
// ("Clo1", "CLO-2"); those print exactly what is on record. Empty in,
// empty out — the caller picks its own em-dash fallback.
export const cloLabel = (code: string | null | undefined): string => {
  const raw = (code ?? '').trim()
  if (!raw) return ''
  const digits = /^(?:CLO[-\s.]*)?(\d+)$/i.exec(raw)
  return digits ? `CLO${digits[1]}` : raw
}
