// 不要引 node 适配器，先用 dev 跑
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static', // ✅ v2 也支持
  integrations: [ tailwind({ applyBaseStyles: true }) ],
  server: { port: 3000 },
  vite: {
    build: {
      rollupOptions: {
        input: {
          preline: './src/scripts/entries/preline-entry.js',
          'auth-bar': './src/scripts/entries/auth-bar-entry.js',
          'auth-callback': './src/scripts/entries/auth-callback-entry.js',
          'alpha-access': './src/scripts/entries/alpha-access-entry.js',
          'contact-form': './src/scripts/entries/contact-form-entry.js',
          'supabase-client': './src/lib/supabaseClient.ts',
        },
        output: {
          entryFileNames: 'assets/[name].js',
        },
      },
    },
  }
});
