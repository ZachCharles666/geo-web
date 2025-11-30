// 不要引 node 适配器，先用 dev 跑
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static', // ✅ v2 也支持
  integrations: [ tailwind({ applyBaseStyles: true }) ],
  server: { port: 3000 }
});
