import { useEffect, useRef, useState } from 'react'
import { sameSnapshot, snapshot } from '../lib/time'
import type { ClockSnapshot } from '../lib/time'

/**
 * Fire a few milliseconds AFTER the second boundary rather than exactly on it.
 * `setTimeout` may run marginally early, and landing at 999.7ms would read the
 * previous second and visibly stall the display for a full tick.
 */
const BOUNDARY_GUARD_MS = 8

/**
 * A clock that does not drift, does not skip, and does not shift the layout.
 *
 * Three distinct problems are solved here:
 *
 * 1. FIRST PAINT (fix 2) — `useState` is seeded with a real snapshot via an
 *    initialiser function, so the very first render already contains a complete
 *    "10:13:09". Without this the box would render empty and then grow, pushing
 *    the date line down: a textbook layout shift.
 *
 * 2. DRIFT (fix 3) — `setInterval(fn, 1000)` accumulates error: each callback
 *    is late by a little, and that lateness compounds until the clock visibly
 *    skips a second to catch up. Instead, every round re-derives its delay from
 *    the wall clock, so error can never accumulate.
 *
 * 3. THROTTLING (fix 3) — Chrome aggressively throttles timers in background
 *    tabs and may coalesce the backlog on return, producing a burst of rapid
 *    ticks. Visibility/focus events drop the stale timer, resync immediately,
 *    and re-align to the next boundary.
 */
export function useClock(showSeconds = true): ClockSnapshot {
  const [now, setNow] = useState<ClockSnapshot>(() => snapshot())

  // Read inside the timer callback without re-creating the timer when the
  // setting changes — tearing down and rebuilding the schedule would skip a
  // tick.
  const showSecondsRef = useRef(showSeconds)
  showSecondsRef.current = showSeconds

  // Toggling the seconds group on must repaint immediately rather than waiting
  // for the next boundary, otherwise the revealed seconds would be stale by up
  // to a second.
  useEffect(() => {
    setNow(snapshot())
  }, [showSeconds])

  useEffect(() => {
    let timer: number | undefined
    let disposed = false

    const schedule = (): void => {
      if (disposed) return
      // Distance to the next whole second, recomputed from scratch every time.
      const delay = 1000 - (Date.now() % 1000) + BOUNDARY_GUARD_MS
      timer = window.setTimeout(tick, delay)
    }

    function tick(): void {
      if (disposed) return
      setNow((prev) => {
        const next = snapshot()
        // Returning `prev` (the identical reference) makes React skip the
        // re-render entirely.
        return sameSnapshot(prev, next, showSecondsRef.current) ? prev : next
      })
      schedule()
    }

    /**
     * Back in the foreground: whatever timer we had is untrustworthy. Clear it,
     * paint the true current time at once, then re-align.
     */
    const resync = (): void => {
      if (document.visibilityState === 'hidden') return
      if (timer !== undefined) window.clearTimeout(timer)
      tick()
    }

    schedule()
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('focus', resync)
    // Fires when restored from the back/forward cache, where timers were frozen.
    window.addEventListener('pageshow', resync)

    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('focus', resync)
      window.removeEventListener('pageshow', resync)
    }
  }, [])

  return now
}
