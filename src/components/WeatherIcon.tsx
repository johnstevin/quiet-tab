import type { IconKind } from '../lib/weather'

/**
 * Weather glyphs.
 *
 * Hand-drawn thin-stroke SVG rather than an icon font or sprite sheet: nine
 * shapes do not justify a dependency or an extra request, and inline paths
 * inherit `currentColor` so they tint with the surrounding text for free.
 *
 * Style follows SF Symbols' outline set — 1.6px stroke, round caps and joins,
 * on a 24x24 grid.
 */

const CLOUD = 'M17.2 16.6H7.4a3.9 3.9 0 0 1-.42-7.77A5.4 5.4 0 0 1 17.1 9.8a3.4 3.4 0 0 1 .1 6.8Z'

/** Sun rays at 45-degree steps, drawn as eight short strokes. */
function Rays() {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4
    const inner = 6.6
    const outer = 9.2
    return {
      x1: 12 + Math.cos(angle) * inner,
      y1: 12 + Math.sin(angle) * inner,
      x2: 12 + Math.cos(angle) * outer,
      y2: 12 + Math.sin(angle) * outer,
    }
  })

  return (
    <>
      {rays.map((r, i) => (
        <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
      ))}
    </>
  )
}

function Drops({ slant = 1.1, count = 3 }: { slant?: number; count?: number }) {
  const xs = count === 2 ? [9.8, 14.2] : [8.2, 12, 15.8]
  return (
    <>
      {xs.map((x) => (
        <line key={x} x1={x} y1={19} x2={x - slant} y2={22} />
      ))}
    </>
  )
}

function Shape({ kind }: { kind: IconKind }) {
  switch (kind) {
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4.3" />
          <Rays />
        </>
      )

    case 'moon':
      // Crescent: a disc with a bite taken out, expressed as one arc pair.
      return <path d="M20 14.8A8.2 8.2 0 1 1 9.2 4a6.6 6.6 0 0 0 10.8 10.8Z" />

    case 'partly':
      return (
        <>
          <circle cx="9" cy="8.4" r="3.1" />
          <line x1="9" y1="2.6" x2="9" y2="4" />
          <line x1="4.1" y1="8.4" x2="2.7" y2="8.4" />
          <line x1="5.2" y1="4.6" x2="4.2" y2="3.6" />
          <path d="M18 18.4H9.6a3.5 3.5 0 0 1-.38-6.97A4.85 4.85 0 0 1 17.9 12.2a3.05 3.05 0 0 1 .1 6.2Z" />
        </>
      )

    case 'partly-night':
      return (
        <>
          <path d="M13.4 9.6A5 5 0 0 1 7.6 3.8a4 4 0 1 0 5.8 5.8Z" />
          <path d="M18 18.4H9.6a3.5 3.5 0 0 1-.38-6.97A4.85 4.85 0 0 1 17.9 12.2a3.05 3.05 0 0 1 .1 6.2Z" />
        </>
      )

    case 'cloud':
      return <path d={CLOUD} />

    case 'fog':
      return (
        <>
          <path d="M17.2 14.4H7.4a3.9 3.9 0 0 1-.42-7.77A5.4 5.4 0 0 1 17.1 7.6a3.4 3.4 0 0 1 .1 6.8Z" />
          <line x1="5.5" y1="18" x2="18.5" y2="18" />
          <line x1="7.8" y1="21" x2="16.2" y2="21" />
        </>
      )

    case 'drizzle':
      return (
        <>
          <path d={CLOUD} />
          <Drops count={2} slant={0.7} />
        </>
      )

    case 'rain':
      return (
        <>
          <path d={CLOUD} />
          <Drops count={3} />
        </>
      )

    case 'snow':
      return (
        <>
          <path d={CLOUD} />
          {[8.2, 12, 15.8].map((x, i) => (
            <g key={x} transform={`translate(${x} ${i === 1 ? 21 : 20.2})`}>
              <line x1="-1.8" y1="0" x2="1.8" y2="0" />
              <line x1="-0.9" y1="-1.55" x2="0.9" y2="1.55" />
              <line x1="0.9" y1="-1.55" x2="-0.9" y2="1.55" />
            </g>
          ))}
        </>
      )

    case 'thunder':
      return (
        <>
          <path d={CLOUD} />
          <path d="M13.2 18.4h-2.6l1.1 2.1h-2l3.6 3.1-.9-2.3h1.9Z" />
        </>
      )

    default:
      return <path d={CLOUD} />
  }
}

export function WeatherIcon({ kind, size = 26 }: { kind: IconKind; size?: number }) {
  // Filled shapes (the moon crescent, the lightning bolt) need no stroke, but
  // sharing one <g> keeps the markup simple — they are drawn closed so a stroke
  // just traces their own outline.
  return (
    <svg
      className="weather__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <Shape kind={kind} />
    </svg>
  )
}
