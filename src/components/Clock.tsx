import { useClock } from '../hooks/useClock'
import { Colon, DigitPair } from './Digits'

type Props = {
  showSeconds: boolean
}

/**
 * The clock face.
 *
 * Structure is flat on purpose: fixed-width slots in a single flex row. An
 * extra wrapper per group would reintroduce a width that depends on its
 * content.
 *
 * Hiding the seconds takes the row from 6 digits + 2 colons down to 4 digits +
 * 1 colon, so the overall width changes with it. That is fine: it happens on a
 * deliberate user action, not sixty times a minute. The no-jitter guarantee is
 * about the row being immovable *while running*, and it holds in both layouts
 * because every slot remains a fixed fraction of the font size. `data-seconds`
 * selects the matching width in CSS.
 */
export function Clock({ showSeconds }: Props) {
  const { hh, mm, ss, dateText } = useClock(showSeconds)

  return (
    <div className="clock-wrap">
      {/*
        role="timer" with aria-live="off" tells assistive tech what this is
        while keeping it quiet — announcing every slot every second would be
        unusable. aria-label carries the readable value.
      */}
      <div
        className="clock"
        data-testid="clock"
        data-seconds={showSeconds ? 'on' : 'off'}
        role="timer"
        aria-live="off"
        aria-label={showSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`}
      >
        <DigitPair value={hh} />
        <Colon />
        <DigitPair value={mm} />
        {showSeconds && (
          <>
            <Colon />
            <DigitPair value={ss} />
          </>
        )}
      </div>

      <div className="clock-date" data-testid="clock-date">
        {dateText}
      </div>
    </div>
  )
}
