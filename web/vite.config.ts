import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The code font is bundled with the app (src/main.tsx imports it; the rest of the app uses the system font). This preloads its Latin files
// every page uses, so the browser fetches them alongside the CSS instead of after it, and the text
// is drawn in the right font from the start rather than swapping once they arrive.
const PRELOAD = /^(dm-mono-latin-400-normal|dm-mono-latin-500-normal)-[\w-]+\.woff2$/;
function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml(_html, ctx) {
      return Object.keys(ctx.bundle ?? {})
        .filter((f) => PRELOAD.test(f.split('/').pop() ?? ''))
        .map((f) => ({ tag: 'link', injectTo: 'head' as const, attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' } }));
    },
  };
}

// In development the API server runs on :8787; Vite proxies HTTP and WebSocket traffic to it.
export default defineConfig({
  plugins: [react(), preloadFonts()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/collab': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
