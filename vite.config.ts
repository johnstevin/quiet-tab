import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Add only the configured proxy origin to the packaged host permissions. */
function proxyManifest(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const proxy = (env.VITE_UNSPLASH_PROXY_URL ?? '').trim()
  let outputDir = ''
  return {
    name: 'quiet-tab-proxy-manifest',
    apply: 'build',
    configResolved(config) {
      outputDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      if (!proxy) return
      // public/ has been copied at this point. Do not change the source manifest
      // shared with personal builds, and never grant a wildcard across all sites.
      const path = resolve(outputDir, 'manifest.json')
      const data = JSON.parse(await readFile(path, 'utf8'))
      data.host_permissions = [...new Set([
        ...data.host_permissions.filter((p: string) => p !== 'https://api.unsplash.com/*'),
        `${new URL(proxy).origin}/*`,
      ])]
      await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
    },
  }
}
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Refuse to produce a bundle that would leak the Unsplash Access Key while
 * claiming to be the proxied (publishable) configuration.
 *
 * Two build flavours exist:
 *   - personal : VITE_UNSPLASH_ACCESS_KEY set, no proxy. Key is in the bundle.
 *                Fine on your own machine, never to be distributed.
 *   - publish  : VITE_UNSPLASH_PROXY_URL set, NO key. Safe to distribute.
 *
 * Setting both is the dangerous mistake: it looks like the publish flavour but
 * ships the key anyway. Vite inlines every VITE_* variable, so the only
 * reliable guard is to stop the build.
 */
function assertNoKeyLeakWithProxy(mode: string): void {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const key = (env.VITE_UNSPLASH_ACCESS_KEY ?? '').trim()
  const proxy = (env.VITE_UNSPLASH_PROXY_URL ?? '').trim()

  if (proxy && key) {
    throw new Error(
      '\n[quiet-tab] Refusing to build: VITE_UNSPLASH_PROXY_URL and ' +
        'VITE_UNSPLASH_ACCESS_KEY are both set.\n' +
        '  A proxied build must not contain the Access Key (Vite would inline it).\n' +
        '  For a publishable build, remove VITE_UNSPLASH_ACCESS_KEY from the\n' +
        '  environment (including .env.local). For a personal build, remove\n' +
        '  VITE_UNSPLASH_PROXY_URL.\n',
    )
  }
  if (proxy && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(proxy)) {
    throw new Error(`[quiet-tab] VITE_UNSPLASH_PROXY_URL must be an https URL, got "${proxy}"`)
  }
}

// Chrome MV3 extension pages run under the default CSP
//   script-src 'self'; object-src 'self'
// which forbids inline <script> and remote code. Every build option below
// exists to keep the emitted bundle inside that box.
export default defineConfig(({ mode }) => {
  assertNoKeyLeakWithProxy(mode)
  return {
  plugins: [react(), tailwindcss(), proxyManifest(mode)],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,

    // Chrome 120+ is our floor (declared in manifest.json), so we can ship
    // modern output with no legacy transforms.
    target: 'chrome120',

    // CRITICAL for MV3. Vite normally injects its module-preload polyfill as an
    // INLINE <script> in the HTML, which `script-src 'self'` blocks outright —
    // the page would fail to boot with a CSP violation. Disabling it is the
    // single most important setting in this file.
    modulePreload: false,

    // One predictable stylesheet instead of runtime-injected <link> elements.
    cssCodeSplit: false,

    // Never inline assets as `data:` URIs. Keeps dist/ auditable file-by-file
    // and keeps the wallpaper/font out of the CSS payload.
    assetsInlineLimit: 0,

    rollupOptions: {
      // Point at the new-tab document so the HTML lands at dist/newtab.html,
      // exactly where manifest.json's chrome_url_overrides expects it.
      input: { newtab: 'newtab.html' },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  server: {
    port: 5173,
  },
  }
})
