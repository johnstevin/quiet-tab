/** Shared domain types. */

export type SourceId = 'unsplash' | 'bing'

export type EngineId = 'google' | 'bing' | 'duckduckgo'

/** A resolved weather location. */
export type Place = {
  /** Display name, or "当前位置" when it came from the browser. */
  name: string
  lat: number
  lon: number
}

/** A wallpaper, normalised across providers. */
export type Photo = {
  /** Stable per-provider id; used for cache keys and download-ping bookkeeping. */
  id: string
  /** Full-size image URL, already sized for display. */
  url: string
  /** Photo title or description. May be empty. */
  title: string
  /** Photographer / credit line. May be empty. */
  authorName: string
  /** Profile link, when the provider offers one. */
  authorUrl: string | null
  source: SourceId
  /**
   * Unsplash only. Their API Guidelines require a request to this endpoint
   * whenever a photo is actually used, so the photographer's download count
   * reflects reality. Null for providers with no such requirement.
   */
  downloadLocation: string | null
}

export type Settings = {
  source: SourceId
  /** Background blur in CSS pixels. */
  blur: number
  /** Show the seconds group in the clock. */
  showSeconds: boolean
  /** Show the search box. */
  showSearch: boolean
  /** Which engine the search box queries. */
  engine: EngineId
  /** Show the weather line. */
  showWeather: boolean
  /**
   * Explicit weather location. When null we ask the browser for a position
   * once; if that is refused the weather line simply stays hidden until a city
   * is chosen from the context menu.
   */
  place: Place | null
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'unsplash',
  blur: 8,
  showSeconds: true,
  showSearch: true,
  engine: 'google',
  showWeather: true,
  place: null,
}

export const BLUR_MIN = 0
export const BLUR_MAX = 40

/**
 * Constant overscan applied to the background layers, in CSS pixels.
 *
 * Sized once for BLUR_MAX and then never changed. It MUST NOT track the
 * current blur radius: the layers are `object-fit: cover`, so resizing them
 * re-derives the cover scale and the photo visibly zooms and drifts every time
 * the slider moves. A fixed overscan means changing the blur only swaps the
 * filter, leaving the geometry — and therefore the framing — untouched.
 *
 * 2.8x the maximum radius comfortably covers the Gaussian tail that CSS
 * `blur()` samples beyond the element's edges.
 */
export const BG_BLEED_PX = Math.ceil(BLUR_MAX * 2.8)

/** A provider's fetched photo list plus the day it was fetched. */
export type Pool = {
  photos: Photo[]
  dayKey: string
  fetchedAt: number
}
