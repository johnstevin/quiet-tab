/**
 * Image byte cache.
 *
 * Bytes live in the Cache Storage API rather than chrome.storage.local because
 * Cache Storage holds native binary, does not count against the 10 MB extension
 * storage quota, and works offline. A cache hit yields a `blob:` URL, so
 * reopening a tab touches the network zero times.
 *
 * Photo metadata (the pool, the current index, settings) is small JSON and goes
 * through lib/storage.ts instead.
 */

const CACHE_NAME = 'quiet-tab-bg-v2'

/**
 * Upper bound on stored images. Prev/next browsing would otherwise accumulate
 * a few megabytes per photo forever. 12 covers a full Unsplash batch, so
 * stepping back and forth within the current pool stays offline-instant.
 */
const MAX_ENTRIES = 12

function available(): boolean {
  return typeof caches !== 'undefined'
}

/**
 * Return a `blob:` URL for `url` if its bytes are cached, else null.
 * Callers own the returned URL and must revoke it.
 */
export async function getCachedBlobUrl(url: string): Promise<string | null> {
  if (!available()) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(url)
    if (!hit) return null
    return URL.createObjectURL(await hit.blob())
  } catch {
    return null
  }
}

/**
 * Download `url`, store the bytes, and return a `blob:` URL for immediate use.
 * Throws if the download fails; callers fall back to the bundled wallpaper.
 */
export async function cacheImage(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`图片下载失败：HTTP ${res.status}`)

  if (available()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      // Clone before reading the body — a Response body is single-use.
      await cache.put(url, res.clone())
    } catch {
      // Out of disk or quota: still show the photo, just re-fetch next time.
    }
  }

  return URL.createObjectURL(await res.blob())
}

/**
 * Trim the cache to MAX_ENTRIES, evicting oldest-first but always keeping
 * anything in `keepUrls` (the current pool).
 */
export async function pruneCache(keepUrls: string[]): Promise<void> {
  if (!available()) return
  try {
    const cache = await caches.open(CACHE_NAME)
    const keys = await cache.keys()
    if (keys.length <= MAX_ENTRIES) return

    const keep = new Set(keepUrls)
    // Cache Storage preserves insertion order, so the front of the list is the
    // oldest. Drop from there, skipping anything still referenced.
    const evictable = keys.filter((req) => !keep.has(req.url))
    const excess = keys.length - MAX_ENTRIES

    await Promise.all(evictable.slice(0, excess).map((req) => cache.delete(req)))
  } catch {
    // Non-fatal.
  }
}

/** Diagnostics for the verification script. */
export async function cacheStats(): Promise<{ entries: number }> {
  if (!available()) return { entries: 0 }
  try {
    const cache = await caches.open(CACHE_NAME)
    return { entries: (await cache.keys()).length }
  } catch {
    return { entries: 0 }
  }
}
