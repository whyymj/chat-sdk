import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * IIFE 全量构建 —— 供 CDN <script> 一行引入(无需 importmap / peer 依赖)
 *
 * 与主 vite.config 的区别:不 external,把 vue / zod / @langchain/* 全部打包进单文件,
 * 暴露全局 window.ChatSdk。体积较大(~1.5MB),适合「CDN 直引」场景;
 * npm 安装场景请用主产物(ESM/UMD,peer 外置)。
 */
export default defineConfig({
  plugins: [vue()],
  // IIFE 全量把 vue/zod/@langchain 全打包进,这些库引用 Node 的 process(process.env.NODE_ENV / process.version 等);
  // vite 库模式不自动 polyfill,浏览器顶层求值会抛 "process is not defined"。这里两步处置:
  //  1) define 静态替换 NODE_ENV → production(Vue 等走 prod 分支,去 dev 警告代码、减体积)
  //  2) rollup intro 注入 process shim,运行时兜底裸 process / process.version / process.platform 等环境探测
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  publicDir: false,
  build: {
    emptyOutDir: false, // 追加到 build:lib 产物,避免清空 ESM/UMD
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      name: 'ChatSdk',
      fileName: () => 'page-agent-sdk.iife.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        exports: 'named',
        // IIFE 单文件(codeSplitting: false)自动内联动态 import → MCP SDK 经此打进(无需显式 inlineDynamicImports)
        // 注入到 IIFE 函数体顶部(IIFE 内局部 var,不污染全局):宿主有 process(Node)则用之,否则用浏览器 shim
        intro:
          'var process=(typeof process!=="undefined")?process:{env:{NODE_ENV:"production"},version:"",platform:"browser",arch:"browser",versions:{},argv:[]};',
      },
    },
  },
})
