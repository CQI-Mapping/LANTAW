// Curriculum PDF import: pick a curriculum checklist PDF, read it in the
// browser (pdf.js), and write every parsed subject straight into the
// manager's selected program + curriculum. Codes already in that program
// are skipped and counted; on success the dialog closes and the plan view
// refreshes with the new subjects in their year/semester tables.

import { useMemo, useState } from 'react'
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

export default function CurriculumPdfImport({
  programId,
  programCode,
  curriculumId,
  curriculumLabel,
  courses,
  onClose,
  onImported,
}: CurriculumPdfImportProps) {
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)

  const existingCodes = useMemo(
    () =>
      new Set(
        courses
          .filter((c) =>
            typeof c.program_id === 'object' ? c.program_id.id === programId : c.program_id === programId,
          )
          .map((c) => c.code.toUpperCase()),
      ),
    [courses, programId],
  )

  const importAll = async (parsed: ParsedCurriculumSubject[]) => {
    setParsing(true)
    setError('')
    let created = 0
    let skipped = 0
    try {
      for (const row of parsed) {
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
      // Straight back to the Curriculum Structure with the tables refreshed.
      onClose()
    } catch (e) {
      setError('Import failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setParsing(false)
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setParsing(true)
    setError('')
    setResult(null)
    try {
      const parsed = await parseCurriculumPdf(file)
      if (parsed.length === 0) {
        setError(
          'No subject rows were found in this PDF — check that it is a curriculum checklist (Year Level tables with CODE / Course Description / Units / Pre-Req).',
        )
        setParsing(false)
        return
      }
      // No review step: every parsed subject is written in one pass.
      await importAll(parsed)
    } catch (e) {
      setError('Failed to read the PDF: ' + (e instanceof Error ? e.message : String(e)))
      setParsing(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Import curriculum from PDF">
      <div className="modal curriculum-import" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: "'Manrope', sans-serif", fontSize: 19, margin: '0 0 4px' }}>
              Import curriculum from PDF
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {programCode ? `${programCode} · ` : ''}
              {curriculumLabel || 'No curriculum selected'} — subjects import directly into this program and curriculum.
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="field" style={{ marginBottom: 10 }}>
            <span>Curriculum checklist (PDF)</span>
            <input
              className="input input--sm"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              disabled={parsing}
            />
          </label>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
            The file is read in your browser — nothing is uploaded. Every parsed subject is added to the
            curriculum plan; subject codes already in this program are skipped automatically.
          </p>
          {parsing && (
            <p className="msg" style={{ margin: '12px 0 0' }}>
              Reading the PDF and importing subjects…
            </p>
          )}
          {error && (
            <p className="msg msg--error" style={{ margin: '12px 0 0' }}>
              {error}
            </p>
          )}
          {result && (
            <p className="msg msg--success" style={{ margin: '12px 0 0' }}>
              Imported {result.created} subject{result.created === 1 ? '' : 's'} · skipped {result.skipped}{' '}
              already in this program.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
