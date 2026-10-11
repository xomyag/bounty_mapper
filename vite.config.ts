import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { offlinePlugin } from './build/offlinePlugin.ts'

export default defineConfig({ plugins: [react(), offlinePlugin()] })
