import { isExtensionRuntime } from './env'

/**
 * Key/value persistence with one branch for the extension and one for dev.
 *
 * chrome.storage.local in the extension (10 MB quota, survives restarts);
 * localStorage on the dev server so styling work keeps its state too.
 *
 * Every function swallows its errors. Losing a preference is a cosmetic
 * problem; throwing on a new tab page is not acceptable.
 */

export async function getItem<T>(key: string): Promise<T | null> {
  try {
    if (isExtensionRuntime()) {
      const bag = await chrome.storage.local.get(key)
      return (bag[key] as T | undefined) ?? null
    }
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    if (isExtensionRuntime()) {
      await chrome.storage.local.set({ [key]: value })
      return
    }
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled — not worth surfacing.
  }
}
