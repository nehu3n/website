// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from "@tailwindcss/vite";
import mermaid from 'astro-mermaid';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://nh3.pages.dev',
  integrations: [mdx(), sitemap(), mermaid({
    theme: 'forest',
    autoTheme: true
  })],

  vite: {
    plugins: [tailwindcss()],
	},

  adapter: cloudflare()
});