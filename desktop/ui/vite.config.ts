import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../frontend/public', import.meta.url)),
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
      '@phosphor-icons/react': fileURLToPath(new URL('./node_modules/@phosphor-icons/react', import.meta.url)),
      '@paper-design/shaders-react': fileURLToPath(new URL('./node_modules/@paper-design/shaders-react', import.meta.url)),
      three: fileURLToPath(new URL('./node_modules/three', import.meta.url)),
    },
  },
  server: { fs: { allow: [root, fileURLToPath(new URL('../../frontend', import.meta.url))] } },
  build: { outDir: 'dist', emptyOutDir: true },
})
