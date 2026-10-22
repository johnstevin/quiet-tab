import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Chrome MV3 extension pages run under the default CSP
//   script-src 'self'; object-src 'self'
// which forbids inline <script> and remote code. Every build option below
// exists to keep the emitted bundle inside that box.
export default defineConfig({
  plugins: [react(), tailwindcss()],

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
})
