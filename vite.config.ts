import { defineConfig, type Plugin } from 'vite';

/**
 * The privacy guarantee, enforced by the browser instead of promised in a
 * footer: no outbound connections at all, and every asset must come from this
 * origin. It is injected only for builds — the dev server needs its HMR
 * websocket, which `connect-src 'none'` would kill.
 *
 * Shipping the same policy as a real HTTP header is stronger still (a meta tag
 * cannot restrict things the parser has already acted on); see README.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  // Vite inlines the stylesheet link, but injected <style> needs inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'imgwiz-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  worker: {
    format: 'es',
  },
});
