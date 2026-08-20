import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Semua panggilan /api diteruskan ke server file di port 5174,
    // jadi frontend cukup memakai path relatif seperti '/api/trades'.
    proxy: {
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
})
