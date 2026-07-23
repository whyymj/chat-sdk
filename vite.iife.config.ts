import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * IIFE 全量构建 —— 供 CDN <script> 一行引入(无需 importmap / peer 依赖)
 *
 * 与主 vite.config 的区别:不 external,把 vue / zod / @langchain/* 全部打包进单文件,
 * 暴露全局 window.PageAgent。体积较大(~1.5MB),适合「CDN 直引」场景;
 * npm 安装场景请用主产物(ESM/UMD,peer 外置)。
 */
export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  build: {
    emptyOutDir: false, // 追加到 build:lib 产物,避免清空 ESM/UMD
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      name: 'PageAgent',
      fileName: () => 'page-agent.iife.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: { exports: 'named' },
    },
  },
})
