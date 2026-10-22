import type { Place } from './types'

/**
 * Weather via Open-Meteo.
 *
 * Chosen over OpenWeather / 和风 for one decisive reason: it needs NO API key.
 * Any key shipped in a client-side extension is readable by anyone who unzips
 * it, so an keyless provider removes the exposure entirely rather than
 * mitigating it. Free for non-commercial use, CORS-enabled, no registration.
 */

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search'

export type IconKind =
  | 'sun'
  | 'moon'
  | 'partly'
  | 'partly-night'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder'

export type Weather = {
  /** Celsius, rounded. */
  temp: number
  apparent: number
  /** Percent. */
  humidity: number
  /** km/h. */
  wind: number
  high: number
  low: number
  /** Raw WMO code, kept for debugging. */
  code: number
  label: string
  icon: IconKind
  isDay: boolean
  placeName: string
}

/**
 * WMO 4677 present-weather codes, as used by Open-Meteo.
 * https://open-meteo.com/en/docs — "Weather variable documentation".
 */
const WMO_LABELS: Record<number, string> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '冻雾',
  51: '小毛雨',
  53: '毛雨',
  55: '大毛雨',
  56: '冻毛雨',
  57: '强冻毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴阵雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷雨',
  96: '雷雨伴冰雹',
  99: '强雷雨伴冰雹',
}

function labelFor(code: number): string {
  return WMO_LABELS[code] ?? '未知'
}

function iconFor(code: number, isDay: boolean): IconKind {
  if (code === 0) return isDay ? 'sun' : 'moon'
  if (code === 1 || code === 2) return isDay ? 'partly' : 'partly-night'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'thunder'
  return 'cloud'
}

type ForecastPayload = {
  current?: {
    temperature_2m?: number
    apparent_temperature?: number
    relative_humidity_2m?: number
    wind_speed_10m?: number
    weather_code?: number
    is_day?: number
  }
  daily?: {
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
  }
}

export async function fetchWeather(place: Place, signal?: AbortSignal): Promise<Weather> {
  const url =
    `${FORECAST_API}?latitude=${place.lat.toFixed(4)}&longitude=${place.lon.toFixed(4)}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=1'

  const res = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) })
  if (!res.ok) throw new Error(`天气接口返回 HTTP ${res.status}`)

  const data = (await res.json()) as ForecastPayload
  const current = data.current
  if (!current || typeof current.temperature_2m !== 'number') {
    throw new Error('天气接口返回的数据不完整')
  }

  const code = current.weather_code ?? 0
  const isDay = current.is_day !== 0

  return {
    temp: Math.round(current.temperature_2m),
    apparent: Math.round(current.apparent_temperature ?? current.temperature_2m),
    humidity: Math.round(current.relative_humidity_2m ?? 0),
    wind: Math.round(current.wind_speed_10m ?? 0),
    high: Math.round(data.daily?.temperature_2m_max?.[0] ?? current.temperature_2m),
    low: Math.round(data.daily?.temperature_2m_min?.[0] ?? current.temperature_2m),
    code,
    label: labelFor(code),
    icon: iconFor(code, isDay),
    isDay,
    placeName: place.name,
  }
}

type GeocodePayload = {
  results?: Array<{
    name?: string
    admin1?: string
    country?: string
    latitude?: number
    longitude?: number
  }>
}

/**
 * City search. `language=zh` makes Open-Meteo return Chinese place names
 * (verified: "Seattle" -> "西雅圖 / 华盛顿州 / 美国").
 */
export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const text = query.trim()
  if (!text) return []

  const url = `${GEOCODE_API}?name=${encodeURIComponent(text)}&count=5&language=zh&format=json`
  const res = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) })
  if (!res.ok) throw new Error(`城市搜索返回 HTTP ${res.status}`)

  const data = (await res.json()) as GeocodePayload

  return (data.results ?? []).flatMap((r) => {
    if (!r.name || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return []
    // Qualify with region/country so duplicates are distinguishable — a search
    // for "Seattle" legitimately returns one in the USA and one in Mexico.
    const qualifier = [r.admin1, r.country].filter(Boolean).join('·')
    return [
      {
        name: qualifier ? `${r.name} · ${qualifier}` : r.name,
        lat: r.latitude,
        lon: r.longitude,
      },
    ]
  })
}

/** Short label for the UI — drops the region qualifier. */
export function shortPlaceName(name: string): string {
  const head = name.split(' · ')[0]
  return head ?? name
}
