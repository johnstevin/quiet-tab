/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Unsplash Access Key, for LOCAL/PERSONAL builds only. Set in .env.local
   * (gitignored); see .env.example. This ends up readable inside the built
   * bundle, so a build that carries it must never be distributed.
   */
  readonly VITE_UNSPLASH_ACCESS_KEY?: string
  /**
   * Base URL of the Cloudflare Worker proxy (worker/). When set, Unsplash is
   * reached through it and the Access Key is NOT bundled. This is the only
   * configuration suitable for a published build.
   */
  readonly VITE_UNSPLASH_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
