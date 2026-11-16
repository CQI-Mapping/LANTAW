// Clock helpers for the dashboards' greeting banner: a time-of-day greeting
// with fixed boundaries, and a local-time ISO date for the banner's date
// pill (toISOString() is UTC and names the wrong day for Philippine
// evenings near local midnight, where the calendar has already rolled).

/** Philippine time as a Date, regardless of the device's clock setting:
 *  the device's own zone offset is read and re-based to UTC+8, so a laptop
 *  parked on another timezone still greets by the school's day. */
export function philippineNow(now: Date = new Date()): Date {
  const deviceOffsetMin = -now.getTimezoneOffset()
  const phOffsetMin = 8 * 60
  return new Date(now.getTime() + (phOffsetMin - deviceOffsetMin) * 60_000)
}

/** The day's clock, not the calendar, sets the mood: the evening runs from
 *  6 PM and carries through the small hours (12–4:59 AM), morning starts
 *  at 5, afternoon at noon. Feed it philippineNow() so the greeting reads
 *  by the school's day, not the device's. */
export function timeGreeting(now: Date): string {
  const h = now.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The date part of `now` in local time, as YYYY-MM-DD. */
export function localISODate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
