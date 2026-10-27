import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

export default defineConfig({
  plugins: [react(), {
    name: 'toaster-license',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/toaster.txt',
        source: readFileSync(new URL('./src/features/toaster/upstream/LICENSE', import.meta.url), 'utf8'),
      })
    },
  }],
  build: { outDir: '../backend/web/dist', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
  },
})
