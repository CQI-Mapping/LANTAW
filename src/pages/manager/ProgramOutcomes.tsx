// Manager Program Outcomes — organized like the rebuilt CLO page: a white
// toolbar (search + status tabs), and the outcomes grouped per CMO
// category in accordion cards with a mini-table of rows. The CRUD runs
// through the same useEntityCrud engine (audits, friendly errors), with
// the manager's rows stamped source='manager' and hard delete reserved
// to admins (RLS). The numbered reference run beside the form stays.
import { useEffect, useMemo, useState } from 'react'
import { useEntityCrud } from '../admin/curriculum/useEntityCrud.js'
import Icon from '../../components/icons'
import SuggestionInput, { type SuggestionOption } from '../../components/SuggestionInput'
import { outcomeCodeKey, buildGroups, type PoGroup } from '../../utils/report'
import {
  fetchProgramOutcomesStandalone,
  createProgramOutcomeStandalone,
  updateProgramOutcomeStandalone,
  deleteProgramOutcomeStandalone,
  fetchChedMemoOrders,
  fetchProgramEducationalObjectives,
  fetchStrategicGoals,
} from '../../services/database'
import type { ProgramOutcomeStandalone } from '../../services/database'

const FIXED_OPTIONS = [
  'COMMON TO ALL PROGRAMS IN ALL TYPES OF SCHOOLS',
  'BACHELOR OF SCIENCE IN COMPUTER SCIENCE PROGRAM OUTCOMES ',
  'COLLEGE DEFINED PROGRAM OUTCOME ',
]

const toSuggestion = (i: { code: string; title: string | null }): SuggestionOption => ({
  value: i.code,
  label: `${i.code} - ${i.title ?? ''}`.trim(),
})

const toSgSuggestion = (i: { code: string; description: string | null }): SuggestionOption => ({
  value: i.code,
  label: `${i.code.replace(/^SG-/i, 'Goal ')}: ${i.description ?? ''}`.trim(),
})

type ListTab = 'Active' | 'All' | 'Archived'

interface FormState {
  code: string
  title: string
  cmoValue: string
  peo: string
  sg: string
}

const BLANK: FormState = { code: '', title: '', cmoValue: '', peo: '', sg: '' }

export default function ProgramOutcomes() {
  // Manager create stamps source='manager' so View can separate admin vs
  // manager inputs; the load is manager-authored rows only.
  const managerCreate = async (payload: Partial<ProgramOutcomeStandalone>) =>
    createProgramOutcomeStandalone({ ...payload, source: 'manager' })
  const managerLoad = () => fetchProgramOutcomesStandalone('manager')

  const crud = useEntityCrud<ProgramOutcomeStandalone>({
    loadFn: managerLoad,
    createFn: managerCreate,
    updateFn: updateProgramOutcomeStandalone,
    deleteFn: deleteProgramOutcomeStandalone,
    scope: 'Program Outcome',
  })
  const { items, loading, error, message, busy, handleCreate, handleUpdate, handleToggleStatus } = crud

  const [cmoOptions, setCmoOptions] = useState<{ value: string; cmo_id: string | null }[]>([])
  const [peoSuggestions, setPeoSuggestions] = useState<SuggestionOption[]>([])
  const [sgSuggestions, setSgSuggestions] = useState<SuggestionOption[]>([])
  // The reader beside the add form: the manager's own active program
  // outcomes — grouped per CMO category and numbered continuously the way
  // the syllabus document prints it.
  const [readerGroups, setReaderGroups] = useState<PoGroup[]>([])

  const [listTab, setListTab] = useState<ListTab>('Active')
  const [query, setQuery] = useState('')
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(BLANK)
  const [editForm, setEditForm] = useState<FormState>(BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pos, peos, sgs, cmosAll, allPos] = await Promise.all([
          fetchProgramOutcomesStandalone('manager'),
          fetchProgramEducationalObjectives(),
          fetchStrategicGoals(),
          fetchChedMemoOrders(),
          // The read side: the manager's own rows — the reader mirrors it.
          fetchProgramOutcomesStandalone(),
        ])
        const referencedCmos = new Set(pos.map((p) => p.cmo_id).filter(Boolean) as string[])
        const cmos = cmosAll.filter(
          (c) => c.status === 'active' || referencedCmos.has(c.id),
        )
        const fixedOptions = FIXED_OPTIONS.map((v) => ({ value: v, cmo_id: null }))
        const cmoOpts = cmos.map((c) => ({
          value: `${c.title} (${c.code})`,
          cmo_id: c.id,
        }))

        if (!cancelled) {
          // Reader build: the manager's own active rows only, code order
          // (PO-1… before SD-…, numeric within each family), grouped per CMO
          // category — manager rows carry it in the description column.
          const activeManager = allPos.filter(
            (p) => p.source === 'manager' && (!p.status || p.status === 'active'),
          )
          activeManager.sort((a, b) => outcomeCodeKey(a.code).localeCompare(outcomeCodeKey(b.code)))
          setReaderGroups(buildGroups(activeManager, cmosAll))
          setCmoOptions([...fixedOptions, ...cmoOpts])
          setPeoSuggestions(peos.filter((p) => p.status === 'active').map(toSuggestion))
          setSgSuggestions(sgs.filter((s) => s.status === 'active').map(toSgSuggestion))
        }
      } catch (e) {
        crud.setError(e instanceof Error ? e.message : 'Failed to load alignment data.')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isActive = (i: ProgramOutcomeStandalone) => !i.status || i.status === 'active'
  const q = query.trim().toLowerCase()
  const categoryOf = (p: ProgramOutcomeStandalone) => (p.description || '').trim() || 'UNCATEGORIZED'

  // The prototype's grouped list: one accordion per CMO category, holding
  // the rows that survive the status tab and the search, in the same order
  // the syllabus run prints (category, then PO-1… before SD-…, numeric
  // within each family).
  const groups = useMemo(() => {
    const sorted = items
      .filter((i) => (listTab === 'All' ? true : listTab === 'Archived' ? !isActive(i) : isActive(i)))
      .filter(
        (i) =>
          !q ||
          [i.code, i.title, i.description, i.peo_text, i.sg_text].some(
            (v) => (v || '').toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => {
        const ga = categoryOf(a).toUpperCase()
        const gb = categoryOf(b).toUpperCase()
        if (ga !== gb) return ga < gb ? -1 : 1
        return outcomeCodeKey(String(a.code || '')).localeCompare(outcomeCodeKey(String(b.code || '')))
      })
    const map = new Map<string, ProgramOutcomeStandalone[]>()
    for (const p of sorted) {
      const key = categoryOf(p)
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return [...map.entries()].map(([category, rows]) => ({ category, rows }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, listTab, q])

  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0)
  const archivedCount = items.filter((i) => !isActive(i)).length
  const activeCount = items.filter((i) => isActive(i)).length

  // The family code on a category's tile: PO or SD, from its rows.
  const familyOf = (rows: ProgramOutcomeStandalone[]) => {
    const code = rows[0]?.code || ''
    return code.startsWith('SD') ? 'SD' : 'PO'
  }

  const payloadOf = (f: FormState): Partial<ProgramOutcomeStandalone> => {
    const opt = cmoOptions.find((o) => o.value === f.cmoValue)
    return {
      code: f.code.trim(),
      title: f.title.trim(),
      // Picking a CMO writes both its id and the option's display text —
      // the grouping key the page and the reader read.
      description: f.cmoValue.trim() || null,
      cmo_id: opt ? (opt.cmo_id ?? null) : null,
      peo_text: f.peo.trim() || null,
      sg_text: f.sg.trim() || null,
    } as Partial<ProgramOutcomeStandalone>
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (await handleCreate(payloadOf(form), 'program_outcome.created')) setForm(BLANK)
  }

  const startEdit = (item: ProgramOutcomeStandalone) => {
    setEditingId(item.id)
    setEditForm({
      code: item.code || '',
      title: item.title || '',
      cmoValue: item.description || '',
      peo: item.peo_text || '',
      sg: item.sg_text || '',
    })
  }

  const saveEdit = async () => {
    const target = editingId ? items.find((i) => i.id === editingId) : undefined
    if (await handleUpdate(editingId, payloadOf(editForm), 'program_outcome.updated', target)) setEditingId(null)
  }

  const renderEdit = () => (
    <div className="resource-card__edit">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Code</span>
          <input className="input input--sm" type="text" placeholder="e.g. PO-1" value={editForm.code}
            onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Program Outcome</span>
          <textarea className="input input--sm" rows={2} value={editForm.title}
            onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>CMO Alignment</span>
          <select className="input input--sm" value={editForm.cmoValue}
            onChange={(e) => setEditForm((f) => ({ ...f, cmoValue: e.target.value }))}>
            <option value="">No CMO alignment</option>
            {cmoOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Program Educational Objectives Alignment</span>
          <SuggestionInput value={editForm.peo} onChange={(v) => setEditForm((f) => ({ ...f, peo: v }))}
            options={peoSuggestions} placeholder="Type PEOs" />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Strategic Goals Alignment</span>
          <SuggestionInput value={editForm.sg} onChange={(v) => setEditForm((f) => ({ ...f, sg: v }))}
            options={sgSuggestions} placeholder="Type Strategic Goals" />
        </label>
      </div>
      <div className="program-card__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={saveEdit} disabled={busy}>
          <Icon name="check" size={13} /> Save
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingId(null)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )

  // The reader leg beside the New Program Outcome form (the CLO page's pair
  // layout): the manager's own active POs as one numbered run per CMO
  // category.
  const readerRef = (
    <aside className="panel clo-layout__ref" aria-label="Program Outcomes reference">
      <div className="clo-layout__ref-scroll">
        {readerGroups.length === 0 ? (
          <p className="clo-layout__ref-empty">No Program Outcomes yet — the first one added opens the run here.</p>
        ) : (
          readerGroups.map((group, gi) => {
            const rowBase = readerGroups.slice(0, gi).reduce((n, prior) => n + prior.items.length, 0)
            return (
              <div key={group.heading} className="clo-layout__ref-group">
                <p className="clo-layout__ref-head">{group.heading}</p>
                {group.items.map((p, i) => (
                  <div key={p.id} className="clo-layout__ref-row">
                    <span className="clo-layout__ref-num">{rowBase + i + 1}.</span>
                    <span>{p.code ? `${p.code} — ` : ''}{(p.title || '').replace(/\.$/, '')}</span>
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )

  return (
    <div className="programs-page">
      <div className="program-hero">
        <div className="program-hero__left">
          <div className="program-hero__icon">PO</div>
          <div className="program-hero__titles">
            <h2>Program Outcomes</h2>
            <p>Define the program's outcomes per CMO category and keep their alignments current.</p>
          </div>
        </div>
      </div>

      <div className="program-stats">
        <div className="program-stat">
          <div className="program-stat__label">Total</div>
          <div className="program-stat__value">{items.length}</div>
          <div className="program-stat__sub">Manager-authored outcomes</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Active</div>
          <div className="program-stat__value" style={{ color: 'var(--primary)' }}>{activeCount}</div>
          <div className="program-stat__sub">In the mapping run</div>
        </div>
        <div className="program-stat">
          <div className="program-stat__label">Archived</div>
          <div className="program-stat__value" style={{ color: 'var(--text-muted)' }}>{archivedCount}</div>
          <div className="program-stat__sub">Out of the run</div>
        </div>
      </div>

      {error && <p className="msg msg--error" role="alert">{error}</p>}
      {message && <p className="msg msg--success" role="status">{message}</p>}

      <div className="clo-layout">
        <form className="panel create-resource" onSubmit={submit} style={{ borderTop: '3px solid var(--primary)' }}>
          <h3>New Program Outcome</h3>
          <label className="field">
            <span>Code</span>
            <input className="input input--sm" type="text" placeholder="e.g. PO-1" value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
          </label>
          <label className="field">
            <span>Program Outcome</span>
            <textarea className="input input--sm" rows={2} placeholder="The outcome, worded as the CMO states it"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </label>
          <label className="field">
            <span>CMO Alignment</span>
            <select className="input input--sm" value={form.cmoValue}
              onChange={(e) => setForm((f) => ({ ...f, cmoValue: e.target.value }))}>
              <option value="">No CMO alignment</option>
              {cmoOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Program Educational Objectives Alignment</span>
            <SuggestionInput value={form.peo} onChange={(v) => setForm((f) => ({ ...f, peo: v }))}
              options={peoSuggestions} placeholder="Type PEOs" />
          </label>
          <label className="field">
            <span>Strategic Goals Alignment</span>
            <SuggestionInput value={form.sg} onChange={(v) => setForm((f) => ({ ...f, sg: v }))}
              options={sgSuggestions} placeholder="Type Strategic Goals" />
          </label>
          <div className="create-resource__submit">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {busy ? 'Saving...' : (<><Icon name="plus" size={13} /> Add</>)}
            </button>
          </div>
        </form>
        {readerRef}
      </div>

      <div className="clo-2026">
        <div className="clo26-toolbar">
          <div className="clo26-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20L15.5 15.5" /></svg>
            <input type="search" placeholder="Search code, outcome, or alignment..." value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search program outcomes" />
          </div>
          <div className="clo26-viewtabs" role="tablist" aria-label="Status view">
            {(['Active', 'All', 'Archived'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={listTab === t}
                className={`clo26-tab ${listTab === t ? 'active' : ''}`}
                onClick={() => setListTab(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="clo26-section-head">
          <p>
            Showing {shownCount} program outcome{shownCount === 1 ? '' : 's'} across {groups.length} CMO
            categor{groups.length === 1 ? 'y' : 'ies'}
          </p>
          <button type="button" className="clo26-textbtn" onClick={() => setExpandedCategory(null)}>
            Collapse all
          </button>
        </div>
        {loading ? (
          <div className="clo26-empty">Loading program outcomes…</div>
        ) : groups.length === 0 ? (
          <div className="clo26-empty">
            {query ? `No results for "${query}"` : listTab === 'Archived' ? 'No archived outcomes.' : 'No program outcomes yet — add the first one above.'}
          </div>
        ) : (
          <div className="clo26-list">
            {groups.map(({ category, rows }) => {
              const open = expandedCategory === category
              return (
                <article key={category} className={`clo26-course ${open ? 'open' : ''}`}>
                  <button type="button" className="clo26-course-head" onClick={() => setExpandedCategory(open ? null : category)}
                    aria-expanded={open}>
                    <div className="clo26-code">{familyOf(rows)}</div>
                    <div className="clo26-info">
                      <strong>{category}</strong>
                      <small>{rows.length} outcome{rows.length === 1 ? '' : 's'}</small>
                    </div>
                    <div className="clo26-meta">
                      <span className="clo26-count">{rows.filter((r) => isActive(r)).length} active</span>
                      <span className="clo26-chevron" aria-hidden="true">›</span>
                    </div>
                  </button>
                  {open && (
                    <div className="clo26-body">
                      <div className="clo26-thead">
                        <span>Code</span><span>Program outcome</span><span>Alignments</span><span />
                      </div>
                      {rows.map((row) => (
                        editingId === row.id ? (
                          <div key={row.id} className="clo26-editrow">{renderEdit()}</div>
                        ) : (
                          <div key={row.id} className="clo26-row" style={!isActive(row) ? { opacity: 0.55 } : undefined}>
                            <div className="clo26-id">{row.code}</div>
                            <div className="clo26-desc">{row.title || 'No outcome text.'}</div>
                            <div className="clo26-pos">
                              {[row.peo_text, row.sg_text].filter(Boolean).map((t) => (
                                <span key={t as string} className="clo26-tag">{t}</span>
                              ))}
                              {!row.peo_text && !row.sg_text && (
                                <span className="clo26-tag clo26-tag--muted">Not aligned</span>
                              )}
                            </div>
                            <div className="clo26-actions">
                              <button type="button" onClick={() => startEdit(row)} disabled={busy || !!editingId}>Edit</button>
                              <button type="button" onClick={() => handleToggleStatus(row, `program_outcome.${isActive(row) ? 'archived' : 'restored'}`)} disabled={busy || !!editingId}>
                                {isActive(row) ? 'Archive' : 'Restore'}
                              </button>
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
