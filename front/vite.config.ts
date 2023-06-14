import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
//const dev_mode = process.env.APP_ENV // This now exists.

// https://vitejs.dev/config/
export default defineConfig({
  //mode: process.env.NODE_ENV ?? 'production',
  plugins: [
    vue(),
    vueJsx(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 3202,
    host: '0.0.0.0'
  },
  build: {
    outDir: '../public/price-admin',
  }
})
