/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Unsplash Access Key. Set in .env.local (gitignored); see .env.example.
   * Absent means the Unsplash source is unavailable and we fall back to Bing.
   */
  readonly VITE_UNSPLASH_ACCESS_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
