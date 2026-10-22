/**
 * Runtime capability detection + build-time configuration.
 */

/**
 * Bundled wallpaper. Always present, always the first thing painted.
 *
 * Procedurally generated (scripts/make-fallback-bg.mjs), ~38KB, no third-party
 * licensing. Its only job is to cover the gap before a real photo fades in,
 * and to look presentable when fully offline.
 */
export const FALLBACK_IMAGE = '/images/fallback-bg.png'

/**
 * True only when running as a real extension page.
 *
 * Why this gate matters: cross-origin `fetch` to bing.com / api.unsplash.com
 * succeeds from an extension page (we hold `host_permissions`) but is blocked
 * by CORS from a plain `http://localhost` dev server. Rather than letting dev
 * and the verification run spew network errors into the console, we simply do
 * not attempt remote fetches outside the extension — dev keeps the bundled
 * wallpaper.
 *
 * Consequence to be aware of: `npm run dev` will never show a live photo. Use
 * `npm run build` + load-unpacked to exercise the wallpaper pipeline.
 */
export function isExtensionRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.local !== 'undefined'
  )
}

/**
 * Unsplash Access Key, injected at build time from .env.local.
 *
 * SECURITY REALITY CHECK: this ends up inside the built bundle. Anyone who
 * unzips the extension or opens DevTools can read it. That is unavoidable for a
 * purely client-side app — keeping it out of git (.env.local is gitignored)
 * prevents accidental publication and nothing more. Shipping this publicly
 * would require proxying Unsplash through a server you control.
 *
 * Only the ACCESS key is used. Unsplash's Secret Key exists solely for OAuth
 * user-authorisation flows and is never needed here.
 */
export const UNSPLASH_ACCESS_KEY: string = import.meta.env.VITE_UNSPLASH_ACCESS_KEY ?? ''

export function hasUnsplashKey(): boolean {
  return UNSPLASH_ACCESS_KEY.length > 0
}

/** Used for the UTM parameters Unsplash's attribution guidelines ask for. */
export const APP_NAME = 'quiet-tab'
