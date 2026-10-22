import type { CSSProperties } from 'react'
import { FALLBACK_IMAGE } from '../lib/env'
import { BG_BLEED_PX } from '../lib/types'

type Props = {
  src: string
  ready: boolean
  /** Blur radius in CSS pixels; 0 means off. */
  blur: number
}

/**
 * Two stacked wallpaper layers.
 *
 * The bundled image is always mounted underneath, so there is never a frame
 * without a photo. A real photo mounts on top at opacity 0 and fades in once
 * decoded.
 *
 * Both layers are sized larger than the viewport and use `object-fit: cover`,
 * so the images' intrinsic dimensions never participate in layout. A 2560px
 * JPEG arriving 400ms late therefore cannot reflow the clock.
 *
 * BLUR — and why the overscan is a CONSTANT:
 * A Gaussian blur samples past the element's edges, so a blurred layer sized
 * exactly to the viewport shows a soft transparent border all the way round.
 * The fix is to oversize the layers and let `.bg`'s `overflow: hidden` clip the
 * feathered edge away.
 *
 * The overscan must NOT be derived from the current blur radius. An earlier
 * revision used `blur * 2.5`, which meant every slider movement resized the
 * layers; because they are `object-fit: cover`, resizing re-derives the cover
 * scale and the photo visibly zoomed and drifted while dragging. Pinning the
 * overscan to a single value computed from BLUR_MAX means changing the blur
 * only swaps the `filter` — the geometry, and therefore the framing, never
 * moves.
 */
export function Background({ src, ready, blur }: Props) {
  const hasPhoto = src !== FALLBACK_IMAGE
  const enabled = blur > 0

  const style = {
    '--bg-blur': `${blur}px`,
    // Constant on every render. This is the whole point — see above.
    '--bg-bleed': `${BG_BLEED_PX}px`,
  } as CSSProperties

  return (
    <div className="bg" aria-hidden="true" style={style} data-blur={enabled ? 'on' : 'off'}>
      <img
        className="bg__layer"
        src={FALLBACK_IMAGE}
        alt=""
        decoding="sync"
        fetchPriority="high"
        draggable={false}
      />

      {hasPhoto && (
        <img
          className={`bg__layer bg__layer--top${ready ? ' is-visible' : ''}`}
          src={src}
          alt=""
          decoding="sync"
          draggable={false}
        />
      )}

      <div className="bg__scrim" />
    </div>
  )
}
