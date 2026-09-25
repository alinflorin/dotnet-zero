import fs from 'node:fs'
import path from 'node:path'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The engine build fingerprints its _framework/*.js(.mjs) files (e.g.
// blazor.webassembly.<hash>.js, dotnet.<hash>.js) for cache busting, and the
// hashes change on every engine build. `dotnet publish` normally resolves
// this itself by rewriting index.html's placeholders, but that resolution
// doesn't happen for a plain `dotnet build` (what CopyEngineWebAssets in
// engine.csproj runs), so we do it here instead:
//  - a script tag for the fingerprinted blazor.webassembly.<hash>.js
//  - an import map covering every unfingerprinted path that blazor.webassembly.js
//    and dotnet.js resolve relative to their own URL via bare `import(...)`
//    calls: dotnet.js, dotnet.native.js, dotnet.native.worker.mjs, and
//    dotnet.runtime.js. Missing any of these fails silently until the
//    runtime tries to load that particular piece.
function blazorScriptTag(): Plugin {
  const frameworkDir = path.resolve(import.meta.dirname, 'public/engine/_framework')

  // Matches "<name>.<hash>.<ext>" but not "<name>.native.<hash>.js" or
  // "<name>.runtime.<hash>.js", which fingerprint the same base name.
  function resolveFingerprinted(name: string, ext: string): string {
    const files = fs.existsSync(frameworkDir) ? fs.readdirSync(frameworkDir) : []
    const pattern = new RegExp(`^${name}\\.[a-z0-9]+\\.${ext}$`)
    const match = files.find((file) => pattern.test(file))
    if (!match) {
      throw new Error(
        `Could not find ${name}.<hash>.${ext} in ${frameworkDir}. Build the engine project first.`,
      )
    }
    return `/engine/_framework/${match}`
  }

  return {
    name: 'blazor-script-tag',
    transformIndexHtml() {
      const blazorSrc = resolveFingerprinted('blazor\\.webassembly', 'js')
      const imports = {
        '/engine/_framework/dotnet.js': resolveFingerprinted('dotnet', 'js'),
        '/engine/_framework/dotnet.native.js': resolveFingerprinted('dotnet\\.native', 'js'),
        '/engine/_framework/dotnet.native.worker.mjs': resolveFingerprinted('dotnet\\.native\\.worker', 'mjs'),
        '/engine/_framework/dotnet.runtime.js': resolveFingerprinted('dotnet\\.runtime', 'js'),
      }
      return [
        {
          tag: 'script',
          attrs: { type: 'importmap' },
          children: JSON.stringify({ imports }),
          injectTo: 'body',
        },
        {
          tag: 'script',
          attrs: { src: blazorSrc, autostart: 'false' },
          injectTo: 'body',
        },
      ]
    },
  }
}

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
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          // monaco-editor splits into ~100 tiny per-language/worker chunks by
          // default; bundle it (and @monaco-editor/react) into one chunk
          // instead so it's a single request/cache entry.
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
            return 'monaco'
          }
        },
      },
    },
  },
  optimizeDeps: {
    // monaco-editor ships as hundreds of individual ESM files internally.
    // Without forcing it into the dep pre-bundle, dev mode serves each one
    // as a separate request instead of the single bundled chunk esbuild
    // produces here.
    include: ['monaco-editor', '@monaco-editor/react'],
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    reloadOnEngineChange(),
    crossOriginIsolation(),
    blazorScriptTag(),
    VitePWA({
      registerType: 'prompt',
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
        // vite-plugin-pwa's default globPatterns only covers
        // js/css/html/ico/png/svg/webp, which misses the Blazor WASM
        // engine's own asset types (mjs workers, .dat ICU/timezone data,
        // .pdb symbols, .dll/.blat assemblies) and plenty of ordinary web
        // asset types (fonts, extra image/cursor formats, etc). Rather than
        // maintain an extension allowlist that's always one type behind,
        // precache everything under dist so the app can run fully offline.
        globPatterns: ['**/*'],
      },
    }),
  ],
})
