import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORM_PAGE } from './nbscForm'

// The Word export is browser-facing (saveBlob + fetched artwork), so the test
// replaces both edges and keeps the generated Blob. It checks the contract the
// Create GRASPS page depends on: the official form's file name and A4 page,
// the four artworks the chrome embeds, and a graceful fallback when an
// artwork goes missing.
let captured: { blob: Blob; filename: string } | null = null
const fetched: string[] = []
vi.mock('./download', () => ({
  saveBlob: (blob: Blob, filename: string) => {
    captured = { blob, filename }
  },
}))

import { downloadGraspsDocx } from './graspsDocx'

const TASK = {
  program: 'BS Information Technology',
  course: 'IT12 - Human-Computer Interaction',
  taskType: 'Prelim',
  term: '2nd Semester, 2025-2026',
  goal: 'Apply HCI principles to design a user-centered website.',
  role: 'You are a UX/UI Designer.',
  audience: 'Your audience includes:\n- The client\n- Potential users',
  situation: 'A client needs a new website.',
  product: 'A sketch and a digital wireframe.',
  standards: 'Your output will be evaluated on:\n1. Usability\n2. Completeness',
  preparedBy: 'Juan D. Cruz, Instructor',
}

const stubFetch = (imagesAvailable: boolean) =>
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    if (!imagesAvailable) return { ok: false }
    const bytes = readFileSync(join(process.cwd(), 'public', url.replace(/^\//, '')))
    return {
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  })

describe('downloadGraspsDocx', () => {
  beforeEach(() => {
    captured = null
    fetched.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses the model form\'s A4 page with one-inch margins', () => {
    expect(FORM_PAGE.size).toEqual({ width: 11906, height: 16838 })
    expect(FORM_PAGE.margin).toMatchObject({ top: 1440, bottom: 1440, left: 1440, right: 1440 })
  })

  it('exports the form-code file with all four form artworks embedded', async () => {
    stubFetch(true)
    await downloadGraspsDocx(TASK)

    const result = captured as { blob: Blob; filename: string }
    expect(result.filename).toBe('FM-NBSC-CID-030 GRASPS Model - HCI - Prelim.docx')
    expect(result.blob.size).toBeGreaterThan(100_000) // four artworks, not just text
    expect(fetched).toEqual([
      '/nbsc-seal.jpg',
      '/bagong-pilipinas.png',
      '/nbsc-facebook-icon.png',
      '/nbsc-mail-icon.png',
    ])
  })

  it('still exports when the artwork cannot be fetched', async () => {
    stubFetch(false)
    await downloadGraspsDocx(TASK)

    const result = captured as { blob: Blob; filename: string }
    expect(result.blob.size).toBeGreaterThan(1_000)
    expect(result.filename).toContain('FM-NBSC-CID-030')
  })
})
