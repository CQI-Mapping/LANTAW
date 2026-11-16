// SubjectMultiAssign — the checkbox list behind "assign subjects to a faculty
// member". Both the Assign Faculty module and the Course page's faculty view
// render it, so the two surfaces pick and assign the same way: check every
// subject the member should take, press Assign once, and the whole pick
// travels as one database write.
//
// Options already held by someone else carry their current instructor in the
// row, so handing a subject over is never a silent move. Removals stay
// one-at-a-time on the subject rows themselves — deliberate, rare actions.

import Icon from './icons'

export interface MultiAssignOption {
  id: string
  code: string
  title: string
  /** The instructor who currently holds the subject, when any. */
  current?: string | null
}

interface SubjectMultiAssignProps {
  /** Display name of the faculty member receiving the subjects. */
  facultyName: string
  options: MultiAssignOption[]
  /** Ids the manager has checked, waiting for the Assign press. */
  picks: string[]
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
  onAssign: () => void
  busy: boolean
  /** Shown when there is nothing left to pick — why, in one line. */
  emptyHint?: string
}

export default function SubjectMultiAssign({
  facultyName,
  options,
  picks,
  onToggle,
  onSelectAll,
  onClear,
  onAssign,
  busy,
  emptyHint,
}: SubjectMultiAssignProps) {
  const count = picks.length
  const allPicked = options.length > 0 && count === options.length

  return (
    <div className="assign-multi">
      <div className="assign-multi__head">
        <span>
          Assign subjects to <strong>{facultyName}</strong>
        </span>
        <span className="assign-multi__tools">
          {options.length > 0 && !allPicked && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onSelectAll} disabled={busy}>
              Select all ({options.length})
            </button>
          )}
          {count > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClear} disabled={busy}>
              Clear ({count})
            </button>
          )}
        </span>
      </div>
      {options.length === 0 ? (
        <p className="assign-multi__empty">{emptyHint ?? 'No subjects available to assign.'}</p>
      ) : (
        <>
          <div className="assign-multi__list" role="group" aria-label={`Subjects to assign to ${facultyName}`}>
            {options.map((o) => {
              const checked = picks.includes(o.id)
              return (
                <label key={o.id}
                  className={`assign-multi__item ${checked ? 'assign-multi__item--checked' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={busy}
                    onChange={() => onToggle(o.id)} />
                  <span className="cb-box" aria-hidden="true" />
                  <span className="assign-multi__code">{o.code}</span>
                  <span className="assign-multi__title" title={o.title}>{o.title}</span>
                  {o.current && (
                    <span className="assign-multi__current" title={`Currently taught by ${o.current}`}>
                      currently {o.current}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          <div className="assign-multi__foot">
            <button type="button" className="btn btn--primary btn--sm" onClick={onAssign} disabled={busy || count === 0}>
              {busy
                ? 'Assigning…'
                : count === 0
                  ? (<><Icon name="check" size={13} /> Assign subjects</>)
                  : (<><Icon name="check" size={13} /> Assign {count} subject{count === 1 ? '' : 's'}</>)}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
