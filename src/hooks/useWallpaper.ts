import { useCallback, useEffect, useRef, useState } from 'react'
import { FALLBACK_IMAGE, isExtensionRuntime } from '../lib/env'
import { cacheImage, getCachedBlobUrl, pruneCache } from '../lib/imageCache'
import { batchSize, fetchPhotos, resolveSource } from '../lib/providers'
import { pingUnsplashDownload } from '../lib/providers/unsplash'
import { getItem, setItem } from '../lib/storage'
import { snapshot } from '../lib/time'
import type { Photo, Pool, SourceId } from '../lib/types'

const KEY_PINGED = 'pingedPhotoIds'
const keyPool = (s: SourceId) => `pool:${s}`
const keyIndex = (s: SourceId) => `index:${s}`

export type WallpaperApi = {
  /** The photo currently on screen, or null while on the bundled fallback. */
  photo: Photo | null
  /** URL fed to the top background layer. */
  src: string
  /** True once a real photo has faded in. */
  ready: boolean
  /** A fetch or decode is in flight. */
  busy: boolean
  /** Human-readable failure, surfaced in the context menu. */
  error: string | null
  next: () => void
  prev: () => void
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Force a full decode before the image reaches the DOM.
 *
 * Attaching a multi-megapixel JPEG and letting the browser decode during paint
 * costs a long frame. Decoding first makes the swap instantaneous, with no
 * blank frame between the old and new photo.
 */
async function decodeImage(src: string): Promise<void> {
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    // Rejects on a broken or aborted image; the <img> element will cope.
  }
}

function dedupe(photos: Photo[]): Photo[] {
  const seen = new Set<string>()
  return photos.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
}

/**
 * Wallpaper pipeline: photo pool, navigation, byte caching.
 *
 * @param preferredSource the source from settings; falls back automatically
 *        when it is unusable (e.g. Unsplash with no API key)
 * @param enabled hold off until settings have loaded, so we never fetch
 *        against the default source and then discard it
 *
 * Deliberate behaviours:
 *  - The bundled wallpaper is on screen from the first frame; a real photo only
 *    ever fades in on top. No loading spinner, no error screen — a new tab that
 *    flashes either is worse than one showing a static photo.
 *  - Photos arrive in batches and are cached as bytes, so prev/next inside the
 *    current pool is instant and works offline.
 *  - Every async path is guarded by a sequence number, so hammering "next"
 *    cannot let a slow earlier download overwrite a newer one.
 */
export function useWallpaper(preferredSource: SourceId, enabled: boolean): WallpaperApi {
  const [pool, setPool] = useState<Photo[]>([])
  const [index, setIndex] = useState(0)
  const [src, setSrc] = useState<string>(FALLBACK_IMAGE)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const objectUrlRef = useRef<string | null>(null)
  const aliveRef = useRef(true)
  const revealedRef = useRef(false)
  /** Incremented on every navigation; stale async work checks it and bails. */
  const seqRef = useRef(0)

  /** Report a first-time use to Unsplash, at most once per photo. */
  const pingOnce = useCallback(async (photo: Photo) => {
    if (!photo.downloadLocation) return
    const pinged = (await getItem<string[]>(KEY_PINGED)) ?? []
    if (pinged.includes(photo.id)) return
    await pingUnsplashDownload(photo.downloadLocation)
    // Bounded so the list cannot grow without limit.
    await setItem(KEY_PINGED, [...pinged.slice(-200), photo.id])
  }, [])

  const show = useCallback(
    async (photo: Photo) => {
      const seq = ++seqRef.current
      setBusy(true)
      try {
        let url = await getCachedBlobUrl(photo.url)
        if (!url) {
          url = await cacheImage(photo.url)
          // Only ping on a real download, not on a cache hit.
          void pingOnce(photo)
        }

        const stale = () => seq !== seqRef.current || !aliveRef.current
        if (stale()) {
          URL.revokeObjectURL(url)
          return
        }

        await decodeImage(url)
        if (stale()) {
          URL.revokeObjectURL(url)
          return
        }

        const previous = objectUrlRef.current
        objectUrlRef.current = url
        setSrc(url)
        setError(null)

        // Fade in only the first time. Later swaps are instantaneous because
        // the bytes are already decoded — toggling opacity again would flash
        // the fallback layer underneath.
        if (!revealedRef.current) {
          revealedRef.current = true
          requestAnimationFrame(() => {
            if (aliveRef.current) setReady(true)
          })
        }

        // Release the old blob once the cross-fade can no longer reference it.
        if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1200)
      } catch (err) {
        if (seq === seqRef.current && aliveRef.current) setError(describe(err))
      } finally {
        if (seq === seqRef.current && aliveRef.current) setBusy(false)
      }
    },
    [pingOnce],
  )

  /**
   * Guarantee the pool for `source` holds at least `want` photos, fetching a
   * batch if not. Existing entries are preserved so stepping backwards still
   * works after a refill.
   */
  const ensurePool = useCallback(async (source: SourceId, want: number): Promise<Photo[]> => {
    const today = snapshot().dayKey
    const cached = await getItem<Pool>(keyPool(source))

    if (cached && cached.dayKey === today && cached.photos.length >= want) {
      return cached.photos
    }

    const existing = cached?.dayKey === today ? cached.photos : []
    const fresh = await fetchPhotos(source, batchSize(source))
    const merged = dedupe([...existing, ...fresh])

    await setItem<Pool>(keyPool(source), {
      photos: merged,
      dayKey: today,
      fetchedAt: Date.now(),
    })
    void pruneCache(merged.map((p) => p.url))

    return merged
  }, [])

  const go = useCallback(
    (delta: number) => {
      void (async () => {
        const source = resolveSource(preferredSource)
        let list = pool
        let target = index + delta

        if (target < 0) {
          // Wrap to the end rather than dead-ending at the first photo.
          target = Math.max(0, list.length - 1)
        }

        if (target >= list.length) {
          try {
            const grown = await ensurePool(source, target + 1)
            if (grown.length > list.length) {
              list = grown
              setPool(grown)
            }
          } catch (err) {
            setError(describe(err))
          }
          // Bing only ever exposes 8 days, so a refill cannot grow the pool.
          // Wrap instead of leaving the user stuck.
          if (target >= list.length) target = 0
        }

        const photo = list[target]
        if (!photo) return

        setIndex(target)
        void setItem(keyIndex(source), target)
        await show(photo)
      })()
    },
    [index, pool, preferredSource, ensurePool, show],
  )

  const next = useCallback(() => go(1), [go])
  const prev = useCallback(() => go(-1), [go])

  // Load (or reload, when the source changes) the pool and show a photo.
  useEffect(() => {
    aliveRef.current = true
    if (!enabled) return

    // Dev server: no cross-origin fetch (CORS), so keep the bundled wallpaper.
    // See lib/env.ts for the rationale.
    if (!isExtensionRuntime()) return

    const source = resolveSource(preferredSource)

    void (async () => {
      setError(null)
      setBusy(true)
      try {
        const list = await ensurePool(source, 1)
        if (!aliveRef.current) return
        setPool(list)

        const savedIndex = (await getItem<number>(keyIndex(source))) ?? 0
        const i = Math.min(Math.max(0, savedIndex), list.length - 1)
        setIndex(i)

        const photo = list[i]
        if (photo) await show(photo)
      } catch (err) {
        if (aliveRef.current) setError(describe(err))
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }, [preferredSource, enabled, ensurePool, show])

  // Release the live blob URL on unmount.
  useEffect(
    () => () => {
      aliveRef.current = false
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    },
    [],
  )

  return {
    photo: pool[index] ?? null,
    src,
    ready,
    busy,
    error,
    next,
    prev,
  }
}
