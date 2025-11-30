/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SITE_URL: string
  readonly DEFAULT_LANG: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
