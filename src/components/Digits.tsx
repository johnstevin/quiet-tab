import { memo } from 'react'

/**
 * One glyph inside a fixed-width slot.
 *
 * The slot width comes from `--digit-slot` in main.css and depends only on
 * font-size — never on the glyph. This is the structural guarantee that makes
 * horizontal displacement mathematically zero rather than merely small.
 */
export const Digit = memo(function Digit({ char }: { char: string }) {
  return <span className="clock__digit">{char}</span>
})

/**
 * A two-digit group (hours, minutes or seconds).
 *
 * Memoised on `value`, so a seconds tick cannot re-render the hour or minute
 * groups — their props are referentially identical 3599 ticks out of 3600
 * (fix 4).
 */
export const DigitPair = memo(function DigitPair({ value }: { value: string }) {
  // noUncheckedIndexedAccess is on. `value` is always a 2-char padded string
  // from lib/time, so the fallbacks are unreachable but must be stated.
  return (
    <>
      <Digit char={value[0] ?? '0'} />
      <Digit char={value[1] ?? '0'} />
    </>
  )
})

/** Separator in its own narrower slot. Never re-renders: it takes no props. */
export const Colon = memo(function Colon() {
  return <span className="clock__colon">:</span>
})
