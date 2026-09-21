import { defineConfig } from 'vitest/config'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Cornerstone pulls in vtk.js, which reaches for Node's "events"
      // module. Point it at the browser version so the class that extends
      // EventEmitter can be defined.
      events: 'events/events.js',
    },
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
