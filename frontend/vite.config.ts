import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Stamp of the explainer film currently copied into public/. Bump the
// number after every re-render of biblio-video so browsers never play a
// stale cached MP4 (the src becomes /biblio-explainer.mp4?v=<stamp>).
const FILM_BUILD = '2026-10-14-female-vo'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __FILM_BUILD__: JSON.stringify(FILM_BUILD),
  },
  optimizeDeps: {
    // Pre-bundle everything the dialogs and lazy views need BEFORE the
    // browser asks for it. Without this, Vite discovers e.g.
    // @phosphor-icons/react/dist/csr/Keyboard only when a dialog first
    // mounts, re-optimizes deps mid-session, and force-reloads the page
    // ("optimized dependencies changed. reloading") — every newly opened
    // dialog used to nuke the app state. Listing them here makes the
    // discovery happen at server start instead (Vite docs: use include
    // for imports "with a lot of dynamic imports" the scanner can miss).
    include: [
      // Phosphor deep paths used across dialogs, nav, and lazy views.
      '@phosphor-icons/react/dist/csr/ArrowCounterClockwise',
      '@phosphor-icons/react/dist/csr/ArrowLeft',
      '@phosphor-icons/react/dist/csr/ArrowRight',
      '@phosphor-icons/react/dist/csr/ArrowsLeftRight',
      '@phosphor-icons/react/dist/csr/Check',
      '@phosphor-icons/react/dist/csr/Command',
      '@phosphor-icons/react/dist/csr/Copy',
      '@phosphor-icons/react/dist/csr/DownloadSimple',
      '@phosphor-icons/react/dist/csr/FileText',
      '@phosphor-icons/react/dist/csr/Keyboard',
      '@phosphor-icons/react/dist/csr/Lightning',
      '@phosphor-icons/react/dist/csr/MagnifyingGlass',
      '@phosphor-icons/react/dist/csr/Moon',
      '@phosphor-icons/react/dist/csr/Pause',
      '@phosphor-icons/react/dist/csr/Play',
      '@phosphor-icons/react/dist/csr/Presentation',
      '@phosphor-icons/react/dist/csr/Printer',
      '@phosphor-icons/react/dist/csr/SlidersHorizontal',
      '@phosphor-icons/react/dist/csr/Sparkle',
      '@phosphor-icons/react/dist/csr/Sun',
      '@phosphor-icons/react/dist/csr/Waveform',
      '@phosphor-icons/react/dist/csr/X',
      // Lazily imported by the cover's CTA card and the chart views.
      '@paper-design/shaders-react',
      'gsap',
      'gsap/ScrollTrigger',
      '@gsap/react',
    ],
  },
  resolve: {
    alias: {
      // shadcn convention: '@/components/ui/...' etc. map into src/
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Allow access via public tunnels (e.g. *.lhr.life via localhost.run)
    // while still blocking arbitrary third-party Host headers.
    // NOTE: Vite 5 matches allowedHosts as strings; a leading dot is the
    // subdomain wildcard. RegExp entries silently never match.
    allowedHosts: ['.lhr.life'],
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    // echarts is ~556 kB but is lazy: only the chart views import it, so
    // it never blocks the landing. The limit reflects that known, deferred
    // weight rather than an unsplit initial payload.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the chart engine and the React runtime in named vendor
        // chunks. echarts is reached only via lazy workbench views, so
        // it never enters the landing bundle (bundle rules 2.1/2.4).
        manualChunks: {
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
