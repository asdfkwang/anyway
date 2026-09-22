import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://asdfkwang.github.io',
  base: '/anyway',
  trailingSlash: 'always',
  output: 'static',
  integrations: [mdx()],
  markdown: { shikiConfig: { theme: 'github-dark', wrap: false } },
});
