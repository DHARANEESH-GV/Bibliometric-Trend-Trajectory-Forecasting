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
