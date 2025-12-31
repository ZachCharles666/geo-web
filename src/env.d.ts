/// <reference types="astro/client" />

export {};

interface ImportMetaEnv {
  readonly SITE_URL: string;
  readonly DEFAULT_LANG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    supabase?: {
      auth: {
        getSession: () => Promise<{
          data: { session: any };
          error: any;
        }>;
      };
    };
  }
}
