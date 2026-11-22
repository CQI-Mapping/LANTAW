// Curriculum PDF import modal: pick a curriculum checklist PDF, extract its
// subject rows in-browser (pdf.js), and review every parsed row in an
// editable grid before anything is written. The program head fixes
// whatever the extraction misread — the manual-input half of the feature.
// Import creates the checked rows as courses under the page's selected
// program + curriculum; subject codes already in that program are skipped
// and counted, never duplicated.

import { useMemo, useState } from 'react'
import Icon from './icons'
import { parseCurriculumPdf, type ParsedCurriculumSubject } from '../utils/curriculumPdf'
import { createCourse, addActivityLog } from '../services/database'
import type { Course } from '../services/database'

interface CurriculumPdfImportProps {
  programId: string
  programCode?: string
  curriculumId: string
  curriculumLabel?: string
  /** The page's loaded courses — codes already in this program are skipped. */
  courses: Course[]
  onClose: () => void
  onImported: (created: number, skipped: number) => void
}

interface ReviewRow extends ParsedCurriculumSubject {
  include: boolean
  /** The curriculum family of the code (IT, GE, CCS…) — the filter chips. */
  family: string
}

/** The leading letter run of a subject code — its curriculum family. */
const familyOf = (code: string) => (code.match(/^[A-Za-z]+/)?.[0] ?? 'OTHER').toUpperCase()

const YEAR_OPTIONS = [
  { value: '1', label: '1st Year' },
  { value: '2', label: '2nd Year' },
  { value: '3', label: '3rd Year' },
  { value: '4', label: '4th Year' },
]

const SEM_OPTIONS = [
  { value: '1', label: '1st Sem' },
  { value: '2', label: '2nd Sem' },
  { value: '3', label: 'Summer' },
]

export default function CurriculumPdfImport({
  programId,
  programCode,
  curriculumId,
  curriculumLabel,
  courses,
  onClose,
  onImported,
}: CurriculumPdfImportProps) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  // The curriculum-family filter (IT, GE, CCS…): the checklist mixes
  // professional subjects with General Education and PE rows. The review
  // opens on 'All' so every parsed subject can be imported in one pass;
  // the chips narrow the grid only when the program head wants a family.
  const [family, setFamily] = useState<string>('All')

  const existingCodes = useMemo(
    () => new Set(courses.filter((c) => typeof c.program_id === 'object' ? c.program_id.id === programId : c.program_id === programId).map((c) => c.code.toUpperCase())),
    [courses, programId],
  )

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setParsing(true)
    setParseError('')
    try {
      const parsed = await parseCurriculumPdf(file)
      if (parsed.length === 0) {
        setParseError('No subject rows were found in this PDF — check that it is a curriculum checklist (Year Level tables with CODE / Course Description / Units / Pre-Req).')
        setRows(null)
      } else {
        const withFamily = parsed.map((r) => ({
          ...r,
          family: familyOf(r.code),
          // Rows whose code already exists in this program start unchecked.
          include: !existingCodes.has(r.code.toUpperCase()),
        }))
        setRows(withFamily as ReviewRow[])
        // Every family stays visible by default — 'All' is the import
        // scope; the chips narrow the grid only when explicitly picked.
        setFamily('All')
      }
    } catch (e) {
      setParseError('Failed to read the PDF: ' + (e instanceof Error ? e.message : String(e)))
      setRows(null)
    } finally {
      setParsing(false)
    }
  }

  const setRow = (index: number, patch: Partial<ReviewRow>) =>
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev))

  // The visible subset: the family chips (IT, GE, CCS…) narrow the grid,
  // and the import takes exactly what is shown and checked.
  const families = useMemo(
    () => ['All', ...[...new Set(rows?.map((r) => r.family) ?? [])].sort()],
    [rows],
  )
  const visibleRows = useMemo(
    () => (rows ?? []).filter((r) => family === 'All' || r.family === family),
    [rows, family],
  )
  const includedCount = visibleRows.filter((r) => r.include).length
  const skippedCount = includedCount === 0
    ? 0
    : visibleRows.filter((r) => r.include && existingCodes.has(r.code.toUpperCase())).length

  const handleImport = async () => {
    if (!rows) return
    const picked = visibleRows.filter((r) => r.include)
    if (picked.length === 0) return
    setBusy(true)
    let created = 0
    let skipped = 0
    try {
      for (const row of picked) {
        if (existingCodes.has(row.code.toUpperCase())) {
          skipped++
          continue
        }
        await createCourse({
          program_id: programId,
          curriculum_id: curriculumId || null,
          code: row.code.toUpperCase(),
          title: row.title,
          units: row.units,
          credit_lecture: row.units,
          credit_laboratory: 0,
          prerequisite: row.prereq,
          year_level: row.year,
          semester: row.semester,
          description: '',
        })
        created++
      }
      await addActivityLog('course.imported', {
        entity: 'course',
        label: `Curriculum PDF import — ${created} subject${created === 1 ? '' : 's'} added to ${programCode || 'the program'}`,
      })
      setResult({ created, skipped })
      onImported(created, skipped)
    } catch (e) {
      setResult(null)
      setParseError('Import failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Import curriculum from PDF">
      <div className="modal curriculum-import" style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: "'Manrope', sans-serif", fontSize: 19, margin: '0 0 4px' }}>Import curriculum from PDF</h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {programCode ? `${programCode} · ` : ''}{curriculumLabel || 'No curriculum selected'} — the subjects import into this program and curriculum.
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="field" style={{ marginBottom: 10 }}>
            <span>Curriculum checklist (PDF)</span>
            <input className="input input--sm" type="file" accept="application/pdf,.pdf"
              onChange={(e) => void handleFile(e.target.files?.[0])} disabled={parsing || busy} />
          </label>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-muted)' }}>
            The file is read in your browser — nothing is uploaded. Every parsed row is editable below before the import;
            subject codes already in this program are skipped.
          </p>
          {parsing && <p className="msg" style={{ margin: '8px 0 0' }}>Reading the PDF…</p>}
          {parseError && <p className="msg msg--error" style={{ margin: '8px 0 0' }}>{parseError}</p>}
          {result && (
            <p className="msg msg--success" style={{ margin: '8px 0 0' }}>
              Imported {result.created} subject{result.created === 1 ? '' : 's'} · skipped {result.skipped} already in this program.
            </p>
          )}
        </div>

        {rows && rows.length > 0 && (
          <>
            <div className="clo26-section-head" style={{ margin: '14px 0 8px' }}>
              <p style={{ margin: 0 }}>
                {visibleRows.length} of {rows.length} parsed rows
                {family !== 'All' && <> · family {family}</>}
              </p>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {families.map((f) => (
                  <button key={f} type="button"
                    className={`clo26-tag${family === f ? ' clo26-tag--selected' : ''}`}
                    style={{ cursor: 'pointer', border: 0, font: '600 10px \'DM Sans\', sans-serif', padding: '4px 9px' }}
                    onClick={() => setFamily(f)}
                    aria-pressed={family === f}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 8px' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {includedCount} of {visibleRows.length} rows selected for import
                {skippedCount > 0 && <> · {skippedCount} already in this program (will be skipped)</>}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRows((prev) => prev!.map((r) => ({ ...r, include: visibleRows.includes(r) ? true : r.include })))}>Select shown</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRows((prev) => prev!.map((r) => ({ ...r, include: visibleRows.includes(r) ? false : r.include })))}>Clear shown</button>
              </div>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 70px minmax(140px,1fr) 52px minmax(110px,1fr) 66px 66px', gap: 6, padding: '8px 10px', background: 'var(--bg-soft)', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: 'var(--text-muted)', position: 'sticky', top: 0 }}>
                <span>✓</span><span>Code</span><span>Course description</span><span>Units</span><span>Pre-req</span><span>Year</span><span>Sem</span>
              </div>
              {visibleRows.map((row) => {
                const index = rows.indexOf(row)
                return (
                  <div key={`${row.code}-${index}`} style={{ display: 'grid', gridTemplateColumns: '28px 70px minmax(140px,1fr) 52px minmax(110px,1fr) 66px 66px', gap: 6, padding: '6px 10px', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                    <input type="checkbox" checked={row.include} onChange={(e) => setRow(index, { include: e.target.checked })} aria-label={`Include ${row.code}`} />
                    <input className="input input--sm" value={row.code} onChange={(e) => setRow(index, { code: e.target.value.toUpperCase() })} aria-label="Code" />
                    <input className="input input--sm" value={row.title} onChange={(e) => setRow(index, { title: e.target.value })} aria-label="Course description" />
                    <input className="input input--sm" type="number" min={0} value={row.units} onChange={(e) => setRow(index, { units: Number(e.target.value) || 0 })} aria-label="Units" />
                    <input className="input input--sm" value={row.prereq} onChange={(e) => setRow(index, { prereq: e.target.value })} aria-label="Pre-req" placeholder="None" />
                    <select className="input input--sm" value={String(row.year)} onChange={(e) => setRow(index, { year: Number(e.target.value) })} aria-label="Year level">
                      {YEAR_OPTIONS.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
                    </select>
                    <select className="input input--sm" value={String(row.semester)} onChange={(e) => setRow(index, { semester: Number(e.target.value) })} aria-label="Semester">
                      {SEM_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
            <div className="create-resource__submit" style={{ marginTop: 14 }}>
              <button className="btn btn--primary btn--sm" type="button" onClick={handleImport}
                disabled={busy || includedCount === 0}>
                {busy ? 'Importing…' : (<><Icon name="plus" size={13} /> Import {includedCount} subject{includedCount === 1 ? '' : 's'}</>)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
