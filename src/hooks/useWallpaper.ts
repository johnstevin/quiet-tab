import { useCallback, useEffect, useRef, useState } from 'react'
import { FALLBACK_IMAGE, isExtensionRuntime } from '../lib/env'
import { cacheImage, getCachedBlobUrl, pruneCache } from '../lib/imageCache'
import { batchSize, fetchPhotos, resolveSource } from '../lib/providers'
import { pingUnsplashDownload } from '../lib/providers/unsplash'
import { getItem, setItem } from '../lib/storage'
import { snapshot } from '../lib/time'
import type { Photo, Pool, SourceId } from '../lib/types'
import { wallpaperScope } from '../lib/unsplashCategories'
import type { UnsplashCategoryId } from '../lib/unsplashCategories'

const KEY_PINGED = 'pingedPhotoIds'
const keyPool = (s: SourceId, c: UnsplashCategoryId) => `pool:${wallpaperScope(s, c)}`
const keyIndex = (s: SourceId, c: UnsplashCategoryId) => `index:${wallpaperScope(s, c)}`

export type WallpaperApi = {
  photo: Photo | null
  src: string
  ready: boolean
  busy: boolean
  error: string | null
  next: () => void
  prev: () => void
}

type Operation = { id: number; scope: string }
const describe = (err: unknown) => err instanceof Error ? err.message : String(err)

function dedupe(photos: Photo[]): Photo[] {
  const seen = new Set<string>()
  return photos.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
}

/** Category-scoped batches; only the current operation may change screen state. */
export function useWallpaper(preferredSource: SourceId, enabled: boolean, category: UnsplashCategoryId = 'landscape'): WallpaperApi {
  const [pool, setPool] = useState<Photo[]>([])
  const [index, setIndex] = useState(0)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [src, setSrc] = useState(FALLBACK_IMAGE)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const aliveRef = useRef(true)
  const busyRef = useRef(false)
  const operationRef = useRef(0)
  const poolScopeRef = useRef<string | null>(null)
  const desiredScope = wallpaperScope(resolveSource(preferredSource), category)
  const desiredScopeRef = useRef(desiredScope)
  if (desiredScopeRef.current !== desiredScope) {
    desiredScopeRef.current = desiredScope
    operationRef.current += 1
  }

  const current = useCallback((op: Operation) =>
    aliveRef.current && op.id === operationRef.current && op.scope === desiredScopeRef.current, [])

  const begin = useCallback((scope: string): Operation => {
    const op = { id: ++operationRef.current, scope }
    busyRef.current = true
    setBusy(true)
    setError(null)
    return op
  }, [])

  const finish = useCallback((op: Operation) => {
    if (!current(op)) return
    busyRef.current = false
    setBusy(false)
  }, [current])

  const pingOnce = useCallback(async (item: Photo) => {
    if (!item.downloadLocation) return
    const pinged = (await getItem<string[]>(KEY_PINGED)) ?? []
    if (pinged.includes(item.id)) return
    if (await pingUnsplashDownload(item.downloadLocation)) {
      await setItem(KEY_PINGED, [...pinged.slice(-200), item.id])
    }
  }, [])

  /** Keep the prior image and its credit until the replacement really decodes. */
  const show = useCallback(async (item: Photo, op: Operation): Promise<boolean> => {
    let candidate: string | null = null
    let committed = false
    try {
      candidate = await getCachedBlobUrl(item.url)
      const downloaded = !candidate
      if (!candidate) candidate = await cacheImage(item.url)
      if (!current(op)) return false
      const img = new Image()
      img.src = candidate
      await img.decode()
      if (!current(op)) return false
      const previous = objectUrlRef.current
      objectUrlRef.current = candidate
      setSrc(candidate)
      setPhoto(item)
      setReady(true)
      setError(null)
      committed = true
      if (downloaded) void pingOnce(item)
      if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1200)
      return true
    } finally {
      if (candidate && !committed) URL.revokeObjectURL(candidate)
    }
  }, [current, pingOnce])

  /** Prevent even same-category A-B-A late requests from overwriting the pool. */
  const ensurePool = useCallback(async (source: SourceId, want: number, op: Operation): Promise<Photo[]> => {
    const today = snapshot().dayKey
    const cached = await getItem<Pool>(keyPool(source, category))
    if (!current(op)) return []
    if (cached?.dayKey === today && cached.photos.length >= want) return cached.photos
    const existing = cached?.dayKey === today ? cached.photos : []
    const fresh = await fetchPhotos(source, batchSize(source), undefined, category)
    if (!current(op)) return []
    const merged = dedupe([...existing, ...fresh])
    await setItem<Pool>(keyPool(source, category), { photos: merged, dayKey: today, fetchedAt: Date.now() })
    if (current(op)) void pruneCache(merged.map((p) => p.url))
    return merged
  }, [category, current])

  const go = useCallback((delta: number) => {
    const source = resolveSource(preferredSource)
    const scope = wallpaperScope(source, category)
    if (busyRef.current || poolScopeRef.current !== scope || !enabled) return
    const op = begin(scope)
    void (async () => {
      try {
        let list = pool
        let target = index + delta
        if (target < 0) target = Math.max(0, list.length - 1)
        if (target >= list.length) {
          list = await ensurePool(source, target + 1, op)
          if (!current(op)) return
          if (target >= list.length) target = 0
        }
        const item = list[target]
        if (!item || !current(op)) return
        if (await show(item, op)) {
          setPool(list)
          setIndex(target)
          await setItem(keyIndex(source, category), target)
        }
      } catch (err) {
        if (current(op)) setError(describe(err))
      } finally {
        finish(op)
      }
    })()
  }, [preferredSource, category, enabled, pool, index, begin, current, ensurePool, show, finish])
  const next = useCallback(() => go(1), [go])
  const prev = useCallback(() => go(-1), [go])

  useEffect(() => {
    aliveRef.current = true
    if (!enabled || !isExtensionRuntime()) return
    const source = resolveSource(preferredSource)
    const scope = wallpaperScope(source, category)
    const op = begin(scope)
    void (async () => {
      try {
        const list = await ensurePool(source, 1, op)
        if (!current(op)) return
        const saved = (await getItem<number>(keyIndex(source, category))) ?? 0
        if (!current(op)) return
        const target = Math.min(Math.max(0, saved), Math.max(0, list.length - 1))
        const item = list[target]
        if (item && await show(item, op)) {
          poolScopeRef.current = scope
          setPool(list)
          setIndex(target)
        }
      } catch (err) {
        if (current(op)) setError(describe(err))
      } finally {
        finish(op)
      }
    })()
    return () => { operationRef.current += 1 }
  }, [preferredSource, category, enabled, begin, current, ensurePool, show, finish])

  useEffect(() => () => {
    aliveRef.current = false
    operationRef.current += 1
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  return { photo, src, ready, busy, error, next, prev }
}
