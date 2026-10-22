/**
 * Pure time formatting. No React, no side effects — so the verification script
 * and any future unit tests can exercise the exact same logic.
 */

export type ClockSnapshot = {
  /** Zero-padded 24h hour, "00".."23". */
  hh: string
  /** Zero-padded minute, "00".."59". */
  mm: string
  /** Zero-padded second, "00".."59". */
  ss: string
  /** Rendered Chinese date, e.g. "10月22日星期四". */
  dateText: string
  /** Calendar-day identity. Cheap way to notice a date rollover. */
  dayKey: string
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** Faster and allocation-free compared with String.padStart for a 0..59 range. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Read the wall clock and format everything at once.
 *
 * Always derived from a real `Date` — never from an incrementing counter. That
 * is what makes the clock immune to timer drift, to the user changing the
 * system clock, and to DST / timezone transitions (fix 3).
 */
export function snapshot(d: Date = new Date()): ClockSnapshot {
  const month = d.getMonth() + 1
  const day = d.getDate()
  // noUncheckedIndexedAccess is on; getDay() is always 0..6 so the fallback is
  // unreachable, but the compiler needs it stated.
  const weekday = WEEKDAYS[d.getDay()] ?? ''

  return {
    hh: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
    dateText: `${month}月${day}日星期${weekday}`,
    dayKey: `${d.getFullYear()}-${pad2(month)}-${pad2(day)}`,
  }
}

/**
 * Value equality for a snapshot.
 *
 * Ordered cheapest-and-most-volatile first: `ss` changes every tick, so the
 * comparison short-circuits on the first field 59 times out of 60.
 *
 * Used to return the SAME object reference when nothing changed, which lets
 * React bail out of re-rendering the entire subtree (fix 4).
 *
 * @param withSeconds when false, seconds are ignored, so a tick that only
 *        moved the second counter compares equal and triggers no render at all.
 *        That turns 60 wasted renders per minute into 1 while the seconds group
 *        is hidden.
 */
export function sameSnapshot(a: ClockSnapshot, b: ClockSnapshot, withSeconds = true): boolean {
  if (withSeconds && a.ss !== b.ss) return false
  return a.mm === b.mm && a.hh === b.hh && a.dayKey === b.dayKey
}
