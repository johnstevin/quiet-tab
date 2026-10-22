import { useEffect, useState } from 'react'
import { getItem, setItem } from '../lib/storage'
import { fetchWeather } from '../lib/weather'
import type { Weather } from '../lib/weather'
import type { Place } from '../lib/types'

const KEY_CACHE = 'weatherCache'
const KEY_GEO_REFUSED = 'geolocationRefused'

/** Weather moves slowly; half an hour is plenty fresh for a new tab page. */
const TTL_MS = 30 * 60 * 1000

type CacheEntry = {
  key: string
  at: number
  weather: Weather
}

/** Two decimals ~= 1km, which is far finer than weather resolution. */
function cacheKey(place: Place): string {
  return `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`
}

/**
 * Ask the browser where we are.
 *
 * Only called when no explicit city has been chosen. A refusal is remembered,
 * so we do not pop a permission prompt on every single new tab — that would be
 * genuinely obnoxious given how often this page opens.
 */
async function browserPlace(): Promise<Place | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  if (await getItem<boolean>(KEY_GEO_REFUSED)) return null

  return new Promise<Place | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          // Open-Meteo's geocoding API is forward-only (name -> coordinates),
          // so a position from the browser has no name attached. Rather than
          // pull in another third-party reverse-geocoder (and another host
          // permission), label it generically; choosing a city in the context
          // menu gives a real name.
          name: '当前位置',
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        }),
      () => {
        void setItem(KEY_GEO_REFUSED, true)
        resolve(null)
      },
      { timeout: 8000, maximumAge: TTL_MS },
    )
  })
}

export type WeatherApi = {
  weather: Weather | null
  error: string | null
  /** True while we are waiting on geolocation or the network. */
  busy: boolean
}

export function useWeather(place: Place | null, enabled: boolean): WeatherApi {
  const [weather, setWeather] = useState<Weather | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setWeather(null)
      setError(null)
      return
    }

    // NOTE: unlike the wallpaper providers and the search-suggestion endpoints,
    // Open-Meteo answers with `Access-Control-Allow-Origin: *` (verified), so
    // this works on the plain dev server too. No isExtensionRuntime() gate.

    let alive = true
    const controller = new AbortController()

    void (async () => {
      setBusy(true)
      try {
        const target = place ?? (await browserPlace())
        if (!alive) return

        if (!target) {
          // No city chosen and no position available. Show nothing rather than
          // an error — the user can pick a city from the context menu.
          setWeather(null)
          setError(null)
          return
        }

        const key = cacheKey(target)
        const cached = await getItem<CacheEntry>(KEY_CACHE)
        const fresh = cached && cached.key === key && Date.now() - cached.at < TTL_MS

        if (fresh && cached) {
          // Prefer the currently configured display name over whatever was
          // stored, so renaming a location takes effect immediately.
          if (alive) setWeather({ ...cached.weather, placeName: target.name })
          return
        }

        try {
          const next = await fetchWeather(target, controller.signal)
          if (!alive) return
          setWeather(next)
          setError(null)
          await setItem<CacheEntry>(KEY_CACHE, { key, at: Date.now(), weather: next })
        } catch (err) {
          if (!alive) return
          if (cached?.key === key) {
            // Offline: a half-hour-old reading beats an empty slot.
            setWeather({ ...cached.weather, placeName: target.name })
          } else {
            setError(err instanceof Error ? err.message : String(err))
          }
        }
      } finally {
        if (alive) setBusy(false)
      }
    })()

    return () => {
      alive = false
      controller.abort()
    }
    // Depend on the coordinates and name rather than the object identity, so a
    // re-render with an equivalent place does not refetch.
  }, [place?.lat, place?.lon, place?.name, enabled])

  return { weather, error, busy }
}
