import { useCallback, useEffect, useState } from 'react'
import { ENGINE_ORDER } from '../lib/search'
import { getItem, setItem } from '../lib/storage'
import { BLUR_MAX, BLUR_MIN, DEFAULT_SETTINGS } from '../lib/types'
import type { EngineId, Place, Settings } from '../lib/types'

const KEY = 'settings'

function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<Place>
  return (
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon)
  )
}

function isEngine(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_ORDER as string[]).includes(value)
}

/**
 * Coerce whatever came out of storage into a valid Settings object.
 *
 * Persisted data is untrusted: it may predate a schema change, or have been
 * edited by hand in DevTools. A new tab page must not break because of a stray
 * value, so every field is clamped or defaulted rather than validated-and-
 * thrown.
 */
function sanitize(raw: Partial<Settings> | null): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  const blur = Number(merged.blur)

  return {
    source: merged.source === 'bing' ? 'bing' : 'unsplash',
    blur: Math.round(Math.min(BLUR_MAX, Math.max(BLUR_MIN, Number.isFinite(blur) ? blur : 0))),
    // Explicit `!== false` so a field missing from older storage defaults to on.
    showSeconds: merged.showSeconds !== false,
    showSearch: merged.showSearch !== false,
    engine: isEngine(merged.engine) ? merged.engine : 'google',
    keepHistory: merged.keepHistory !== false,
    showWeather: merged.showWeather !== false,
    place: isPlace(merged.place) ? merged.place : null,
  }
}

export type SettingsApi = {
  settings: Settings
  /**
   * False until persisted settings have been read.
   *
   * Consumers that act on `source` must wait for this, otherwise the first
   * render would kick off a fetch against the DEFAULT source and immediately
   * have to throw it away — burning an Unsplash rate-limit slot for nothing.
   */
  loaded: boolean
  update: (patch: Partial<Settings>) => void
}

/**
 * App-wide preferences.
 *
 * Owned here rather than inside a feature hook because the fields span three
 * features now: the clock reads `showSeconds`, the background reads `blur` and
 * `source`, the search box reads `engine`, and the weather reads `place`.
 */
export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true

    void (async () => {
      const raw = await getItem<Partial<Settings>>(KEY)
      if (!alive) return
      setSettings(sanitize(raw))
      setLoaded(true)
    })()

    return () => {
      alive = false
    }
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      const next = sanitize({ ...previous, ...patch })
      // Skip the write and the re-render when nothing actually moved — the blur
      // slider fires a change event for every pixel of travel. The object is a
      // handful of scalars plus one small record, so a structural compare is
      // both cheaper and less error-prone than field-by-field.
      if (JSON.stringify(next) === JSON.stringify(previous)) return previous
      void setItem(KEY, next)
      return next
    })
  }, [])

  return { settings, loaded, update }
}
