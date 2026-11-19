/** The form's fixed scoring scale - the same table the model GRASPS
 *  document prints after the analytic rubric. */
export const SCORING_INTERPRETATION: ReadonlyArray<{ range: string; level: string }> = [
  { range: '90–100', level: 'Outstanding' },
  { range: '80–89', level: 'Very Satisfactory' },
  { range: '75–79', level: 'Satisfactory' },
  { range: '60–74', level: 'Needs Improvement' },
  { range: 'Below 60', level: 'Beginning' },
]
