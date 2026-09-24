import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync } from 'node:fs'
import type { Plugin } from 'vite'

/** 把 pdf.js 的标准字体与中文字符映射复制到界面的静态资源目录 */
function pdfjsAssets(): Plugin {
  return {
    name: 'pdfjs-assets',
    buildStart() {
      for (const dir of ['standard_fonts', 'cmaps']) {
        const dst = resolve(__dirname, 'src/renderer/public/pdfjs', dir)
        if (!existsSync(dst)) cpSync(resolve(__dirname, 'node_modules/pdfjs-dist', dir), dst, { recursive: true })
      }
    }
  }
}

/** 开发模式下 React 热更新需要内联脚本，仅在开发时放宽安全策略 */
function devCsp(): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  }
}

export default defineConfig({
  main: {
    build: { outDir: 'out/main' }
  },
  preload: {
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [pdfjsAssets(), react(), devCsp()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
