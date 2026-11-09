import { describe, expect, it } from 'vitest'

import { everythingTakenPrereq, normalizeCode, standingPrereqYear } from './courseCodes'

// The prerequisite parser sees the tokens exactly as the maps do: after
// normalizeCode has stripped spaces, periods and dashes, so both spellings
// recorded in the courses table ("3rd Yr. Standing" with the period,
// "3rd Yr Standing" without) must parse to the same year.
describe('standingPrereqYear', () => {
  it('reads every standing spelling the database stores', () => {
    expect(standingPrereqYear('3rd Yr Standing')).toBe(3)
    expect(standingPrereqYear('3rd Yr. Standing')).toBe(3)
    expect(standingPrereqYear('4th Yr Standing')).toBe(4)
    expect(standingPrereqYear('3rd Year Standing')).toBe(3)
    expect(standingPrereqYear('2nd Year Standing')).toBe(2)
  })

  it('is case and spacing indifferent, like normalizeCode', () => {
    expect(standingPrereqYear(normalizeCode('3rd Yr. Standing'))).toBe(3)
    expect(standingPrereqYear(normalizeCode('  4TH YR STANDING '))).toBe(4)
  })

  it('refuses ordinary subject codes and non-standing text', () => {
    expect(standingPrereqYear('IT10')).toBeNull()
    expect(standingPrereqYear('it 10')).toBeNull()
    expect(standingPrereqYear('MATH21')).toBeNull()
    expect(standingPrereqYear('')).toBeNull()
    expect(standingPrereqYear('Standing')).toBeNull()
    expect(standingPrereqYear('Yr Standing')).toBeNull()
  })

  it('accepts standing years across the map range but not absurd ones', () => {
    expect(standingPrereqYear('1st Yr Standing')).toBe(1)
    expect(standingPrereqYear('6th Yr Standing')).toBe(6)
    expect(standingPrereqYear('0th Yr Standing')).toBeNull()
    expect(standingPrereqYear('7th Yr Standing')).toBeNull()
  })
})

// IT44 stores its gate as "100% of the Profession Subjects are Taken" — the
// DB's own spelling drops the "al", so both spellings must parse, and the
// phrase must never swallow ordinary subject codes or the standing tokens.
describe('everythingTakenPrereq', () => {
  it('catches the exact text the database stores and its cleaner cousin', () => {
    expect(everythingTakenPrereq('100% of the Profession Subjects are Taken')).toBe(true)
    expect(everythingTakenPrereq('100% of the Professional Subjects are Taken')).toBe(true)
    expect(everythingTakenPrereq('100 % of professional subjects taken')).toBe(true)
  })

  it('refuses subject codes, standings, and other prose', () => {
    expect(everythingTakenPrereq('IT44')).toBe(false)
    expect(everythingTakenPrereq('3rd Yr Standing')).toBe(false)
    expect(everythingTakenPrereq('4th Yr. Standing')).toBe(false)
    expect(everythingTakenPrereq('')).toBe(false)
    expect(everythingTakenPrereq('50% of the Subjects are Taken')).toBe(false)
    expect(everythingTakenPrereq('IT13, IT15')).toBe(false)
  })
})
