// Server-time calibration: the device's clock can be wrong (a manual
// mis-set, or the classic dual-boot drift where Windows and another OS
// disagree about the hardware clock) — and every greeting and date on the
// banners reads from it. An HTTP response carries the responding server's
// Date header, so one ping re-bases the app's clock onto an authoritative
// timestamp. Calibrated once per session; everything falls back to the
// device clock when no source answers.

let cachedOffset: number | null = null

/** The server's timestamp from a Date header, or null when unreadable
 *  (some gateways don't expose the header cross-origin). */
async function headerDate(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    const header = res.headers.get('date')
    if (header) return new Date(header).getTime()
  } catch {
    // Network or CORS refusal — fall through to the next source.
  }
  return null
}

/** A public time source that speaks CORS JSON (the Manila zone). */
async function worldTimeApi(): Promise<number | null> {
  try {
    const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Manila', { cache: 'no-store' })
    const body = (await res.json()) as { unixtime?: unknown; datetime?: unknown }
    if (typeof body.unixtime === 'number') return body.unixtime * 1000
    if (typeof body.datetime === 'string') return new Date(body.datetime).getTime()
  } catch {
    // Offline or blocked — fall back to the device clock.
  }
  return null
}

/** The offset (ms) to add to the device's clock for true time. Calibrates
 *  once per session: the app's own Supabase project first, then a public
 *  time service, then no offset at all. */
export async function calibrateServerTime(): Promise<number> {
  if (cachedOffset !== null) return cachedOffset
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const attempts: Promise<number | null>[] = []
  if (base) {
    attempts.push(headerDate(`${base}/auth/v1/health`))
    attempts.push(headerDate(base))
  }
  attempts.push(worldTimeApi())
  const results = await Promise.allSettled(attempts)
  for (const r of results) {
    const v = r.status === 'fulfilled' ? r.value : null
    if (v !== null && Number.isFinite(v)) {
      cachedOffset = v - Date.now()
      return cachedOffset
    }
  }
  cachedOffset = 0
  return 0
}

/** The calibrated offset in ms — 0 until calibration has answered. */
export function serverOffset(): number {
  return cachedOffset ?? 0
}
