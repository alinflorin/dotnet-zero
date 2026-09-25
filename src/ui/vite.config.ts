import path from 'node:path'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The Blazor WASM engine build writes directly into public/engine. Those
// files sit outside the module graph, so trigger a full reload whenever any
// of them change instead of relying on Vite's default asset handling.
function reloadOnEngineChange(): Plugin {
  const engineDir = path.resolve(import.meta.dirname, 'public/engine')

  return {
    name: 'reload-on-engine-change',
    configureServer(server) {
      server.watcher.add(engineDir)
      server.watcher.on('all', (event, file) => {
        if (event !== 'change' && event !== 'add' && event !== 'unlink') return
        if (!path.resolve(file).startsWith(engineDir + path.sep)) return
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}

// The Blazor engine build (WasmEnableThreads) needs SharedArrayBuffer to run Roslyn work
// on background WASM threads, which browsers only expose on cross-origin-isolated pages.
function crossOriginIsolation(): Plugin {
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  }

  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    reloadOnEngineChange(),
    crossOriginIsolation(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Zero',
        short_name: 'Zero',
        description: 'Zero',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The Monaco workers and app bundle legitimately exceed the 2 MiB default.
        maximumFileSizeToCacheInBytes: 1000 * 1024 * 1024,
      },
    }),
  ],
})
