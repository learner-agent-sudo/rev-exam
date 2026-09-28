/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The app is served from https://<owner>.github.io/rev-exam/ on GitHub Pages.
const base = process.env.BASE_PATH ?? '/rev-exam/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // Ask before swapping in a new version, so an update never interrupts a mock exam.
      registerType: 'prompt',
      manifest: {
        name: 'Rev Exam',
        short_name: 'Rev Exam',
        description: 'Exam revision with questions backed by exact book passages.',
        lang: 'en',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f1e7',
        theme_color: '#f6f1e7',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app so it opens offline. Only Latin font subsets are
        // precached; other scripts fall back to system fonts when offline.
        globPatterns: ['**/*.{js,css,html,svg,png}', 'assets/*-latin-*.woff2'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
