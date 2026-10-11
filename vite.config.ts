import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { offlinePlugin } from './build/offlinePlugin.ts'

export default defineConfig({ base: process.env.BM_BASE_PATH || '/', plugins: [react(), offlinePlugin()] })
