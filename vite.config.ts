import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.VITE_PORT) || 8000
  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : []

  return {
    plugins: [vue(), tailwindcss()],
    build: {
      outDir: 'dist/client',
    },
    server: {
      host: true,
      port,
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true
        },
        '/ws': {
          target: 'ws://localhost:3001',
          ws: true
        }
      }
    }
  }
})
