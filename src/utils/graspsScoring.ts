/** The form's fixed scoring scale - the same table the model GRASPS
 *  document prints after the analytic rubric. */
export interface GraspsScoringRow {
  range: string
  level: string
}

export const SCORING_INTERPRETATION: ReadonlyArray<GraspsScoringRow> = [
  { range: '90–100', level: 'Outstanding' },
  { range: '80–89', level: 'Very Satisfactory' },
  { range: '75–79', level: 'Satisfactory' },
  { range: '60–74', level: 'Needs Improvement' },
  { range: 'Below 60', level: 'Beginning' },
]


export interface GraspsScoringRow {
  range: string
  level: string
}

/** A fresh copy of the college's default bands - drafts get their own
 *  rows so editing never mutates the shared constant. */
export function defaultScoring(): GraspsScoringRow[] {
  return SCORING_INTERPRETATION.map((s) => ({ range: s.range, level: s.level }))
}
