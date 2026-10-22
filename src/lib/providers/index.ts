import { hasUnsplashKey } from '../env'
import type { Photo, SourceId } from '../types'
import { fetchBingPhotos } from './bing'
import { fetchUnsplashPhotos } from './unsplash'

export type SourceDescriptor = {
  id: SourceId
  label: string
  /** False when the source cannot run — e.g. Unsplash with no API key. */
  available: boolean
  /** Shown in the context menu when unavailable. */
  unavailableHint?: string
}

export function listSources(): SourceDescriptor[] {
  return [
    {
      id: 'unsplash',
      label: 'Unsplash',
      available: hasUnsplashKey(),
      ...(hasUnsplashKey() ? {} : { unavailableHint: '需配置 Access Key' }),
    },
    { id: 'bing', label: 'Bing 每日', available: true },
  ]
}

/** How many photos to pull per request. */
export function batchSize(source: SourceId): number {
  // Bing caps out at 8 (one per past day). For Unsplash a larger batch means
  // fewer requests against the 50/hour allowance.
  return source === 'bing' ? 8 : 12
}

export function fetchPhotos(
  source: SourceId,
  count: number,
  signal?: AbortSignal,
): Promise<Photo[]> {
  return source === 'unsplash'
    ? fetchUnsplashPhotos(count, signal)
    : fetchBingPhotos(count, signal)
}

/**
 * Resolve the source to actually use.
 *
 * Unsplash is the default, but a missing key would leave the page with no
 * wallpaper at all — so degrade to Bing rather than failing.
 */
export function resolveSource(preferred: SourceId): SourceId {
  if (preferred === 'unsplash' && !hasUnsplashKey()) return 'bing'
  return preferred
}
