// The dashboards' clock, calibrated against the server: it ticks every
// minute like the plain clock, but the device's own skew (a mis-set time,
// or dual-boot drift) is corrected by the offset fetched from an HTTP
// Date header once on mount. Falls back to the device clock when no
// server answers.

import { useEffect, useState } from 'react'
import { calibrateServerTime, serverOffset } from '../utils/serverTime'

export function useServerClock(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  const [offset, setOffset] = useState(() => serverOffset())

  useEffect(() => {
    let alive = true
    calibrateServerTime().then((off) => {
      if (alive) setOffset(off)
    })
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [intervalMs])

  return new Date(now.getTime() + offset)
}
